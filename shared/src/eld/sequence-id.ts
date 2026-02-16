/**
 * FMCSA ELD Sequence ID — Generation, Formatting, and Validation
 *
 * Regulatory source: 49 CFR Part 395, Appendix A to Subpart B, §7.3
 *
 * Rules summary
 * ─────────────
 * • IDs are unsigned integers in the range [1, 65535] (uint16).
 * • They are monotonically increasing within a single 24-hour log period.
 * • The counter resets to 1 at midnight in the driver's home-terminal timezone.
 * • Scope is per ELD device registration ID — not per driver. A driver using
 *   two different trucks on the same day will produce two independent sequences
 *   that are merged by timestamp during compliance output generation.
 * • Gaps in the sequence are allowed by the spec but must be flagged during
 *   compliance review (gaps can indicate deleted records — potential falsification).
 * • Duplicate IDs within the same (eldDeviceId, logDate) scope are a data
 *   integrity violation and must be rejected.
 * • Offline events are assigned IDs locally by the mobile app; the backend
 *   validates them on ingestion.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum valid sequence ID per log period (1-based). */
export const SEQUENCE_ID_MIN = 1;

/**
 * Maximum valid sequence ID per log period.
 * uint16 ceiling — 65535 events per device per 24 h is an intentionally high
 * ceiling; normal operations produce ~10–100 events per day.
 */
export const SEQUENCE_ID_MAX = 65535;

/**
 * The maximum number of events in a real-world 24-hour period that would be
 * considered normal. Used to generate a warning (not an error) when a sequence
 * approaches saturation.
 */
export const SEQUENCE_ID_NORMAL_MAX = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifies the scope for a sequence.
 *
 * Scope is (eldDeviceId × logDate). This means:
 *   - Two different devices used by the same driver on the same day each have
 *     their own independent sequence.
 *   - IDs from both devices are merged by timestamp in the compliance output.
 */
export interface SequenceIdScope {
  /** FMCSA-registered ELD device ID (e.g. "PACTRKV1" + serial suffix). */
  eldDeviceId: string;
  /**
   * Calendar date for this log period in MMDDYY format, expressed in the
   * driver's home-terminal timezone (not UTC). This matches the `eventDate`
   * field in the .erod file.
   */
  logDate: string;
}

/**
 * Persisted counter state for one (eldDeviceId × logDate) scope.
 *
 * The mobile app stores this in SQLite via expo-sqlite. The backend stores
 * the derived state in the `eld_sequence_state` Supabase table.
 */
export interface SequenceIdState {
  scope: SequenceIdScope;
  /** The last ID that was issued. 0 means no events have been recorded yet. */
  lastIssuedId: number;
  /** ISO 8601 UTC timestamp when the last ID was issued. */
  lastIssuedAt: string;
  /**
   * Count of wrap-arounds (reaching 65535).
   * Should always be 0 in normal operations — if > 0 it indicates an anomaly
   * (e.g. a device stuck in a loop) and must be investigated.
   */
  wrapAroundCount: number;
}

/** Returned by generateSequenceId(). */
export interface SequenceIdResult {
  sequenceId: number;
  /** Formatted as a zero-padded 5-digit string for .erod file encoding. */
  formatted: string;
  scope: SequenceIdScope;
  /** ISO 8601 UTC timestamp at the moment of generation. */
  generatedAt: string;
  /** True when this is the first event of a new log period (id === 1). */
  isFirstOfPeriod: boolean;
  /** True when lastIssuedId > SEQUENCE_ID_NORMAL_MAX (not an error, just a signal). */
  isApproachingSaturation: boolean;
  /** Updated state to be persisted by the caller. */
  newState: SequenceIdState;
}

/** A gap in a sequence — contiguous range of missing IDs between two events. */
export interface SequenceGap {
  /** The last observed ID before the gap. */
  precedingId: number;
  /** The first observed ID after the gap. */
  followingId: number;
  /** Number of missing IDs: followingId - precedingId - 1. */
  missingCount: number;
  /**
   * Classification of the gap.
   * - 'expected': The period was never populated (e.g. ID 1 is missing because
   *    the log starts at a later ID — implies earlier records may have been deleted).
   * - 'interior': Gap in the middle of the sequence.
   */
  kind: 'leading' | 'interior';
}

/** Result of validating a proposed sequence ID before writing it. */
export interface SequenceIdValidationResult {
  valid: boolean;
  errors: SequenceIdError[];
  warnings: SequenceIdWarning[];
}

export interface SequenceIdError {
  code: SequenceIdErrorCode;
  message: string;
}

