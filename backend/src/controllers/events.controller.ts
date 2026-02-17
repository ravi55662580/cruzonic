/**
 * Events Controller
 *
 * Handles ELD event operations:
 * - Ingest single event
 * - Ingest batch of events (up to 100)
 * - Retrieve events by device/driver
 * - Detect sequence ID gaps
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { ingestEvent, getEventsByDevice, ingestBatchEvents } from '../services/event-ingestion.service';
import { validateBatchEvents } from '../services/event-validation.service';
import { detectSequenceGaps } from '../services/sequence-id.service';
import { logger } from '../utils/logger';
import { AuthenticationError } from '../models/errors/api-error';
import type { IngestEventRequest } from '../models/dtos/event.dto';

export class EventsController extends BaseController {
  /**
   * POST /api/v1/events
   * Ingest a single ELD event
   */
  async ingestEvent(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const eventData = req.body;

    if (!req.user) {
      throw new AuthenticationError('User not authenticated');
    }

    logger.info('Ingesting event', {
      eventType: eventData.eventType,
      deviceId: eventData.eldDeviceId,
      userId: req.user.id,
    });

    const result = await ingestEvent({
      ...eventData,
      actor: {
        userId: req.user.id,
        deviceId: eventData.eldDeviceId,
        source: 'api' as const,
      },
      network: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      },
    });

    logger.info('Event ingested successfully', { sequenceId: result.sequenceId });

    return this.created(res, result);
  }

  /**
   * POST /api/v1/events/batch
   * Ingest a batch of ELD events (up to 100).
   *
   * Processing pipeline:
   *   1. Zod schema validation (middleware — already done before this handler)
   *   2. Business rules + cross-reference validation (layers 2 & 3) — pre-pass
   *   3. Sequential hash-chain ingestion of validated events
   *
   * Returns 201 if all events accepted, 207 if partial, 400 if all rejected.
   * Supports gzip-compressed request bodies via Content-Encoding: gzip.
   */
  async ingestBatchEvents(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) {
      throw new AuthenticationError('User not authenticated');
    }

    const startTime = Date.now();
    const { events, deviceId: sharedDeviceId } = req.body;
    const deviceIdHeader = req.headers['x-device-id'] as string | undefined;
    const resolvedDeviceId = sharedDeviceId || deviceIdHeader;

    logger.info('Ingesting event batch', {
      count: events?.length ?? 0,
      deviceId: resolvedDeviceId,
      userId: req.user.id,
      contentEncoding: req.headers['content-encoding'] || 'none',
    });

    // Normalise each event: apply shared deviceId if the individual event doesn't provide one
    const normalisedEvents = (events as Record<string, unknown>[]).map((event) => ({
      ...event,
      eldDeviceId: (event.eldDeviceId as string) || resolvedDeviceId,
    }));

    // ── Layer 2 & 3: business rules + cross-reference pre-pass ───────────────
    // Events that fail validation are moved directly to the rejected list;
    // only events that pass are forwarded to the hash-chain ingest service.
    let batchValidation: Awaited<ReturnType<typeof validateBatchEvents>>;
    try {
      batchValidation = await validateBatchEvents(
        normalisedEvents as unknown as IngestEventRequest[]
      );
    } catch {
      // Validation service unavailable — skip layers 2/3 and ingest everything
      logger.warn('Batch validation service error — proceeding without layers 2/3');
      batchValidation = { invalidIndices: new Map() };
    }

    // Split events into valid (to ingest) and pre-rejected (validation failures)
    type PreRejected = { index: number; error: string; eventType?: number; eventSequenceId?: string };
    const preRejected: PreRejected[] = [];
    const validSlots: Array<{ event: Record<string, unknown>; originalIndex: number }> = [];

    for (let i = 0; i < normalisedEvents.length; i++) {
      const fieldErrors = batchValidation.invalidIndices.get(i);
      if (fieldErrors && fieldErrors.length > 0) {
        const errorMsg = fieldErrors
          .map((e) => `[${e.field}] ${e.message}`)
          .join('; ');
        preRejected.push({
          index: i,
          error: `Validation failed: ${errorMsg}`,
          eventType: (normalisedEvents[i] as Record<string, unknown>).eventType as number | undefined,
          eventSequenceId: (normalisedEvents[i] as Record<string, unknown>).eventSequenceId as string | undefined,
        });
      } else {
        validSlots.push({ event: normalisedEvents[i], originalIndex: i });
      }
    }

    // ── Fast-path: all events failed validation ───────────────────────────────
    if (validSlots.length === 0) {
      const allRejectedResult = {
        accepted: [],
        rejected: preRejected,
        summary: {
          total: normalisedEvents.length,
          accepted: 0,
          rejected: preRejected.length,
          processingTimeMs: Date.now() - startTime,
        },
      };
      logger.info('Batch ingestion complete — all events rejected by validation', {
        total: allRejectedResult.summary.total,
        rejected: allRejectedResult.summary.rejected,
        processingTimeMs: allRejectedResult.summary.processingTimeMs,
      });
      return res.status(400).json({ success: false, data: allRejectedResult });
    }

    // ── Ingest validated events sequentially ─────────────────────────────────
    const ingestResult = await ingestBatchEvents({
      events: validSlots.map((s) => s.event) as Parameters<typeof ingestBatchEvents>[0]['events'],
      actor: {
        userId: req.user.id,
        deviceId: resolvedDeviceId || 'unknown',
        source: 'api' as const,
      },
      network: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      },
    });

    // Re-map ingest-result indices to their original batch positions
    const remappedAccepted = ingestResult.accepted.map((a) => ({
      ...a,
      index: validSlots[a.index]?.originalIndex ?? a.index,
    }));

    const remappedIngestionRejected = ingestResult.rejected.map((r) => ({
      ...r,
      index: validSlots[r.index]?.originalIndex ?? r.index,
    }));

    // Merge pre-rejected (validation) + ingest-rejected, sorted by original index
    const allRejected = [...preRejected, ...remappedIngestionRejected].sort(
      (a, b) => a.index - b.index
    );

    const finalResult = {
      accepted: remappedAccepted,
      rejected: allRejected,
      summary: {
        total: normalisedEvents.length,
        accepted: remappedAccepted.length,
        rejected: allRejected.length,
        processingTimeMs: Date.now() - startTime,
      },
    };

    logger.info('Batch ingestion complete', {
      total: finalResult.summary.total,
      accepted: finalResult.summary.accepted,
      rejected: finalResult.summary.rejected,
      validationRejected: preRejected.length,
      processingTimeMs: finalResult.summary.processingTimeMs,
    });

    // 201 – all accepted; 207 – partial; 400 – all rejected
    if (finalResult.summary.rejected === 0) {
      return this.created(res, finalResult);
    }
    if (finalResult.summary.accepted === 0) {
      return res.status(400).json({ success: false, data: finalResult });
    }
    return res.status(207).json({ success: true, data: finalResult });
  }

  /**
   * GET /api/v1/events
   * Get events with filtering and pagination
   */
  async getEvents(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const query = req.query as Record<string, unknown>;

    logger.debug('Fetching events', { query });

    const deviceId = (query.deviceId as string) || (query.eldDeviceId as string) || '';
    const logDate = (query.startDate as string) || '';
    const eventType = query.eventType ? Number(query.eventType) : undefined;
    const includeInactive = query.eventRecordStatus !== '1';

    const events = await getEventsByDevice(deviceId, logDate, {
      eventType,
      includeInactive,
    });

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const pagination = this.buildPaginationMeta(page, limit, events.length);

    return this.success(res, {
      events: events.slice(0, limit),
      pagination,
    });
  }

  /**
   * GET /api/v1/events/:eldDeviceId/:logDate
   * Retrieve events for a specific device and log date
   */
  async getEventsByDeviceAndDate(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { eldDeviceId, logDate } = req.params;
    const eventType = req.query.eventType ? Number(req.query.eventType) : undefined;
    const includeInactive = req.query.includeInactive === 'true';

    logger.debug('Fetching events by device and date', {
      eldDeviceId,
      logDate,
      eventType,
      includeInactive,
    });

    const events = await getEventsByDevice(eldDeviceId, logDate, {
      eventType,
      includeInactive,
    });

    return this.success(res, {
      events,
      count: events.length,
      eldDeviceId,
      logDate,
    });
  }

  /**
   * GET /api/v1/events/:eldDeviceId/:logDate/gaps
   * Detect sequence ID gaps for a specific device and log date
   */
  async detectGaps(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { eldDeviceId, logDate } = req.params;

    logger.debug('Detecting sequence ID gaps', { eldDeviceId, logDate });

    const gaps = await detectSequenceGaps(eldDeviceId, logDate);

    logger.info('Sequence gap detection complete', {
      eldDeviceId,
      logDate,
      gapCount: gaps.length,
    });

    return this.success(res, {
      eldDeviceId,
      logDate,
      gaps,
      gapCount: gaps.length,
    });
  }
}
