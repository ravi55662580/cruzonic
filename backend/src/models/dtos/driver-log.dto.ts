/**
 * Driver Log DTOs
 *
 * Request/response types for daily driver log endpoints.
 */

import { z } from 'zod';

/**
 * Route params validation for GET /drivers/:id/logs/:logDate
 */
export const DriverLogParamsSchema = z.object({
  id: z.string().uuid('Invalid driver ID'),
  logDate: z.string().regex(/^\d{6}$/, 'Invalid date format (MMDDYY)'),
});

export type DriverLogParams = z.infer<typeof DriverLogParamsSchema>;

/**
 * Daily Driver Log Response
 */
export interface DriverLogResponse {
  driver: {
    id: string;
    full_name: string;
    license_number: string;
    home_terminal_timezone: string;
  };
  logDate: string; // MMDDYY
  logPeriod: {
    id: string;
    status: 'open' | 'closed' | 'certified' | 'recertified';
    certified_at: string | null;
    total_event_count: number;
  };
  dutyStatusSummary: {
    off_duty_minutes: number;
    sleeper_berth_minutes: number;
    driving_minutes: number;
    on_duty_not_driving_minutes: number;
    total_miles: number;
    start_location: string | null;
    end_location: string | null;
  };
  hosSummary: {
    driving_minutes_today: number;
    on_duty_minutes_today: number;
    driving_minutes_remaining: number;
    on_duty_window_remaining: number;
    break_required_in_minutes: number | null;
    violations: Array<{
      type: string;
      severity: string;
      message: string;
    }>;
  };
  events: Array<{
    id: string;
    event_sequence_id: number;
    event_type: number;
    event_sub_type: number;
    event_timestamp: string;
    event_record_status: number;
    event_record_origin: number;
    location_description: string | null;
    annotation: string | null;
    accumulated_vehicle_miles: number;
  }>;
  certifications: Array<{
    id: string;
    certification_type: string;
    is_recertification: boolean;
    performed_at: string;
    total_records_certified: number;
  }>;
}
