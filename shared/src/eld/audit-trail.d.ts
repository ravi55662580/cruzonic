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
/** Who is performing an action on an ELD event record. */
export declare enum AuditActorType {
    /** The driver who owns the record. */
    DRIVER = "DRIVER",
    /** A co-driver on the same CMV. */
    CO_DRIVER = "CO_DRIVER",
    /** Fleet manager, dispatcher, or other carrier employee via the fleet portal. */
    CARRIER = "CARRIER",
    /** Cruzonic technical support (must be documented with ticket reference). */
    SUPPORT = "SUPPORT",
    /** Automated system action: ELD firmware, offline sync reconciliation, etc. */
    SYSTEM = "SYSTEM"
}
/** Identifies a specific person or process that acted on a record. */
export interface AuditActor {
    type: AuditActorType;
    /** Supabase auth.users UUID for human actors. Null for SYSTEM actions. */
    userId: string | null;
    /** Human-readable display name (driver full name, manager name, "ELD-SYNC", etc.). */
    displayName: string;
    /**
     * For CARRIER and SUPPORT actors: the UUID of the fleet/organization
     * in the Cruzonic multi-tenant data model.
     */
    organizationId?: string;
}
/**
 * Standardized reason codes for edits to ELD event records.
 *
 * FMCSA requires that every edit be annotated with a reason. These codes map
 * to the annotation field in the .erod output. When code is OTHER, the
 * `editReasonText` field is mandatory.
 */
export declare enum EditReasonCode {
    /** Driver forgot to change duty status at the correct time. */
    FORGOT_TO_CHANGE_STATUS = "FORGOT_TO_CHANGE_STATUS",
    /** Driver entered the wrong duty status. */
    INCORRECT_DUTY_STATUS = "INCORRECT_DUTY_STATUS",
    /** Driver entered the wrong start or end time. */
    INCORRECT_TIME = "INCORRECT_TIME",
    /** Location description was incorrect or missing. */
    INCORRECT_LOCATION = "INCORRECT_LOCATION",
    /** Driver is accepting unassigned (unidentified) driving as their own. */
    ASSUMED_DRIVING_ACCEPTED = "ASSUMED_DRIVING_ACCEPTED",
    /** Driver is rejecting unassigned driving (e.g. another driver used the vehicle). */
    ASSUMED_DRIVING_REJECTED = "ASSUMED_DRIVING_REJECTED",
    /** Wrong CMV was assigned to the record. */
    INCORRECT_VEHICLE = "INCORRECT_VEHICLE",
    /** Wrong trailer number was listed. */
    INCORRECT_TRAILER = "INCORRECT_TRAILER",
    /** Carrier is adding a missing record that the driver omitted. */
    MISSING_RECORD_ADDED = "MISSING_RECORD_ADDED",
    /** Carrier is annotating a record following a DOT inspection finding. */
    DOT_INSPECTION_FOLLOWUP = "DOT_INSPECTION_FOLLOWUP",
    /** ELD hardware or firmware error produced an incorrect record. */
    SYSTEM_ERROR = "SYSTEM_ERROR",
    /** Offline sync conflict — reconciled by the system after connectivity restored. */
    OFFLINE_SYNC_RECONCILIATION = "OFFLINE_SYNC_RECONCILIATION",
    /** Clock/timezone misconfiguration caused incorrect timestamps. */
    TIMEZONE_CORRECTION = "TIMEZONE_CORRECTION",
    /** GPS failure produced incorrect or missing coordinates. */
    GPS_FAILURE_CORRECTION = "GPS_FAILURE_CORRECTION",
    /** ECM / CAN bus data (odometer, engine hours) was incorrect. */
    ECM_DATA_CORRECTION = "ECM_DATA_CORRECTION",
    /**
     * Other reason not covered above. When used, `editReasonText` is required
     * and must be a clear prose explanation (≥20 characters).
     */
    OTHER = "OTHER"
}
export declare const EDIT_REASON_DESCRIPTIONS: Record<EditReasonCode, string>;
/**
 * Records what changed in a single field during an edit.
 * Stored in JSON so the full diff is queryable in Supabase.
 */
