/**
 * Dead-Letter Queue (DLQ) Service
 *
 * Stores ELD events that fail ingestion after all retry attempts.
 * Provides admin operations to inspect, retry, and discard entries.
 *
 * Alert system:
 *   After every new entry is created the pending depth is checked
 *   asynchronously.  When it exceeds DLQ_ALERT_THRESHOLD (default 100)
 *   a structured error log is emitted — ready to be picked up by any
 *   log-aggregation alert rule (Datadog, Grafana, CloudWatch, etc.).
 *
 * Retry semantics:
 *   Admin retry calls ingestEvent() directly with the stored payload.
 *   A successful re-ingestion marks the entry as 'resolved'.
 *   A failed re-ingestion increments retry_count, updates failure_reason,
 *   and resets status back to 'pending' so the entry stays visible.
 */

import { supabase } from '../config/supabase';
import { ingestEvent } from './event-ingestion.service';
import type { AuditActor, NetworkContext } from '../../../shared/src/eld/audit-trail';
import { logger } from '../utils/logger';

// ============================================================================
// Configuration
// ============================================================================

const DLQ_ALERT_THRESHOLD = parseInt(process.env.DLQ_ALERT_THRESHOLD || '100', 10);
const DLQ_TABLE = 'event_dlq';

// ============================================================================
// Types
// ============================================================================

export interface DLQPayload {
  eventType: number;
  eventSubType?: number;
  eventRecordStatus: number;
  eventRecordOrigin: number;
  eventDate: string;
  eventTime: string;
  timezoneOffset: string;
  eldDeviceId: string;
  driverEldAccountId?: string;
  carrierDotNumber?: string;
  metadata: Record<string, unknown>;
  actor: AuditActor;
  network?: NetworkContext;
  sequenceId?: number;
}

export interface AddToDLQParams {
  originalPayload: DLQPayload;
  failureReason: string;
  sourceDeviceId: string | null;
  sourceEndpoint: '/events' | '/events/batch';
  batchIndex?: number;
  rawVaultId?: string;
}

export interface DLQEntry {
  id: string;
  originalPayload: DLQPayload;
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
}

export interface DLQListResult {
  entries: DLQEntry[];
  total: number;
}

export interface DLQStats {
  pending: number;
  retrying: number;
  resolved: number;
  discarded: number;
  total: number;
}

export interface DLQRetryResult {
  success: boolean;
  eventId?: string;
  sequenceId?: number;
  chainHash?: string;
  error?: string;
}

// ============================================================================
// Internal helpers
// ============================================================================

