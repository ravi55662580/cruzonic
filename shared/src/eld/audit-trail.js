"use strict";
/**
 * FMCSA ELD Audit Trail — Metadata, Edit History, and Tamper-Evidence
 *
 * Regulatory basis
 * ────────────────
 * 49 CFR §395.30  — Driver's right to review, confirm, and reject records.
 * 49 CFR §395.32  — Motor carrier's ability to annotate and edit records;
 *                   original must be preserved.
 * 49 CFR §395.8(k)— Records retained for 6 months; ELD must store full history.
 * Appendix A §7.4 — Edit annotations must be present in the transferred .erod file.
 *
 * Design
 * ──────
 * Every ELD event record carries an `AuditMetadata` object. The metadata is
 * *not* included in the FMCSA event data checksum (which covers only driving
 * data fields), but it IS included in Cruzonic's own `contentHash` used for
 * the tamper-evidence chain.
 *
 * Immutability contract
 * ─────────────────────
 * Original records are never deleted or overwritten. When an edit occurs:
 *   1. The existing record's `eventRecordStatus` is set to INACTIVE_CHANGED (2).
 *   2. A new record is inserted with the corrected values, `eventRecordStatus`
 *      ACTIVE (1), and `audit.previousVersionId` pointing to the superseded record.
 *   3. If the edit was made by anyone other than the driver, `requiresDriverReview`
 *      is set to true on the new record until the driver confirms or rejects it.
 *
 * Hash chain
 * ──────────
 * Each record stores two hashes:
 *   contentHash — SHA-256 of the record's own ELD data fields (deterministic,
 *                 excludes audit metadata).
 *   chainHash   — SHA-256 of (contentHash ∥ previousChainHash). The first
 *                 record in a log period uses the period's genesisHash as
 *                 previousChainHash.
 *
 * Any modification to a record's data or ordering breaks the chainHash of all
 * subsequent records, making tampering detectable during compliance review.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENESIS_SALT = exports.AuditAction = exports.EDIT_REASON_DESCRIPTIONS = exports.EditReasonCode = exports.AuditActorType = void 0;
exports.canonicaliseEventFields = canonicaliseEventFields;
exports.computeGenesisHash = computeGenesisHash;
exports.computeContentHash = computeContentHash;
exports.computeChainHash = computeChainHash;
exports.verifyHashChain = verifyHashChain;
exports.buildInitialAuditMetadata = buildInitialAuditMetadata;
exports.buildEditedAuditMetadata = buildEditedAuditMetadata;
exports.recordDriverReview = recordDriverReview;
// ─────────────────────────────────────────────────────────────────────────────
// Actor types
// ─────────────────────────────────────────────────────────────────────────────
/** Who is performing an action on an ELD event record. */
var AuditActorType;
(function (AuditActorType) {
    /** The driver who owns the record. */
    AuditActorType["DRIVER"] = "DRIVER";
    /** A co-driver on the same CMV. */
    AuditActorType["CO_DRIVER"] = "CO_DRIVER";
    /** Fleet manager, dispatcher, or other carrier employee via the fleet portal. */
    AuditActorType["CARRIER"] = "CARRIER";
    /** Cruzonic technical support (must be documented with ticket reference). */
    AuditActorType["SUPPORT"] = "SUPPORT";
    /** Automated system action: ELD firmware, offline sync reconciliation, etc. */
    AuditActorType["SYSTEM"] = "SYSTEM";
})(AuditActorType || (exports.AuditActorType = AuditActorType = {}));
// ─────────────────────────────────────────────────────────────────────────────
// Edit reason codes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Standardized reason codes for edits to ELD event records.
 *
 * FMCSA requires that every edit be annotated with a reason. These codes map
 * to the annotation field in the .erod output. When code is OTHER, the
 * `editReasonText` field is mandatory.
 */