export interface FieldDiff {
    /**
     * Dot-notation path to the changed field within the event record.
     * @example "eventSubType"
     * @example "location.locationDescription"
     * @example "driver.driverEldAccountId"
     */
    fieldPath: string;
    /**
     * The value before the edit. Null if the field did not previously exist
     * (field was added by the edit).
     */
    previousValue: unknown;
    /**
     * The value after the edit. Null if the field was removed.
     */
    newValue: unknown;
    /**
     * True when this field is one of the FMCSA-required fields listed in
     * Appendix A §7.3. Changes to required fields are more significant for
     * compliance review.
     */
    isRequiredField: boolean;
}
/** The action that produced an audit entry. */
export declare enum AuditAction {
    /** Initial creation of the event record (by the ELD or the driver). */
    CREATED = "CREATED",
    /** Record data was edited. The original is preserved with INACTIVE_CHANGED status. */
    EDITED = "EDITED",
    /**
     * Driver certified this record as accurate (at end of 24-hour period).
     * Maps to EventType 4 (CERTIFICATION) in the ELD event stream.
     */
    DRIVER_CERTIFIED = "DRIVER_CERTIFIED",
    /**
     * Driver rejected a carrier-initiated edit and reverted to the previous version.
     * Ref: 49 CFR §395.30(b)(2).
     */
    DRIVER_REJECTED_EDIT = "DRIVER_REJECTED_EDIT",
    /**
     * Driver confirmed a carrier-initiated edit as accurate.
     * Ref: 49 CFR §395.30(b)(1).
     */
    DRIVER_CONFIRMED_EDIT = "DRIVER_CONFIRMED_EDIT",
    /**
     * Record was assumed from the unidentified driver profile and later claimed
     * by a driver logging in. Ref: 49 CFR §395.30(c).
     */
    ASSUMED_FROM_UNIDENTIFIED = "ASSUMED_FROM_UNIDENTIFIED",
    /** Record was archived to cold storage after 6-month retention period. */
    ARCHIVED = "ARCHIVED"
}
/**
 * A single entry in the audit trail for one event record.
 * Each action produces exactly one AuditEntry, stored append-only.
 */
export interface AuditEntry {
    /** UUID of this audit entry. */
    id: string;
    /** UUID of the ELD event record this entry describes. */
    eventId: string;
    /**
     * UUID of the previous version of this event record.
     * Null for CREATED entries. For EDITED entries, this points to the
     * superseded (now INACTIVE_CHANGED) record.
     */
    previousVersionId: string | null;
    action: AuditAction;
    actor: AuditActor;
    /** ISO 8601 UTC timestamp when this action was performed. */
    performedAt: string;
    /** ELD device registration ID from which the action originated (if hardware). */
    eldDeviceId: string | null;
    /**
     * Network details of the client that performed the action.
     * Null for ELD-hardware-generated events (those originate via BT/USB).
     */
    network: NetworkContext | null;
    /**
     * Reason for the edit. Required when action is EDITED; null otherwise.
     * When code is OTHER, editReasonText must be at least 20 characters.
     */
    editReasonCode: EditReasonCode | null;
    /** Free-text explanation. Required when editReasonCode is OTHER. */
    editReasonText: string | null;
    /**
     * Field-level diff showing exactly what changed.
     * Empty array for CREATED, CERTIFIED, CONFIRMED, REJECTED, ARCHIVED entries.
     */
    changedFields: FieldDiff[];
    /**
     * For DRIVER_REJECTED_EDIT: the UUID of the version the driver reverted to.
     * For all other actions: null.
     */
    revertedToVersionId: string | null;
}
/** Network context captured at the time of a portal or API action. */
export interface NetworkContext {
    /**
     * IPv4 or IPv6 address of the request origin.
     * For fleet portal actions: the user's IP.
     * For API actions: the client's IP from the X-Forwarded-For header.
     */
    ipAddress: string;
    /**
     * User-Agent string of the client that performed the action.
     * Useful for identifying whether the edit came from the mobile app or portal.
     */
    userAgent: string;
    /**
     * If the request came through the mobile app, the device's unique identifier
     * (Expo's `Application.androidId` or `identifierForVendor` on iOS).
     */
    mobileDeviceId?: string;
}
/**
 * Hash-chain fields stored on every ELD event record.
 *
 * Chain construction
 * ──────────────────
 * For the first event in a log period:
 *   genesisHash   = SHA-256( eldDeviceId ∥ logDate ∥ GENESIS_SALT )
 *   contentHash   = SHA-256( canonicalise(eventDataFields) )
 *   chainHash     = SHA-256( contentHash ∥ genesisHash )
 *
 * For every subsequent event (ordered by eventSequenceId):
 *   contentHash   = SHA-256( canonicalise(eventDataFields) )
 *   chainHash     = SHA-256( contentHash ∥ previousEvent.chainHash )
 *
 * Tamper detection
 * ────────────────
 * If any event's data fields are modified without updating the chain, its own
 * contentHash will no longer match, and the chainHash of every following event
 * will also be incorrect. A single pass over the sorted event list detects
 * all tampering.
 *
 * Editing without breaking the chain (legitimate edits)
 * ─────────────────────────────────────────────────────
 * When a record is legitimately edited:
 *   1. The original record is preserved with INACTIVE_CHANGED status. Its
 *      hashes remain unchanged and verifiable.
 *   2. The new (active) record is appended to the sequence with a new
 *      contentHash and a chainHash linking from the previous active record.
 *   3. The compliance generator rebuilds the active-records chain when
 *      producing the .erod file.
 */
