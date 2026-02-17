/**
 * Event DTOs
 *
 * Data transfer objects for ELD event operations.
 * Reuses validation schemas from shared package.
 */

import { z } from 'zod';

// ============================================================================
// Ingest Single Event
// ============================================================================

// Base event schema (simplified - full validation uses shared FMCSA schemas)
export const IngestEventSchema = z.object({
  eventType: z.number().int().min(1).max(7),
  eventCode: z.string().optional(),
  eventTimestamp: z.string().datetime({ offset: true }),
  eventSequenceId: z.string(),
  driverId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  eldDeviceId: z.string().uuid(),
  accumulatedVehicleMiles: z.number().nonnegative(),
  accumulatedEngineHours: z.number().nonnegative(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  locationDescription: z.string().max(255).optional(),
  malfunctionIndicatorStatus: z.boolean(),
  datadiagnosticEventIndicatorStatus: z.boolean(),
  eventRecordStatus: z.number().int().min(1).max(4).default(1),
  eventRecordOrigin: z.number().int().min(1).max(4),
  metadata: z.record(z.unknown()).optional(),
});

export type IngestEventRequest = z.infer<typeof IngestEventSchema>;

export interface IngestEventResponse {
  id: string;
  eventSequenceId: string;
  eventTimestamp: string;
  createdAt: string;
}

// ============================================================================
// Batch Ingest Events
// ============================================================================

export const BatchIngestEventSchema = z.object({
  events: z
    .array(IngestEventSchema)
    .min(1, 'Batch must contain at least one event')
    .max(100, 'Batch cannot exceed 100 events'),
  deviceId: z.string().optional(), // Shared device ID for all events (overridden per-event if set)
});

export type BatchIngestEventRequest = z.infer<typeof BatchIngestEventSchema>;

export interface BatchAcceptedEvent {
  index: number;
  eventId: string;
  sequenceId: number;
  chainHash: string;
  eventType: number;
}

export interface BatchRejectedEvent {
  index: number;
  error: string;
  eventType?: number;
  eventSequenceId?: string;
}

export interface BatchIngestEventResponse {
  accepted: BatchAcceptedEvent[];
  rejected: BatchRejectedEvent[];
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    processingTimeMs: number;
  };
}

// ============================================================================
// Get Events
// ============================================================================

export const GetEventsQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  eventType: z.coerce.number().int().min(1).max(7).optional(),
  eventRecordStatus: z.coerce.number().int().min(1).max(4).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type GetEventsQuery = z.infer<typeof GetEventsQuerySchema>;

export interface GetEventsResponse {
  events: EventSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface EventSummary {
  id: string;
  eventType: number;
  eventCode: string | null;
  eventTimestamp: string;
  eventSequenceId: string;
  driverId: string;
  vehicleId: string;
  accumulatedVehicleMiles: number;
  latitude: number | null;
  longitude: number | null;
  locationDescription: string | null;
  eventRecordStatus: number;
}

// ============================================================================
// Get Event by ID
// ============================================================================

export interface EventDetailResponse {
  id: string;
  eventType: number;
  eventCode: string | null;
  eventTimestamp: string;
  eventSequenceId: string;
  driverId: string;
  vehicleId: string;
  eldDeviceId: string;
  accumulatedVehicleMiles: number;
  accumulatedEngineHours: number;
  latitude: number | null;
  longitude: number | null;
  locationDescription: string | null;
  malfunctionIndicatorStatus: boolean;
  datadiagnosticEventIndicatorStatus: boolean;
  eventRecordStatus: number;
  eventRecordOrigin: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
