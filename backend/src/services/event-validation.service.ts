/**
 * Multi-Layer Event Validation Service
 *
 * Implements three validation layers for ELD event submissions:
 *   Layer 1 – Schema           handled upstream by Zod (middleware/validation.ts)
 *   Layer 2 – Business rules   FMCSA event codes, timestamp ranges, odometer monotonicity
 *   Layer 3 – Cross-reference  driver and vehicle existence in the database
 *
 * FMCSA regulatory reference: 49 CFR 395.26
 */

import { supabase } from '../config/supabase';
import type { IngestEventRequest } from '../models/dtos/event.dto';

// ============================================================================
// Types
// ============================================================================

export interface EventFieldError {
  field: string;
  value: unknown;
  message: string;
  layer: 'business_rules' | 'cross_reference';
}

export interface SingleEventValidationResult {
  valid: boolean;
  errors: EventFieldError[];
}

export interface BatchValidationResult {
  /**
   * Map of event index → field errors.
   * Indices absent from this map passed validation.
   */
  invalidIndices: Map<number, EventFieldError[]>;
}

// ============================================================================
// FMCSA Event-Code Tables (49 CFR 395.26 Table 6)
// ============================================================================

/**
 * Valid event codes for each event type.
 * Type 1 – Duty Status Change:         1=Off Duty, 2=Sleeper Berth, 3=Driving, 4=On Duty ND
 * Type 2 – Intermediate Log:           1=Conventional precision, 2=Reduced precision
 * Type 3 – Driver Indication (PC/YM):  1=PC, 2=YM, 3=Clear
 * Type 4 – Certification:              1=Certification, 2=Recertification
 * Type 5 – Login/Logout:               1=Login, 2=Logout, 3=Power-on
 * Type 6 – Admin Login/Logout:         1=Login, 2=Logout
 * Type 7 – Malfunction/Diagnostic:     1-7 for malfunction sub-types
 */
const VALID_EVENT_CODES: Record<number, number[]> = {
  1: [1, 2, 3, 4],
  2: [1, 2],
  3: [1, 2, 3],
  4: [1, 2],
  5: [1, 2, 3],
  6: [1, 2],
  7: [1, 2, 3, 4, 5, 6, 7],
};

const EVENT_TYPE_NAMES: Record<number, string> = {
  1: 'Duty Status Change',
  2: 'Intermediate Log',
  3: 'Driver Indication (PC/YM)',
  4: 'Driver Certification',
  5: 'Driver Login/Logout',
  6: 'Admin Login/Logout',
  7: 'Malfunction/Diagnostic',
};

// ============================================================================
// Timestamp constants
// ============================================================================

/** Events may be at most 5 minutes ahead of server time. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

/** Events may not be older than 14 days (FMCSA allows 13-day log period + 1 day buffer). */
const MAX_PAST_MS = 14 * 24 * 60 * 60 * 1000;

// ============================================================================
// Layer 2 – Business rules
// ============================================================================

/**
 * Pure (synchronous) business-rule checks on a single event payload.
 * Checks:
 *   1. eventCode is valid for the declared eventType
 *   2. eventTimestamp is within the acceptable window (not too far future/past)
 *   3. accumulatedVehicleMiles is non-negative
 *   4. accumulatedEngineHours is non-negative
 *   5. locationDescription is present when lat/lon are null (FMCSA 395.26(c)(2))
 */
