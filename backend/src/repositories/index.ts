/**
 * Repository Index
 *
 * Central export point for all repositories.
 * Provides factory function to create repository instances with connection pooling.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DriverRepository } from './driver.repository';
import { EventRepository } from './event.repository';
import { LogPeriodRepository } from './log-period.repository';

export { BaseRepository } from './base.repository';
export { DriverRepository, type Driver } from './driver.repository';
export { EventRepository, type EldEvent } from './event.repository';
export { LogPeriodRepository, type LogPeriod } from './log-period.repository';

/**
 * Repository Container
 *
 * Holds all repository instances for a given Supabase client.
 */
export class RepositoryContainer {
  public readonly drivers: DriverRepository;
  public readonly events: EventRepository;
  public readonly logPeriods: LogPeriodRepository;

  constructor(supabase: SupabaseClient) {
    this.drivers = new DriverRepository(supabase);
    this.events = new EventRepository(supabase);
    this.logPeriods = new LogPeriodRepository(supabase);
  }
}

/**
 * Create repository container with the given Supabase client
 */
export function createRepositories(supabase: SupabaseClient): RepositoryContainer {
  return new RepositoryContainer(supabase);
}
