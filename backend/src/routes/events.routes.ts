/**
 * Events Routes
 *
 * ELD event ingestion and retrieval endpoints.
 */

import { Router } from 'express';
import { EventsController } from '../controllers/events.controller';
import { validateRequest, validateBody } from '../middleware/validation';
import { IngestEventSchema, GetEventsQuerySchema } from '../models/dtos/event.dto';
import { asyncHandler } from '../utils/async-handler';
import { z } from 'zod';

const router = Router();
const controller = new EventsController();

// Validation schemas for route params
const DeviceDateParamsSchema = z.object({
  eldDeviceId: z.string().min(1).max(50),
  logDate: z.string().regex(/^\d{6}$/, 'Invalid date format (MMDDYY)'),
});

/**
 * @openapi
 * /api/v1/events:
 *   post:
 *     tags: [Events]
 *     summary: Ingest a new ELD event
 *     description: Submit an FMCSA-compliant ELD event record. Rate limited to 100 req/min per device.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DeviceIdHeader'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ELDEvent'
 *     responses:
 *       201:
 *         description: Event ingested successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post(
  '/',
  validateBody(IngestEventSchema),
  asyncHandler(controller.ingestEvent.bind(controller))
);

/**
 * @openapi
 * /api/v1/events:
 *   get:
 *     tags: [Events]
 *     summary: Query events with filtering and pagination
 *     description: Retrieve ELD events for a driver with optional date range filtering. Rate limited to 60 req/min per user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: driverId
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver UUID to query events for
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter (YYYY-MM-DD)
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter (YYYY-MM-DD)
 *       - name: eventType
 *         in: query
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 7
 *         description: Filter by event type
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ELDEvent'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  '/',
  validateRequest({ query: GetEventsQuerySchema }),
  asyncHandler(controller.getEvents.bind(controller))
);

/**
 * @openapi
 * /api/v1/events/{eldDeviceId}/{logDate}:
 *   get:
 *     tags: [Events]
 *     summary: Get events by device and log date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: eldDeviceId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: ELD device identifier
 *       - name: logDate
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{6}$'
 *         description: Log date in MMDDYY format
 *     responses:
 *       200:
 *         description: Events retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/:eldDeviceId/:logDate',
  validateRequest({ params: DeviceDateParamsSchema }),
  asyncHandler(controller.getEventsByDeviceAndDate.bind(controller))
);

/**
 * @openapi
 * /api/v1/events/{eldDeviceId}/{logDate}/gaps:
 *   get:
 *     tags: [Events]
 *     summary: Detect sequence ID gaps
 *     description: Check for missing event sequence IDs (FMCSA compliance requirement)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: eldDeviceId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: logDate
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{6}$'
 *     responses:
 *       200:
 *         description: Gap analysis result
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/:eldDeviceId/:logDate/gaps',
  validateRequest({ params: DeviceDateParamsSchema }),
  asyncHandler(controller.detectGaps.bind(controller))
);

export default router;
