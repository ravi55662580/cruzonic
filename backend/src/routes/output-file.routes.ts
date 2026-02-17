/**
 * Output File Routes
 *
 * Routes for FMCSA output file (EROD) endpoints.
 */

import { Router } from 'express';
import { OutputFileController } from '../controllers/output-file.controller';
import { validateRequest } from '../middleware/validation';
import {
  OutputFileParamsSchema,
  GenerateOutputFileRequestSchema,
} from '../models/dtos/output-file.dto';
import { asyncHandler } from '../utils/async-handler';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const controller = new OutputFileController();

/**
 * @openapi
 * /api/v1/output-file/{recordId}:
 *   get:
 *     tags: [Output Files]
 *     summary: Get FMCSA output file record
 *     description: |
 *       Retrieves metadata and a fresh signed download URL for a previously generated
 *       FMCSA output file. Signed URLs expire after 1 hour.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: recordId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ELD record UUID
 *     responses:
 *       200:
 *         description: Output file record
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
 *                         record_id:
 *                           type: string
 *                           format: uuid
 *                         file_version:
 *                           type: string
 *                           example: '1.1.0'
 *                         erod_storage_path:
 *                           type: string
 *                           nullable: true
 *                         file_size_bytes:
 *                           type: integer
 *                         total_event_count:
 *                           type: integer
 *                         content_sha256:
 *                           type: string
 *                         generated_at:
 *                           type: string
 *                           format: date-time
 *                         download_url:
 *                           type: string
 *                           description: Signed download URL (expires in 1 hour)
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/:recordId',
  authenticateToken,
  validateRequest({ params: OutputFileParamsSchema }),
  asyncHandler(controller.getFile.bind(controller))
);

/**
 * @openapi
 * /api/v1/output-file/generate:
 *   post:
 *     tags: [Output Files]
 *     summary: Generate FMCSA output file
 *     description: |
 *       Generates an FMCSA-compliant Electronic Records of Duty Status (EROD) file
 *       for roadside inspections (49 CFR 395.8).
 *
 *       **Process:**
 *       1. Fetches all ELD events for the specified driver/date
 *       2. Formats data per FMCSA JSON schema (v1.1.0)
 *       3. Calculates SHA-256 content hash for integrity verification
 *       4. Uploads file to secure storage (Supabase Storage)
 *       5. Creates an eld_records entry
 *       6. Returns signed download URL (expires in 1 hour)
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
 *             required: [driver_id, log_date]
 *             properties:
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               log_date:
 *                 type: string
 *                 pattern: '^\d{6}$'
 *                 example: '021526'
 *                 description: Log date in MMDDYY format
 *               format:
 *                 type: string
 *                 enum: [json, pdf, both]
 *                 default: json
 *               include_metadata:
 *                 type: boolean
 *                 default: true
 *                 description: Include certification records in output
 *     responses:
 *       201:
 *         description: Output file generated
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
 *                         record_id:
 *                           type: string
 *                           format: uuid
 *                         file_version:
 *                           type: string
 *                           example: '1.1.0'
 *                         total_event_count:
 *                           type: integer
 *                         content_sha256:
 *                           type: string
 *                           description: SHA-256 hash for integrity verification
 *                         generated_at:
 *                           type: string
 *                           format: date-time
 *                         download_url:
 *                           type: string
 *                           description: Signed download URL (expires in 1 hour)
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
  '/generate',
  authenticateToken,
  validateRequest({ body: GenerateOutputFileRequestSchema }),
  asyncHandler(controller.generateFile.bind(controller))
);

export default router;
