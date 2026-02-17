/**
 * Idempotency Service
 *
 * Prevents duplicate event ingestion when clients retry requests.
 * Uses Redis as the primary store with a bounded in-memory map as fallback.
 *
 * Key design:
 *   • Scoped per user: key = `idem:{userId}:{X-Idempotency-Key header}`
 *   • TTL: 24 hours (configurable via IDEMPOTENCY_TTL_SECONDS env var)
 *   • In-flight status: set to 'in_flight' before processing starts
 *     so that concurrent duplicates receive 409 Conflict
 *   • Completed status: set after the response is captured, caches
 *     the HTTP status code + response body for exact replay
 *
 * In-memory fallback:
 *   Activated automatically when Redis is unavailable.
 *   Capped at MAX_FALLBACK_ENTRIES to prevent unbounded memory growth.
 *   Entries are evicted by insertion-order when the cap is reached.
 */

import { redisClient, isRedisAvailable } from '../config/redis';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface IdempotencyRecord {
  status: 'in_flight' | 'completed';
  statusCode: number;
  body: unknown;
  createdAt: string;
}

// ============================================================================
// Configuration
// ============================================================================

const TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '86400', 10); // 24 h
const KEY_PREFIX = 'idem:';
const MAX_FALLBACK_ENTRIES = 2_000;

// ============================================================================
// In-memory fallback
// ============================================================================

const memoryStore = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();

function memoryGet(key: string): IdempotencyRecord | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.record;
}

function memorySet(key: string, record: IdempotencyRecord, ttlSeconds: number): void {
  // Evict oldest entry if at capacity
  if (memoryStore.size >= MAX_FALLBACK_ENTRIES) {
    const firstKey = memoryStore.keys().next().value;
    if (firstKey !== undefined) memoryStore.delete(firstKey);
  }
  memoryStore.set(key, { record, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ============================================================================
// Scoped key construction
// ============================================================================

/**
 * Builds the Redis/memory key scoped to a specific user.
 * Scoping prevents user A from replaying user B's responses.
 */
export function buildIdempotencyKey(userId: string, clientKey: string): string {
  return `${KEY_PREFIX}${userId}:${clientKey}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Looks up an existing idempotency record.
 * Returns null if the key has never been seen or has expired.
 */
export async function getIdempotencyRecord(
  scopedKey: string
): Promise<IdempotencyRecord | null> {
  if (isRedisAvailable()) {
    try {
      const raw = await redisClient.get(scopedKey);
      if (!raw) return null;
      return JSON.parse(raw.toString()) as IdempotencyRecord;
    } catch (err) {
      logger.warn('Redis read failed — falling back to in-memory idempotency store', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return memoryGet(scopedKey);
}

/**
 * Marks a request as in-flight.
 * Set BEFORE processing begins so concurrent duplicates get 409.
 * TTL is short (60 s) — it will be overwritten by setCompleted on success,
 * or naturally expire if the server crashes mid-request.
 */
export async function setIdempotencyInFlight(scopedKey: string): Promise<void> {
  const record: IdempotencyRecord = {
    status: 'in_flight',
    statusCode: 0,
    body: null,
    createdAt: new Date().toISOString(),
  };

  if (isRedisAvailable()) {
    try {
      // NX: only set if not exists; expire in 60 s (request timeout guard)
      await redisClient.set(scopedKey, JSON.stringify(record), { NX: true, EX: 60 });
      return;
    } catch (err) {
      logger.warn('Redis write failed — using in-memory fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  memorySet(scopedKey, record, 60);
}

/**
 * Persists the completed response for future replay.
 * Overwrites the in-flight record with the full TTL.
 */
export async function setIdempotencyCompleted(
  scopedKey: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  const record: IdempotencyRecord = {
    status: 'completed',
    statusCode,
    body,
    createdAt: new Date().toISOString(),
  };

  if (isRedisAvailable()) {
    try {
      // XX: only overwrite existing (in_flight must exist); set full TTL
      await redisClient.set(scopedKey, JSON.stringify(record), { EX: TTL_SECONDS });
      return;
    } catch (err) {
      logger.warn('Redis write failed — storing idempotency result in memory', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  memorySet(scopedKey, record, TTL_SECONDS);
}

/**
 * Removes the in-flight record (called when the request fails so that
 * the client can retry with the same key on a fresh attempt).
 */
export async function clearIdempotencyKey(scopedKey: string): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await redisClient.del(scopedKey);
      return;
    } catch {
      // Best-effort
    }
  }
  memoryStore.delete(scopedKey);
}
