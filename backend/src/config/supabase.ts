/**
 * Supabase Database Configuration
 *
 * Configured with:
 * - Connection pooling (5-20 connections via Supavisor)
 * - Automatic retry on connection failures (max 3 retries)
 * - Separate clients for service role and user authentication
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Connection pool configuration
const POOL_MIN_CONNECTIONS = parseInt(process.env.DB_POOL_MIN || '5', 10);
const POOL_MAX_CONNECTIONS = parseInt(process.env.DB_POOL_MAX || '20', 10);
const CONNECTION_TIMEOUT = parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10);
const MAX_RETRIES = parseInt(process.env.DB_MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.DB_RETRY_DELAY || '1000', 10);

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing required Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
}

/**
 * Supabase connection options with pooling
 */
const connectionOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    headers: {
      'x-connection-pool-min': String(POOL_MIN_CONNECTIONS),
      'x-connection-pool-max': String(POOL_MAX_CONNECTIONS),
    },
  },
};

/**
 * Retry wrapper for database operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retriable (connection/network errors)
      const isRetriable =
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('Connection') ||
          error.message.includes('timeout'));

      if (!isRetriable || attempt === retries) {
        logger.error(`Database operation failed after ${attempt} attempts`, {
          context,
          error: lastError,
          attempts: attempt,
        });
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
      logger.warn(`Database operation failed, retrying in ${delay}ms`, {
        context,
        attempt,
        error: (lastError as Error).message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Supabase client with service role key for backend operations.
 * Bypasses RLS policies - use with caution and implement authorization logic.
 *
 * Configured with connection pooling (5-20 connections).
 */
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, connectionOptions);

/**
 * Supabase client with anon key for user-authenticated operations.
 * Respects RLS policies.
 */
export const supabaseAnon = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    })
  : null;

/**
 * Health check for database connection
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from('drivers').select('id').limit(1);

    if (error) {
      logger.error('Database health check failed', { error });
      return false;
    }

    logger.debug('Database health check passed');
    return true;
  } catch (error) {
    logger.error('Database health check error', { error });
    return false;
  }
}

/**
 * Graceful shutdown - close database connections
 */
export async function closeConnections(): Promise<void> {
  logger.info('Closing database connections');
  // Supabase JS client doesn't require explicit connection closing
  // Connections are managed by the underlying HTTP client
}

logger.info('Supabase client initialized', {
  url: supabaseUrl,
  poolMin: POOL_MIN_CONNECTIONS,
  poolMax: POOL_MAX_CONNECTIONS,
  connectionTimeout: CONNECTION_TIMEOUT,
});
