/**
 * DLQ Admin Controller
 *
 * Handles admin operations on the dead-letter queue:
 *   GET  /api/v1/admin/dlq          — paginated list with optional filters
 *   GET  /api/v1/admin/dlq/stats    — per-status counts + alert threshold state
 *   GET  /api/v1/admin/dlq/:id      — single entry with full original_payload
 *   POST /api/v1/admin/dlq/:id/retry    — re-ingest the failed event
 *   POST /api/v1/admin/dlq/:id/discard  — mark as discarded (no re-ingestion)
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import {
  listDLQEntries,
  getDLQEntry,
  getDLQStats,
  getDLQDepth,
  retryDLQEntry,
  discardDLQEntry,
} from '../services/dlq.service';
import { AuthenticationError, NotFoundError, ValidationError } from '../models/errors/api-error';
import type {
  DLQListResponse,
  DLQStatsResponse,
  DLQRetryResponse,
} from '../models/dtos/dlq.dto';
import { logger } from '../utils/logger';

const DLQ_ALERT_THRESHOLD = parseInt(process.env.DLQ_ALERT_THRESHOLD || '100', 10);

export class DLQController extends BaseController {
  /**
   * GET /api/v1/admin/dlq
   * Lists DLQ entries with optional filtering and pagination.
   * Original payload is excluded from list responses to keep them lightweight.
   */
  async listEntries(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) throw new AuthenticationError('User not authenticated');

    const { status, sourceDeviceId, sourceEndpoint, limit, offset } = req.query as Record<
      string,
      string
    >;

    const result = await listDLQEntries({
      status: status as 'pending' | 'retrying' | 'resolved' | 'discarded' | undefined,
      sourceDeviceId,
      sourceEndpoint,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const response: DLQListResponse = {
      entries: result.entries.map(({ originalPayload: _omit, ...rest }) => rest),
      pagination: {
        total: result.total,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < result.total,
      },
    };

    logger.debug('DLQ entries listed', {
      total: result.total,
      returned: result.entries.length,
      status,
      userId: req.user.id,
    });

    return this.success(res, response);
  }

  /**
   * GET /api/v1/admin/dlq/stats
   * Returns per-status counts plus whether the alert threshold is exceeded.
   */
  async getStats(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) throw new AuthenticationError('User not authenticated');

    const stats = await getDLQStats();
    const pending = await getDLQDepth();

    const response: DLQStatsResponse = {
      ...stats,
      alertThreshold: DLQ_ALERT_THRESHOLD,
      thresholdExceeded: pending >= DLQ_ALERT_THRESHOLD,
    };

    return this.success(res, response);
  }

  /**
   * GET /api/v1/admin/dlq/:id
   * Returns a single DLQ entry including the full original_payload.
   */
  async getEntry(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) throw new AuthenticationError('User not authenticated');

    const { id } = req.params;
    const entry = await getDLQEntry(id);

    if (!entry) {
      throw new NotFoundError(`DLQ entry ${id} not found`);
    }

    return this.success(res, entry);
  }

  /**
   * POST /api/v1/admin/dlq/:id/retry
   * Attempts to re-ingest the failed event.
   * Returns 200 with success/failure details — never 5xx unless the DB itself
   * is unavailable, so callers can distinguish "retry attempted" from "retry call failed".
   */
  async retryEntry(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) throw new AuthenticationError('User not authenticated');

    const { id } = req.params;

    logger.info('Admin DLQ retry requested', { dlqId: id, userId: req.user.id });

    const result = await retryDLQEntry(id, req.user.id);

    const response: DLQRetryResponse = {
      success: result.success,
      dlqEntryId: id,
      eventId: result.eventId,
      sequenceId: result.sequenceId,
      chainHash: result.chainHash,
      error: result.error,
    };

    // 200 regardless of re-ingestion outcome — the retry was executed.
    // Use the `success` field to detect re-ingestion failure.
    return this.success(res, response);
  }

  /**
   * POST /api/v1/admin/dlq/:id/discard
   * Marks the entry as discarded — it will not be re-ingested.
   */
  async discardEntry(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) throw new AuthenticationError('User not authenticated');

    const { id } = req.params;
    const notes: string | undefined = req.body?.notes;

    if (notes !== undefined && typeof notes !== 'string') {
      throw new ValidationError('notes must be a string');
    }

    await discardDLQEntry(id, req.user.id, notes);

    logger.info('DLQ entry discarded by admin', { dlqId: id, userId: req.user.id, notes });

    return this.success(res, {
      dlqEntryId: id,
      status: 'discarded',
      discardedAt: new Date().toISOString(),
      discardedBy: req.user.id,
    });
  }
}