export function applyBusinessRules(event: IngestEventRequest): EventFieldError[] {
  const errors: EventFieldError[] = [];

  // 1. Event code validation ─────────────────────────────────────────────────
  if (event.eventCode !== undefined) {
    const code = parseInt(event.eventCode, 10);
    const validCodes = VALID_EVENT_CODES[event.eventType];
    const typeName = EVENT_TYPE_NAMES[event.eventType] ?? `type ${event.eventType}`;

    if (isNaN(code)) {
      errors.push({
        field: 'eventCode',
        value: event.eventCode,
        message: `'eventCode' must be a numeric string. Received: '${event.eventCode}'.`,
        layer: 'business_rules',
      });
    } else if (validCodes && !validCodes.includes(code)) {
      errors.push({
        field: 'eventCode',
        value: event.eventCode,
        message:
          `Invalid eventCode '${event.eventCode}' for ${typeName}. ` +
          `Accepted codes: [${validCodes.join(', ')}].`,
        layer: 'business_rules',
      });
    }
  }

  // 2. Timestamp range ────────────────────────────────────────────────────────
  const ts = new Date(event.eventTimestamp).getTime();
  const now = Date.now();

  if (isNaN(ts)) {
    errors.push({
      field: 'eventTimestamp',
      value: event.eventTimestamp,
      message: `'eventTimestamp' is not a valid ISO 8601 date-time string.`,
      layer: 'business_rules',
    });
  } else {
    if (ts > now + MAX_FUTURE_MS) {
      const diffMin = Math.round((ts - now) / 60_000);
      errors.push({
        field: 'eventTimestamp',
        value: event.eventTimestamp,
        message:
          `Timestamp is ${diffMin} minute(s) ahead of server time. ` +
          `Maximum allowed skew is 5 minutes.`,
        layer: 'business_rules',
      });
    }

    if (ts < now - MAX_PAST_MS) {
      const diffDays = Math.round((now - ts) / 86_400_000);
      errors.push({
        field: 'eventTimestamp',
        value: event.eventTimestamp,
        message:
          `Timestamp is ${diffDays} day(s) old. ` +
          `Events older than 14 days cannot be submitted.`,
        layer: 'business_rules',
      });
    }
  }

  // 3. Odometer – non-negative ────────────────────────────────────────────────
  if (event.accumulatedVehicleMiles < 0) {
    errors.push({
      field: 'accumulatedVehicleMiles',
      value: event.accumulatedVehicleMiles,
      message: `'accumulatedVehicleMiles' must be ≥ 0. Received: ${event.accumulatedVehicleMiles}.`,
      layer: 'business_rules',
    });
  }

  // 4. Engine hours – non-negative ───────────────────────────────────────────
  if (event.accumulatedEngineHours < 0) {
    errors.push({
      field: 'accumulatedEngineHours',
      value: event.accumulatedEngineHours,
      message: `'accumulatedEngineHours' must be ≥ 0. Received: ${event.accumulatedEngineHours}.`,
      layer: 'business_rules',
    });
  }

  // 5. Location – description required when lat/lon absent ───────────────────
  if (event.latitude === null && event.longitude === null) {
    if (!event.locationDescription || event.locationDescription.trim() === '') {
      errors.push({
        field: 'locationDescription',
        value: event.locationDescription ?? null,
        message:
          `'locationDescription' is required when 'latitude' and 'longitude' are null ` +
          `(FMCSA 49 CFR 395.26(c)(2)).`,
        layer: 'business_rules',
      });
    }
  }

  return errors;
}

// ============================================================================
// Layer 3 – Cross-reference validation
// ============================================================================

/**
 * Async cross-reference checks for a single event.
 * Verifies that the referenced driver and vehicle exist in the database.
 * Fails open on database errors (does not block ingestion).
 */
export async function applyCrossReferences(event: IngestEventRequest): Promise<EventFieldError[]> {
  const errors: EventFieldError[] = [];

  const [driverCheck, vehicleCheck] = await Promise.allSettled([
    supabase.from('drivers').select('id').eq('id', event.driverId).maybeSingle(),
    supabase.from('vehicles').select('id').eq('id', event.vehicleId).maybeSingle(),
  ]);

  if (
    driverCheck.status === 'fulfilled' &&
    !driverCheck.value.error &&
    !driverCheck.value.data
  ) {
    errors.push({
      field: 'driverId',
      value: event.driverId,
      message: `Driver '${event.driverId}' does not exist.`,
      layer: 'cross_reference',
    });
  }

  if (
    vehicleCheck.status === 'fulfilled' &&
    !vehicleCheck.value.error &&
    !vehicleCheck.value.data
  ) {
    errors.push({
      field: 'vehicleId',
      value: event.vehicleId,
      message: `Vehicle '${event.vehicleId}' does not exist.`,
      layer: 'cross_reference',
    });
  }

  return errors;
}

// ============================================================================
// Public API – single event
// ============================================================================

/**
 * Validates a single event through business rules (layer 2) and
 * cross-reference checks (layer 3).
 * Layer 1 (Zod schema) is handled before this function is called.
 */
