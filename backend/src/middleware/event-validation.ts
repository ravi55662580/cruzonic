/**
 * Event Validation Middleware
 *
 * Express middleware wrapper around event-validation.service.
 * Applied after Zod schema validation (layer 1) has already passed.
 *
 * Handles:
 *   - Layer 2: Business rules (FMCSA event codes, timestamp range, odometer)
 *   - Layer 3: Cross-reference (driver and vehicle existence)
 *
 * Usage:
 *   router.post('/', validateBody(IngestEventSchema), validateSingleEventMiddleware(), ...)
 */

import type { Request, Response, NextFunction } from 'express';
import { validateSingleEvent } from '../services/event-validation.service';
import { ValidationError } from '../models/errors/api-error';
import type { IngestEventRequest } from '../models/dtos/event.dto';
import { logger } from '../utils/logger';

/**
 * Middleware for the single-event ingestion route.
 *
 * Runs layers 2 and 3 validation against the already-parsed request body.
 * Returns a 400 ValidationError with field-level detail on failure.
 * Fails open if the validation service itself throws (database unavailable).
 */
export function validateSingleEventMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await validateSingleEvent(req.body as IngestEventRequest);

      if (!result.valid) {
        const details = result.errors.map((err) => ({
          field: err.field,
          value: err.value,
          message: err.message,
          layer: err.layer,
        }));

        next(new ValidationError('Event validation failed', details));
        return;
      }

      next();
    } catch (err) {
      // Validation service errors (e.g. DB unreachable) must not block ingestion
      logger.warn('Event validation service error — skipping layers 2/3', {
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}
