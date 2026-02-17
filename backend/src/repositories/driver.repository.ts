/**
 * Driver Repository
 *
 * Data access layer for driver-related operations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './base.repository';
import { DatabaseError, NotFoundError } from '../models/errors/api-error';
import { logger } from '../utils/logger';

export interface Driver {
  id: string;
  carrier_id: string;
  user_id: string | null;
  driver_eld_account_id: string;
  full_name: string;
  email: string;
  phone: string;
  license_number: string;
  license_state: string;
  license_class: string;
  license_expiry: string;
  home_terminal_timezone: string;
  hos_ruleset: string;
  status: 'active' | 'inactive' | 'on_duty' | 'off_duty' | 'driving' | 'sleeper_berth' | 'offline';
  current_vehicle_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class DriverRepository extends BaseRepository<Driver> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'drivers');
  }

  /**
   * Find driver by carrier and driver ELD account ID
   */
  async findByEldAccountId(carrierId: string, eldAccountId: string): Promise<Driver | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('carrier_id', carrierId)
        .eq('driver_eld_account_id', eldAccountId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to find driver by ELD account ID', { carrierId, eldAccountId, error });
        throw new DatabaseError('Failed to find driver');
      }

      return data as Driver;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByEldAccountId', { carrierId, eldAccountId, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find all drivers for a carrier
   */
  async findByCarrier(carrierId: string, status?: string): Promise<Driver[]> {
    try {
      let query = this.supabase
        .from(this.tableName)
        .select('*')
        .eq('carrier_id', carrierId);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('full_name', { ascending: true });

      if (error) {
        logger.error('Failed to find drivers by carrier', { carrierId, status, error });
        throw new DatabaseError('Failed to query drivers');
      }

      return (data as Driver[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByCarrier', { carrierId, status, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find driver with carrier information
   */
  async findByIdWithCarrier(driverId: string): Promise<any> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select(
          `
          *,
          carrier:carriers!inner (
            id,
            dot_number,
            legal_name,
            address_line1,
            city,
            state,
            zip
          )
        `
        )
        .eq('id', driverId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new NotFoundError('Driver');
        }
        logger.error('Failed to find driver with carrier', { driverId, error });
        throw new DatabaseError('Failed to find driver');
      }

      return data;
    } catch (error) {
      if (error instanceof DatabaseError || error instanceof NotFoundError) throw error;
      logger.error('Unexpected error in findByIdWithCarrier', { driverId, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Update driver status
   */
  async updateStatus(driverId: string, status: Driver['status']): Promise<Driver> {
    return this.update(driverId, { status } as Partial<Driver>);
  }

  /**
   * Find driver by user ID
   */
  async findByUserId(userId: string): Promise<Driver | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to find driver by user ID', { userId, error });
        throw new DatabaseError('Failed to find driver');
      }

      return data as Driver;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByUserId', { userId, error });
      throw new DatabaseError('Database operation failed');
    }
  }
}
