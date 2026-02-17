/**
 * HOS (Hours of Service) DTOs
 *
 * Request/response types for HOS status endpoints.
 */

import { z } from 'zod';

/**
 * Route params validation for GET /hos/:driverId/status
 */
export const HOSStatusParamsSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
});

export type HOSStatusParams = z.infer<typeof HOSStatusParamsSchema>;

/**
 * HOS Status Response
 */
export interface HOSStatusResponse {
  driver_id: string;
  current_status: {
    duty_status: number; // 1=OFF, 2=SLEEPER, 3=DRIVING, 4=ON_DUTY
    duty_status_name: string;
    started_at: string;
    duration_minutes: number;
  } | null;
  remaining_time: {
    driving_minutes: number;
    on_duty_window_minutes: number;
    weekly_minutes: number;
    shift_minutes: number;
    cycle_minutes: number;
  };
  breaks: {
    break_required: boolean;
    break_required_in_minutes: number | null;
    consecutive_driving_minutes: number;
  };
  restart: {
    in_34h_restart: boolean;
    restart_started_at: string | null;
    restart_eligible_at: string | null;
    restart_progress_minutes: number | null;
  };
  violations: Array<{
    type: string;
    severity: string;
    active: boolean;
    started_at: string;
  }>;
  calculated_at: string;
  hos_ruleset: string;
}