export interface TamperEvidence {
    /**
     * SHA-256 hex digest of the canonical JSON representation of the event's
     * ELD data fields (excludes `audit` metadata — those can change without
     * constituting falsification).
     *
     * Fields included in the hash input (in key-sorted JSON, no whitespace):
     *   eventSequenceId, eventType, eventSubType, eventDate, eventTime,
     *   timezoneOffset, accumulatedVehicleMiles, elapsedEngineHours,
     *   latitude, longitude, driverEldAccountId, eldDeviceId,
     *   eventDataCheckValue (FMCSA's own checksum)
     */
    contentHash: string;
    /**
     * SHA-256 hex digest linking this record to the previous record in the chain.
     * = SHA-256( contentHash ∥ previousChainHash )
     *
     * Null for the first event in a log period (chain starts at genesisHash).
     */
    chainHash: string;
    /**
     * The chainHash of the immediately preceding event in this log period
     * (sorted by eventSequenceId). Used to verify this record's chainHash.
     *
     * Null for the first event (genesis record).
     */
    previousChainHash: string | null;
    /**
     * The version number of this record (1 = original, 2 = first edit, etc.).
     * Correlates with `AuditMetadata.versionNumber`.
     */
    recordVersion: number;
    /**
     * ISO 8601 UTC timestamp when the hashes were computed.
     * For records created by the ELD device, this equals the event timestamp.
     * For backend-computed hashes (sync), this may be later.
     */
    hashedAt: string;
}
/**
 * The inputs that are canonicalised and hashed to produce contentHash.
 * Keeping this as a separate type prevents accidental omission of fields.
 */
export interface HashableEventFields {
    eventSequenceId: number;
    eventType: number;
    eventSubType: number;
    eventDate: string;
    eventTime: string;
    timezoneOffset: string;
    accumulatedVehicleMiles: number;
    elapsedEngineHours: number;
    latitude: number | null;
    longitude: number | null;
    driverEldAccountId: string;
    eldDeviceId: string;
    /** FMCSA's own two-hex-char checksum (Appendix A §7.3.2). */
    eventDataCheckValue: string;
}
/**
 * Embedded on every ELD event record. Contains the complete provenance of the
 * record: who created it, all edits, driver review status, and hash-chain fields.
 */
export interface AuditMetadata {
    /** Version of this audit schema. Increment when the shape changes. */
    schemaVersion: 1;
    /** The actor and timestamp of the initial creation. */
    createdBy: AuditActor;
    /** ISO 8601 UTC timestamp when this record was first created. */
    createdAt: string;
    /**
     * Monotonically increasing version counter.
     * 1 = original record. Incremented by 1 with every accepted edit.
     */
    versionNumber: number;
    /**
     * UUID of the immediately preceding version of this record.
     * Null for version 1 (original).
     */
    previousVersionId: string | null;
    /**
     * UUID of the very first (version 1) record in this event's history.
     * Allows jumping directly to the original without traversing the full chain.
     * Equals the current record's own ID when versionNumber === 1.
     */
    originalVersionId: string;
    /**
     * True when this record was edited by a CARRIER or SUPPORT actor and the
     * driver has not yet reviewed the change.
     * Ref: 49 CFR §395.30(b) — driver must be given opportunity to confirm/reject.
     */
    requiresDriverReview: boolean;
    /** ISO 8601 UTC timestamp when the driver reviewed a carrier-initiated edit. */
    driverReviewedAt: string | null;
    /** The driver's action when reviewing a carrier edit. */
    driverReviewOutcome: 'CONFIRMED' | 'REJECTED' | null;
    /**
     * All audit entries for this record's lifetime, in chronological order.
     * Includes CREATED, every EDITED entry, DRIVER_CERTIFIED, etc.
     * This array is append-only — entries are never removed.
     */
    history: AuditEntry[];
    /** Tamper-evidence hash chain fields. */
    tamperEvidence: TamperEvidence;
}
/**
 * The salt mixed into the genesis hash to prevent pre-image attacks on
 * empty log periods. This value must be identical on mobile and backend.
 */
