/**
 * Certification DTOs
 *
 * Request/response types for driver certification endpoints.
 */

import { z } from 'zod';

/**
 * Request schema for POST /certify
 */
export const CertifyLogRequestSchema = z.object({
  driver_id: z.string().uuid('Invalid driver ID'),
  certified_log_date: z.string().regex(/^\d{6}$/, 'Invalid date format (MMDDYY)'),
  certification_type: z.enum(['own_records', 'co_driver_records']).default('own_records'),
  certified_driver_id: z.string().uuid('Invalid certified driver ID').optional(),
  annotation: z.string().max(60, 'Annotation must be 60 characters or less').optional(),
});

export type CertifyLogRequest = z.infer<typeof CertifyLogRequestSchema>;

/**
 * Certification Response
 */
export interface CertifyLogResponse {
  certification: {
    id: string;
    certification_type: string;
    certified_log_date: string;
    is_recertification: boolean;
    total_records_certified: number;
    performed_at: string;
  };
  eld_event: {
    id: string;
    event_sequence_id: number;
    event_timestamp: string;
  };
  log_period: {
    id: string;
    status: string;
    certified_at: string;
  };
}
