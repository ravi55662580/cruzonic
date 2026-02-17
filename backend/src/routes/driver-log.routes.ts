/**
 * Driver Log Routes
 *
 * Routes for daily driver log endpoints.
 */

import { Router } from 'express';
import { DriverLogController } from '../controllers/driver-log.controller';
import { validateRequest } from '../middleware/validation';
import { DriverLogParamsSchema } from '../models/dtos/driver-log.dto';
import { asyncHandler } from '../utils/async-handler';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const controller = new DriverLogController();

/**
 * @openapi
 * /api/v1/drivers/{id}/logs/{logDate}:
 *   get:
 *     tags: [Driver Logs]
 *     summary: Get daily driver log
 *     description: |
 *       Returns complete 24-hour driver log including duty status timeline,
 *       HOS summary, all ELD events, and certifications.
 *       Rate limited to 60 req/min per user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver UUID
 *       - name: logDate
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{6}$'
 *           example: '021526'
 *         description: Log date in MMDDYY format (e.g. 021526 = Feb 15 2026)
 *     responses:
 *       200:
 *         description: Daily driver log
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  '/:id/logs/:logDate',
  authenticateToken,
  validateRequest({ params: DriverLogParamsSchema }),
  asyncHandler(controller.getDailyLog.bind(controller))
);

export default router;
