# Structured Logging Guide

## Overview

The ELD backend uses **Winston** for structured logging with full support for:

- ✅ **JSON format** in production for log aggregation
- ✅ **Colorized console** output in development
- ✅ **Correlation IDs** for request tracing
- ✅ **Log rotation** with daily rotation and size limits
- ✅ **Sensitive data filtering** to prevent credential leaks
- ✅ **Multiple log levels**: ERROR, WARN, INFO, DEBUG

## Log Levels

### ERROR
**When**: System failures, unrecoverable errors, exceptions

```typescript
logger.error('Database connection failed', {
  error: error.message,
  attempt: retryCount,
});
```

**Examples**:
- Database connection failures
- Unhandled exceptions
- API service unavailability
- Data corruption

### WARN
**When**: Anomalies, recoverable errors, deprecated usage

```typescript
logger.warn('Retry attempt failed', {
  attempt: 2,
  maxRetries: 3,
  error: error.message,
});
```

**Examples**:
- Failed authentication attempts
- Missing optional configuration
- Deprecated API usage
- Resource limits approaching

### INFO
**When**: Business events, successful operations, audit trails

```typescript
logger.info('Driver certified log', {
  driverId: 'uuid',
  logDate: '020125',
  certifiedBy: 'user-uuid',
});
```

**Examples**:
- User login/logout
- Log certification
- File generation
- API requests/responses

### DEBUG
**When**: Development information, detailed execution flow

```typescript
logger.debug('Calculating HOS remaining time', {
  driverId: 'uuid',
  currentStatus: 'DRIVING',
  elapsedMinutes: 180,
});
```

**Examples**:
- Database queries
- Cache hits/misses
- Internal state changes
- Performance metrics

## Configuration

### Environment Variables

```env
# Log level (debug, info, warn, error)
LOG_LEVEL=info

# Environment (affects output format)
NODE_ENV=production

# Log directory (production only)
LOG_DIR=logs
```

### Log Levels by Environment

- **Development**: `debug` (all logs)
- **Production**: `info` (excludes debug)
- **Test**: `error` (minimal logging)

## Correlation IDs

Every HTTP request automatically gets a **correlation ID** for tracing across services and logs.

### Automatic Correlation

```typescript
// Correlation ID automatically added to all logs within request scope
app.get('/api/v1/drivers/:id', async (req, res) => {
  // This log will include the correlation ID
  logger.info('Fetching driver', { driverId: req.params.id });

  // All subsequent logs in this request also include it
  const driver = await getDriver(req.params.id);

  return res.json(driver);
});
```

### Manual Correlation

```typescript
import { logWithCorrelation } from './utils/logger';

// Log with correlation ID from async context
logWithCorrelation('info', 'Processing background job', {
  jobId: 'job-123',
  type: 'certification',
});
```

### Passing Correlation ID Between Services

```typescript
import { getCorrelationId } from './middleware/correlation';

const correlationId = getCorrelationId();

// Pass to external service
await fetch('https://external-api.com/endpoint', {
  headers: {
    'x-correlation-id': correlationId,
  },
});
```

### Finding Logs by Correlation ID

**Development Console**:
```
2026-02-16 10:30:15 [a1b2c3d4-e5f6-7890-abcd-ef1234567890] [info]: API Request: GET /api/v1/drivers/123
2026-02-16 10:30:15 [a1b2c3d4-e5f6-7890-abcd-ef1234567890] [debug]: DB Query: SELECT on drivers
2026-02-16 10:30:15 [a1b2c3d4-e5f6-7890-abcd-ef1234567890] [info]: API Response: GET /api/v1/drivers/123
```

**Production JSON** (grep by correlationId):
```bash
grep "a1b2c3d4-e5f6-7890-abcd-ef1234567890" logs/combined-2026-02-16.log
```

## Log Rotation

### Configuration

**Production only** - automatic daily rotation:

```typescript
// Error logs - keep 30 days, max 20MB per file
filename: 'logs/error-%DATE%.log'
maxSize: '20m'
maxFiles: '30d'
zippedArchive: true  // Compress old logs

// Combined logs - keep 14 days
filename: 'logs/combined-%DATE%.log'
maxFiles: '14d'

// Application logs - keep 30 days
filename: 'logs/app-%DATE%.log'
maxFiles: '30d'
```

### Log Files

```
logs/
├── error-2026-02-16.log       # Errors only
├── error-2026-02-15.log.gz    # Compressed old errors
├── combined-2026-02-16.log    # All logs (debug + info + warn + error)
├── app-2026-02-16.log         # Business events (info + warn + error)
└── audit-2026-02-16.log       # Audit trail (future)
```

