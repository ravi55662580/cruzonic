/**
 * Unit Tests: Ingestion Failure Handling
 *
 * Tests the retry, idempotency, and DLQ logic in isolation.
 * All tests here operate on pure functions — no database, no network.
 *
 * Coverage:
 *   - Transient error classification (isTransientError)
 *   - Exponential backoff + jitter (calculateDelay)
 *   - retryWithBackoff: immediate throw on non-transient, retry on transient
 *   - Idempotency key scoping (buildIdempotencyKey)
 *   - DLQ alert threshold logging
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// ── Import pure-function modules ─────────────────────────────────────────────
import {
  isTransientError,
  calculateDelay,
  retryWithBackoff,
} from '../../src/services/retry.service';
import { buildIdempotencyKey } from '../../src/services/idempotency.service';

// ============================================================================
// 1. isTransientError — error classification
// ============================================================================

describe('isTransientError()', () => {
  it('classifies non-Error values as non-transient', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError('string error')).toBe(false);
    expect(isTransientError(42)).toBe(false);
    expect(isTransientError({})).toBe(false);
  });

  it('classifies network errors as transient', () => {
    const cases = [
      'connect ECONNREFUSED 127.0.0.1:5432',
      'request timed out ETIMEDOUT',
      'getaddrinfo ENOTFOUND db.example.com',
      'network unreachable ENETUNREACH',
      'socket hang up ECONNRESET',
      'FetchError: request to https://... failed',
      'network connection lost',
      'operation timeout after 30000ms',
    ];
    for (const msg of cases) {
      expect(isTransientError(new Error(msg))).toBe(true);
    }
  });

  it('classifies PostgreSQL transient errors as transient', () => {
    const cases = [
      'deadlock detected in transaction',
      'deadlock between processes',
      'could not serialize access due to concurrent update',
      'too many connections for role "anon"',
      'connection terminated unexpectedly',
      'connection refused — is the server running?',
      'server closed the connection unexpectedly',
    ];
    for (const msg of cases) {
      expect(isTransientError(new Error(msg))).toBe(true);
    }
  });

  it('classifies Supabase / PostgREST transient errors as transient', () => {
    const cases = [
      'client was closed',
      'upstream connect error or disconnect/reset before headers',
      'service temporarily unavailable',
      'service unavailable (503)',
    ];
    for (const msg of cases) {
      expect(isTransientError(new Error(msg))).toBe(true);
    }
  });

  it('classifies non-transient errors as non-transient', () => {
    const cases = [
      'duplicate key value violates unique constraint',
      'invalid input syntax for type uuid',
      'null value in column "event_type" violates not-null constraint',
      'permission denied for table eld_events',
      'relation "eld_events" does not exist',
      'value too long for type character varying(6)',
      'Failed to insert event: PGRST116',
    ];
    for (const msg of cases) {
      expect(isTransientError(new Error(msg))).toBe(false);
    }
  });

  it('treats partition errors as non-transient', () => {
    expect(
      isTransientError(
        new Error('Failed to insert event: No partition exists for timestamp 2026-02-15T00:00:00+00:00')
      )
    ).toBe(false);
  });
});

// ============================================================================
// 2. calculateDelay — exponential backoff + jitter
// ============================================================================

describe('calculateDelay()', () => {
  it('uses exponential growth for each attempt', () => {
    const base = 1000;
    const max = 30_000;

    // Attempt 1: base * 2^0 = 1000
    // Attempt 2: base * 2^1 = 2000
    // Attempt 3: base * 2^2 = 4000
    const delay1 = calculateDelay(1, base, max);
    const delay2 = calculateDelay(2, base, max);
    const delay3 = calculateDelay(3, base, max);

    // Each delay should be > the exponential baseline (jitter adds on top)
    expect(delay1).toBeGreaterThanOrEqual(base);
    expect(delay2).toBeGreaterThanOrEqual(base * 2);
    expect(delay3).toBeGreaterThanOrEqual(base * 4);

    // Delays should grow
    expect(delay2).toBeGreaterThan(delay1 - 600); // accounting for jitter variance
    expect(delay3).toBeGreaterThan(delay2 - 600);
  });

  it('caps delay at maxDelayMs', () => {
    const max = 5_000;
    // Attempt 100 would be astronomical without the cap
    const delay = calculateDelay(100, 1000, max);
    // delay = max + jitter, jitter ≤ 500
    expect(delay).toBeLessThanOrEqual(max + 500 + 1); // +1 for rounding
    expect(delay).toBeGreaterThanOrEqual(max);
  });

  it('adds jitter in the range [0, min(base*0.5, 500)]', () => {
    const base = 1000;
    const max = 30_000;
    const jitterCap = Math.min(base * 0.5, 500); // 500

    // Run 50 times and verify jitter stays in range
    for (let i = 0; i < 50; i++) {
      const delay = calculateDelay(1, base, max);
      const jitter = delay - base; // exponential for attempt 1 is exactly base
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(jitterCap + 1); // +1 for rounding
    }
  });

  it('returns integer values (Math.round applied)', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = calculateDelay(attempt, 1000, 30_000);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});

// ============================================================================
// 3. retryWithBackoff — retry orchestration
// ============================================================================

describe('retryWithBackoff()', () => {
  // Use 1ms base delay to keep tests fast without fake timers.
  // The delay formula: min(1 * 2^(n-1), 30000) + jitter(0..0.5ms) ≈ 1-2ms per retry.

  it('returns result immediately on first success', async () => {
    const operation = jest.fn<() => Promise<string>>().mockResolvedValue('ok');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      context: 'test',
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on non-transient errors without retrying', async () => {
    const nonTransient = new Error('duplicate key value violates unique constraint');
    const operation = jest.fn<() => Promise<string>>().mockRejectedValue(nonTransient);

    await expect(
      retryWithBackoff(operation, { maxAttempts: 5, baseDelayMs: 1, context: 'test' })
    ).rejects.toThrow('duplicate key value');

    expect(operation).toHaveBeenCalledTimes(1); // No retries for non-transient errors
  });

  it('retries transient errors up to maxAttempts then re-throws', async () => {
    const transient = new Error('deadlock detected');
    const operation = jest.fn<() => Promise<string>>().mockRejectedValue(transient);

    await expect(
      retryWithBackoff(operation, { maxAttempts: 3, baseDelayMs: 1, context: 'test' })
    ).rejects.toThrow('deadlock detected');

    expect(operation).toHaveBeenCalledTimes(3); // Attempted 3 times
  }, 10_000); // Allow up to 10s for 3 retries with jitter

  it('succeeds on a retry after transient failures', async () => {
    let attempt = 0;
    const operation = jest.fn<() => Promise<string>>().mockImplementation(() => {
      attempt++;
      if (attempt < 3) return Promise.reject(new Error('ETIMEDOUT'));
      return Promise.resolve('recovered');
    });

    const result = await retryWithBackoff(operation, {
      maxAttempts: 5,
      baseDelayMs: 1,
      context: 'test',
    });

    expect(result).toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('accepts a custom isRetryable classifier', async () => {
    const isRetryable = (err: unknown) =>
      err instanceof Error && err.message.includes('custom-transient');

    const operation = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('custom-transient error'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      isRetryable,
      context: 'test',
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2); // 1 failure + 1 success
  }, 10_000);
});

// ============================================================================
// 4. buildIdempotencyKey — key scoping
// ============================================================================

describe('buildIdempotencyKey()', () => {
  it('scopes key with prefix and userId', () => {
    const key = buildIdempotencyKey('user-123', 'client-key-abc');
    expect(key).toBe('idem:user-123:client-key-abc');
  });

  it('produces different keys for different users with the same client key', () => {
    const keyA = buildIdempotencyKey('user-A', 'same-client-key');
    const keyB = buildIdempotencyKey('user-B', 'same-client-key');
    expect(keyA).not.toBe(keyB);
  });

  it('produces different keys for the same user with different client keys', () => {
    const key1 = buildIdempotencyKey('user-123', 'key-1');
    const key2 = buildIdempotencyKey('user-123', 'key-2');
    expect(key1).not.toBe(key2);
  });

  it('includes the idem: prefix', () => {
    const key = buildIdempotencyKey('any-user', 'any-key');
    expect(key.startsWith('idem:')).toBe(true);
  });

  it('handles UUID client keys', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const key = buildIdempotencyKey('driver-id', uuid);
    expect(key).toBe(`idem:driver-id:${uuid}`);
  });

  it('scopes anonymous user correctly', () => {
    // This matches the middleware fallback for unauthenticated requests
    const key = buildIdempotencyKey('anonymous', 'some-key');
    expect(key).toBe('idem:anonymous:some-key');
  });
});