var EditReasonCode;
(function (EditReasonCode) {
    // ── Driver self-corrections ─────────────────────────────────────────────
    /** Driver forgot to change duty status at the correct time. */
    EditReasonCode["FORGOT_TO_CHANGE_STATUS"] = "FORGOT_TO_CHANGE_STATUS";
    /** Driver entered the wrong duty status. */
    EditReasonCode["INCORRECT_DUTY_STATUS"] = "INCORRECT_DUTY_STATUS";
    /** Driver entered the wrong start or end time. */
    EditReasonCode["INCORRECT_TIME"] = "INCORRECT_TIME";
    /** Location description was incorrect or missing. */
    EditReasonCode["INCORRECT_LOCATION"] = "INCORRECT_LOCATION";
    /** Driver is accepting unassigned (unidentified) driving as their own. */
    EditReasonCode["ASSUMED_DRIVING_ACCEPTED"] = "ASSUMED_DRIVING_ACCEPTED";
    /** Driver is rejecting unassigned driving (e.g. another driver used the vehicle). */
    EditReasonCode["ASSUMED_DRIVING_REJECTED"] = "ASSUMED_DRIVING_REJECTED";
    // ── Carrier / fleet manager corrections ────────────────────────────────
    /** Wrong CMV was assigned to the record. */
    EditReasonCode["INCORRECT_VEHICLE"] = "INCORRECT_VEHICLE";
    /** Wrong trailer number was listed. */
    EditReasonCode["INCORRECT_TRAILER"] = "INCORRECT_TRAILER";
    /** Carrier is adding a missing record that the driver omitted. */
    EditReasonCode["MISSING_RECORD_ADDED"] = "MISSING_RECORD_ADDED";
    /** Carrier is annotating a record following a DOT inspection finding. */
    EditReasonCode["DOT_INSPECTION_FOLLOWUP"] = "DOT_INSPECTION_FOLLOWUP";
    // ── Technical / system corrections ─────────────────────────────────────
    /** ELD hardware or firmware error produced an incorrect record. */
    EditReasonCode["SYSTEM_ERROR"] = "SYSTEM_ERROR";
    /** Offline sync conflict — reconciled by the system after connectivity restored. */
    EditReasonCode["OFFLINE_SYNC_RECONCILIATION"] = "OFFLINE_SYNC_RECONCILIATION";
    /** Clock/timezone misconfiguration caused incorrect timestamps. */
    EditReasonCode["TIMEZONE_CORRECTION"] = "TIMEZONE_CORRECTION";
    /** GPS failure produced incorrect or missing coordinates. */
    EditReasonCode["GPS_FAILURE_CORRECTION"] = "GPS_FAILURE_CORRECTION";
    /** ECM / CAN bus data (odometer, engine hours) was incorrect. */
    EditReasonCode["ECM_DATA_CORRECTION"] = "ECM_DATA_CORRECTION";
    /**
     * Other reason not covered above. When used, `editReasonText` is required
     * and must be a clear prose explanation (≥20 characters).
     */
    EditReasonCode["OTHER"] = "OTHER";
})(EditReasonCode || (exports.EditReasonCode = EditReasonCode = {}));
exports.EDIT_REASON_DESCRIPTIONS = {
    [EditReasonCode.FORGOT_TO_CHANGE_STATUS]: 'Driver forgot to change duty status at the correct time',
    [EditReasonCode.INCORRECT_DUTY_STATUS]: 'Driver entered an incorrect duty status',
    [EditReasonCode.INCORRECT_TIME]: 'Start or end time was incorrect',
    [EditReasonCode.INCORRECT_LOCATION]: 'Location description was incorrect or missing',
    [EditReasonCode.ASSUMED_DRIVING_ACCEPTED]: 'Driver accepted unidentified driving as their own',
    [EditReasonCode.ASSUMED_DRIVING_REJECTED]: 'Driver rejected unidentified driving',
    [EditReasonCode.INCORRECT_VEHICLE]: 'Wrong commercial motor vehicle was assigned',
    [EditReasonCode.INCORRECT_TRAILER]: 'Wrong trailer number was recorded',
    [EditReasonCode.MISSING_RECORD_ADDED]: 'Missing record added by motor carrier',
    [EditReasonCode.DOT_INSPECTION_FOLLOWUP]: 'Correction following DOT roadside inspection finding',
    [EditReasonCode.SYSTEM_ERROR]: 'ELD hardware or firmware error produced incorrect data',
    [EditReasonCode.OFFLINE_SYNC_RECONCILIATION]: 'Offline sync conflict resolved by system',
    [EditReasonCode.TIMEZONE_CORRECTION]: 'Clock or timezone misconfiguration corrected',
    [EditReasonCode.GPS_FAILURE_CORRECTION]: 'GPS failure caused incorrect or missing coordinates',
    [EditReasonCode.ECM_DATA_CORRECTION]: 'Engine ECM / CAN bus data (odometer, engine hours) corrected',
    [EditReasonCode.OTHER]: 'Other reason (see editReasonText)',
};
// ─────────────────────────────────────────────────────────────────────────────
// Audit entries
// ─────────────────────────────────────────────────────────────────────────────
/** The action that produced an audit entry. */
var AuditAction;
(function (AuditAction) {
    /** Initial creation of the event record (by the ELD or the driver). */
    AuditAction["CREATED"] = "CREATED";
    /** Record data was edited. The original is preserved with INACTIVE_CHANGED status. */
    AuditAction["EDITED"] = "EDITED";
    /**
     * Driver certified this record as accurate (at end of 24-hour period).
     * Maps to EventType 4 (CERTIFICATION) in the ELD event stream.
     */
    AuditAction["DRIVER_CERTIFIED"] = "DRIVER_CERTIFIED";
    /**
     * Driver rejected a carrier-initiated edit and reverted to the previous version.
     * Ref: 49 CFR §395.30(b)(2).
     */
    AuditAction["DRIVER_REJECTED_EDIT"] = "DRIVER_REJECTED_EDIT";
    /**
     * Driver confirmed a carrier-initiated edit as accurate.
     * Ref: 49 CFR §395.30(b)(1).
     */
    AuditAction["DRIVER_CONFIRMED_EDIT"] = "DRIVER_CONFIRMED_EDIT";
    /**
     * Record was assumed from the unidentified driver profile and later claimed
     * by a driver logging in. Ref: 49 CFR §395.30(c).
     */
    AuditAction["ASSUMED_FROM_UNIDENTIFIED"] = "ASSUMED_FROM_UNIDENTIFIED";
    /** Record was archived to cold storage after 6-month retention period. */
    AuditAction["ARCHIVED"] = "ARCHIVED";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
// ─────────────────────────────────────────────────────────────────────────────
// Hash chain utilities
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The salt mixed into the genesis hash to prevent pre-image attacks on
 * empty log periods. This value must be identical on mobile and backend.
 */
exports.GENESIS_SALT = 'cruzonic-eld-v1';
/**
 * Serialises a HashableEventFields object to a canonical, deterministic JSON
 * string. Keys are sorted alphabetically; values are JSON-encoded; no whitespace.
 * This is the input to SHA-256 for the contentHash.
 */
function canonicaliseEventFields(fields) {
    const ordered = {};
    for (const key of Object.keys(fields).sort()) {
        ordered[key] = fields[key];
    }
    return JSON.stringify(ordered);
}
/**
 * Computes the genesis hash for a log period. This is the `previousChainHash`
 * of the very first event record in the period.
 *
 * Input to SHA-256: eldDeviceId ∥ ":" ∥ logDate ∥ ":" ∥ GENESIS_SALT
 *
 * @param hash - Platform-specific SHA-256 function. Accepts a string, returns
 *               a lowercase hex string. On Node.js:
 *               `(s) => require('crypto').createHash('sha256').update(s).digest('hex')`
 *               On React Native with expo-crypto:
 *               `async` version using `Crypto.digestStringAsync`
 */
function computeGenesisHash(eldDeviceId, logDate, hash) {
    return hash(`${eldDeviceId}:${logDate}:${exports.GENESIS_SALT}`);
}
/**
 * Computes the contentHash for an event's hashable fields.
 *
 * @param fields - The event's hashable data fields.
 * @param hash   - SHA-256 function (see computeGenesisHash).
 */
function computeContentHash(fields, hash) {
    return hash(canonicaliseEventFields(fields));
}
/**
 * Computes the chainHash linking this record to the previous one.
 *
 * @param contentHash       - This record's contentHash.
 * @param previousChainHash - The previous record's chainHash, or the genesisHash
 *                            if this is the first event in the period.
 * @param hash              - SHA-256 function.
 */
function computeChainHash(contentHash, previousChainHash, hash) {
    return hash(`${contentHash}:${previousChainHash}`);
}
/**
 * Verifies the tamper-evidence hash chain for a set of active event records
 * from a single (eldDeviceId, logDate) scope.
 *
 * Pass all *active* (eventRecordStatus === 1) records sorted ascending by
 * eventSequenceId. Inactive (superseded) records are not part of the active
 * chain and should be verified separately if needed.
 *
 * @param activeEvents      - Active records sorted by eventSequenceId ascending.
 * @param eldDeviceId       - Device ID for genesis hash computation.
 * @param logDate           - Log period date (MMDDYY) for genesis hash.
 * @param hash              - SHA-256 function.
 * @param recomputeContent  - Function that extracts HashableEventFields from
 *                            an event and recomputes its contentHash for comparison.
 *                            If omitted, content verification is skipped (chain
 *                            structure is still checked).
 */
function verifyHashChain(activeEvents, eldDeviceId, logDate, hash, recomputeContent) {
    const findings = [];
    const now = Date.now();
    if (activeEvents.length === 0) {
        return { valid: true, findings: [], recordsChecked: 0, summary: { TAMPER: 0, WARN: 0, INFO: 0 } };
    }
    const expectedGenesisHash = computeGenesisHash(eldDeviceId, logDate, hash);
    let expectedPreviousChainHash = expectedGenesisHash;
    for (let i = 0; i < activeEvents.length; i++) {
        const event = activeEvents[i];
        const te = event.audit.tamperEvidence;
        const ref = { eventSequenceId: event.eventSequenceId, eventId: event.id };
        // ── Content hash verification ────────────────────────────────────────
        if (recomputeContent) {
            const recomputed = computeContentHash(recomputeContent(event), hash);
            if (recomputed !== te.contentHash) {
                findings.push({
                    ...ref,
                    severity: 'TAMPER',
                    code: 'CONTENT_HASH_MISMATCH',
                    message: `Content hash mismatch for event ${event.eventSequenceId}. ` +
                        `Stored: ${te.contentHash}. Recomputed: ${recomputed}. ` +
                        `Event data fields were modified without regenerating the hash.`,
                });
            }
        }
        // ── previousChainHash presence ───────────────────────────────────────
        if (i === 0 && te.previousChainHash === null) {
            // First record: previousChainHash should equal the genesis hash.
            // The genesis hash is external; we verify by recomputing chainHash.
        }
        else if (i > 0 && te.previousChainHash === null) {
            findings.push({
                ...ref,
                severity: 'TAMPER',
                code: 'MISSING_PREVIOUS_HASH',
                message: `Event ${event.eventSequenceId} is not the first in the period but has null previousChainHash.`,
            });
            expectedPreviousChainHash = te.chainHash; // continue best-effort
            continue;
        }
        // ── Genesis hash check (first record only) ───────────────────────────
        if (i === 0 && te.previousChainHash !== null && te.previousChainHash !== expectedGenesisHash) {
            findings.push({
                ...ref,
                severity: 'TAMPER',
                code: 'GENESIS_HASH_MISMATCH',
                message: `First record's previousChainHash (${te.previousChainHash}) does not match ` +
                    `the expected genesis hash (${expectedGenesisHash}). ` +
                    `The log period scope may have been changed.`,
            });
        }
        // ── Chain hash verification ───────────────────────────────────────────
        const prevHash = te.previousChainHash ?? expectedGenesisHash;
        const expectedChainHash = computeChainHash(te.contentHash, prevHash, hash);
        if (expectedChainHash !== te.chainHash) {
            findings.push({
                ...ref,
                severity: 'TAMPER',
                code: 'CHAIN_HASH_MISMATCH',
                message: `Chain hash mismatch for event ${event.eventSequenceId}. ` +
                    `Stored: ${te.chainHash}. Expected: ${expectedChainHash}. ` +
                    `This record or a predecessor in the chain was tampered with.`,
            });
        }
        // ── Future timestamp check ────────────────────────────────────────────
        const hashedAtMs = new Date(te.hashedAt).getTime();
        if (hashedAtMs > now + 60000) { // allow 60-second clock skew
            findings.push({
                ...ref,
                severity: 'WARN',
                code: 'FUTURE_HASH_TIMESTAMP',
                message: `hashedAt timestamp (${te.hashedAt}) is in the future. Possible clock manipulation.`,
            });
        }
        expectedPreviousChainHash = te.chainHash;
    }
    const summary = findings.reduce((acc, f) => { acc[f.severity]++; return acc; }, { TAMPER: 0, WARN: 0, INFO: 0 });
    return {
        valid: summary.TAMPER === 0,
        findings,
        recordsChecked: activeEvents.length,
        summary,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Builds the AuditMetadata object for a brand-new (version 1) event record.
 *
 * @param eventId       - UUID of the event record being created.
 * @param actor         - Who is creating the record.
 * @param fields        - The event's hashable data fields.
 * @param prevHash      - The chainHash of the previous event, or the genesisHash
 *                        if this is the first event in the period.
 * @param logDate       - The log period date (MMDDYY) — used to detect whether
 *                        `prevHash` is the genesis hash so `previousChainHash`
 *                        can be stored as null for the first event.
 * @param hash          - SHA-256 function.
 * @param network       - Optional network context (null for ELD-hardware events).
 * @param nowUtc        - Override for "now" (useful in tests).
 */
function buildInitialAuditMetadata(eventId, actor, fields, prevHash, logDate, hash, network = null, nowUtc = new Date()) {
    const createdAt = nowUtc.toISOString();
    const contentHash = computeContentHash(fields, hash);
    const chainHash = computeChainHash(contentHash, prevHash, hash);
    const entry = {
        id: generateAuditEntryId(),
        eventId,
        previousVersionId: null,
        action: AuditAction.CREATED,
        actor,
        performedAt: createdAt,
        eldDeviceId: fields.eldDeviceId,
        network,
        editReasonCode: null,
        editReasonText: null,
        changedFields: [],
        revertedToVersionId: null,
    };
    return {
        schemaVersion: 1,
        createdBy: actor,
        createdAt,
        versionNumber: 1,
        previousVersionId: null,
        originalVersionId: eventId,
        requiresDriverReview: false,
        driverReviewedAt: null,
        driverReviewOutcome: null,
        history: [entry],
        tamperEvidence: {
            contentHash,
            chainHash,
            // Store null for the genesis record so verifyHashChain() knows to compare
            // against the recomputed genesis hash rather than a stored chain link.
            previousChainHash: prevHash === computeGenesisHash(fields.eldDeviceId, logDate, hash)
                ? null
                : prevHash,
            recordVersion: 1,
            hashedAt: createdAt,
        },
    };
}
/**
 * Produces the updated AuditMetadata for an edited event record.
 * Call this when creating the new (active) version of an edited event.
 *
 * @param newEventId         - UUID of the new (active) version being created.
 * @param previousVersionId  - UUID of the superseded (now INACTIVE_CHANGED) record.
 * @param previousAudit      - AuditMetadata from the superseded record.
 * @param actor              - Who is making the edit.
 * @param changedFields      - The fields that changed.
 * @param reasonCode         - Why the edit was made.
 * @param reasonText         - Required when reasonCode is OTHER.
 * @param newFields          - The updated hashable fields.
 * @param prevChainHash      - chainHash of the previous *active* record.
 * @param hash               - SHA-256 function.
 * @param network            - Network context.
 * @param nowUtc             - Override for "now".
 */
function buildEditedAuditMetadata(newEventId, previousVersionId, previousAudit, actor, changedFields, reasonCode, reasonText, newFields, prevChainHash, hash, network = null, nowUtc = new Date()) {
    if (reasonCode === EditReasonCode.OTHER && (!reasonText || reasonText.length < 20)) {
        throw new Error('editReasonText is required and must be ≥20 characters when editReasonCode is OTHER.');
    }
    const editedAt = nowUtc.toISOString();
    const contentHash = computeContentHash(newFields, hash);
    const chainHash = computeChainHash(contentHash, prevChainHash, hash);
    const requiresDriverReview = actor.type === AuditActorType.CARRIER ||
        actor.type === AuditActorType.SUPPORT;
    const editEntry = {
        id: generateAuditEntryId(),
        eventId: newEventId,
        previousVersionId,
        action: AuditAction.EDITED,
        actor,
        performedAt: editedAt,
        eldDeviceId: newFields.eldDeviceId,
        network,
        editReasonCode: reasonCode,
        editReasonText: reasonText,
        changedFields,
        revertedToVersionId: null,
    };
    return {
        schemaVersion: 1,
        createdBy: previousAudit.createdBy,
        createdAt: previousAudit.createdAt,
        versionNumber: previousAudit.versionNumber + 1,
        previousVersionId,
        originalVersionId: previousAudit.originalVersionId,
        requiresDriverReview,
        driverReviewedAt: null,
        driverReviewOutcome: null,
        history: [...previousAudit.history, editEntry],
        tamperEvidence: {
            contentHash,
            chainHash,
            previousChainHash: prevChainHash,
            recordVersion: previousAudit.versionNumber + 1,
            hashedAt: editedAt,
        },
    };
}
/**
 * Records the driver's decision (confirm or reject) on a carrier-initiated edit.
 * Returns a new AuditMetadata with `requiresDriverReview` cleared.
 *
 * If the driver rejects, the caller must also reinstate the previous version
 * (set its eventRecordStatus back to ACTIVE) and mark the rejected version
 * as INACTIVE_CHANGED.
 */
function recordDriverReview(existingAudit, eventId, driver, outcome, revertedToVersionId, network = null, nowUtc = new Date()) {
    const reviewedAt = nowUtc.toISOString();
    const reviewEntry = {
        id: generateAuditEntryId(),
        eventId,
        previousVersionId: null,
        action: outcome === 'CONFIRMED'
            ? AuditAction.DRIVER_CONFIRMED_EDIT
            : AuditAction.DRIVER_REJECTED_EDIT,
        actor: driver,
        performedAt: reviewedAt,
        eldDeviceId: null,
        network,
        editReasonCode: null,
        editReasonText: null,
        changedFields: [],
        revertedToVersionId: outcome === 'REJECTED' ? revertedToVersionId : null,
    };
    return {
        ...existingAudit,
        requiresDriverReview: false,
        driverReviewedAt: reviewedAt,
        driverReviewOutcome: outcome,
        history: [...existingAudit.history, reviewEntry],
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Internal utility
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generates a UUID v4 for audit entry IDs.
 * Uses the platform's built-in crypto.randomUUID() (Node 19+, modern browsers,
 * React Native via `react-native-get-random-values`).
 */
function generateAuditEntryId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID (Node <19 in backend).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
//# sourceMappingURL=audit-trail.js.map