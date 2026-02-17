/**
 * Common DTOs
 *
 * Shared data transfer objects used across the API.
 */

import { z } from 'zod';

// ============================================================================
// Pagination
// ============================================================================

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

// ============================================================================
// API Response Envelope
// ============================================================================

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Common Query Params
// ============================================================================

export const UUIDParamSchema = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

export type UUIDParam = z.infer<typeof UUIDParamSchema>;

export const DateRangeQuerySchema = z.object({
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
});

export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

// ============================================================================
// Health Check
// ============================================================================

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceHealth;
  };
  memory: NodeJS.MemoryUsage;
}

export interface ServiceHealth {
  status: 'up' | 'down';
  latency?: number;
  error?: string;
}