### Rotation Triggers

Logs rotate when:
1. **Daily** at midnight (new date)
2. **Size limit** reached (20MB)

Old logs are **automatically compressed** (.gz) and deleted after retention period.

## Sensitive Data Filtering

### Automatic Redaction

The logger **automatically redacts** sensitive fields:

```typescript
logger.info('User login', {
  email: 'user@example.com',
  password: 'secret123',  // Automatically redacted
  token: 'jwt-token',      // Automatically redacted
});

// Logged as:
{
  "level": "info",
  "message": "User login",
  "email": "user@example.com",
  "password": "[REDACTED]",
  "token": "[REDACTED]"
}
```

### Redacted Fields

Automatically filters fields containing:
- `password`, `token`, `secret`, `apiKey`, `api_key`
- `authorization`, `cookie`, `session`
- `ssn`, `social_security`, `credit_card`, `cvv`, `pin`
- `access_token`, `refresh_token`, `private_key`
- Environment-specific: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`

### Long Strings

Strings longer than 500 characters are truncated:

```typescript
logger.info('Large payload', {
  data: 'x'.repeat(1000),  // Very long string
});

// Logged as:
{
  "data": "[String of length 1000]"
}
```

## Usage Examples

### Basic Logging

```typescript
import { logger } from './utils/logger';

// Info
logger.info('Driver created', {
  driverId: 'uuid',
  carrierId: 'carrier-uuid',
  licenseNumber: 'DL123456',
});

// Warning
logger.warn('HOS violation detected', {
  driverId: 'uuid',
  violationType: 'DRIVING_LIMIT_EXCEEDED',
  severity: 'medium',
});

// Error
logger.error('Failed to generate output file', {
  error: error.message,
  stack: error.stack,
  driverId: 'uuid',
  logDate: '020125',
});

// Debug
logger.debug('Cache hit', {
  key: 'driver:uuid',
  ttl: 300,
});
```

### Log Helpers

Pre-built helpers for common scenarios:

```typescript
import { logHelpers } from './utils/logger';

// API Request/Response (automatic via correlation middleware)
logHelpers.apiRequest('GET', '/api/v1/drivers/123', { userId: 'user-uuid' });
logHelpers.apiResponse('GET', '/api/v1/drivers/123', 200, 45);

// Database Operations
logHelpers.dbQuery('SELECT', 'drivers', 12);
logHelpers.dbQuery('INSERT', 'eld_events');

// Authentication
logHelpers.auth('login', 'user-uuid', { method: 'email' });
logHelpers.auth('logout', 'user-uuid');
logHelpers.auth('failed_login', undefined, { email: 'user@example.com' });

// Business Events
logHelpers.business('log_certified', {
  driverId: 'uuid',
  logDate: '020125',
  certifiedBy: 'user-uuid',
});

// Security Events
logHelpers.security('unauthorized_access', 'medium', {
  path: '/api/v1/admin',
  userId: 'user-uuid',
});
```

### Child Loggers

Create scoped loggers with persistent context:

```typescript
import { createChildLogger } from './utils/logger';

// Create child logger for a specific module
const driverLogger = createChildLogger({
  module: 'driver-service',
  driverId: 'uuid',
});

// All logs include module and driverId
driverLogger.info('Processing driver logs');
// Output: { module: 'driver-service', driverId: 'uuid', message: 'Processing driver logs' }
```

### Error Logging with Stack Traces

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
    operation: 'riskyOperation',
  });
}
```

## Production JSON Format

### Example Log Entry

```json
{
  "level": "info",
  "message": "API Request: GET /api/v1/drivers/123",
  "timestamp": "2026-02-16 10:30:15",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "service": "eld-backend",
  "environment": "production",
  "method": "GET",
  "path": "/api/v1/drivers/123",
  "query": {},
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0..."
}
```

### Querying JSON Logs

```bash
# Find all errors
jq 'select(.level == "error")' logs/combined-2026-02-16.log

# Find by correlation ID
jq 'select(.correlationId == "a1b2c3d4-...")' logs/combined-2026-02-16.log

# Find failed API requests
jq 'select(.statusCode >= 400)' logs/app-2026-02-16.log

# Count errors by type
jq -s 'group_by(.error) | map({error: .[0].error, count: length})' logs/error-2026-02-16.log
```

## Integration with Log Aggregation

### ELK Stack (Elasticsearch, Logstash, Kibana)

