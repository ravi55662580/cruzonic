/**
 * HOS (Hours of Service) Controller
 *
 * Handles HOS status endpoints.
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { getHOSStatus } from '../services/hos-status.service';
import { logger } from '../utils/logger';

export class HOSController extends BaseController {
  /**
   * GET /api/v1/hos/:driverId/status
   * Get current HOS status and remaining time for a driver
   */
  async getStatus(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { driverId } = req.params;

    logger.info('Fetching HOS status', { driverId });

    const hosStatus = await getHOSStatus(driverId);

    logger.debug('HOS status fetched successfully', {
      driverId,
      currentStatus: hosStatus.current_status?.duty_status_name,
      violationCount: hosStatus.violations.length,
    });

    return this.success(res, hosStatus);
  }
}
