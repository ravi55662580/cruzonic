/**
 * Optimized Common Queries
 *
 * High-performance implementations of the most frequent ELD queries.
 * Target: Sub-100ms response time for all queries.
 *
 * Optimizations:
 * - Uses composite indexes for WHERE + ORDER BY
 * - Minimizes JOINs where possible
 * - Leverages partial indexes (status filters)
 * - Uses covering indexes to avoid table lookups
 * - Partition pruning via event_timestamp filters
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ═════════════════════════════════════════════════════════════════════════════
// QUERY 1: Fetch Driver's Events for 24-Hour Period
// Target: <50ms
// Usage: Daily log viewer, timeline display
// ═════════════════════════════════════════════════════════════════════════════

export interface DriverEvent {
  id: string;
  event_sequence_id: number;
  event_type: number;
  event_sub_type: number;
  event_timestamp: string;
  event_date: string;
  event_time: string;
  event_record_status: number;
  event_record_origin: number;
  duty_status?: number;
  accumulated_vehicle_miles: number;
  elapsed_engine_hours: number;
  latitude: number | null;
  longitude: number | null;
  location_description: string | null;
  annotation: string | null;
  driver_eld_account_id: string | null;
}

/**
 * Fetches all active events for a driver within a 24-hour period.
 *
 * Optimized with:
 * - idx_eld_events_driver_timestamp_composite (driver_id, event_timestamp, status)
 * - Partition pruning via event_timestamp filter
 * - WHERE status = 1 uses partial index
 *
 * @param supabase - Supabase client
 * @param driverId - Driver UUID
 * @param logDate - Date in MMDDYY format (e.g., "021524")
 * @param timezone - Driver's home terminal timezone (e.g., "America/Chicago")
 * @returns Array of events ordered by sequence
 */
