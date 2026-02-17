/**
 * Logging System Usage Examples
 *
 * Demonstrates structured logging with correlation IDs, log levels,
 * sensitive data filtering, and log helpers.
 */

import { logger, logHelpers, logWithCorrelation, createChildLogger } from '../src/utils/logger';

// ============================================================================
// Example 1: Basic Logging with Different Levels
// ============================================================================

export function basicLoggingExample() {
  // ERROR - System failures, unrecoverable errors
  logger.error('Database connection failed', {
    error: 'Connection refused',
    host: 'localhost',
    port: 5432,
    retryAttempt: 3,
  });

  // WARN - Anomalies, recoverable issues
  logger.warn('HOS violation detected', {
    driverId: 'driver-uuid-123',
    violationType: 'DRIVING_LIMIT_EXCEEDED',
    currentDrivingMinutes: 720,
    limitMinutes: 660,
  });

  // INFO - Business events, successful operations
  logger.info('Driver log certified', {
    driverId: 'driver-uuid-123',
    logDate: '020125',
    certifiedBy: 'user-uuid-456',
    totalEvents: 45,
  });

  // DEBUG - Development information
  logger.debug('Cache lookup', {
    key: 'driver:uuid-123',
    hit: true,
    ttl: 300,
  });
}

// ============================================================================
// Example 2: Sensitive Data Filtering (Automatic)
// ============================================================================

export function sensitiveDataExample() {
  // Password and tokens are automatically redacted
  logger.info('User login attempt', {
    email: 'user@example.com',
    password: 'this-will-be-redacted', // Automatically [REDACTED]
    loginMethod: 'email',
  });

  // API keys and secrets are redacted
  logger.debug('External API call', {
    url: 'https://api.example.com/data',
    apiKey: 'sk-1234567890', // Automatically [REDACTED]
    method: 'POST',
  });

  // Nested sensitive data is also redacted
  logger.info('User session created', {
    userId: 'user-123',
    session: {
      id: 'session-abc',
      token: 'jwt-token-here', // Automatically [REDACTED]
      expiresAt: '2026-02-17T10:00:00Z',
    },
  });
}

// ============================================================================
// Example 3: Using Log Helpers
// ============================================================================

export function logHelpersExample() {
  // API Request/Response logging (automatic via correlation middleware)
  logHelpers.apiRequest('POST', '/api/v1/events', {
    driverId: 'driver-123',
    eventType: 1,
  });

  logHelpers.apiResponse('POST', '/api/v1/events', 201, 45);

  // Database operations
  logHelpers.dbQuery('SELECT', 'eld_events', 12);
  logHelpers.dbQuery('INSERT', 'certifications');

  // Authentication events
  logHelpers.auth('login', 'user-123', { method: 'email' });
  logHelpers.auth('logout', 'user-123');
  logHelpers.auth('failed_login', undefined, {
    email: 'attacker@example.com',
    reason: 'invalid_password',
  });

  // Business events (audit trail)
  logHelpers.business('log_certified', {
    driverId: 'driver-123',
    logDate: '020125',
    eventCount: 45,
  });

  logHelpers.business('output_file_generated', {
    recordId: 'record-uuid',
    format: 'json',
    sizeBytes: 12345,
  });

  // Security events
  logHelpers.security('unauthorized_access', 'medium', {
    path: '/api/v1/admin/users',
    userId: 'user-123',
    ip: '192.168.1.100',
  });

  logHelpers.security('rate_limit_exceeded', 'low', {
    ip: '192.168.1.100',
    endpoint: '/api/v1/auth/login',
    attempts: 10,
  });
}

// ============================================================================
// Example 4: Correlation ID Usage
// ============================================================================

export async function correlationIdExample() {
  // In HTTP requests, correlation ID is automatic
  // In background jobs or async tasks, use logWithCorrelation

  // Simulate a background job
  logWithCorrelation('info', 'Starting background certification job', {
    jobId: 'job-123',
    driverId: 'driver-456',
  });

  // All subsequent logs in this async context include the correlation ID
  logWithCorrelation('debug', 'Fetching driver events', {
    dateRange: '020125-020125',
  });

  logWithCorrelation('info', 'Certification job completed', {
    jobId: 'job-123',
    duration: 2500,
    success: true,
  });
}

// ============================================================================
// Example 5: Child Loggers with Persistent Context
// ============================================================================

