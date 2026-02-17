/**
 * HOS (Hours of Service) Routes
 *
 * Routes for HOS status endpoints.
 */

import { Router } from 'express';
import { HOSController } from '../controllers/hos.controller';
import { validateRequest } from '../middleware/validation';
import { HOSStatusParamsSchema } from '../models/dtos/hos.dto';
import { asyncHandler } from '../utils/async-handler';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const controller = new HOSController();

/**
 * @openapi
 * /api/v1/hos/{driverId}/status:
 *   get:
 *     tags: [HOS]
 *     summary: Get current HOS status
 *     description: |
 *       Returns real-time Hours of Service status for a driver including:
 *       - Current duty status and duration
 *       - Remaining driving/on-duty time
 *       - Break requirements (30-min break rule)
 *       - 34-hour restart progress
 *       - Active violations
 *
 *       Calculated from the latest hos_calculations record.
 *       Rate limited to 60 req/min per user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: driverId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver UUID
 *     responses:
 *       200:
 *         description: Current HOS status
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/HOSStatus'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  '/:driverId/status',
  authenticateToken,
  validateRequest({ params: HOSStatusParamsSchema }),
  asyncHandler(controller.getStatus.bind(controller))
);

export default router;
