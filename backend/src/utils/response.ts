/**
 * Response Helpers
 *
 * Standardized response formatting for success and error responses.
 */

import type { Response } from 'express';
import type { ApiResponse, ApiErrorResponse } from '../models/dtos/common.dto';
import { ApiError } from '../models/errors/api-error';

/**
 * Send successful response
 */
export function successResponse<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>,
  statusCode = 200
): Response<ApiResponse<T>> {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };

  if (meta) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send error response
 */
export function errorResponse(res: Response, error: ApiError): Response<ApiErrorResponse> {
  const errorObj: ApiErrorResponse['error'] = {
    code: error.code,
    message: error.message,
  };

  if (error.details) {
    errorObj.details = error.details;
  }

  return res.status(error.statusCode).json({
    success: false,
    error: errorObj,
  });
}

/**
 * Send created response (201)
 */
export function createdResponse<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>
): Response<ApiResponse<T>> {
  return successResponse(res, data, meta, 201);
}

/**
 * Send no content response (204)
 */
export function noContentResponse(res: Response): Response {
  return res.status(204).send();
}
