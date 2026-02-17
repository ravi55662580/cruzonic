## Rate Limiting Guide

## Overview

The ELD backend implements **distributed rate limiting** using Redis to protect the API from abuse and ensure system stability. Different endpoints have different rate limits based on their usage patterns and resource requirements.

### ✅ Features

- **Distributed rate limiting** - Works across multiple server instances using Redis
- **Per-endpoint limits** - Different limits for different endpoint types
- **Multiple strategies** - Rate limit by device ID, user ID, or IP address
- **429 responses** - Proper HTTP status code with Retry-After header
- **Rate limit headers** - X-RateLimit-* headers on all responses
- **Security logging** - All rate limit violations are logged
- **Graceful fallback** - In-memory rate limiting if Redis unavailable

## Rate Limits

### Event Ingestion
**Endpoint**: `POST /api/v1/events`
**Limit**: **100 requests/minute per device**
**Strategy**: Device ID (from `x-device-id` header or authenticated user)
**Purpose**: Prevent ELD device abuse while allowing normal operation

### Query Endpoints
**Endpoints**:
- `GET /api/v1/drivers/*`
- `GET /api/v1/hos/*`

**Limit**: **60 requests/minute per user**
**Strategy**: User ID (from authentication token)
**Purpose**: Prevent excessive database queries

### Authentication
**Endpoint**: `POST /api/v1/auth/*`
**Limit**: **10 requests/minute per IP**
**Strategy**: IP address
**Purpose**: Prevent brute force attacks

### Strict Rate Limit (Resource Intensive)
**Endpoints**:
- `POST /api/v1/certify`
- `POST /api/v1/output-file/generate`

**Limit**: **20 requests/minute per user**
**Strategy**: User ID
**Purpose**: Protect resource-intensive operations

## Configuration

### Environment Variables

```env
# Redis connection (required for distributed rate limiting)
REDIS_URL=redis://localhost:6379
REDIS_ENABLED=true

# Rate limit configuration (requests per minute)
RATE_LIMIT_EVENTS=100      # Event ingestion per device
RATE_LIMIT_QUERY=60        # Query endpoints per user
RATE_LIMIT_AUTH=10         # Auth endpoints per IP
RATE_LIMIT_STRICT=20       # Strict endpoints per user
RATE_LIMIT_GENERAL=120     # General API per IP

# Disable all rate limiting (development only)
RATE_LIMIT_ENABLED=false
```

### Redis Setup

**Local Development**:
```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Using Homebrew (macOS)
brew install redis
brew services start redis

# Verify connection
redis-cli ping
# Should respond: PONG
```

**Production (AWS ElastiCache)**:
```env
REDIS_URL=redis://my-redis-cluster.abc123.0001.use1.cache.amazonaws.com:6379
```

**Production (Redis Cloud)**:
```env
REDIS_URL=redis://default:password@redis-12345.c1.cloud.redislabs.com:12345
```

## Response Format

### Successful Request (Under Limit)

**Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1676564100
X-RateLimit-Window: 60s
```

### Rate Limit Exceeded (429)

**Status**: `429 Too Many Requests`

**Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1676564100
Retry-After: 45
```

**Body**:
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 45,
  "limit": 100,
  "remaining": 0,
  "reset": "2026-02-16T10:35:00.000Z"
}
```

## Client Implementation

### JavaScript/TypeScript

```typescript
async function makeRequestWithRetry(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);

  // Check rate limit headers
  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '0', 10);
  const limit = parseInt(response.headers.get('X-RateLimit-Limit') || '0', 10);

  console.log(`Rate limit: ${remaining}/${limit} remaining`);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);

    console.warn(`Rate limited. Retrying after ${retryAfter} seconds`);

    // Wait and retry
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return makeRequestWithRetry(url, options);
  }

  return response;
}

// Usage
const response = await makeRequestWithRetry('https://api.example.com/api/v1/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-device-id': 'device-123',
  },
  body: JSON.stringify(eventData),
});
```

### Python

```python
import requests
import time

def make_request_with_retry(url, headers=None, json=None):
    response = requests.post(url, headers=headers, json=json)

    # Check rate limit headers
    remaining = int(response.headers.get('X-RateLimit-Remaining', 0))
    limit = int(response.headers.get('X-RateLimit-Limit', 0))

    print(f"Rate limit: {remaining}/{limit} remaining")

    if response.status_code == 429:
        retry_after = int(response.headers.get('Retry-After', 60))
        print(f"Rate limited. Retrying after {retry_after} seconds")

        time.sleep(retry_after)
        return make_request_with_retry(url, headers, json)

    return response

# Usage
response = make_request_with_retry(
    'https://api.example.com/api/v1/events',
    headers={
        'Content-Type': 'application/json',
        'x-device-id': 'device-123'
    },
    json=event_data
)
```

## Rate Limit Strategies

### Device-Based (Event Ingestion)

Rate limit key: `device:{deviceId}`

```typescript
// Include device ID in request headers
headers: {
  'x-device-id': 'eld-device-12345'
}
```

If no device ID header is provided:
1. Falls back to authenticated user's device ID
2. Falls back to IP address (less granular)

### User-Based (Query & Strict Endpoints)

Rate limit key: `user:{userId}`

Automatically extracted from JWT authentication token.

### IP-Based (Auth Endpoints)

Rate limit key: `ip:{ipAddress}`

Prevents brute force attacks by limiting login attempts per IP address.

## Monitoring & Alerts

### Rate Limit Violations

All rate limit violations are logged with security level:

```json
{
  "level": "warn",
  "message": "Security: rate_limit_exceeded",
  "severity": "medium",
  "path": "/api/v1/events",
  "method": "POST",
  "ip": "192.168.1.100",
  "userId": "user-uuid",
  "retryAfter": 45
}
```

### Metrics to Monitor

1. **Rate limit hit rate** - % of requests that hit the limit
2. **Top violators** - IPs/users/devices exceeding limits
3. **429 error rate** - Track rate limit rejections
4. **Redis performance** - Connection errors, latency

### Grafana Dashboard Queries

```promql
# Rate limit violations per minute
rate(http_requests_total{status="429"}[1m])

