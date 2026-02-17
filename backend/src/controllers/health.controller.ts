/**
 * Health Controller
 *
 * Handles health check endpoint with comprehensive system status.
 */

import type { Request, Response } from 'express';
import { BaseController } from './base.controller';
import type { HealthCheckResponse } from '../models/dtos/common.dto';
import { supabase } from '../config/supabase';
import { logger } from '../utils/logger';

export class HealthController extends BaseController {
  /**
   * GET /health
   * Comprehensive health check including database connectivity
   */
  async checkHealth(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();

    // Check database connection
    const dbHealth = await this.checkDatabase();

    const health: HealthCheckResponse = {
      status: dbHealth.status === 'up' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.API_VERSION || 'v1',
      uptime: process.uptime(),
      services: {
        database: dbHealth,
      },
      memory: process.memoryUsage(),
    };

    // Log if unhealthy
    if (health.status !== 'healthy') {
      logger.warn('Health check failed', { health });
    }

    return this.success(res, health);
  }

  /**
   * Check database connectivity via Supabase
   */
  private async checkDatabase() {
    try {
      const startTime = Date.now();

      // Simple query to check connectivity
      const { error } = await supabase.from('carriers').select('id').limit(1).single();

      const latency = Date.now() - startTime;

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows, which is fine for health check
        throw error;
      }

      return {
        status: 'up' as const,
        latency,
      };
    } catch (error) {
      logger.error('Database health check failed', { error });

      return {
        status: 'down' as const,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
