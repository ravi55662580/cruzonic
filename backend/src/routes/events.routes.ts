/**
 * Events Routes
 *
 * ELD event ingestion and retrieval endpoints.
 *
 * Gzip decompression is handled automatically by Express body-parser
 * when the client sends Content-Encoding: gzip.
 */

import { Router } from 'express';
import { EventsController } from '../controllers/events.controller';
import { validateRequest, validateBody } from '../middleware/validation';
import { IngestEventSchema, GetEventsQuerySchema, BatchIngestEventSchema } from '../models/dtos/event.dto';
import { validateSingleEventMiddleware } from '../middleware/event-validation';
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
 *     summary: Ingest a single ELD event
 *     description: |
 *       Submit a single FMCSA-compliant ELD event record.
 *       Rate limited to 100 req/min per device (x-device-id header).
 *
 *       **Supports gzip compression** — clients can send `Content-Encoding: gzip`
 *       to reduce payload size. Decompression is handled automatically.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DeviceIdHeader'
 *       - $ref: '#/components/parameters/CorrelationIdHeader'
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
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         eventId:
 *                           type: string
 *                           format: uuid
 *                         sequenceId:
 *                           type: integer
 *                         chainHash:
 *                           type: string
 *                           description: SHA-256 hash for audit trail continuity
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
  validateSingleEventMiddleware(),
  asyncHandler(controller.ingestEvent.bind(controller))
);

/**
 * @openapi
 * /api/v1/events/batch:
 *   post:
 *     tags: [Events]
 *     summary: Ingest a batch of ELD events (up to 100)
 *     description: |
 *       Submit multiple FMCSA-compliant ELD events in a single request.
 *       Events are processed **sequentially** to preserve hash-chain integrity —
 *       each event's `chainHash` depends on the previous event's hash.
 *
 *       **Gzip compression is strongly recommended** for batches to minimise
 *       bandwidth. Send `Content-Encoding: gzip` and the body will be
 *       decompressed automatically.
 *
 *       **Response codes:**
 *       - `201` — all events accepted
 *       - `207 Multi-Status` — partial success (some accepted, some rejected)
 *       - `400` — all events rejected
 *
 *       Rate limited to 100 req/min per device (x-device-id header).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DeviceIdHeader'
 *       - $ref: '#/components/parameters/CorrelationIdHeader'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [events]
 *             properties:
 *               events:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *                 description: Array of ELD events to ingest
 *                 items:
 *                   $ref: '#/components/schemas/ELDEvent'
 *               deviceId:
 *                 type: string
 *                 description: |
 *                   Shared device ID applied to all events that don't provide
 *                   their own eldDeviceId. Overridden by the x-device-id header
 *                   or individual event.eldDeviceId fields.
 *           examples:
 *             singleEvent:
 *               summary: Batch with one event
 *               value:
 *                 events:
 *                   - eventType: 1
 *                     eventTimestamp: "2026-02-15T14:30:00-05:00"
 *                     eventSequenceId: "42"
 *                     driverId: "00000000-0000-0000-0000-000000000001"
 *                     vehicleId: "00000000-0000-0000-0000-000000000002"
 *                     eldDeviceId: "00000000-0000-0000-0000-000000000003"
 *                     accumulatedVehicleMiles: 12345.6
 *                     accumulatedEngineHours: 1234.5
 *                     latitude: 37.7749
 *                     longitude: -122.4194
 *                     malfunctionIndicatorStatus: false
 *                     datadiagnosticEventIndicatorStatus: false
 *                     eventRecordStatus: 1
 *                     eventRecordOrigin: 2
 *             multipleEvents:
 *               summary: Batch with multiple events
 *               value:
 *                 deviceId: "00000000-0000-0000-0000-000000000003"
 *                 events:
 *                   - eventType: 5
 *                     eventTimestamp: "2026-02-15T06:00:00-05:00"
 *                     eventSequenceId: "1"
 *                     driverId: "00000000-0000-0000-0000-000000000001"
 *                     vehicleId: "00000000-0000-0000-0000-000000000002"
 *                     eldDeviceId: "00000000-0000-0000-0000-000000000003"
 *                     accumulatedVehicleMiles: 12340.0
 *                     accumulatedEngineHours: 1230.0
 *                     latitude: 37.7749
 *                     longitude: -122.4194
 *                     malfunctionIndicatorStatus: false
 *                     datadiagnosticEventIndicatorStatus: false
 *                     eventRecordStatus: 1
 *                     eventRecordOrigin: 1
 *                   - eventType: 1
 *                     eventTimestamp: "2026-02-15T06:01:00-05:00"
 *                     eventSequenceId: "2"
 *                     driverId: "00000000-0000-0000-0000-000000000001"
 *                     vehicleId: "00000000-0000-0000-0000-000000000002"
 *                     eldDeviceId: "00000000-0000-0000-0000-000000000003"
 *                     accumulatedVehicleMiles: 12340.0
 *                     accumulatedEngineHours: 1230.0
 *                     latitude: 37.7749
 *                     longitude: -122.4194
 *                     malfunctionIndicatorStatus: false
 *                     datadiagnosticEventIndicatorStatus: false
 *                     eventRecordStatus: 1
 *                     eventRecordOrigin: 1
 *     responses:
 *       201:
 *         description: All events accepted
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/BatchIngestResponse'
 *       207:
 *         description: Partial success — some events accepted, some rejected
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/BatchIngestResponse'
 *       400:
 *         description: All events rejected or validation failed
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Error'
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: false
 *                     data:
 *                       $ref: '#/components/schemas/BatchIngestResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post(
  '/batch',
  validateBody(BatchIngestEventSchema),
  asyncHandler(controller.ingestBatchEvents.bind(controller))
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