export async function validateSingleEvent(
  event: IngestEventRequest
): Promise<SingleEventValidationResult> {
  const errors: EventFieldError[] = [
    ...applyBusinessRules(event),
    ...(await applyCrossReferences(event)),
  ];

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Public API – batch events
// ============================================================================

/**
 * Validates a batch of events with bulk database lookups for performance.
 *
 * Additional batch-specific check:
 *   - Odometer monotonicity: accumulatedVehicleMiles must be non-decreasing
 *     within the batch when events are ordered by eventTimestamp.
 */
export async function validateBatchEvents(
  events: IngestEventRequest[]
): Promise<BatchValidationResult> {
  const invalidIndices = new Map<number, EventFieldError[]>();

  if (events.length === 0) {
    return { invalidIndices };
  }

  // Bulk cross-reference lookups ─────────────────────────────────────────────
  const uniqueDriverIds = [...new Set(events.map((e) => e.driverId))];
  const uniqueVehicleIds = [...new Set(events.map((e) => e.vehicleId))];

  const [driverRes, vehicleRes] = await Promise.allSettled([
    supabase.from('drivers').select('id').in('id', uniqueDriverIds),
    supabase.from('vehicles').select('id').in('id', uniqueVehicleIds),
  ]);

  // Build existence sets.  On query error, treat all IDs as existing (fail open).
  const existingDrivers = new Set<string>(
    driverRes.status === 'fulfilled' && !driverRes.value.error
      ? (driverRes.value.data ?? []).map((r: { id: string }) => r.id)
      : uniqueDriverIds
  );

  const existingVehicles = new Set<string>(
    vehicleRes.status === 'fulfilled' && !vehicleRes.value.error
      ? (vehicleRes.value.data ?? []).map((r: { id: string }) => r.id)
      : uniqueVehicleIds
  );

  // Odometer monotonicity within the batch ───────────────────────────────────
  const odometerErrors = checkBatchOdometerMonotonicity(events);

  // Per-event validation ─────────────────────────────────────────────────────
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const errs: EventFieldError[] = [];

    // Layer 2: business rules
    errs.push(...applyBusinessRules(event));

    // Layer 3: cross-reference
    if (!existingDrivers.has(event.driverId)) {
      errs.push({
        field: 'driverId',
        value: event.driverId,
        message: `Driver '${event.driverId}' does not exist.`,
        layer: 'cross_reference',
      });
    }

    if (!existingVehicles.has(event.vehicleId)) {
      errs.push({
        field: 'vehicleId',
        value: event.vehicleId,
        message: `Vehicle '${event.vehicleId}' does not exist.`,
        layer: 'cross_reference',
      });
    }

    // Odometer errors detected during monotonicity check
    const oErr = odometerErrors.get(i);
    if (oErr) errs.push(...oErr);

    if (errs.length > 0) {
      invalidIndices.set(i, errs);
    }
  }

  return { invalidIndices };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Checks that accumulatedVehicleMiles and accumulatedEngineHours are
 * non-decreasing within a batch when events are sorted by eventTimestamp.
 *
 * Returns a map of event index → monotonicity errors.
 */
function checkBatchOdometerMonotonicity(
  events: IngestEventRequest[]
): Map<number, EventFieldError[]> {
  const errMap = new Map<number, EventFieldError[]>();

  // Sort by timestamp (ascending); skip events with unparseable timestamps
  const sorted = events
    .map((e, idx) => ({ e, idx }))
    .filter((item) => !isNaN(new Date(item.e.eventTimestamp).getTime()))
    .sort(
      (a, b) =>
        new Date(a.e.eventTimestamp).getTime() - new Date(b.e.eventTimestamp).getTime()
    );

  let prevMiles = -Infinity;
  let prevHours = -Infinity;
  let prevTs = '';

  for (const { e, idx } of sorted) {
    const itemErrs: EventFieldError[] = [];

    if (e.accumulatedVehicleMiles < prevMiles) {
      itemErrs.push({
        field: 'accumulatedVehicleMiles',
        value: e.accumulatedVehicleMiles,
        message:
          `Odometer decreased from ${prevMiles} to ${e.accumulatedVehicleMiles} mi ` +
          `(previous event at ${prevTs}). Readings must be non-decreasing.`,
        layer: 'business_rules',
      });
    }

    if (e.accumulatedEngineHours < prevHours) {
      itemErrs.push({
        field: 'accumulatedEngineHours',
        value: e.accumulatedEngineHours,
        message:
          `Engine hours decreased from ${prevHours} to ${e.accumulatedEngineHours} h ` +
          `(previous event at ${prevTs}). Readings must be non-decreasing.`,
        layer: 'business_rules',
      });
    }

    if (itemErrs.length > 0) {
      errMap.set(idx, [...(errMap.get(idx) ?? []), ...itemErrs]);
    }

    prevMiles = e.accumulatedVehicleMiles;
    prevHours = e.accumulatedEngineHours;
    prevTs = e.eventTimestamp;
  }

  return errMap;
}
