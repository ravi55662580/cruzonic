/**
 * Event Repository
 *
 * Data access layer for ELD event operations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './base.repository';
import { DatabaseError } from '../models/errors/api-error';
import { logger } from '../utils/logger';

export interface EldEvent {
  id: string;
  carrier_id: string;
  driver_id: string;
  eld_device_id: string;
  event_sequence_id: number;
  event_type: number;
  event_code: number;
  event_timestamp: string;
  event_date_mmddyy: string;
  event_time_hhmmss: string;
  accumulated_vehicle_miles: string;
  elapsed_engine_hours: string;
  event_latitude: string | null;
  event_longitude: string | null;
  distance_last_coord: number | null;
  location_description: string | null;
  malfunction_diagnostic_code: string | null;
  record_status: number;
  record_origin: number;
  comment_annotation: string | null;
  driver_location_description: string | null;
  vin: string | null;
  shipping_doc_number: string | null;
  trailer_number: string | null;
  event_data_check_value: string | null;
  audit_trail: any;
  created_at: string;
  updated_at: string;
}

export class EventRepository extends BaseRepository<EldEvent> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'eld_events');
  }

  /**
   * Find events for a driver within a date range
   */
  async findByDriverAndDateRange(
    driverId: string,
    startDate: string,
    endDate: string,
    limit?: number
  ): Promise<EldEvent[]> {
    try {
      let query = this.supabase
        .from(this.tableName)
        .select('*')
        .eq('driver_id', driverId)
        .gte('event_timestamp', startDate)
        .lte('event_timestamp', endDate)
        .order('event_timestamp', { ascending: true });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to find events by driver and date range', {
          driverId,
          startDate,
          endDate,
          error,
        });
        throw new DatabaseError('Failed to query events');
      }

      return (data as EldEvent[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByDriverAndDateRange', {
        driverId,
        startDate,
        endDate,
        error,
      });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find events by event type
   */
  async findByEventType(
    driverId: string,
    eventType: number,
    startDate?: string,
    endDate?: string
  ): Promise<EldEvent[]> {
    try {
      let query = this.supabase
        .from(this.tableName)
        .select('*')
        .eq('driver_id', driverId)
        .eq('event_type', eventType);

      if (startDate) {
        query = query.gte('event_timestamp', startDate);
      }

      if (endDate) {
        query = query.lte('event_timestamp', endDate);
      }

      const { data, error } = await query.order('event_timestamp', { ascending: false });

      if (error) {
        logger.error('Failed to find events by type', { driverId, eventType, error });
        throw new DatabaseError('Failed to query events');
      }

      return (data as EldEvent[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByEventType', { driverId, eventType, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Get the latest event for a driver
   */
  async findLatestByDriver(driverId: string): Promise<EldEvent | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('driver_id', driverId)
        .order('event_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Failed to find latest event', { driverId, error });
        throw new DatabaseError('Failed to query latest event');
      }

      return data as EldEvent | null;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findLatestByDriver', { driverId, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Get next event sequence ID for a driver
   */
  async getNextSequenceId(driverId: string): Promise<number> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('event_sequence_id')
        .eq('driver_id', driverId)
        .order('event_sequence_id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Failed to get next sequence ID', { driverId, error });
        throw new DatabaseError('Failed to get sequence ID');
      }

      return data ? data.event_sequence_id + 1 : 1;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in getNextSequenceId', { driverId, error });
      throw new DatabaseError('Database operation failed');
    }
  }

  /**
   * Find events by carrier
   */
  async findByCarrier(
    carrierId: string,
    filters?: {
      eventType?: number;
      startDate?: string;
      endDate?: string;
      limit?: number;
    }
  ): Promise<EldEvent[]> {
    try {
      let query = this.supabase.from(this.tableName).select('*').eq('carrier_id', carrierId);

      if (filters?.eventType !== undefined) {
        query = query.eq('event_type', filters.eventType);
      }

      if (filters?.startDate) {
        query = query.gte('event_timestamp', filters.startDate);
      }

      if (filters?.endDate) {
        query = query.lte('event_timestamp', filters.endDate);
      }

      query = query.order('event_timestamp', { ascending: false });

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to find events by carrier', { carrierId, filters, error });
        throw new DatabaseError('Failed to query events');
      }

      return (data as EldEvent[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Unexpected error in findByCarrier', { carrierId, filters, error });
      throw new DatabaseError('Database operation failed');
    }
  }
}
