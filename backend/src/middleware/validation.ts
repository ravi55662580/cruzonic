/**
 * Validation Middleware
 *
 * Centralized Zod schema validation for request body, query, and params.
 * Automatically throws ValidationError if validation fails.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../models/errors/api-error';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Validate request using Zod schemas
 */
export function validateRequest(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      // Validate query parameters
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }

      // Validate URL parameters
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Transform Zod errors into a readable format
        const details = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        next(new ValidationError('Request validation failed', details));
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate only request body
 */
export function validateBody(schema: ZodSchema) {
  return validateRequest({ body: schema });
}

/**
 * Validate only query parameters
 */
export function validateQuery(schema: ZodSchema) {
  return validateRequest({ query: schema });
}

/**
 * Validate only URL parameters
 */
export function validateParams(schema: ZodSchema) {
  return validateRequest({ params: schema });
}