**Logstash configuration**:
```conf
input {
  file {
    path => "/var/log/eld-backend/combined-*.log"
    codec => json
  }
}

filter {
  # Add correlation ID field
  mutate {
    add_field => { "[@metadata][correlation_id]" => "%{correlationId}" }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "eld-logs-%{+YYYY.MM.dd}"
  }
}
```

### DataDog

```bash
# Install DataDog agent
# Configure log collection in datadog.yaml

logs:
  - type: file
    path: /var/log/eld-backend/combined-*.log
    service: eld-backend
    source: nodejs
    sourcecategory: eld
    tags:
      - env:production
      - version:1.0.0
```

### CloudWatch Logs

```typescript
// Add cloudwatch transport
import CloudWatchTransport from 'winston-cloudwatch';

logger.add(new CloudWatchTransport({
  logGroupName: '/aws/eld-backend',
  logStreamName: `${instanceId}-${new Date().toISOString().split('T')[0]}`,
  awsRegion: 'us-east-1',
  jsonMessage: true,
}));
```

## Best Practices

### ✅ DO

1. **Use appropriate log levels**
   ```typescript
   logger.error('Critical failure');  // System down
   logger.warn('Recoverable issue');  // Needs attention
   logger.info('Business event');     // Audit trail
   logger.debug('Development info');  // Debugging
   ```

2. **Include contextual metadata**
   ```typescript
   logger.info('Log certified', {
     driverId: 'uuid',
     logDate: '020125',
     certifiedBy: 'user-uuid',
     eventCount: 45,
   });
   ```

3. **Log at transaction boundaries**
   ```typescript
   logger.info('Starting log certification');
   // ... operation ...
   logger.info('Log certification completed', { duration: 120 });
   ```

4. **Use correlation IDs for tracing**
   ```typescript
   // Automatically included in HTTP requests
   // Manually add for background jobs
   logWithCorrelation('info', 'Processing background job');
   ```

### ❌ DON'T

1. **Log sensitive data**
   ```typescript
   // Bad
   logger.info('User login', { password: 'secret123' });

   // Good (automatically redacted)
   logger.info('User login', { email: 'user@example.com' });
   ```

2. **Log in tight loops**
   ```typescript
   // Bad
   for (const event of events) {
     logger.debug('Processing event', { event });  // 1000 logs!
   }

   // Good
   logger.debug('Processing events', { count: events.length });
   // ... process ...
   logger.debug('Events processed', { successCount, failCount });
   ```

3. **Log excessive detail in production**
   ```typescript
   // Bad (use DEBUG level)
   logger.info('Cache lookup', { key, value, ttl, hit, miss });

   // Good
   logger.debug('Cache lookup', { key, hit: true });
   ```

4. **Ignore errors**
   ```typescript
   // Bad
   try {
     await operation();
   } catch (error) {
     // Silent failure!
   }

   // Good
   try {
     await operation();
   } catch (error) {
     logger.error('Operation failed', { error: error.message });
     throw error;  // Re-throw if appropriate
   }
   ```

## Monitoring & Alerts

### Error Rate Alerts

Monitor error logs for spikes:

```bash
# Count errors in last hour
jq 'select(.level == "error")' logs/error-*.log | wc -l
```

**Alert if**:
- Error rate > 10/minute
- Specific error appears > 5 times
- Critical errors (database down, auth failure)

### Performance Alerts

Track response times via correlation logs:

```bash
# Find slow requests (>1 second)
jq 'select(.duration != null and (.duration | tonumber) > 1000)' logs/app-*.log
```

**Alert if**:
- P95 response time > 1000ms
- Database query time > 500ms
- File generation time > 5000ms

## Troubleshooting

### No logs appearing

Check:
1. `LOG_LEVEL` environment variable
2. Log directory permissions (production)
3. Console output disabled in test mode

### Correlation ID missing

Ensure:
1. Correlation middleware is registered early
2. Using `logWithCorrelation()` for async operations
3. Async local storage enabled (Node.js >= 14)

### Sensitive data in logs

Check:
1. Field name matches SENSITIVE_FIELDS patterns
2. Using logger, not console.log
3. Data sanitization working (test with dummy data)

### Log rotation not working

Verify:
1. Running in production mode (`NODE_ENV=production`)
2. Log directory exists and is writable
3. Sufficient disk space

## References

- [Winston Documentation](https://github.com/winstonjs/winston)
- [Winston Daily Rotate File](https://github.com/winstonjs/winston-daily-rotate-file)
- [AsyncLocalStorage](https://nodejs.org/api/async_context.html#class-asynclocalstorage)
