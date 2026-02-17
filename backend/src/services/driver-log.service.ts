/**
 * Driver Log Service
 *
 * Business logic for daily driver log operations.
 */

import { supabase } from '../config/supabase';
import { NotFoundError } from '../models/errors/api-error';
import {
  getDriverEventsFor24Hours,
  getDailyLogSummary,
} from '../queries/optimized-queries';
import type { DriverLogResponse } from '../models/dtos/driver-log.dto';
import { logger } from '../utils/logger';

/**
 * Get complete daily driver log with HOS summary, events, and certifications
 */
export async function getDriverDailyLog(
  driverId: string,
  logDate: string // MMDDYY
): Promise<DriverLogResponse> {
  // 1. Fetch driver info and verify exists
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, full_name, license_number, home_terminal_timezone')
    .eq('id', driverId)
    .single();

  if (driverError || !driver) {
    logger.warn('Driver not found', { driverId });
    throw new NotFoundError('Driver');
  }

  // 2. Fetch log period for this date
  const { data: logPeriod, error: periodError } = await supabase
    .from('log_periods')
    .select('id, status, certified_at, total_event_count')
    .eq('driver_id', driverId)
    .eq('log_date_mmddyy', logDate)
    .single();

  if (periodError || !logPeriod) {
    logger.warn('Log period not found', { driverId, logDate });
    throw new NotFoundError('Log period');
  }

  // 3. Get daily summary (reuse optimized query)
  const { data: summary, error: summaryError } = await getDailyLogSummary(
    supabase,
    driverId,
    logDate
  );

  if (summaryError || !summary) {
    logger.error('Failed to get daily log summary', { driverId, logDate, error: summaryError });
    throw new NotFoundError('Daily log summary');
  }

  // 4. Get HOS calculations for this log period
  const { data: hosCalc, error: hosError } = await supabase
    .from('hos_calculations')
    .select(
      `
      driving_minutes_today,
      on_duty_minutes_today,
      remaining_driving_minutes,
      remaining_on_duty_window_minutes,
      time_until_break_required_minutes
    `
    )
    .eq('log_period_id', logPeriod.id)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (hosError) {
    logger.error('Failed to get HOS calculations', { logPeriodId: logPeriod.id, error: hosError });
  }

  // 5. Get events for this log period (reuse optimized query)
  const { data: events, error: eventsError } = await getDriverEventsFor24Hours(
    supabase,
    driverId,
    logDate,
    driver.home_terminal_timezone
  );

  if (eventsError) {
    logger.error('Failed to get driver events', { driverId, logDate, error: eventsError });
  }

  // 6. Get certifications for this log period
  const { data: certifications, error: certError } = await supabase
    .from('certifications')
    .select(
      `
      id,
      certification_type,
      is_recertification,
      performed_at,
      total_records_certified
    `
    )
    .eq('log_period_id', logPeriod.id)
    .order('performed_at', { ascending: true });

  if (certError) {
    logger.error('Failed to get certifications', { logPeriodId: logPeriod.id, error: certError });
  }

  // 7. Get violations for this log period
  const { data: violations, error: violationError } = await supabase
    .from('hos_violations')
    .select('violation_type, severity, description')
    .eq('log_period_id', logPeriod.id)
    .order('started_at', { ascending: true });

  if (violationError) {
    logger.error('Failed to get violations', { logPeriodId: logPeriod.id, error: violationError });
  }

  // 8. Build response
  return {
    driver: {
      id: driver.id,
      full_name: driver.full_name,
      license_number: driver.license_number,
      home_terminal_timezone: driver.home_terminal_timezone,
    },
    logDate,
    logPeriod: {
      id: logPeriod.id,
      status: logPeriod.status,
      certified_at: logPeriod.certified_at,
      total_event_count: logPeriod.total_event_count,
    },
    dutyStatusSummary: {
      off_duty_minutes: summary.off_duty_minutes,
      sleeper_berth_minutes: summary.sleeper_berth_minutes,
      driving_minutes: summary.driving_minutes,
      on_duty_not_driving_minutes: summary.on_duty_minutes,
      total_miles: summary.total_miles,
      start_location: summary.start_location,
      end_location: summary.end_location,
    },
    hosSummary: {
      driving_minutes_today: hosCalc ? Number(hosCalc.driving_minutes_today) : 0,
      on_duty_minutes_today: hosCalc ? Number(hosCalc.on_duty_minutes_today) : 0,
      driving_minutes_remaining: hosCalc ? Number(hosCalc.remaining_driving_minutes) : 660, // 11h default
      on_duty_window_remaining: hosCalc
        ? Number(hosCalc.remaining_on_duty_window_minutes)
        : 840, // 14h default
      break_required_in_minutes: hosCalc?.time_until_break_required_minutes
        ? Number(hosCalc.time_until_break_required_minutes)
        : null,
      violations:
        violations?.map((v) => ({
          type: v.violation_type,
          severity: v.severity,
          message: v.description,
        })) || [],
    },
    events:
      events?.map((e) => ({
        id: e.id,
        event_sequence_id: e.event_sequence_id,
        event_type: e.event_type,
        event_sub_type: e.event_sub_type,
        event_timestamp: e.event_timestamp,
        event_record_status: e.event_record_status,
        event_record_origin: e.event_record_origin,
        location_description: e.location_description,
        annotation: e.annotation,
        accumulated_vehicle_miles: Number(e.accumulated_vehicle_miles),
      })) || [],
    certifications: certifications || [],
  };
}