# Rate limit remaining by endpoint
histogram_quantile(0.95, rate_limit_remaining)

# Redis connection errors
redis_connection_errors_total
```

## Redis Key Structure

Rate limit data is stored in Redis with the following key structure:

```
ratelimit:{prefix}:{strategy}:{identifier}
```

**Examples**:
```
ratelimit:events:device:eld-device-12345
ratelimit:query:user:user-uuid-123
ratelimit:auth:ip:192.168.1.100
```

**Value**: Number of requests in current window
**TTL**: Time remaining in window (seconds)

## Advanced Configuration

### Custom Rate Limits per User

Future enhancement - allow VIP users higher limits:

```typescript
// In rate limit middleware
const getUserLimit = (userId: string): number => {
  const vipUsers = ['user-vip-1', 'user-vip-2'];
  return vipUsers.includes(userId) ? 200 : 60; // VIPs get 200/min
};
```

### Burst Allowance

Allow short bursts above the limit:

```typescript
// Token bucket algorithm with burst capacity
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  // Allow burst of 20 requests
  skipSuccessfulRequests: false,
  skipFailedRequests: true,
});
```

### Tiered Rate Limiting

Different limits based on subscription tier:

```typescript
const TIER_LIMITS = {
  free: 60,
  pro: 120,
  enterprise: 300,
};

const getUserTier = (userId: string): keyof typeof TIER_LIMITS => {
  // Lookup user tier from database
  return 'pro';
};
```

## Troubleshooting

### Rate Limits Too Strict

**Symptoms**: Legitimate users getting 429 errors

**Solutions**:
1. Increase limits in environment variables
2. Check if clients are retrying too aggressively
3. Review logs for unusual traffic patterns
4. Consider burst allowance

### Redis Connection Failures

**Symptoms**: Rate limiting not working consistently

**Solutions**:
1. Check Redis is running: `redis-cli ping`
2. Verify `REDIS_URL` in environment
3. Check network connectivity to Redis server
4. Review Redis logs for errors

**Fallback**: System automatically falls back to in-memory rate limiting (not distributed)

### False Positives (Shared IPs)

**Symptoms**: Multiple users behind same IP hitting limits

**Solutions**:
1. Use device-based or user-based rate limiting (not IP)
2. Whitelist known proxies/VPNs
3. Implement more granular rate limiting
4. Consider user authentication requirements

### Performance Impact

**Symptoms**: Slow response times, Redis latency

**Solutions**:
1. Monitor Redis memory usage
2. Use Redis connection pooling
3. Consider Redis cluster for high traffic
4. Optimize Redis commands

## Best Practices

### ✅ DO

1. **Include device ID in headers**
   ```typescript
   headers: { 'x-device-id': 'device-123' }
   ```

2. **Handle 429 responses gracefully**
   ```typescript
   if (response.status === 429) {
     const retryAfter = response.headers.get('Retry-After');
     await sleep(retryAfter * 1000);
     return retry();
   }
   ```

3. **Monitor rate limit headers**
   ```typescript
   const remaining = response.headers.get('X-RateLimit-Remaining');
   if (remaining < 10) {
     console.warn('Approaching rate limit');
   }
   ```

4. **Implement exponential backoff**
   ```typescript
   const backoff = Math.min(retryCount * 1000, 30000);
   await sleep(backoff);
   ```

### ❌ DON'T

1. **Ignore 429 responses**
   ```typescript
   // Bad - retry immediately
   if (response.status === 429) {
     return makeRequest(); // Will keep getting 429!
   }
   ```

2. **Hardcode rate limits in clients**
   ```typescript
   // Bad - limits may change
   if (requestCount > 100) {
     throw new Error('Rate limit');
   }
   ```

3. **Retry without waiting**
   ```typescript
   // Bad - amplifies the problem
   for (let i = 0; i < 10; i++) {
     await makeRequest(); // Will get rate limited!
   }
   ```

## Security Considerations

1. **DDoS Protection** - Rate limiting prevents distributed denial of service
2. **Brute Force Prevention** - Auth endpoint limits prevent password guessing
3. **Resource Protection** - Strict limits on expensive operations
4. **Audit Trail** - All violations logged for security review

## Performance

### Redis Overhead

- **Latency**: <1ms per request (Redis lookup)
- **Memory**: ~100 bytes per rate limit key
- **Network**: Minimal (single GET/INCR per request)

### Scaling

- **Horizontal**: Redis supports clustering for high availability
- **Vertical**: Redis can handle millions of keys in memory
- **Caching**: Rate limit data expires automatically (TTL)

## References

- [Express Rate Limit Documentation](https://github.com/express-rate-limit/express-rate-limit)
- [Redis Documentation](https://redis.io/docs/)
- [Rate Limit Redis Store](https://github.com/wyattjoh/rate-limit-redis)
- [RFC 6585 - Additional HTTP Status Codes](https://tools.ietf.org/html/rfc6585#section-4)
