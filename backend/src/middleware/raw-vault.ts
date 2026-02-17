/**
 * Raw Vault Capture Middleware
 *
 * Records every inbound ELD event payload to the raw_events vault
 * BEFORE any Zod schema validation, business-rule checks, or ingestion
 * logic runs.  This guarantees the vault always has the original device
 * payload regardless of what happens later in the pipeline.
 *
 * Two middleware factories are exported:
 *   captureRawSingleEvent()  — for POST /api/v1/events
 *   captureRawBatchEvents()  — for POST /api/v1/events/batch
 *
 * After recording the row(s), the vault ID(s) are stored on the request
 * object so downstream controllers can update the processing status:
 *   (req as any).rawVaultId        — string | undefined (single event)
 *   (req as any).rawVaultIds       — string[]           (batch events)
 *   (req as any).rawVaultBatchId   — string             (batch UUID)
 *
 * Raw vault failures are non-fatal — if the INSERT fails, the middleware
 * logs a warning and continues without setting rawVaultId/rawVaultIds, so
 * the event ingestion pipeline is never blocked by vault issues.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { recordRawEvent, recordRawBatch } from '../services/raw-vault.service';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildBaseContext(req: Request) {
  return {
    receiptTimestamp: new Date().toISOString(),
    sourceIp: req.ip || null,
    userAgent: (req.headers['user-agent'] as string) || null,
    submittedByUserId: (req as any).user?.id ?? null,
  };
}

function resolveDeviceId(req: Request, payload?: Record<string, unknown>): string | null {
  return (
    (req.headers['x-device-id'] as string | undefined) ||
    (payload?.eldDeviceId as string | undefined) ||
    null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-event capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Captures the raw request body for a single-event POST and records it
 * to the raw_events vault.
 *
 * Stores `(req as any).rawVaultId` on success for downstream use.
 */
export function captureRawSingleEvent() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Deep-copy body before Zod can mutate it (apply defaults, coerce types, etc.)
    let rawPayload: Record<string, unknown>;
    try {
      rawPayload = JSON.parse(JSON.stringify(req.body)) as Record<string, unknown>;
    } catch {
      rawPayload = {};
    }

    const ctx = buildBaseContext(req);
    const sourceDeviceId = resolveDeviceId(req, rawPayload);

    try {
      const rawVaultId = await recordRawEvent({
        rawPayload,
        receiptTimestamp: ctx.receiptTimestamp,
        sourceDeviceId,
        sourceIp: ctx.sourceIp,
        userAgent: ctx.userAgent,
        submittedByUserId: ctx.submittedByUserId,
        batchId: null,
        eventIndex: null,
      });

      (req as any).rawVaultId = rawVaultId;

      logger.debug('Raw event captured', { rawVaultId, sourceDeviceId });
    } catch (err) {
      logger.warn('Raw vault capture failed — continuing without vault record', {
        error: err instanceof Error ? err.message : String(err),
        sourceDeviceId,
      });
      // Do not set rawVaultId; downstream code must handle undefined gracefully.
    }

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Captures each event in a batch POST and records them to the raw_events
 * vault in a single bulk INSERT.  All records share a generated batch_id.
 *
 * Stores on the request:
 *   (req as any).rawVaultIds      — string[] (same order as req.body.events)
 *   (req as any).rawVaultBatchId  — string   (shared batch UUID)
 */
export function captureRawBatchEvents() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Deep-copy entire body before Zod touches it
    let rawBody: Record<string, unknown>;
    try {
      rawBody = JSON.parse(JSON.stringify(req.body)) as Record<string, unknown>;
    } catch {
      rawBody = {};
    }

    const rawEvents = Array.isArray(rawBody.events)
      ? (rawBody.events as Record<string, unknown>[])
      : [];

    if (rawEvents.length === 0) {
      // No events to capture; let Zod validation handle the empty-array case.
      next();
      return;
    }

    const ctx = buildBaseContext(req);
    const batchId = randomUUID();
    const sharedDeviceId =
      (req.headers['x-device-id'] as string | undefined) ||
      (rawBody.deviceId as string | undefined) ||
      null;

    try {
      const paramsArray = rawEvents.map((event, idx) => ({
        rawPayload: event,
        receiptTimestamp: ctx.receiptTimestamp,
        sourceDeviceId:
          (event.eldDeviceId as string | undefined) || sharedDeviceId || null,
        sourceIp: ctx.sourceIp,
        userAgent: ctx.userAgent,
        submittedByUserId: ctx.submittedByUserId,
        batchId,
        eventIndex: idx,
      }));

      const rawVaultIds = await recordRawBatch(paramsArray);

      (req as any).rawVaultIds = rawVaultIds;
      (req as any).rawVaultBatchId = batchId;

      logger.debug('Raw batch captured', {
        batchId,
        count: rawVaultIds.length,
        sharedDeviceId,
      });
    } catch (err) {
      logger.warn('Raw vault batch capture failed — continuing without vault records', {
        batchId,
        count: rawEvents.length,
        error: err instanceof Error ? err.message : String(err),
      });
      // rawVaultIds will be undefined; downstream code handles this gracefully.
    }

    next();
  };
}
