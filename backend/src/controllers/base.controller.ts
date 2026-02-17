/**
 * Base Controller
 *
 * Provides common functionality for all controllers:
 * - Standardized response formatting
 * - Pagination helpers
 * - Error handling utilities
 */

import type { Response } from 'express';
import type { PaginationMeta } from '../models/dtos/common.dto';
import { successResponse, createdResponse, noContentResponse } from '../utils/response';

export class BaseController {
  /**
   * Send successful response with data
   */
  protected success<T>(res: Response, data: T, meta?: Record<string, unknown>) {
    return successResponse(res, data, meta);
  }

  /**
   * Send created response (201)
   */
  protected created<T>(res: Response, data: T, meta?: Record<string, unknown>) {
    return createdResponse(res, data, meta);
  }

  /**
   * Send no content response (204)
   */
  protected noContent(res: Response) {
    return noContentResponse(res);
  }

  /**
   * Build pagination metadata
   */
  protected buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
    const totalPages = Math.ceil(total / limit);

    return {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  /**
   * Calculate pagination offset
   */
  protected calculateOffset(page: number, limit: number): number {
    return (page - 1) * limit;
  }
}
