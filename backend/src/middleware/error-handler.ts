import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface ApiError extends Error {
  statusCode?: number;
  details?: unknown;
}

/**
 * Global error handler middleware.
 * Transforms errors into consistent JSON responses.
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Custom API errors with status code
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  console.error('[ERROR]', {
    statusCode,
    message,
    stack: err.stack,
    details: err.details,
  });

  res.status(statusCode).json({
    error: message,
    ...(err.details && { details: err.details }),
  });
}

/**
 * 404 handler for unknown routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
  });
}
