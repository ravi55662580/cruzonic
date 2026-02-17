/**
 * Error Handler Middleware
 *
 * Global error handling with structured logging and standardized responses.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError, ValidationError } from '../models/errors/api-error';
import { errorResponse } from '../utils/response';
import { logger } from '../utils/logger';

/**
 * Global error handler middleware
 * Transforms all errors into consistent API responses
 */
export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationError = new ValidationError(
      'Request validation failed',
      err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      }))
    );

    logger.warn('Validation error', {
      path: req.path,
      method: req.method,
      errors: validationError.details,
    });

    errorResponse(res, validationError);
    return;
  }

  // Handle custom API errors
  if (err instanceof ApiError) {
    logger.error('API error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
      stack: err.stack,
    });

    errorResponse(res, err);
    return;
  }

  // Handle unexpected errors
  logger.error('Unexpected error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Don't expose internal error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDevelopment ? err.message : 'Internal server error',
      ...(isDevelopment && { stack: err.stack }),
    },
  });
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
  });

  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      path: req.path,
    },
  });
}