export interface SequenceIdWarning {
  code: SequenceIdWarningCode;
  message: string;
}

export type SequenceIdErrorCode =
  | 'OUT_OF_RANGE'           // id < 1 or id > 65535
  | 'DUPLICATE'              // id already exists in this scope
  | 'NON_MONOTONIC'          // id <= lastIssuedId (went backwards)
  | 'WRONG_SCOPE'            // (eldDeviceId, logDate) mismatch
  | 'PERIOD_EXHAUSTED';      // lastIssuedId === 65535

export type SequenceIdWarningCode =
  | 'GAP_DETECTED'           // id > lastIssuedId + 1 — gap in the sequence
  | 'APPROACHING_SATURATION' // id > SEQUENCE_ID_NORMAL_MAX
  | 'LARGE_GAP'              // gap of > 10 IDs — more suspicious
  | 'LEADING_GAP';           // first event in period does not start at 1

/**
 * Minimal event shape needed for ordering and gap analysis.
 * Only the fields relevant to sequencing are required here.
 */
export interface SequenceableEvent {
  eventSequenceId: number;
  /** ISO 8601 UTC event timestamp — used for cross-device merge ordering. */
  eventTimestampUtc: string;
  eldDeviceId: string;
  logDate: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a sequence ID as a zero-padded 5-digit string, as required by the
 * FMCSA .erod pipe-delimited file format.
 *
 * @example formatSequenceId(5)    // "00005"
 * @example formatSequenceId(1024) // "01024"
 */
export function formatSequenceId(id: number): string {
  return String(id).padStart(5, '0');
}

/**
 * Parses a formatted sequence ID string back to an integer.
 * Returns null if the string is not a valid formatted sequence ID.
 *
 * @example parseSequenceId("00005")  // 5
 * @example parseSequenceId("01024")  // 1024
 * @example parseSequenceId("ABC")    // null
 */
export function parseSequenceId(formatted: string): number | null {
  if (!/^\d{1,5}$/.test(formatted)) return null;
  const n = parseInt(formatted, 10);
  if (n < SEQUENCE_ID_MIN || n > SEQUENCE_ID_MAX) return null;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// logDate helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a JavaScript Date to the MMDDYY string format used as logDate.
 * The date components are taken in the specified IANA timezone so that the
 * log period matches the driver's home-terminal timezone, not UTC.
 *
 * @param date       - Point in time (defaults to now)
 * @param ianaTimezone - Driver's home-terminal IANA timezone (e.g. "America/Chicago")
 *
 * @example toLogDate(new Date("2024-06-12T05:00:00Z"), "America/Chicago")
 *          // "061224"  (still June 12 in Chicago, which is UTC-5)
 */
export function toLogDate(date: Date = new Date(), ianaTimezone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    month: '2-digit',
    day:   '2-digit',
    year:  '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('month')}${get('day')}${get('year')}`;
}

/**
 * Returns true if two ISO 8601 UTC timestamps fall in the same 24-hour
 * home-terminal log period (i.e. their logDate values in the given timezone match).
 */
export function isSameLogPeriod(
  isoA: string,
  isoB: string,
  ianaTimezone: string,
): boolean {
  return toLogDate(new Date(isoA), ianaTimezone) ===
         toLogDate(new Date(isoB), ianaTimezone);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the next compliant sequence ID for a given scope.
 *
 * This is a **pure function** — it takes the current state and returns the new
 * ID plus the updated state. The caller is responsible for persisting
 * `result.newState` atomically (SQLite transaction on mobile, Supabase RPC
 * with optimistic locking on the backend).
 *
 * @param currentState - The persisted state for this (eldDeviceId, logDate) scope.
 *                       Pass null to start a new log period (first event of the day).
 * @param nowUtc       - Override for "now" (useful for testing). Defaults to Date.now().
 *
 * @throws {Error} if the sequence is exhausted (lastIssuedId === SEQUENCE_ID_MAX).
 *
 * @example
 *   // First event of the day — no prior state
 *   const result = generateSequenceId(null, { eldDeviceId: 'PACTRKV1-001', logDate: '061224' });
 *   // result.sequenceId === 1, result.formatted === "00001"
 *
 *   // Subsequent event
 *   const result2 = generateSequenceId(result.newState);
 *   // result2.sequenceId === 2
 */
export function generateSequenceId(
  currentState: SequenceIdState | null,
  scopeForNewPeriod?: SequenceIdScope,
  nowUtc: Date = new Date(),
): SequenceIdResult {
  const generatedAt = nowUtc.toISOString();

  // ── Determine scope ────────────────────────────────────────────────────────
  const scope: SequenceIdScope = currentState?.scope ?? scopeForNewPeriod ?? (() => {
    throw new Error(
      'generateSequenceId: provide either currentState or scopeForNewPeriod for a new log period.',
    );
  })();

  const lastIssuedId = currentState?.lastIssuedId ?? 0;

  if (lastIssuedId >= SEQUENCE_ID_MAX) {
    throw new RangeError(
      `ELD sequence exhausted for device=${scope.eldDeviceId} date=${scope.logDate}. ` +
      `${SEQUENCE_ID_MAX} events recorded — this device/period must not generate further events.`,
    );
  }

  const sequenceId = lastIssuedId + 1;
  const isFirstOfPeriod = sequenceId === SEQUENCE_ID_MIN;
  const isApproachingSaturation = sequenceId > SEQUENCE_ID_NORMAL_MAX;

  const newState: SequenceIdState = {
    scope,
    lastIssuedId: sequenceId,
    lastIssuedAt: generatedAt,
    wrapAroundCount: currentState?.wrapAroundCount ?? 0,
  };

  return {
    sequenceId,
    formatted: formatSequenceId(sequenceId),
    scope,
    generatedAt,
    isFirstOfPeriod,
    isApproachingSaturation,
    newState,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (used by the backend on event ingestion)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a proposed sequence ID against the current state for a scope.
 * Called by the backend API when ingesting events from the mobile app or
 * from an offline batch upload.
 *
 * Does **not** mutate state — returns a result the caller can act on.
 *
 * @param proposedId    - The sequence ID on the incoming event record.
 * @param currentState  - Current persisted state for this (eldDeviceId, logDate) scope.
 *                        Null if this is the first event seen for this scope.
 * @param existingIds   - Optional set of IDs already recorded in this scope (for
 *                        duplicate detection). Pass a Set for O(1) lookup.
 */
export function validateSequenceId(
  proposedId: number,
  currentState: SequenceIdState | null,
  existingIds?: ReadonlySet<number>,
): SequenceIdValidationResult {
  const errors: SequenceIdError[] = [];
  const warnings: SequenceIdWarning[] = [];

  // ── Range check ─────────────────────────────────────────────────────────
  if (!Number.isInteger(proposedId) || proposedId < SEQUENCE_ID_MIN || proposedId > SEQUENCE_ID_MAX) {
    errors.push({
      code: 'OUT_OF_RANGE',
      message: `Sequence ID ${proposedId} is outside the valid range [${SEQUENCE_ID_MIN}, ${SEQUENCE_ID_MAX}].`,
    });
    return { valid: false, errors, warnings };
  }

  // ── Duplicate check ──────────────────────────────────────────────────────
  if (existingIds?.has(proposedId)) {
    errors.push({
      code: 'DUPLICATE',
      message: `Sequence ID ${proposedId} already exists in this scope. Duplicates are a data integrity violation.`,
    });
  }

  if (currentState) {
    // ── Period exhausted ──────────────────────────────────────────────────
    if (currentState.lastIssuedId >= SEQUENCE_ID_MAX) {
      errors.push({
        code: 'PERIOD_EXHAUSTED',
        message: `Sequence for device=${currentState.scope.eldDeviceId} date=${currentState.scope.logDate} is exhausted (last ID: ${currentState.lastIssuedId}).`,
      });
    }

    // ── Monotonicity check ────────────────────────────────────────────────
    if (proposedId <= currentState.lastIssuedId && !existingIds?.has(proposedId)) {
      errors.push({
        code: 'NON_MONOTONIC',
        message:
          `Sequence ID ${proposedId} is not greater than the last issued ID ` +
          `(${currentState.lastIssuedId}). IDs must be strictly increasing within a log period.`,
      });
    }

    // ── Gap detection (warnings only — gaps are allowed by FMCSA) ─────────
    const gap = proposedId - currentState.lastIssuedId - 1;
    if (gap > 0) {
      const warningCode: SequenceIdWarningCode = gap > 10 ? 'LARGE_GAP' : 'GAP_DETECTED';
      warnings.push({
        code: warningCode,
        message:
          `Gap detected: ${gap} missing ID(s) between ${currentState.lastIssuedId} and ${proposedId}. ` +
          `Gaps are permitted but must be flagged for compliance review — they may indicate deleted records.`,
      });
    }
  } else {
    // No prior state — first event seen for this scope.
    if (proposedId !== SEQUENCE_ID_MIN) {
      warnings.push({
        code: 'LEADING_GAP',
        message:
          `First event for this scope has sequence ID ${proposedId} instead of 1. ` +
          `Leading gap of ${proposedId - 1} ID(s) — earlier records may have been removed.`,
      });
    }
  }

  // ── Saturation warning ────────────────────────────────────────────────────
  if (proposedId > SEQUENCE_ID_NORMAL_MAX) {
    warnings.push({
      code: 'APPROACHING_SATURATION',
      message: `Sequence ID ${proposedId} exceeds the normal operating range (${SEQUENCE_ID_NORMAL_MAX}). Investigate potential ELD loop or event storm.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gap analysis (used by the compliance output generator)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans a sorted list of sequence IDs for a single (eldDeviceId, logDate) scope
 * and returns all gaps found.
 *
 * The input must be **sorted ascending**. Duplicates in the input are not
 * checked here — run validateSequenceId() first.
 *
 * @param sortedIds - Sorted ascending array of sequence IDs observed for a scope.
 * @returns Array of SequenceGap objects. Empty array means no gaps.
 *
 * @example
 *   detectSequenceGaps([1, 2, 5, 6, 10])
 *   // → [
 *   //     { precedingId: 2,  followingId: 5,  missingCount: 2, kind: 'interior' },
 *   //     { precedingId: 6,  followingId: 10, missingCount: 3, kind: 'interior' },
 *   //   ]
 */
export function detectSequenceGaps(sortedIds: number[]): SequenceGap[] {
  if (sortedIds.length === 0) return [];

  const gaps: SequenceGap[] = [];

  // Check for a leading gap (period not starting at 1).
  if (sortedIds[0] > SEQUENCE_ID_MIN) {
    gaps.push({
      precedingId: 0,
      followingId: sortedIds[0],
      missingCount: sortedIds[0] - SEQUENCE_ID_MIN,
      kind: 'leading',
    });
  }

  // Check interior gaps.
  for (let i = 1; i < sortedIds.length; i++) {
    const prev = sortedIds[i - 1];
    const curr = sortedIds[i];
    const missing = curr - prev - 1;
    if (missing > 0) {
      gaps.push({
        precedingId: prev,
        followingId: curr,
        missingCount: missing,
        kind: 'interior',
      });
    }
  }

  return gaps;
}

/**
 * Returns the set of duplicate sequence IDs found in an unsorted list.
 * An ID appears in the result set if it occurs more than once.
 *
 * @example
 *   detectDuplicateSequenceIds([1, 2, 2, 3, 5, 5, 5])
 *   // → Set { 2, 5 }
 */
export function detectDuplicateSequenceIds(ids: number[]): Set<number> {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return duplicates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-device ordering (used when merging events from multiple ELD devices)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comparator for sorting ELD events from potentially multiple devices into a
 * single chronological order for compliance output generation.
 *
 * Sort priority:
 *   1. eventTimestampUtc ascending (primary — establishes chronological order)
 *   2. eldDeviceId ascending (secondary — deterministic tie-break for events
 *      with identical timestamps on different devices)
 *   3. eventSequenceId ascending (tertiary — tie-break within the same device
 *      when two events share the same UTC second)
 *
 * @example
 *   const merged = [...deviceAEvents, ...deviceBEvents].sort(compareSequenceableEvents);
 */
export function compareSequenceableEvents(
  a: SequenceableEvent,
  b: SequenceableEvent,
): number {
  // Primary: chronological
  const tA = new Date(a.eventTimestampUtc).getTime();
  const tB = new Date(b.eventTimestampUtc).getTime();
  if (tA !== tB) return tA - tB;

  // Secondary: device ID (lexicographic — deterministic)
  if (a.eldDeviceId < b.eldDeviceId) return -1;
  if (a.eldDeviceId > b.eldDeviceId) return 1;

  // Tertiary: sequence ID within the same device
  return a.eventSequenceId - b.eventSequenceId;
}

/**
 * After merging and sorting events from multiple devices, assigns new
 * monotonically increasing sequence IDs (1-based) to the merged list for the
 * compliance output file (.erod).
 *
 * The original per-device sequence IDs are preserved in the returned objects
 * as `originalSequenceId`.
 *
 * @param sortedEvents - Events already sorted by compareSequenceableEvents().
 * @returns New array with `eventSequenceId` reassigned and `originalSequenceId` set.
 */
export function assignMergedSequenceIds<T extends SequenceableEvent>(
  sortedEvents: T[],
): Array<T & { originalSequenceId: number }> {
  return sortedEvents.map((event, index) => ({
    ...event,
    originalSequenceId: event.eventSequenceId,
    eventSequenceId: index + 1,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline buffer ordering (used by the mobile app)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sorts a batch of locally-queued (offline) events into submission order
 * before draining the offline queue to the backend.
 *
 * Rules:
 *   1. Events for earlier log periods come first (chronological by logDate).
 *   2. Within the same log period, events are ordered by their local sequence ID.
 *
 * This ensures the backend processes events in the correct order, which matters
 * for the monotonicity check in validateSequenceId().
 *
 * @param events - Buffered events from the offline SQLite queue.
 * @returns New sorted array (does not mutate the input).
 */
export function sortOfflineBuffer<T extends SequenceableEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    // Compare logDate strings as MMDDYY — need to convert to YYMMDD for lexicographic sort.
    const toSortable = (mmddyy: string) =>
      `${mmddyy.slice(4, 6)}${mmddyy.slice(0, 2)}${mmddyy.slice(2, 4)}`;

    const dateCompare = toSortable(a.logDate).localeCompare(toSortable(b.logDate));
    if (dateCompare !== 0) return dateCompare;

    // Same log period: order by sequence ID.
    return a.eventSequenceId - b.eventSequenceId;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateful SequenceIdManager (wraps the pure functions above)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks the SequenceIdManager uses to load and persist state.
 * Implement these with SQLite on mobile or Supabase on the backend.
 *
 * Both callbacks must be atomic with respect to concurrent callers —
 * wrap them in a transaction or use Supabase's `FOR UPDATE` advisory lock.
 */
export interface SequenceIdStore {
  /** Load the persisted state for a scope. Returns null if no state exists yet. */
  load(scope: SequenceIdScope): Promise<SequenceIdState | null>;
  /** Persist the new state. Must be atomic (upsert, not insert). */
  save(state: SequenceIdState): Promise<void>;
}

/**
 * Stateful wrapper around the pure sequence ID functions.
 *
 * The manager holds no in-memory cache — every call loads from and saves to
 * the provided store, which means the store is the single source of truth.
 * This is intentional: it prevents divergence when the app is killed mid-operation.
 *
 * Usage (mobile — SQLite store):
 * ```ts
 * const manager = new SequenceIdManager(sqliteStore);
 * const result = await manager.next({ eldDeviceId: 'PACTRKV1-001', logDate: '061224' });
 * event.eventSequenceId = result.sequenceId;
 * event.formattedSequenceId = result.formatted;
 * ```
 *
 * Usage (backend — validate incoming event):
 * ```ts
 * const manager = new SequenceIdManager(supabaseStore);
 * const validation = await manager.validate(
 *   incomingEvent.eventSequenceId,
 *   { eldDeviceId: incomingEvent.eldDeviceId, logDate: incomingEvent.logDate },
 *   existingIdSet,
 * );
 * if (!validation.valid) throw new ValidationError(validation.errors);
 * ```
 */
export class SequenceIdManager {
  constructor(private readonly store: SequenceIdStore) {}

  /**
   * Allocates and returns the next sequence ID for a scope.
   * Persists the new state before returning.
   *
   * @throws {RangeError} if the sequence is exhausted (65535 events/day reached).
   */
  async next(scope: SequenceIdScope, nowUtc: Date = new Date()): Promise<SequenceIdResult> {
    const current = await this.store.load(scope);
    const result = generateSequenceId(current, scope, nowUtc);
    await this.store.save(result.newState);
    return result;
  }

  /**
   * Validates a proposed sequence ID without mutating state.
   * Use this on the backend during event ingestion.
   */
  async validate(
    proposedId: number,
    scope: SequenceIdScope,
    existingIds?: ReadonlySet<number>,
  ): Promise<SequenceIdValidationResult> {
    const current = await this.store.load(scope);
    return validateSequenceId(proposedId, current, existingIds);
  }

  /**
   * Advances the stored state to reflect an accepted incoming ID
   * (e.g. after validating and persisting an event received from the mobile app).
   *
   * Only advances if proposedId > current lastIssuedId.
   */
  async accept(scope: SequenceIdScope, acceptedId: number): Promise<void> {
    const current = await this.store.load(scope);
    const lastIssuedId = current?.lastIssuedId ?? 0;

    if (acceptedId > lastIssuedId) {
      await this.store.save({
        scope,
        lastIssuedId: acceptedId,
        lastIssuedAt: new Date().toISOString(),
        wrapAroundCount: current?.wrapAroundCount ?? 0,
      });
    }
  }

  /** Returns the current state without mutating it. */
  async peek(scope: SequenceIdScope): Promise<SequenceIdState | null> {
    return this.store.load(scope);
  }
}
