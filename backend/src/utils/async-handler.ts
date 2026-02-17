/**
 * Async Handler Wrapper
 *
 * Wraps async route handlers to automatically catch errors and pass to next().
 * Eliminates the need for try-catch blocks in every route handler.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response>;

/**
 * Wraps an async request handler and catches any errors
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
