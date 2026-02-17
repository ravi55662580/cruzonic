/**
 * DLQ Admin Routes
 *
 * All routes require:
 *   - authenticateToken  (valid JWT)
 *   - requireRole('admin') — DLQ operations are admin-only
 *
 * Endpoints:
 *   GET  /api/v1/admin/dlq              — list entries (paginated, filterable)
 *   GET  /api/v1/admin/dlq/stats        — per-status counts + alert state
 *   GET  /api/v1/admin/dlq/:id          — full entry including original payload
 *   POST /api/v1/admin/dlq/:id/retry    — re-ingest a pending entry
 *   POST /api/v1/admin/dlq/:id/discard  — discard a pending entry
 */

import { Router } from 'express';
import { DLQController } from '../controllers/dlq.controller';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateRequest, validateBody } from '../middleware/validation';
import { asyncHandler } from '../utils/async-handler';
import { DLQListQuerySchema, DLQEntryParamsSchema, DLQDiscardBodySchema } from '../models/dtos/dlq.dto';

const router = Router();
const controller = new DLQController();

// All DLQ routes require authentication + admin role
router.use(authenticateToken);
router.use(requireRole('admin'));

/**
 * @openapi
 * /api/v1/admin/dlq:
 *   get:
 *     tags: [Admin - DLQ]
 *     summary: List dead-letter queue entries
 *     description: |
 *       Returns paginated DLQ entries. Original payload is excluded from
 *       list responses — use GET /admin/dlq/:id to retrieve it.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [pending, retrying, resolved, discarded]
 *       - name: sourceDeviceId
 *         in: query
 *         schema:
 *           type: string
 *       - name: sourceEndpoint
 *         in: query
 *         schema:
 *           type: string
 *           enum: [/events, /events/batch]
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 100
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: DLQ entries returned
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get(
  '/',
  validateRequest({ query: DLQListQuerySchema }),
  asyncHandler(controller.listEntries.bind(controller))
);

/**
 * @openapi
 * /api/v1/admin/dlq/stats:
 *   get:
 *     tags: [Admin - DLQ]
 *     summary: DLQ statistics and alert state
 *     description: Returns per-status counts and whether the alert threshold is exceeded.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: DLQ stats returned
 */
router.get(
  '/stats',
  asyncHandler(controller.getStats.bind(controller))
);

/**
 * @openapi
 * /api/v1/admin/dlq/{id}:
 *   get:
 *     tags: [Admin - DLQ]
 *     summary: Get a single DLQ entry with full payload
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: DLQ entry returned
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/:id',
  validateRequest({ params: DLQEntryParamsSchema }),
  asyncHandler(controller.getEntry.bind(controller))
);

/**
 * @openapi
 * /api/v1/admin/dlq/{id}/retry:
 *   post:
 *     tags: [Admin - DLQ]
 *     summary: Re-ingest a pending DLQ entry
 *     description: |
 *       Attempts to re-ingest the failed event using the stored payload.
 *       A fresh sequence ID is allocated; the original is not reused.
 *
 *       Response always returns HTTP 200 — check the `success` field to
 *       determine whether re-ingestion succeeded.  A failed retry resets
 *       the entry to 'pending' with an incremented `retryCount`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Retry executed (check `success` field for outcome)
 *       400:
 *         description: Entry is not in 'pending' status
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post(
  '/:id/retry',
  validateRequest({ params: DLQEntryParamsSchema }),
  asyncHandler(controller.retryEntry.bind(controller))
);

/**
 * @openapi
 * /api/v1/admin/dlq/{id}/discard:
 *   post:
 *     tags: [Admin - DLQ]
 *     summary: Discard a pending DLQ entry
 *     description: Marks the entry as discarded. No re-ingestion will occur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional reason for discarding
 *     responses:
 *       200:
 *         description: Entry discarded
 *       400:
 *         description: Entry is not in 'pending' status
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post(
  '/:id/discard',
  validateRequest({ params: DLQEntryParamsSchema }),
  validateBody(DLQDiscardBodySchema),
  asyncHandler(controller.discardEntry.bind(controller))
);

export default router;
