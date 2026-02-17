/**
 * Output File Controller
 *
 * Handles FMCSA output file (EROD) endpoints.
 */

import type { Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { generateOutputFile, getOutputFile } from '../services/output-file.service';
import { logger } from '../utils/logger';
import { AuthenticationError } from '../models/errors/api-error';

export class OutputFileController extends BaseController {
  /**
   * GET /api/v1/output-file/:recordId
   * Get existing FMCSA output file record with signed download URL
   */
  async getFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { recordId } = req.params;

    logger.info('Fetching output file record', { recordId });

    const fileData = await getOutputFile(recordId);

    logger.debug('Output file record fetched', { recordId, eventCount: fileData.total_event_count });

    return this.success(res, fileData);
  }

  /**
   * POST /api/v1/output-file/generate
   * Generate new FMCSA output file (EROD) in JSON format
   */
  async generateFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    if (!req.user) {
      throw new AuthenticationError('User not authenticated');
    }

    const generateRequest = req.body;

    logger.info('Generating output file', {
      driverId: generateRequest.driver_id,
      logDate: generateRequest.log_date,
      userId: req.user.id,
    });

    const fileData = await generateOutputFile(generateRequest, req.user.id);

    logger.info('Output file generated successfully', {
      recordId: fileData.record_id,
      eventCount: fileData.total_event_count,
      fileSizeBytes: fileData.file_size_bytes,
    });

    return this.created(res, fileData);
  }
}
