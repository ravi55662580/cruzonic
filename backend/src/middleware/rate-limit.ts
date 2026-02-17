/**
 * Rate Limiting Middleware
 *
 * Implements distributed rate limiting using Redis to protect API from abuse.
 * Different limits for different endpoint types:
 * - Event ingestion: 100 req/min per device
 * - Query endpoints: 60 req/min per user
 * - Auth endpoints: 10 req/min per IP
 *
 * Returns 429 Too Many Requests with Retry-After header.
 * Adds rate limit headers (X-RateLimit-*) to all responses.
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import type { Request, Response } from 'express';
import { getRedisClient, isRedisAvailable } from '../config/redis';
import { logger, logHelpers } from '../utils/logger';

/**
 * Rate limit configuration
 */
const RATE_LIMITS = {
  eventIngestion: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_EVENTS || '100', 10),
    keyGenerator: 'device',
  },
  query: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_QUERY || '60', 10),
    keyGenerator: 'user',
  },
  auth: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_AUTH || '10', 10),
    keyGenerator: 'ip',
  },
  general: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_GENERAL || '120', 10),
    keyGenerator: 'ip',
  },
};

/**
 * Key generator functions
 */
const keyGenerators = {
  device: (req: Request): string => {
    const deviceId = req.headers['x-device-id'] as string;
    if (deviceId) {
      return `device:${deviceId}`;
    }

    const user = (req as any).user;
    if (user?.deviceId) {
      return `device:${user.deviceId}`;
    }

    return `ip:${req.ip}`;
  },

  user: (req: Request): string => {
    const user = (req as any).user;
    if (user?.id) {
      return `user:${user.id}`;
    }

    return `ip:${req.ip}`;
  },

  ip: (req: Request): string => {
    return `ip:${req.ip}`;
  },
};

/**
 * Custom handler for rate limit exceeded
 */
function rateLimitExceededHandler(req: Request, res: Response): void {
  const retryAfter = Math.ceil(
    (res.getHeader('X-RateLimit-Reset') as number - Date.now()) / 1000
  );

  logHelpers.security('rate_limit_exceeded', 'medium', {
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: (req as any).user?.id,
    retryAfter,
  });

  res.status(429).json({
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter,
    limit: res.getHeader('X-RateLimit-Limit'),
    remaining: 0,
    reset: new Date(res.getHeader('X-RateLimit-Reset') as number).toISOString(),
  });
}

/**
 * Skip rate limiting for certain requests
 */
function skipRateLimit(req: Request): boolean {
  if (req.path === '/health' || req.path === '/metrics') {
    return true;
  }

  if (process.env.RATE_LIMIT_ENABLED === 'false') {
    return true;
  }

  return false;
}

/**
 * Create rate limiter with Redis store or in-memory fallback
 */
function createRateLimiter(config: {
  windowMs: number;
  max: number;
  keyGenerator: keyof typeof keyGenerators;
  prefix: string;
}): RateLimitRequestHandler {
  const baseOptions = {
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimit,
    handler: rateLimitExceededHandler,
    keyGenerator: keyGenerators[config.keyGenerator],
  };

  if (isRedisAvailable()) {
    try {
      const redisStore = new RedisStore({
        // @ts-expect-error - rate-limit-redis types may be outdated
        client: getRedisClient(),
        prefix: `ratelimit:${config.prefix}:`,
        sendCommand: (...args: string[]) => getRedisClient().sendCommand(args),
      });

      return rateLimit({
        ...baseOptions,
        store: redisStore,
      });
    } catch (error) {
      logger.error('Failed to create Redis store, using in-memory fallback');
      return rateLimit(baseOptions);
    }
  }

  return rateLimit(baseOptions);
}

/**
 * Rate limiters for different endpoint types
 */
export const eventIngestionRateLimiter = createRateLimiter({
  windowMs: RATE_LIMITS.eventIngestion.windowMs,
  max: RATE_LIMITS.eventIngestion.max,
  keyGenerator: RATE_LIMITS.eventIngestion.keyGenerator as keyof typeof keyGenerators,
  prefix: 'events',
});

export const queryRateLimiter = createRateLimiter({
  windowMs: RATE_LIMITS.query.windowMs,
  max: RATE_LIMITS.query.max,
  keyGenerator: RATE_LIMITS.query.keyGenerator as keyof typeof keyGenerators,
  prefix: 'query',
});

export const authRateLimiter = createRateLimiter({
  windowMs: RATE_LIMITS.auth.windowMs,
  max: RATE_LIMITS.auth.max,
  keyGenerator: RATE_LIMITS.auth.keyGenerator as keyof typeof keyGenerators,
  prefix: 'auth',
});

export const generalRateLimiter = createRateLimiter({
  windowMs: RATE_LIMITS.general.windowMs,
  max: RATE_LIMITS.general.max,
  keyGenerator: RATE_LIMITS.general.keyGenerator as keyof typeof keyGenerators,
  prefix: 'general',
});

export const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_STRICT || '20', 10),
  keyGenerator: 'user',
  prefix: 'strict',
});

logger.info('Rate limiting configured', {
  redis: isRedisAvailable() ? 'enabled' : 'in-memory fallback',
  limits: {
    eventIngestion: `${RATE_LIMITS.eventIngestion.max}/min per device`,
    query: `${RATE_LIMITS.query.max}/min per user`,
    auth: `${RATE_LIMITS.auth.max}/min per IP`,
  },
});
