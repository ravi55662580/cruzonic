/**
 * Correlation ID Middleware
 *
 * Generates or extracts correlation IDs for request tracing.
 * Correlation IDs are automatically included in all log entries within the request scope.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { asyncLocalStorage, logHelpers } from '../utils/logger';

/**
 * Header name for correlation ID
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Middleware to generate/extract correlation ID and attach to request
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Try to get correlation ID from header, or generate new one
  const correlationId = (req.headers[CORRELATION_ID_HEADER] as string) || randomUUID();

  // Store in async local storage for the duration of this request
  asyncLocalStorage.run({ correlationId }, () => {
    // Attach correlation ID to response headers
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    // Attach to request object for easy access
    (req as any).correlationId = correlationId;

    // Track request start time
    const startTime = Date.now();

    // Log request
    logHelpers.apiRequest(req.method, req.path, {
      query: req.query,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Capture original end function
    const originalEnd = res.end.bind(res);
    let responseSent = false;

    // Override end function to log response
    res.end = function (chunk?: any, encodingOrCb?: any, cb?: any): Response {
      if (!responseSent) {
        responseSent = true;
        const duration = Date.now() - startTime;

        // Log response
        logHelpers.apiResponse(req.method, req.path, res.statusCode, duration);
      }

      // Call original end function with proper arguments
      return originalEnd(chunk, encodingOrCb, cb) as Response;
    };

    next();
  });
}

/**
 * Get correlation ID from current request context
 */
export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}
