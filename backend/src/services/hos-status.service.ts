/**
 * HOS Status Service
 *
 * Business logic for Hours of Service status operations.
 */

import { supabase } from '../config/supabase';
import { NotFoundError } from '../models/errors/api-error';
import { getHOSRemainingTime, getCurrentDutyStatus } from '../queries/optimized-queries';
import type { HOSStatusResponse } from '../models/dtos/hos.dto';
import { logger } from '../utils/logger';

const DUTY_STATUS_NAMES: Record<number, string> = {
  1: 'OFF_DUTY',
  2: 'SLEEPER_BERTH',
  3: 'DRIVING',
  4: 'ON_DUTY_NOT_DRIVING',
};

/**
 * Get current HOS status for a driver
 */
export async function getHOSStatus(driverId: string): Promise<HOSStatusResponse> {
  // 1. Verify driver exists and get hos_ruleset
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, hos_ruleset')
    .eq('id', driverId)
    .single();

  if (driverError || !driver) {
    logger.warn('Driver not found', { driverId });
    throw new NotFoundError('Driver');
  }

  // 2. Get current duty status (reuse optimized query)
  const { data: currentStatus, error: statusError } = await getCurrentDutyStatus(
    supabase,
    driverId
  );

  if (statusError) {
    logger.error('Failed to get current duty status', { driverId, error: statusError });
  }

  // 3. Get latest HOS calculation (reuse optimized query for remaining time)
  const { data: hosRemaining, error: remainingError } = await getHOSRemainingTime(
    supabase,
    driverId
  );

  if (remainingError || !hosRemaining) {
    logger.error('Failed to get HOS remaining time', { driverId, error: remainingError });
    throw new NotFoundError('HOS calculation data');
  }

  // 4. Get full HOS calculation record for additional fields
  const { data: hosCalc, error: calcError } = await supabase
    .from('hos_calculations')
    .select(
      `
      driving_minutes_today,
      on_duty_minutes_today,
      driving_minutes_7day,
      on_duty_minutes_7day,
      driving_minutes_8day,
      on_duty_minutes_8day,
      remaining_driving_minutes,
      remaining_on_duty_window_minutes,
      remaining_weekly_minutes,
      time_until_break_required_minutes,
      consecutive_off_duty_minutes,
      is_in_34h_restart,
      restart_started_at,
      restart_eligible_at,
      calculated_at,
      hos_ruleset
    `
    )
    .eq('driver_id', driverId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .single();

  if (calcError || !hosCalc) {
    logger.error('Failed to get HOS calculation', { driverId, error: calcError });
    throw new NotFoundError('HOS calculation');
  }

  // 5. Get active violations
  const { data: violations, error: violationError } = await supabase
    .from('hos_violations')
    .select('violation_type, severity, started_at, resolved_at')
    .eq('driver_id', driverId)
    .is('resolved_at', null) // Active violations only
    .order('started_at', { ascending: false });

  if (violationError) {
    logger.error('Failed to get violations', { driverId, error: violationError });
  }

  // 6. Calculate restart progress if in 34h restart
  let restartProgressMinutes = null;
  if (hosCalc.is_in_34h_restart && hosCalc.restart_started_at) {
    const startTime = new Date(hosCalc.restart_started_at).getTime();
    const now = Date.now();
    restartProgressMinutes = Math.floor((now - startTime) / 60000);
  }

  // 7. Determine break requirement status
  const timeUntilBreak = hosCalc.time_until_break_required_minutes
    ? Number(hosCalc.time_until_break_required_minutes)
    : null;
  const consecutiveDrivingMinutes = timeUntilBreak !== null ? 480 - timeUntilBreak : 0; // 8h = 480 min
  const breakRequired = timeUntilBreak !== null && timeUntilBreak <= 0;

  // 8. Build response
  return {
    driver_id: driverId,
    current_status: currentStatus
      ? {
          duty_status: currentStatus.duty_status,
          duty_status_name: DUTY_STATUS_NAMES[currentStatus.duty_status] || 'UNKNOWN',
          started_at: currentStatus.started_at,
          duration_minutes: Number(currentStatus.duration_minutes) || 0,
        }
      : null,
    remaining_time: {
      driving_minutes: Number(hosCalc.remaining_driving_minutes) || 0,
      on_duty_window_minutes: Number(hosCalc.remaining_on_duty_window_minutes) || 0,
      weekly_minutes: Number(hosCalc.remaining_weekly_minutes) || 0,
      shift_minutes: Number(hosCalc.remaining_on_duty_window_minutes) || 0,
      cycle_minutes: Number(hosCalc.remaining_weekly_minutes) || 0,
    },
    breaks: {
      break_required: breakRequired,
      break_required_in_minutes: timeUntilBreak,
      consecutive_driving_minutes: consecutiveDrivingMinutes,
    },
    restart: {
      in_34h_restart: hosCalc.is_in_34h_restart,
      restart_started_at: hosCalc.restart_started_at,
      restart_eligible_at: hosCalc.restart_eligible_at,
      restart_progress_minutes: restartProgressMinutes,
    },
    violations:
      violations?.map((v) => ({
        type: v.violation_type,
        severity: v.severity,
        active: !v.resolved_at,
        started_at: v.started_at,
      })) || [],
    calculated_at: hosCalc.calculated_at,
    hos_ruleset: hosCalc.hos_ruleset,
  };
}