function rowToEntry(row: Record<string, unknown>): DLQEntry {
  return {
    id: row.id as string,
    originalPayload: row.original_payload as DLQPayload,
    failureReason: row.failure_reason as string,
    retryCount: row.retry_count as number,
    firstFailureAt: row.first_failure_at as string,
    lastFailureAt: row.last_failure_at as string,
    status: row.status as DLQEntry['status'],
    sourceDeviceId: (row.source_device_id as string) || null,
    sourceEndpoint: (row.source_endpoint as string) || null,
    batchIndex: row.batch_index as number | null,
    rawVaultId: (row.raw_vault_id as string) || null,
    resolvedAt: (row.resolved_at as string) || null,
    resolvedByUserId: (row.resolved_by_user_id as string) || null,
    resolutionNotes: (row.resolution_notes as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Checks pending DLQ depth and emits a structured alert log if the
 * configured threshold is met or exceeded.  Fire-and-forget — never throws.
 */
async function checkDepthAlert(): Promise<void> {
  try {
    const { count, error } = await supabase
      .from(DLQ_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error || count === null) return;

    if (count >= DLQ_ALERT_THRESHOLD) {
      logger.error('DLQ_DEPTH_THRESHOLD_EXCEEDED', {
        alert: 'DLQ_DEPTH_THRESHOLD_EXCEEDED',
        pendingDepth: count,
        threshold: DLQ_ALERT_THRESHOLD,
        message:
          `Dead-letter queue has ${count} pending entries — ` +
          `exceeds threshold of ${DLQ_ALERT_THRESHOLD}. ` +
          `Visit GET /api/v1/admin/dlq to inspect and retry.`,
      });
    }
  } catch {
    // Never surface alert errors to callers
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Adds a failed event to the DLQ.
 * Triggers an async depth-alert check after insertion.
 *
 * @returns The new DLQ entry ID.
 */
export async function addToDLQ(params: AddToDLQParams): Promise<string> {
  const { data, error } = await supabase
    .from(DLQ_TABLE)
    .insert({
      original_payload: params.originalPayload,
      failure_reason: params.failureReason,
      source_device_id: params.sourceDeviceId,
      source_endpoint: params.sourceEndpoint,
      batch_index: params.batchIndex ?? null,
      raw_vault_id: params.rawVaultId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to add event to DLQ: ${error.message}`);
  }

  // Alert check is fire-and-forget — must not delay caller
  checkDepthAlert().catch(() => {});

  logger.warn('Event added to DLQ', {
    dlqId: data.id,
    sourceEndpoint: params.sourceEndpoint,
    sourceDeviceId: params.sourceDeviceId,
    batchIndex: params.batchIndex,
    failureReason: params.failureReason,
  });

  return data.id as string;
}

/**
 * Lists DLQ entries with optional filtering and pagination.
 */
export async function listDLQEntries(options: {
  status?: DLQEntry['status'];
  sourceDeviceId?: string;
  sourceEndpoint?: string;
  limit?: number;
  offset?: number;
}): Promise<DLQListResult> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let query = supabase
    .from(DLQ_TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.sourceDeviceId) {
    query = query.eq('source_device_id', options.sourceDeviceId);
  }
  if (options.sourceEndpoint) {
    query = query.eq('source_endpoint', options.sourceEndpoint);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list DLQ entries: ${error.message}`);
  }

  return {
    entries: (data || []).map(rowToEntry),
    total: count ?? 0,
  };
}

/**
 * Retrieves a single DLQ entry by ID.
 * Returns null if not found.
 */
export async function getDLQEntry(id: string): Promise<DLQEntry | null> {
  const { data, error } = await supabase
    .from(DLQ_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch DLQ entry: ${error.message}`);
  }

  return data ? rowToEntry(data as Record<string, unknown>) : null;
}

/**
 * Returns per-status counts and total for the DLQ dashboard.
 */
export async function getDLQStats(): Promise<DLQStats> {
  const { data, error } = await supabase
    .from(DLQ_TABLE)
    .select('status');

  if (error) {
    throw new Error(`Failed to fetch DLQ stats: ${error.message}`);
  }

  const stats: DLQStats = { pending: 0, retrying: 0, resolved: 0, discarded: 0, total: 0 };

  for (const row of data || []) {
    const s = row.status as keyof Omit<DLQStats, 'total'>;
    if (s in stats) stats[s]++;
    stats.total++;
  }

  return stats;
}

/**
 * Returns the current count of pending DLQ entries (for health checks).
 */
export async function getDLQDepth(): Promise<number> {
  const { count, error } = await supabase
    .from(DLQ_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to fetch DLQ depth: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Attempts to re-ingest a pending DLQ entry.
 *
 * Flow:
 *   1. Fetch the entry and verify status is 'pending'.
 *   2. Mark status as 'retrying'.
 *   3. Call ingestEvent() with the stored payload.
 *   4. On success: mark 'resolved', record resolver.
 *   5. On failure: reset to 'pending', increment retry_count, update reason.
 */
export async function retryDLQEntry(
  id: string,
  actorUserId: string
): Promise<DLQRetryResult> {
  // Fetch entry
  const entry = await getDLQEntry(id);
  if (!entry) {
    throw new Error(`DLQ entry ${id} not found`);
  }
  if (entry.status !== 'pending') {
    throw new Error(
      `DLQ entry ${id} has status '${entry.status}' — only 'pending' entries can be retried`
    );
  }

  // Mark as retrying
  const { error: retryingErr } = await supabase
    .from(DLQ_TABLE)
    .update({ status: 'retrying' })
    .eq('id', id)
    .eq('status', 'pending'); // optimistic concurrency guard

  if (retryingErr) {
    throw new Error(`Failed to mark DLQ entry as retrying: ${retryingErr.message}`);
  }

  logger.info('Retrying DLQ entry', { dlqId: id, actorUserId, retryCount: entry.retryCount });

  try {
    // Use a system actor for admin-triggered retries
    const systemActor: AuditActor = {
      ...(entry.originalPayload.actor || {}),
      userId: actorUserId,
      source: 'admin_dlq_retry' as const,
    } as AuditActor;

    const result = await ingestEvent({
      ...entry.originalPayload,
      actor: systemActor,
      // Clear sequence ID so a fresh one is allocated (the original may be taken)
      sequenceId: undefined,
    });

    // Success — mark as resolved
    const { error: resolveErr } = await supabase
      .from(DLQ_TABLE)
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by_user_id: actorUserId,
        resolution_notes: `Re-ingested as event ${result.eventId} (seq ${result.sequenceId})`,
      })
      .eq('id', id);

    if (resolveErr) {
      logger.warn('DLQ entry re-ingested but failed to update status to resolved', {
        dlqId: id,
        eventId: result.eventId,
        error: resolveErr.message,
      });
    }

    logger.info('DLQ entry resolved via retry', {
      dlqId: id,
      eventId: result.eventId,
      sequenceId: result.sequenceId,
      actorUserId,
    });

    return {
      success: true,
      eventId: result.eventId,
      sequenceId: result.sequenceId,
      chainHash: result.chainHash,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error during retry';

    // Reset to pending, increment retry_count
    const { error: resetErr } = await supabase
      .from(DLQ_TABLE)
      .update({
        status: 'pending',
        failure_reason: reason,
        retry_count: entry.retryCount + 1,
        last_failure_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (resetErr) {
      logger.warn('DLQ retry failed and entry could not be reset to pending', {
        dlqId: id,
        resetError: resetErr.message,
      });
    }

    logger.warn('DLQ retry failed', {
      dlqId: id,
      retryCount: entry.retryCount + 1,
      error: reason,
      actorUserId,
    });

    return { success: false, error: reason };
  }
}

/**
 * Marks a DLQ entry as discarded (no re-ingestion will occur).
 * Only 'pending' entries can be discarded.
 */
export async function discardDLQEntry(
  id: string,
  actorUserId: string,
  notes?: string
): Promise<void> {
  const entry = await getDLQEntry(id);
  if (!entry) {
    throw new Error(`DLQ entry ${id} not found`);
  }
  if (entry.status !== 'pending') {
    throw new Error(
      `DLQ entry ${id} has status '${entry.status}' — only 'pending' entries can be discarded`
    );
  }

  const { error } = await supabase
    .from(DLQ_TABLE)
    .update({
      status: 'discarded',
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: actorUserId,
      resolution_notes: notes ?? null,
    })
    .eq('id', id)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to discard DLQ entry: ${error.message}`);
  }

  logger.info('DLQ entry discarded', { dlqId: id, actorUserId, notes });
}
