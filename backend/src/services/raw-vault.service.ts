/**
 * Raw Vault Service
 *
 * Provides an immutable append-only store for every inbound ELD event payload
 * exactly as received, before any validation or ingestion logic runs.
 *
 * Schema: raw_events table
 *   • raw_payload           — original request body (JSONB)
 *   • receipt_timestamp     — when the HTTP request arrived
 *   • source_device_id      — from x-device-id header or payload
 *   • source_ip / user_agent / submitted_by_user_id — request context
 *   • batch_id / event_index — links events from the same batch request
 *   • processing_status     — received | processed | rejected | failed
 *   • processed_event_id    — FK to eld_events.id on success
 *   • error_message         — rejection / failure reason
 *
 * Immutability is enforced at the database layer via a BEFORE UPDATE trigger
 * (see migration 20260215000000_raw_events_vault.sql).
 * Only the processing_status, processed_event_id, processed_at, and
 * error_message columns may change after insert.
 */

import { supabase } from '../config/supabase';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface RawVaultParams {
  /** Original request body, captured before Zod parsing. */
  rawPayload: Record<string, unknown>;
  /** ISO 8601 timestamp — when the HTTP request arrived at the server. */
  receiptTimestamp: string;
  /** Device identifier: x-device-id header or payload.eldDeviceId. */
  sourceDeviceId: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  submittedByUserId: string | null;
  /** Groups events from the same batch request. Null for single-event POSTs. */
  batchId?: string | null;
  /** 0-based position within the batch. Null for single-event POSTs. */
  eventIndex?: number | null;
}

// ============================================================================
// Insert operations
// ============================================================================

/**
 * Records a single inbound event payload in the raw vault.
 * Called before any validation or ingestion logic.
 *
 * @returns The raw_events row ID (used to update status later).
 */
export async function recordRawEvent(params: RawVaultParams): Promise<string> {
  const { data, error } = await supabase
    .from('raw_events')
    .insert({
      raw_payload: params.rawPayload,
      receipt_timestamp: params.receiptTimestamp,
      source_device_id: params.sourceDeviceId,
      source_ip: params.sourceIp,
      user_agent: params.userAgent,
      submitted_by_user_id: params.submittedByUserId,
      batch_id: params.batchId ?? null,
      event_index: params.eventIndex ?? null,
      processing_status: 'received',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Raw vault INSERT failed: ${error.message}`);
  }

  return data.id as string;
}

/**
 * Records a batch of event payloads in the raw vault in a single INSERT.
 * All records share the same batch_id; each gets a unique event_index.
 *
 * @returns Array of raw_events row IDs in the same order as the input payloads.
 */
export async function recordRawBatch(
  paramsArray: RawVaultParams[]
): Promise<string[]> {
  if (paramsArray.length === 0) return [];

  const rows = paramsArray.map((p) => ({
    raw_payload: p.rawPayload,
    receipt_timestamp: p.receiptTimestamp,
    source_device_id: p.sourceDeviceId,
    source_ip: p.sourceIp,
    user_agent: p.userAgent,
    submitted_by_user_id: p.submittedByUserId,
    batch_id: p.batchId ?? null,
    event_index: p.eventIndex ?? null,
    processing_status: 'received',
  }));

  const { data, error } = await supabase
    .from('raw_events')
    .insert(rows)
    .select('id');

  if (error) {
    throw new Error(`Raw vault batch INSERT failed: ${error.message}`);
  }

  // Supabase returns rows in insert order, so the index mapping is direct.
  return (data ?? []).map((r: { id: string }) => r.id);
}

// ============================================================================
// Status update operations
// (Only these columns may change; the trigger blocks all other mutations.)
// ============================================================================

/**
 * Marks a raw vault record as successfully processed.
 * Links it to the newly created eld_events row.
 */
export async function markRawEventProcessed(
  rawEventId: string,
  processedEventId: string
): Promise<void> {
  const { error } = await supabase
    .from('raw_events')
    .update({
      processing_status: 'processed',
      processed_event_id: processedEventId,
      processed_at: new Date().toISOString(),
    })
    .eq('id', rawEventId);

  if (error) {
    logger.warn('Failed to mark raw event as processed', {
      rawEventId,
      processedEventId,
      error: error.message,
    });
  }
}

/**
 * Marks a raw vault record as rejected (failed schema / business-rule /
 * cross-reference validation).
 */
export async function markRawEventRejected(
  rawEventId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from('raw_events')
    .update({
      processing_status: 'rejected',
      error_message: errorMessage.substring(0, 2000), // guard against very long messages
      processed_at: new Date().toISOString(),
    })
    .eq('id', rawEventId);

  if (error) {
    logger.warn('Failed to mark raw event as rejected', {
      rawEventId,
      error: error.message,
    });
  }
}

/**
 * Marks a raw vault record as failed (passed validation but ingestion threw).
 */
export async function markRawEventFailed(
  rawEventId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from('raw_events')
    .update({
      processing_status: 'failed',
      error_message: errorMessage.substring(0, 2000),
      processed_at: new Date().toISOString(),
    })
    .eq('id', rawEventId);

  if (error) {
    logger.warn('Failed to mark raw event as failed', {
      rawEventId,
      error: error.message,
    });
  }
}

/**
 * Bulk-updates raw vault statuses for a completed batch.
 *
 * Runs all status updates in parallel for performance.
 * Failures are logged but do not throw — vault status updates must never
 * block or fail an API response.
 */
export async function updateBatchRawVaultStatuses(
  updates: Array<{
    rawEventId: string;
    status: 'processed' | 'rejected' | 'failed';
    processedEventId?: string;
    errorMessage?: string;
  }>
): Promise<void> {
  await Promise.allSettled(
    updates.map(({ rawEventId, status, processedEventId, errorMessage }) => {
      if (status === 'processed' && processedEventId) {
        return markRawEventProcessed(rawEventId, processedEventId);
      } else if (status === 'rejected') {
        return markRawEventRejected(rawEventId, errorMessage ?? 'Rejected');
      } else {
        return markRawEventFailed(rawEventId, errorMessage ?? 'Ingestion failed');
      }
    })
  );
}