export declare const GENESIS_SALT = "cruzonic-eld-v1";
/**
 * Serialises a HashableEventFields object to a canonical, deterministic JSON
 * string. Keys are sorted alphabetically; values are JSON-encoded; no whitespace.
 * This is the input to SHA-256 for the contentHash.
 */
export declare function canonicaliseEventFields(fields: HashableEventFields): string;
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
export declare function computeGenesisHash(eldDeviceId: string, logDate: string, hash: (input: string) => string): string;
/**
 * Computes the contentHash for an event's hashable fields.
 *
 * @param fields - The event's hashable data fields.
 * @param hash   - SHA-256 function (see computeGenesisHash).
 */
export declare function computeContentHash(fields: HashableEventFields, hash: (input: string) => string): string;
/**
 * Computes the chainHash linking this record to the previous one.
 *
 * @param contentHash       - This record's contentHash.
 * @param previousChainHash - The previous record's chainHash, or the genesisHash
 *                            if this is the first event in the period.
 * @param hash              - SHA-256 function.
 */
export declare function computeChainHash(contentHash: string, previousChainHash: string, hash: (input: string) => string): string;
/** Severity level of a chain verification finding. */
export type ChainVerificationSeverity = 'TAMPER' | 'WARN' | 'INFO';
/** A single finding from a chain verification pass. */
export interface ChainVerificationFinding {
    severity: ChainVerificationSeverity;
    eventSequenceId: number;
    eventId: string;
    code: ChainVerificationCode;
    message: string;
}
export type ChainVerificationCode = 'CONTENT_HASH_MISMATCH' | 'CHAIN_HASH_MISMATCH' | 'GENESIS_HASH_MISMATCH' | 'MISSING_PREVIOUS_HASH' | 'VERSION_GAP' | 'FUTURE_HASH_TIMESTAMP' | 'CHAIN_OK';
export interface ChainVerificationResult {
    valid: boolean;
    findings: ChainVerificationFinding[];
    /** Number of records verified. */
    recordsChecked: number;
    /** Summary of finding counts by severity. */
    summary: {
        TAMPER: number;
        WARN: number;
        INFO: number;
    };
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
export declare function verifyHashChain<T extends {
    eventSequenceId: number;
    id: string;
    audit: AuditMetadata;
}>(activeEvents: T[], eldDeviceId: string, logDate: string, hash: (input: string) => string, recomputeContent?: (event: T) => HashableEventFields): ChainVerificationResult;
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
export declare function buildInitialAuditMetadata(eventId: string, actor: AuditActor, fields: HashableEventFields, prevHash: string, logDate: string, hash: (input: string) => string, network?: NetworkContext | null, nowUtc?: Date): AuditMetadata;
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
export declare function buildEditedAuditMetadata(newEventId: string, previousVersionId: string, previousAudit: AuditMetadata, actor: AuditActor, changedFields: FieldDiff[], reasonCode: EditReasonCode, reasonText: string | null, newFields: HashableEventFields, prevChainHash: string, hash: (input: string) => string, network?: NetworkContext | null, nowUtc?: Date): AuditMetadata;
/**
 * Records the driver's decision (confirm or reject) on a carrier-initiated edit.
 * Returns a new AuditMetadata with `requiresDriverReview` cleared.
 *
 * If the driver rejects, the caller must also reinstate the previous version
 * (set its eventRecordStatus back to ACTIVE) and mark the rejected version
 * as INACTIVE_CHANGED.
 */
export declare function recordDriverReview(existingAudit: AuditMetadata, eventId: string, driver: AuditActor, outcome: 'CONFIRMED' | 'REJECTED', revertedToVersionId: string | null, network?: NetworkContext | null, nowUtc?: Date): AuditMetadata;
//# sourceMappingURL=audit-trail.d.ts.map