/**
 * Log Period Repository
 *
 * Data access layer for log period operations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './base.repository';
import { DatabaseError, NotFoundError } from '../models/errors/api-error';
import { logger } from '../utils/logger';

export interface LogPeriod {
  id: string;
  driver_id: string;
  log_date_mmddyy: string;
  status: 'active' | 'certified' | 'recertified' | 'rejected';
  total_event_count: number;
  certified_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class LogPeriodRepository extends BaseRepository<LogPeriod> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'log_periods');
  }

  /**
   * Find log period by driver and date
   */
  async findByDriverAndDate(driverId: string, logDate: string): Promise<LogPeriod | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('driver_id', driverId)
        .eq('log_date_mmddyy', logDate)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to find log period by driver and date', { driverId, logDate, error });
        throw new DatabaseError('Failed to find log period');
      }

      return data as LogPeriod;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByDriverAndDate', { driverId, logDate, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find all log periods for a driver
   */
  async findByDriver(driverId: string, status?: string): Promise<LogPeriod[]> {
    try {
      let query = this.supabase
        .from(this.tableName)
        .select('*')
        .eq('driver_id', driverId);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('log_date_mmddyy', { ascending: false });

      if (error) {
        logger.error('Failed to find log periods by driver', { driverId, status, error });
        throw new DatabaseError('Failed to query log periods');
      }

      return (data as LogPeriod[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByDriver', { driverId, status, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Update log period status
   */
  async updateStatus(
    logPeriodId: string,
    status: LogPeriod['status'],
    additionalData?: Partial<LogPeriod>
  ): Promise<LogPeriod> {
    const updateData: Partial<LogPeriod> = { status, ...additionalData };

    if (status === 'certified' || status === 'recertified') {
      updateData.certified_at = new Date().toISOString();
    }

    if (status === 'rejected') {
      updateData.rejected_at = new Date().toISOString();
    }

    return this.update(logPeriodId, updateData);
  }

  /**
   * Increment event count for a log period
   */
  async incrementEventCount(logPeriodId: string): Promise<LogPeriod> {
    try {
      // Fetch current count
      const logPeriod = await this.findById(logPeriodId);
      if (!logPeriod) {
        throw new NotFoundError('Log period');
      }

      // Increment count
      const newCount = logPeriod.total_event_count + 1;

      return this.update(logPeriodId, { total_event_count: newCount } as Partial<LogPeriod>);
    } catch (error) {
      if (error instanceof DatabaseError || error instanceof NotFoundError) throw error;
      logger.error('Unexpected error in incrementEventCount', { logPeriodId, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find or create log period
   */
  async findOrCreate(driverId: string, logDate: string): Promise<LogPeriod> {
    try {
      // Try to find existing
      let logPeriod = await this.findByDriverAndDate(driverId, logDate);

      if (logPeriod) {
        return logPeriod;
      }

      // Create new
      logPeriod = await this.create({
        driver_id: driverId,
        log_date_mmddyy: logDate,
        status: 'active',
        total_event_count: 0,
      } as Partial<LogPeriod>);

      return logPeriod;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findOrCreate', { driverId, logDate, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find uncertified log periods older than N days
   */
  async findUncertifiedOlderThan(driverId: string, daysOld: number): Promise<LogPeriod[]> {
    try {
      // Calculate cutoff date (MMDDYY format)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      const cutoffMMDDYY =
        String(cutoffDate.getMonth() + 1).padStart(2, '0') +
        String(cutoffDate.getDate()).padStart(2, '0') +
        String(cutoffDate.getFullYear()).slice(-2);

      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('driver_id', driverId)
        .eq('status', 'active')
        .lt('log_date_mmddyy', cutoffMMDDYY)
        .order('log_date_mmddyy', { ascending: true });

      if (error) {
        logger.error('Failed to find uncertified log periods', { driverId, daysOld, error });
        throw new DatabaseError('Failed to query log periods');
      }

      return (data as LogPeriod[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findUncertifiedOlderThan', { driverId, daysOld, error });
      throw new DatabaseError('Database operation failed');
    }
  }
}
