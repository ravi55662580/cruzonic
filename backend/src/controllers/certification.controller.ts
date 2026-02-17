/**
 * Certification Controller
 *
 * Handles driver log certification endpoints (EventType 4).
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { certifyDriverLog } from '../services/certification.service';
import { logger } from '../utils/logger';
import { AuthenticationError } from '../models/errors/api-error';

export class CertificationController extends BaseController {
  /**
   * POST /api/v1/certify
   * Certify a driver's log for a specific date
   * Creates EventType 4 event and updates log_periods status
   */
  async certifyLog(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) {
      throw new AuthenticationError('User not authenticated');
    }

    const certificationData = req.body;

    logger.info('Certifying driver log', {
      driverId: certificationData.driver_id,
      logDate: certificationData.certified_log_date,
      userId: req.user.id,
    });

    const result = await certifyDriverLog(certificationData, req.user.id);

    logger.info('Log certified successfully', {
      certificationId: result.certification.id,
      isRecertification: result.certification.is_recertification,
      eventSequenceId: result.eld_event.event_sequence_id,
    });

    return this.created(res, result);
  }
}
