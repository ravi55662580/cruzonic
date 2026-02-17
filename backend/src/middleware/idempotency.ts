/**
 * Idempotency Middleware
 *
 * Prevents duplicate event ingestion when ELD devices retry failed requests.
 *
 * Usage:
 *   Client sends header:  X-Idempotency-Key: <uuid>
 *
 * Behaviour:
 *   1. No header present  → request passes through unmodified.
 *   2. Key seen, completed → cached response replayed immediately with
 *                            header `Idempotency-Replayed: true`.
 *   3. Key seen, in-flight → 409 Conflict (concurrent duplicate).
 *   4. Key not seen        → mark in-flight, execute request, cache result.
 *   5. Request fails       → in-flight record cleared so client can retry.
 *
 * Scoping:
 *   Keys are scoped per authenticated user (`{userId}:{clientKey}`) to
 *   prevent cross-user replay attacks.  Unauthenticated requests are
 *   scoped to 'anonymous' (should not happen after authenticateToken runs).
 *
 * Response interception:
 *   `res.json()` is monkey-patched to capture the outgoing body before it
 *   is sent.  The captured body + status code are stored asynchronously
 *   (fire-and-forget) so the response is never delayed.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  buildIdempotencyKey,
  getIdempotencyRecord,
  setIdempotencyInFlight,
  setIdempotencyCompleted,
  clearIdempotencyKey,
} from '../services/idempotency.service';
import { logger } from '../utils/logger';

/** Header the client uses to supply the idempotency key. */
const IDEMPOTENCY_HEADER = 'x-idempotency-key';
/** Header the server adds to replayed responses. */
const REPLAY_HEADER = 'Idempotency-Replayed';

/**
 * Express middleware that enforces idempotency on POST ingestion routes.
 *
 * Mount AFTER `authenticateToken` so `req.user` is available for key scoping,
 * but BEFORE any processing middleware (Zod validation, etc.).
 */
export function idempotencyMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const clientKey = req.headers[IDEMPOTENCY_HEADER] as string | undefined;

    if (!clientKey || clientKey.trim() === '') {
      // No idempotency key — pass through
      next();
      return;
    }

    const userId = (req as any).user?.id ?? 'anonymous';
    const scopedKey = buildIdempotencyKey(userId, clientKey.trim());

    let existing = null;
    try {
      existing = await getIdempotencyRecord(scopedKey);
    } catch (err) {
      // Idempotency store unavailable — fail open to not block ingestion
      logger.warn('Idempotency lookup failed — proceeding without idempotency check', {
        error: err instanceof Error ? err.message : String(err),
        clientKey,
      });
      next();
      return;
    }

    // ── Case 2: completed → replay cached response ────────────────────────
    if (existing?.status === 'completed') {
      logger.info('Idempotency key matched — replaying cached response', {
        clientKey,
        userId,
        cachedStatusCode: existing.statusCode,
        cachedAt: existing.createdAt,
      });
      res
        .status(existing.statusCode)
        .set(REPLAY_HEADER, 'true')
        .json(existing.body);
      return;
    }

    // ── Case 3: in-flight → concurrent duplicate ──────────────────────────
    if (existing?.status === 'in_flight') {
      logger.warn('Idempotency key collision — concurrent duplicate request', {
        clientKey,
        userId,
      });
      res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message:
            'A request with this idempotency key is already being processed. ' +
            'Please wait and retry after the in-progress request completes.',
        },
      });
      return;
    }

    // ── Case 4: new key → mark in-flight, intercept response ─────────────
    try {
      await setIdempotencyInFlight(scopedKey);
    } catch (err) {
      // Cannot set in-flight — proceed without idempotency to avoid blocking
      logger.warn('Failed to set idempotency in-flight — proceeding anyway', {
        error: err instanceof Error ? err.message : String(err),
        clientKey,
      });
      next();
      return;
    }

    logger.debug('Idempotency key registered as in-flight', { clientKey, userId });

    // Intercept res.json to capture the outgoing response body
    const originalJson = res.json.bind(res) as (body: unknown) => Response;
    res.json = function (body: unknown): Response {
      const statusCode = res.statusCode;

      if (statusCode >= 200 && statusCode < 300) {
        // Success — cache the result
        setIdempotencyCompleted(scopedKey, statusCode, body).catch((err) => {
          logger.warn('Failed to persist idempotency result', {
            error: err instanceof Error ? err.message : String(err),
            clientKey,
          });
        });
      } else {
        // Non-2xx — clear the in-flight record so the client can retry
        clearIdempotencyKey(scopedKey).catch(() => {});
      }

      return originalJson(body);
    };

    // ── Case 5: error path — clear in-flight on uncaught error ───────────
    // res.on('finish') fires after send; if statusCode is set to 4xx/5xx by
    // error-handler middleware the monkey-patched res.json will handle clearing.
    // For unexpected throws that bypass res.json, clean up here.
    res.on('close', () => {
      if (!res.writableEnded) {
        // Response never completed — clear in-flight (connection dropped, etc.)
        clearIdempotencyKey(scopedKey).catch(() => {});
      }
    });

    next();
  };
}
