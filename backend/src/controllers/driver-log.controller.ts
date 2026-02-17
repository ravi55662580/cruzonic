/**
 * Driver Log Controller
 *
 * Handles daily driver log endpoints.
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { getDriverDailyLog } from '../services/driver-log.service';
import { logger } from '../utils/logger';

export class DriverLogController extends BaseController {
  /**
   * GET /api/v1/drivers/:id/logs/:logDate
   * Get daily driver log with HOS summary, events, and certifications
   */
  async getDailyLog(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { id: driverId, logDate } = req.params;

    logger.info('Fetching daily driver log', { driverId, logDate });

    const logData = await getDriverDailyLog(driverId, logDate);

    logger.debug('Daily driver log fetched successfully', {
      driverId,
      logDate,
      eventCount: logData.events.length,
    });

    return this.success(res, logData);
  }
}