export function childLoggerExample() {
  // Create a child logger for a specific driver
  const driverLogger = createChildLogger({
    module: 'driver-service',
    driverId: 'driver-uuid-123',
  });

  // All logs from this logger include driverId and module
  driverLogger.info('Processing driver logs');
  // Output: { module: 'driver-service', driverId: 'driver-uuid-123', message: 'Processing driver logs' }

  driverLogger.debug('Fetching events from database');
  driverLogger.info('Log processing complete', { totalEvents: 45 });

  // Create a child logger for an API request
  const requestLogger = createChildLogger({
    module: 'api',
    endpoint: '/api/v1/drivers/:id',
    method: 'GET',
  });

  requestLogger.info('Request received');
  requestLogger.debug('Validating parameters');
  requestLogger.info('Response sent', { statusCode: 200, duration: 45 });
}

// ============================================================================
// Example 6: Error Logging with Stack Traces
// ============================================================================

export async function errorLoggingExample() {
  try {
    // Simulate an operation that might fail
    await riskyDatabaseOperation();
  } catch (error) {
    logger.error('Database operation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'fetchDriverLogs',
      driverId: 'driver-123',
      timestamp: new Date().toISOString(),
    });

    // Re-throw if necessary
    throw error;
  }
}

// ============================================================================
// Example 7: Logging in Controllers
// ============================================================================

export class ExampleController {
  async getDriverLog(driverId: string, logDate: string) {
    logger.info('Fetching driver log', { driverId, logDate });

    try {
      // Fetch data
      const log = await this.fetchLog(driverId, logDate);

      logger.debug('Driver log fetched', {
        driverId,
        logDate,
        eventCount: log.events.length,
      });

      return log;
    } catch (error) {
      logger.error('Failed to fetch driver log', {
        error: error instanceof Error ? error.message : 'Unknown',
        driverId,
        logDate,
      });

      throw error;
    }
  }

  private async fetchLog(driverId: string, logDate: string) {
    // Simulated database fetch
    return { events: [] };
  }
}

// ============================================================================
// Example 8: Logging in Services with Transaction Boundaries
// ============================================================================

export class CertificationService {
  async certifyLog(driverId: string, logDate: string) {
    logger.info('Starting log certification', { driverId, logDate });

    const startTime = Date.now();

    try {
      // Step 1: Validate
      logger.debug('Validating log period', { driverId, logDate });
      await this.validateLogPeriod(driverId, logDate);

      // Step 2: Create event
      logger.debug('Creating certification event', { driverId, logDate });
      const event = await this.createCertificationEvent(driverId, logDate);

      // Step 3: Update status
      logger.debug('Updating log period status', { driverId, logDate });
      await this.updateLogPeriodStatus(driverId, logDate);

      const duration = Date.now() - startTime;

      logger.info('Log certification completed', {
        driverId,
        logDate,
        eventId: event.id,
        duration,
      });

      return event;
    } catch (error) {
      logger.error('Log certification failed', {
        error: error instanceof Error ? error.message : 'Unknown',
        driverId,
        logDate,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  private async validateLogPeriod(driverId: string, logDate: string) {
    // Validation logic
  }

  private async createCertificationEvent(driverId: string, logDate: string) {
    return { id: 'event-123' };
  }

  private async updateLogPeriodStatus(driverId: string, logDate: string) {
    // Update logic
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function riskyDatabaseOperation() {
  // Simulated operation
  throw new Error('Connection timeout');
}

// ============================================================================
// Production JSON Output Examples
// ============================================================================

/*
ERROR level log:
{
  "level": "error",
  "message": "Database connection failed",
  "timestamp": "2026-02-16 10:30:15",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "service": "eld-backend",
  "environment": "production",
  "error": "Connection refused",
  "host": "localhost",
  "port": 5432,
  "retryAttempt": 3
}

INFO level log with sensitive data redacted:
{
  "level": "info",
  "message": "User login attempt",
  "timestamp": "2026-02-16 10:30:15",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "service": "eld-backend",
  "environment": "production",
  "email": "user@example.com",
  "password": "[REDACTED]",
  "loginMethod": "email"
}

API Request log:
{
  "level": "info",
  "message": "API Request: POST /api/v1/events",
  "timestamp": "2026-02-16 10:30:15",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "service": "eld-backend",
  "environment": "production",
  "query": {},
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0..."
}

API Response log:
{
  "level": "info",
  "message": "API Response: POST /api/v1/events",
  "timestamp": "2026-02-16 10:30:16",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "service": "eld-backend",
  "environment": "production",
  "statusCode": 201,
  "duration": "45ms"
}
*/
