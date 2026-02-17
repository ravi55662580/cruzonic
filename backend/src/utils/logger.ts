/**
 * Structured Logger
 *
 * Winston-based logger with:
 * - JSON format for production, colorized console for development
 * - Correlation IDs for request tracing
 * - Log rotation with daily rotation and size limits
 * - Sensitive data filtering
 * - Multiple log levels: ERROR, WARN, INFO, DEBUG
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { AsyncLocalStorage } from 'async_hooks';

const { combine, timestamp, json, printf, colorize, errors } = winston.format;

// Async local storage for correlation IDs
export const asyncLocalStorage = new AsyncLocalStorage<{ correlationId: string }>();

/**
 * Sensitive field patterns to redact from logs
 */
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'session',
  'ssn',
  'social_security',
  'credit_card',
  'card_number',
  'cvv',
  'pin',
  'access_token',
  'refresh_token',
  'private_key',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
];

/**
 * Sanitize sensitive data from log metadata
 */
function sanitizeData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Don't log long strings that might contain sensitive data
    if (data.length > 500) {
      return `[String of length ${data.length}]`;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  if (typeof data === 'object') {
    const sanitized: any = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Check if key matches sensitive field patterns
      const isSensitive = SENSITIVE_FIELDS.some((field) =>
        lowerKey.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeData(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  return data;
}

/**
 * Custom format that adds correlation ID and sanitizes sensitive data
 */
const correlationFormat = winston.format((info) => {
  const store = asyncLocalStorage.getStore();

  if (store?.correlationId) {
    info.correlationId = store.correlationId;
  }

  // Sanitize all metadata
  const { level, message, timestamp, correlationId, service, environment, ...metadata } = info;

  return {
    level,
    message,
    timestamp,
    correlationId,
    service,
    environment,
    ...sanitizeData(metadata),
  };
});

/**
 * Custom format for development (readable console output with correlation ID)
 */
const devFormat = printf(({ level, message, timestamp, correlationId, ...metadata }) => {
  let msg = `${timestamp}`;

  if (correlationId) {
    msg += ` [${correlationId}]`;
  }

  msg += ` [${level}]: ${message}`;

  // Filter out service and environment from metadata display
  const { service, environment, ...rest } = metadata;

  if (Object.keys(rest).length > 0) {
    msg += ` ${JSON.stringify(rest)}`;
  }

  return msg;
});

// Determine environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// Log level configuration
const LOG_LEVEL = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Base format
const baseFormat = combine(
  errors({ stack: true }), // Log error stack traces
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  correlationFormat() // Add correlation ID and sanitize
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    format: isDevelopment
      ? combine(colorize(), devFormat)
      : combine(json()), // JSON format for production
    silent: isTest, // Suppress console logs during tests
  })
);

// Production file transports with rotation
if (!isDevelopment && !isTest) {
  // Error log - daily rotation, keep for 30 days, max 20MB per file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: json(),
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    })
  );

  // Combined log - daily rotation, keep for 14 days, max 20MB per file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      format: json(),
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    })
  );

  // Info/Warn log - for business events, keep for 30 days
  transports.push(
    new DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      format: json(),
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    })
  );
}

// Create logger
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: baseFormat,
  defaultMeta: {
    service: 'eld-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  transports,
  // Don't exit on uncaught exceptions (let the app handle it)
  exitOnError: false,
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: Record<string, any>) {
  return logger.child(sanitizeData(context));
}

/**
 * Log with correlation ID from async local storage
 */
export function logWithCorrelation(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  meta?: Record<string, any>
) {
  const store = asyncLocalStorage.getStore();
  const sanitized = meta ? sanitizeData(meta) : {};

  logger[level](message, {
    ...sanitized,
    correlationId: store?.correlationId,
  });
}

// Stream for Morgan HTTP logging
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// Log startup info
if (!isTest) {
  logger.info('Logger initialized', {
    level: LOG_LEVEL,
    environment: process.env.NODE_ENV || 'development',
    rotation: !isDevelopment && !isTest ? 'enabled' : 'disabled',
  });
}

/**
 * Helper functions for common log scenarios
 */
export const logHelpers = {
  /**
   * Log API request
   */
  apiRequest: (method: string, path: string, meta?: Record<string, any>) => {
    logWithCorrelation('info', `API Request: ${method} ${path}`, meta);
  },

  /**
   * Log API response
   */
  apiResponse: (method: string, path: string, statusCode: number, duration: number) => {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logWithCorrelation(level, `API Response: ${method} ${path}`, {
      statusCode,
      duration: `${duration}ms`,
    });
  },

  /**
   * Log database query
   */
  dbQuery: (operation: string, table: string, duration?: number) => {
    logWithCorrelation('debug', `DB Query: ${operation} on ${table}`, {
      duration: duration ? `${duration}ms` : undefined,
    });
  },

  /**
   * Log authentication event
   */
  auth: (event: string, userId?: string, meta?: Record<string, any>) => {
    logWithCorrelation('info', `Auth: ${event}`, {
      userId,
      ...meta,
    });
  },

  /**
   * Log business event
   */
  business: (event: string, meta?: Record<string, any>) => {
    logWithCorrelation('info', `Business Event: ${event}`, meta);
  },

  /**
   * Log security event
   */
  security: (event: string, severity: 'low' | 'medium' | 'high', meta?: Record<string, any>) => {
    const level = severity === 'high' ? 'error' : severity === 'medium' ? 'warn' : 'info';
    logWithCorrelation(level, `Security: ${event}`, { severity, ...meta });
  },
};