export async function getDriverEventsFor24Hours(
  supabase: SupabaseClient,
  driverId: string,
  logDate: string, // MMDDYY
  timezone: string = 'America/Chicago'
): Promise<{ data: DriverEvent[] | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  // Convert MMDDYY to date range in driver's timezone
  // Log day = midnight to midnight in driver's home terminal timezone
  const month = logDate.substring(0, 2);
  const day = logDate.substring(2, 4);
  const year = '20' + logDate.substring(4, 6);

  const startDate = `${year}-${month}-${day}T00:00:00`;
  const endDate = `${year}-${month}-${day}T23:59:59`;

  // Query using composite index
  const { data, error } = await supabase
    .from('eld_events')
    .select(
      `
      id,
      event_sequence_id,
      event_type,
      event_sub_type,
      event_timestamp,
      event_date,
      event_time,
      event_record_status,
      event_record_origin,
      accumulated_vehicle_miles,
      elapsed_engine_hours,
      latitude,
      longitude,
      location_description,
      annotation,
      driver_eld_account_id
    `
    )
    .eq('driver_id', driverId)
    .eq('event_record_status', 1) // Active records only (uses partial index)
    .gte('event_timestamp', startDate)
    .lte('event_timestamp', endDate)
    .order('event_sequence_id', { ascending: true });

  const executionTime = Date.now() - startTime;

  return { data, error, executionTime };
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY 2: Calculate HOS Remaining Time
// Target: <75ms
// Usage: Mobile app HOS clock, dashboard widgets
// ═════════════════════════════════════════════════════════════════════════════

export interface HOSRemaining {
  driving_minutes_remaining: number;
  on_duty_window_remaining: number;
  weekly_minutes_remaining: number;
  break_required_in_minutes: number | null;
  in_34h_restart: boolean;
  restart_eligible_at: string | null;
  last_calculated_at: string;
}

/**
 * Gets current HOS remaining time for a driver.
 *
 * Optimized with:
 * - idx_hos_calc_driver_latest (driver_id, calculated_at DESC)
 * - Single row lookup via LIMIT 1
 * - No JOINs required
 *
 * @param supabase - Supabase client
 * @param driverId - Driver UUID
 * @returns Current HOS remaining time
 */
export async function getHOSRemainingTime(
  supabase: SupabaseClient,
  driverId: string
): Promise<{ data: HOSRemaining | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  const { data, error } = await supabase
    .from('hos_calculations')
    .select(
      `
      remaining_driving_minutes,
      remaining_on_duty_window_minutes,
      remaining_weekly_minutes,
      time_until_break_required_minutes,
      is_in_34h_restart,
      restart_eligible_at,
      calculated_at
    `
    )
    .eq('driver_id', driverId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .single();

  const executionTime = Date.now() - startTime;

  if (!data) {
    return { data: null, error, executionTime };
  }

  const result: HOSRemaining = {
    driving_minutes_remaining: Number(data.remaining_driving_minutes) || 0,
    on_duty_window_remaining: Number(data.remaining_on_duty_window_minutes) || 0,
    weekly_minutes_remaining: Number(data.remaining_weekly_minutes) || 0,
    break_required_in_minutes: data.time_until_break_required_minutes
      ? Number(data.time_until_break_required_minutes)
      : null,
    in_34h_restart: data.is_in_34h_restart,
    restart_eligible_at: data.restart_eligible_at,
    last_calculated_at: data.calculated_at,
  };

  return { data: result, error, executionTime };
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY 3: Get Unidentified Driving Records
// Target: <50ms
// Usage: Driver login flow, compliance dashboard
// ═════════════════════════════════════════════════════════════════════════════

export interface UnidentifiedRecord {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  accumulated_miles: number;
  status: string;
  start_location_desc: string | null;
}

/**
 * Gets pending unidentified driving records for a vehicle.
 *
 * Optimized with:
 * - idx_udr_vehicle_pending (vehicle_id, started_at DESC) WHERE status = 'pending'
 * - Partial index for pending records only
 *
 * @param supabase - Supabase client
 * @param vehicleId - Vehicle UUID
 * @returns Pending unidentified records, newest first
 */
export async function getUnidentifiedRecordsByVehicle(
  supabase: SupabaseClient,
  vehicleId: string
): Promise<{ data: UnidentifiedRecord[] | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  const { data, error } = await supabase
    .from('unidentified_driver_records')
    .select(
      `
      id,
      vehicle_id,
      started_at,
      ended_at,
      duration_minutes,
      accumulated_miles,
      status,
      start_location_desc
    `
    )
    .eq('vehicle_id', vehicleId)
    .eq('status', 'pending') // Uses partial index
    .order('started_at', { ascending: false });

  const executionTime = Date.now() - startTime;

  return { data, error, executionTime };
}

/**
 * Gets all aging unidentified records for a carrier (>8 days = violation).
 *
 * Optimized with:
 * - idx_udr_aging (carrier_id, started_at) WHERE status = 'pending'
 *
 * @param supabase - Supabase client
 * @param carrierId - Carrier UUID
 * @param daysOld - Minimum age in days (default: 8)
 * @returns Aging unidentified records
 */
export async function getAgingUnidentifiedRecords(
  supabase: SupabaseClient,
  carrierId: string,
  daysOld: number = 8
): Promise<{ data: UnidentifiedRecord[] | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const { data, error } = await supabase
    .from('unidentified_driver_records')
    .select(
      `
      id,
      vehicle_id,
      started_at,
      ended_at,
      duration_minutes,
      accumulated_miles,
      status,
      start_location_desc
    `
    )
    .eq('carrier_id', carrierId)
    .eq('status', 'pending')
    .lt('started_at', cutoffDate.toISOString())
    .order('started_at', { ascending: true }); // Oldest first

  const executionTime = Date.now() - startTime;

  return { data, error, executionTime };
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY 4: Generate Daily Log Summary
// Target: <100ms
// Usage: Daily log certification, summary reports
// ═════════════════════════════════════════════════════════════════════════════

export interface DailyLogSummary {
  log_date: string;
  total_events: number;
  off_duty_minutes: number;
  sleeper_berth_minutes: number;
  driving_minutes: number;
  on_duty_minutes: number;
  total_miles: number;
  start_location: string | null;
  end_location: string | null;
  certified: boolean;
  certified_at: string | null;
}

/**
 * Generates a summary of a driver's daily log.
 *
 * Optimized with:
 * - idx_duty_status_period_status (log_period_id, duty_status, duration_minutes)
 * - Aggregation on indexed columns
 *
 * @param supabase - Supabase client
 * @param driverId - Driver UUID
 * @param logDate - Date in MMDDYY format
 * @returns Daily log summary
 */
export async function getDailyLogSummary(
  supabase: SupabaseClient,
  driverId: string,
  logDate: string // MMDDYY
): Promise<{ data: DailyLogSummary | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  // First, get the log period
  const { data: logPeriod, error: periodError } = await supabase
    .from('log_periods')
    .select('id, status, certified_at')
    .eq('driver_id', driverId)
    .eq('log_date_mmddyy', logDate)
    .single();

  if (periodError || !logPeriod) {
    return { data: null, error: periodError, executionTime: Date.now() - startTime };
  }

  // Get duty status aggregations
  const { data: dutyRecords, error: dutyError } = await supabase
    .from('duty_status_records')
    .select('duty_status, duration_minutes, location_description')
    .eq('log_period_id', logPeriod.id)
    .order('started_at', { ascending: true });

  if (dutyError) {
    return { data: null, error: dutyError, executionTime: Date.now() - startTime };
  }

  // Get event count and mileage
  const { data: events, error: eventsError } = await supabase
    .from('eld_events')
    .select('accumulated_vehicle_miles, location_description')
    .eq('log_period_id', logPeriod.id)
    .eq('event_record_status', 1)
    .order('event_sequence_id', { ascending: true });

  if (eventsError) {
    return { data: null, error: eventsError, executionTime: Date.now() - startTime };
  }

  // Calculate summary
  let offDutyMinutes = 0;
  let sleeperBerthMinutes = 0;
  let drivingMinutes = 0;
  let onDutyMinutes = 0;

  dutyRecords?.forEach((record) => {
    const minutes = Number(record.duration_minutes) || 0;
    switch (record.duty_status) {
      case 1: // OFF_DUTY
        offDutyMinutes += minutes;
        break;
      case 2: // SLEEPER_BERTH
        sleeperBerthMinutes += minutes;
        break;
      case 3: // DRIVING
        drivingMinutes += minutes;
        break;
      case 4: // ON_DUTY_NOT_DRIVING
        onDutyMinutes += minutes;
        break;
    }
  });

  const totalMiles =
    events && events.length > 0
      ? Number(events[events.length - 1].accumulated_vehicle_miles) -
        Number(events[0].accumulated_vehicle_miles)
      : 0;

  const startLocation = events && events.length > 0 ? events[0].location_description : null;
  const endLocation =
    events && events.length > 0 ? events[events.length - 1].location_description : null;

  const executionTime = Date.now() - startTime;

  const summary: DailyLogSummary = {
    log_date: logDate,
    total_events: events?.length || 0,
    off_duty_minutes: Math.round(offDutyMinutes),
    sleeper_berth_minutes: Math.round(sleeperBerthMinutes),
    driving_minutes: Math.round(drivingMinutes),
    on_duty_minutes: Math.round(onDutyMinutes),
    total_miles: Math.round(totalMiles * 10) / 10, // Round to 1 decimal
    start_location: startLocation,
    end_location: endLocation,
    certified: logPeriod.status === 'certified' || logPeriod.status === 'recertified',
    certified_at: logPeriod.certified_at,
  };

  return { data: summary, error: null, executionTime };
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY 5: Export Events in FMCSA Output Format
// Target: <100ms for single day, <500ms for 7 days
// Usage: Roadside inspection, FMCSA compliance export
// ═════════════════════════════════════════════════════════════════════════════

export interface FMCSAEvent {
  EventSequenceIdNumber: number;
  EventRecordStatus: number;
  EventRecordOrigin: number;
  EventType: number;
  EventCode: number;
  EventDate: string; // MMDDYY
  EventTime: string; // HHMMSS
  AccumulatedVehicleMiles: string; // Tenths of miles
  ElapsedEngineHours: string; // Tenths of hours
  EventLatitude: string | null;
  EventLongitude: string | null;
  DistanceSinceLastValidCoordinates: string | null;
  MalfunctionIndicatorStatus: string;
  EventDataCheckValue: string;
  LineDataCheckValue?: string;
}

/**
 * Exports driver's events in FMCSA output file format.
 *
 * Optimized with:
 * - idx_eld_events_period_sequence_composite (log_period_id, event_sequence_id)
 * - Partition pruning
 * - Minimal columns selected
 *
 * @param supabase - Supabase client
 * @param driverId - Driver UUID
 * @param logDate - Date in MMDDYY format
 * @returns Events in FMCSA format
 */
export async function exportEventsForFMCSA(
  supabase: SupabaseClient,
  driverId: string,
  logDate: string // MMDDYY
): Promise<{ data: FMCSAEvent[] | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  // Get log period
  const { data: logPeriod, error: periodError } = await supabase
    .from('log_periods')
    .select('id')
    .eq('driver_id', driverId)
    .eq('log_date_mmddyy', logDate)
    .single();

  if (periodError || !logPeriod) {
    return { data: null, error: periodError, executionTime: Date.now() - startTime };
  }

  // Get all events for this log period
  const { data: events, error } = await supabase
    .from('eld_events')
    .select(
      `
      event_sequence_id,
      event_record_status,
      event_record_origin,
      event_type,
      event_sub_type,
      event_date,
      event_time,
      accumulated_vehicle_miles,
      elapsed_engine_hours,
      latitude,
      longitude,
      distance_since_last_valid_coords,
      malfunction_indicator_status,
      event_data_check_value
    `
    )
    .eq('log_period_id', logPeriod.id)
    .order('event_sequence_id', { ascending: true });

  if (error) {
    return { data: null, error, executionTime: Date.now() - startTime };
  }

  // Convert to FMCSA format
  const fmcsaEvents: FMCSAEvent[] =
    events?.map((event) => ({
      EventSequenceIdNumber: event.event_sequence_id,
      EventRecordStatus: event.event_record_status,
      EventRecordOrigin: event.event_record_origin,
      EventType: event.event_type,
      EventCode: event.event_sub_type,
      EventDate: event.event_date,
      EventTime: event.event_time,
      AccumulatedVehicleMiles: (Number(event.accumulated_vehicle_miles) * 10).toFixed(0),
      ElapsedEngineHours: (Number(event.elapsed_engine_hours) * 10).toFixed(0),
      EventLatitude: event.latitude ? event.latitude.toFixed(6) : null,
      EventLongitude: event.longitude ? event.longitude.toFixed(6) : null,
      DistanceSinceLastValidCoordinates: event.distance_since_last_valid_coords
        ? (Number(event.distance_since_last_valid_coords) * 10).toFixed(0)
        : null,
      MalfunctionIndicatorStatus: event.malfunction_indicator_status ? '1' : '0',
      EventDataCheckValue: event.event_data_check_value,
    })) || [];

  const executionTime = Date.now() - startTime;

  return { data: fmcsaEvents, error: null, executionTime };
}

// ═════════════════════════════════════════════════════════════════════════════
// BONUS QUERIES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Get driver's current duty status.
 *
 * Optimized with:
 * - idx_duty_status_driver_active (driver_id, started_at DESC) WHERE ended_at IS NULL
 *
 * @param supabase - Supabase client
 * @param driverId - Driver UUID
 * @returns Current duty status or null if offline
 */
export async function getCurrentDutyStatus(
  supabase: SupabaseClient,
  driverId: string
): Promise<{
  data: { duty_status: number; started_at: string; duration_minutes: number } | null;
  error: any;
  executionTime?: number;
}> {
  const startTime = Date.now();

  const { data, error } = await supabase
    .from('duty_status_records')
    .select('duty_status, started_at, duration_minutes')
    .eq('driver_id', driverId)
    .is('ended_at', null) // Active status (uses partial index)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const executionTime = Date.now() - startTime;

  return { data, error, executionTime };
}

/**
 * Get uncertified log periods for a driver.
 *
 * Optimized with:
 * - idx_log_periods_driver_uncertified (driver_id, log_date DESC) WHERE status IN (...)
 *
 * @param supabase - Supabase client
 * @param driverId - Driver UUID
 * @returns Uncertified log periods, oldest first
 */
export async function getUncertifiedLogs(
  supabase: SupabaseClient,
  driverId: string
): Promise<{ data: any[] | null; error: any; executionTime?: number }> {
  const startTime = Date.now();

  const { data, error } = await supabase
    .from('log_periods')
    .select('id, log_date, log_date_mmddyy, status, total_event_count')
    .eq('driver_id', driverId)
    .in('status', ['open', 'closed']) // Not certified (uses partial index)
    .order('log_date', { ascending: true }); // Oldest first

  const executionTime = Date.now() - startTime;

  return { data, error, executionTime };
}
