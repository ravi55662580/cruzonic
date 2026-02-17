/**
 * Base Repository
 *
 * Abstract base class providing common CRUD operations for all repositories.
 * Implements the repository pattern to abstract database operations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DatabaseError, NotFoundError } from '../models/errors/api-error';
import { logger } from '../utils/logger';

export abstract class BaseRepository<T> {
  protected supabase: SupabaseClient;
  protected tableName: string;

  constructor(supabase: SupabaseClient, tableName: string) {
    this.supabase = supabase;
    this.tableName = tableName;
  }

  /**
   * Find a single record by ID
   */
  async findById(id: string): Promise<T | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          return null;
        }
        logger.error(`Failed to find ${this.tableName} by ID`, { id, error });
        throw new DatabaseError(`Failed to find ${this.tableName}`);
      }

      return data as T;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error(`Unexpected error in findById for ${this.tableName}`, { id, error });
      throw new DatabaseError(`Database operation failed`);
    }
  }

  /**
   * Find all records matching a filter
   */
  async findAll(filters?: Record<string, any>): Promise<T[]> {
    try {
      let query = this.supabase.from(this.tableName).select('*');

      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { data, error } = await query;

      if (error) {
        logger.error(`Failed to find all ${this.tableName}`, { filters, error });
        throw new DatabaseError(`Failed to query ${this.tableName}`);
      }

      return (data as T[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error(`Unexpected error in findAll for ${this.tableName}`, { filters, error });
      throw new DatabaseError(`Database operation failed`);
    }
  }

  /**
   * Create a new record
   */
  async create(data: Partial<T>): Promise<T> {
    try {
      const { data: created, error } = await this.supabase
        .from(this.tableName)
        .insert(data)
        .select()
        .single();

      if (error) {
        logger.error(`Failed to create ${this.tableName}`, { data, error });
        throw new DatabaseError(`Failed to create ${this.tableName}: ${error.message}`);
      }

      logger.debug(`Created ${this.tableName}`, { id: (created as any).id });
      return created as T;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error(`Unexpected error in create for ${this.tableName}`, { data, error });
      throw new DatabaseError(`Database operation failed`);
    }
  }

  /**
   * Update a record by ID
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    try {
      const { data: updated, error } = await this.supabase
        .from(this.tableName)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new NotFoundError(this.tableName);
        }
        logger.error(`Failed to update ${this.tableName}`, { id, data, error });
        throw new DatabaseError(`Failed to update ${this.tableName}: ${error.message}`);
      }

      logger.debug(`Updated ${this.tableName}`, { id });
      return updated as T;
    } catch (error) {
      if (error instanceof DatabaseError || error instanceof NotFoundError) throw error;
      logger.error(`Unexpected error in update for ${this.tableName}`, { id, data, error });
      throw new DatabaseError(`Database operation failed`);
    }
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        logger.error(`Failed to delete ${this.tableName}`, { id, error });
        throw new DatabaseError(`Failed to delete ${this.tableName}: ${error.message}`);
      }

      logger.debug(`Deleted ${this.tableName}`, { id });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error(`Unexpected error in delete for ${this.tableName}`, { id, error });
      throw new DatabaseError(`Database operation failed`);
    }
  }

  /**
   * Count records matching a filter
   */
  async count(filters?: Record<string, any>): Promise<number> {
    try {
      let query = this.supabase.from(this.tableName).select('*', { count: 'exact', head: true });

      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { count, error } = await query;

      if (error) {
        logger.error(`Failed to count ${this.tableName}`, { filters, error });
        throw new DatabaseError(`Failed to count ${this.tableName}`);
      }

      return count || 0;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error(`Unexpected error in count for ${this.tableName}`, { filters, error });
      throw new DatabaseError(`Database operation failed`);
    }
  }
}
