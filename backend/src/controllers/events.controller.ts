/**
 * Events Controller
 *
 * Handles ELD event operations:
 * - Ingest new events
 * - Retrieve events by device/driver
 * - Detect sequence ID gaps
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { ingestEvent, getEventsByDevice } from '../services/event-ingestion.service';
import { detectSequenceGaps } from '../services/sequence-id.service';
import { logger } from '../utils/logger';
import { AuthenticationError } from '../models/errors/api-error';

export class EventsController extends BaseController {
  /**
   * POST /api/v1/events
   * Ingest a new ELD event
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

    // Delegate to service (existing implementation)
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

    logger.info('Event ingested successfully', {
      sequenceId: result.sequenceId,
    });

    return this.created(res, result);
  }

  /**
   * GET /api/v1/events
   * Get events with filtering and pagination
   */
  async getEvents(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const query = req.query as Record<string, unknown>;

    logger.debug('Fetching events', { query });

    // Simplified implementation - delegates to existing service
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
