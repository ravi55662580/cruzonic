import { z } from 'zod';

// ============================================================================
// Query / request schemas
// ============================================================================

/** Query params for GET /admin/dlq */
export const DLQListQuerySchema = z.object({
  status: z.enum(['pending', 'retrying', 'resolved', 'discarded']).optional(),
  sourceDeviceId: z.string().min(1).max(255).optional(),
  sourceEndpoint: z.enum(['/events', '/events/batch']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type DLQListQuery = z.infer<typeof DLQListQuerySchema>;

/** Path param for single-entry endpoints */
export const DLQEntryParamsSchema = z.object({
  id: z.string().uuid('DLQ entry ID must be a valid UUID'),
});

export type DLQEntryParams = z.infer<typeof DLQEntryParamsSchema>;

/** Body for POST /admin/dlq/:id/discard */
export const DLQDiscardBodySchema = z.object({
  notes: z.string().max(500).optional(),
});

export type DLQDiscardBody = z.infer<typeof DLQDiscardBodySchema>;

// ============================================================================
// Response types (documentation / OpenAPI)
// ============================================================================

export interface DLQEntryResponse {
  id: string;
  failureReason: string;
  retryCount: number;
  firstFailureAt: string;
  lastFailureAt: string;
  status: 'pending' | 'retrying' | 'resolved' | 'discarded';
  sourceDeviceId: string | null;
  sourceEndpoint: string | null;
  batchIndex: number | null;
  rawVaultId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Original payload omitted from list view — available via GET /admin/dlq/:id */
  originalPayload?: unknown;
}

export interface DLQListResponse {
  entries: DLQEntryResponse[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface DLQStatsResponse {
  pending: number;
  retrying: number;
  resolved: number;
  discarded: number;
  total: number;
  alertThreshold: number;
  thresholdExceeded: boolean;
}

export interface DLQRetryResponse {
  success: boolean;
  dlqEntryId: string;
  eventId?: string;
  sequenceId?: number;
  chainHash?: string;
  error?: string;
}
