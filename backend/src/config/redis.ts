/**
 * Redis Configuration
 *
 * Redis client for distributed rate limiting and caching.
 * Supports both local development (in-memory fallback) and production (Redis server).
 */

import { createClient } from 'redis';
import { logger } from '../utils/logger';

// Redis configuration from environment
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create Redis client
export const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis reconnection attempts exceeded', { retries });
        return new Error('Redis reconnection failed');
      }
      // Exponential backoff
      const delay = Math.min(retries * 100, 3000);
      logger.warn('Redis reconnecting', { retries, delay });
      return delay;
    },
  },
});

// Redis connection state
let isRedisConnected = false;
let isRedisConnecting = false;

/**
 * Initialize Redis connection
 */
export async function connectRedis(): Promise<void> {
  if (!REDIS_ENABLED) {
    logger.info('Redis disabled, using in-memory fallback for rate limiting');
    return;
  }

  if (isRedisConnected || isRedisConnecting) {
    return;
  }

  try {
    isRedisConnecting = true;

    // Connect to Redis
    await redisClient.connect();

    isRedisConnected = true;
    isRedisConnecting = false;

    logger.info('Redis connected successfully', {
      url: REDIS_URL.replace(/:[^:]*@/, ':***@'), // Hide password
      environment: NODE_ENV,
    });

    // Test connection
    await redisClient.ping();
    logger.debug('Redis ping successful');
  } catch (error) {
    isRedisConnecting = false;
    logger.error('Redis connection failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      url: REDIS_URL.replace(/:[^:]*@/, ':***@'),
    });

    // In development, continue without Redis
    if (NODE_ENV === 'development') {
      logger.warn('Continuing without Redis in development mode');
    } else {
      throw error;
    }
  }
}

/**
 * Close Redis connection gracefully
 */
export async function disconnectRedis(): Promise<void> {
  if (isRedisConnected) {
    try {
      await redisClient.quit();
      isRedisConnected = false;
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error('Error closing Redis connection', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }
}

/**
 * Check if Redis is connected and available
 */
export function isRedisAvailable(): boolean {
  return isRedisConnected && redisClient.isReady;
}

/**
 * Get Redis client (for rate limiting stores)
 */
export function getRedisClient() {
  return redisClient;
}

// Handle Redis errors
redisClient.on('error', (error) => {
  logger.error('Redis client error', {
    error: error.message,
  });
});

redisClient.on('reconnecting', () => {
  logger.info('Redis client reconnecting');
});

redisClient.on('ready', () => {
  isRedisConnected = true;
  logger.info('Redis client ready');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await disconnectRedis();
});

process.on('SIGINT', async () => {
  await disconnectRedis();
});
