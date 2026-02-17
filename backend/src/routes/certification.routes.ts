/**
 * Certification Routes
 *
 * Routes for driver log certification endpoints.
 */

import { Router } from 'express';
import { CertificationController } from '../controllers/certification.controller';
import { validateRequest } from '../middleware/validation';
import { CertifyLogRequestSchema } from '../models/dtos/certification.dto';
import { asyncHandler } from '../utils/async-handler';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const controller = new CertificationController();

/**
 * @openapi
 * /api/v1/certify:
 *   post:
 *     tags: [Certification]
 *     summary: Certify driver log
 *     description: |
 *       Certifies a driver's log for a specific date (FMCSA 49 CFR 395.8(e)).
 *
 *       **Actions performed:**
 *       1. Validates the log date (not future, not older than 13 days)
 *       2. Creates an EventType 4 (Certification) ELD event
 *       3. Updates the log_period status to 'certified'
 *       4. If re-certifying, captures edited event sequence IDs
 *
 *       **Rate limited to 20 req/min per user** (strict limit - resource intensive).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [driver_id, certified_log_date, certification_type]
 *             properties:
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               certified_log_date:
 *                 type: string
 *                 pattern: '^\d{6}$'
 *                 example: '021526'
 *                 description: Date in MMDDYY format
 *               certification_type:
 *                 type: string
 *                 enum: [own_records, co_driver_records]
 *                 default: own_records
 *               annotation:
 *                 type: string
 *                 maxLength: 60
 *                 description: Optional annotation (up to 60 chars)
 *     responses:
 *       201:
 *         description: Log certified successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         certification:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                               format: uuid
 *                             certification_type:
 *                               type: string
 *                             certified_log_date:
 *                               type: string
 *                             is_recertification:
 *                               type: boolean
 *                             performed_at:
 *                               type: string
 *                               format: date-time
 *                         eld_event:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             event_sequence_id:
 *                               type: integer
 *                             event_timestamp:
 *                               type: string
 *                               format: date-time
 *                         log_period:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             status:
 *                               type: string
 *                               enum: [certified, recertified]
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post(
  '/',
  authenticateToken,
  validateRequest({ body: CertifyLogRequestSchema }),
  asyncHandler(controller.certifyLog.bind(controller))
);

export default router;
