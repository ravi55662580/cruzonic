/**
 * Retry Service
 *
 * Provides exponential backoff with jitter for transient failures.
 *
 * Configuration (user-requested):
 *   base delay  : 1 second
 *   max delay   : 30 seconds
 *   max retries : 5
 *   jitter      : uniform random in [0, min(base * 0.5, 500ms)]
 *
 * Delay formula per attempt n (1-indexed):
 *   delay = clamp(base * 2^(n-1), 0, maxDelay) + jitter
 *
 * Attempt delays (approximate, excluding jitter):
 *   1 →  1 s    2 →  2 s    3 →  4 s    4 →  8 s    5 → 16 s
 *
 * Transient error classification covers:
 *   • Network: ECONNREFUSED, ETIMEDOUT, ENOTFOUND, FetchError
 *   • PostgreSQL: deadlock, serialization failure, too many connections
 *   • Supabase / connection pool: connection terminated, client closed
 */

import { logger } from '../utils/logger';

// ============================================================================
// Configuration
// ============================================================================

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 5 */
  maxAttempts?: number;
  /** Base delay in ms for the first retry. Default: 1000 */
  baseDelayMs?: number;
  /** Hard cap on delay in ms. Default: 30_000 */
  maxDelayMs?: number;
  /** Label used in log messages to identify the operation. */
  context?: string;
  /** Override the transient-error classifier. */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULTS: Required<Omit<RetryOptions, 'context' | 'isRetryable'>> = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

// ============================================================================
// Transient error classification
// ============================================================================

/**
 * Returns true if the error represents a transient condition that is safe to
 * retry.  Non-transient errors (validation, auth, duplicate key, etc.) will
 * always fail on retry and should be surfaced immediately.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const msg = error.message.toLowerCase();

  return (
    // Network / DNS
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('enetunreach') ||
    msg.includes('econnreset') ||
    msg.includes('fetcherror') ||
    msg.includes('network') ||
    // Generic timeout
    msg.includes('timeout') ||
    // PostgreSQL transient conditions
    msg.includes('deadlock detected') ||
    msg.includes('deadlock') ||
    msg.includes('could not serialize') ||     // serialization failure (REPEATABLE READ)
    msg.includes('too many connections') ||
    msg.includes('connection terminated') ||
    msg.includes('connection refused') ||
    msg.includes('server closed the connection') ||
    // Supabase / PostgREST
    msg.includes('client was closed') ||
    msg.includes('upstream connect error') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable')
  );
}

// ============================================================================
// Delay calculation
// ============================================================================

/**
 * Calculates the delay before the next retry attempt.
 *
 * Uses full exponential backoff with uniform jitter:
 *   delay = clamp(base * 2^(attempt-1), 0, maxDelay) + jitter
 *   jitter = random(0, min(base * 0.5, 500))
 *
 * @param attempt 1-indexed attempt number that just failed.
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitterCap = Math.min(baseDelayMs * 0.5, 500);
  const jitter = Math.random() * jitterCap;
  return Math.round(exponential + jitter);
}

// ============================================================================
// Core retry wrapper
// ============================================================================

/**
 * Executes `operation` with exponential backoff + jitter on transient errors.
 *
 * Non-transient errors are thrown immediately without retrying.
 * If all attempts are exhausted the last error is re-thrown.
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => supabase.from('eld_events').insert(row).single(),
 *   { context: 'ingestEvent', maxAttempts: 5 }
 * );
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const context = options.context ?? 'operation';
  const classifier = options.isRetryable ?? isTransientError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();

      if (attempt > 1) {
        logger.info('Retry succeeded', {
          context,
          attempt,
          totalAttempts: maxAttempts,
        });
      }

      return result;
    } catch (error) {
      lastError = error;

      const transient = classifier(error);
      const isLastAttempt = attempt === maxAttempts;

      if (!transient) {
        // Non-transient: surface immediately, no point retrying
        logger.warn('Non-transient error — not retrying', {
          context,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      if (isLastAttempt) {
        logger.error('All retry attempts exhausted', {
          context,
          attempts: attempt,
          maxAttempts,
          finalError: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs);

      logger.warn('Transient error — retrying with backoff', {
        context,
        attempt,
        maxAttempts,
        delayMs,
        reason: error instanceof Error ? error.message : String(error),
        nextAttempt: attempt + 1,
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
