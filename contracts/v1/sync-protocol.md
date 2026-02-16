# Offline Event Sync Protocol — v1.0

How the Cruzonic mobile app synchronises locally-buffered ELD events with the backend API when connectivity is restored.

---

## 1. Overview

The driver app operates under intermittent connectivity (dead zones, tunnels, remote areas). ELD events generated while offline are stored in a local SQLite queue and drained to the server in ordered batches when a network connection becomes available.

The protocol guarantees:
- **No data loss** — every event generated offline reaches the server eventually.
- **Ordering preservation** — the server processes events in the chronological order they were generated.
- **Idempotency** — retrying a failed batch never creates duplicate records.
- **Conflict detection** — server-side edits (carrier corrections) are delivered back to the device.

---

## 2. Client-Side Buffer

### Storage
Events are written to a local SQLite table (`offline_queue`) via `expo-sqlite` immediately upon generation, before any network attempt.

```sql
CREATE TABLE offline_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_payload   TEXT    NOT NULL,  -- JSON of EldEventCommon
  log_date        TEXT    NOT NULL,  -- MMDDYY
  sequence_id     INTEGER NOT NULL,
  created_at      TEXT    NOT NULL,  -- ISO 8601 UTC
  sync_attempts   INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'syncing', 'synced', 'rejected'))
);

CREATE UNIQUE INDEX uq_queue_seq ON offline_queue(log_date, sequence_id);
```

### Sequence ID allocation
Sequence IDs are allocated by `SequenceIdManager` from the local `SequenceIdState` (SQLite-backed) **before** the event is enqueued. This guarantees IDs are monotonically increasing and unique even without network access.

If the device had pre-reserved a block via `POST /v1/eld/sequence-ids/reserve`, IDs are drawn from that reservation. If the reservation is exhausted or absent, IDs are allocated from the local state only and validated by the server on ingestion.

---

## 3. Sync Trigger Conditions

The sync process is triggered:

| Trigger | Condition |
|---|---|
| **Network restored** | `NetInfo` event fires with `isConnected: true` and `isInternetReachable: true` |
| **App foreground** | App transitions from background to foreground with pending queue items |
| **Periodic** | Every 5 minutes when the app is in the foreground and the queue is non-empty |
| **Manual** | Driver explicitly taps "Sync" in the app (bypasses debounce) |

Sync is **debounced** — concurrent triggers collapse into a single sync run.

---

## 4. Sync Request Construction

### Sorting
Before sending, the offline queue is sorted by `sortOfflineBuffer()`:
1. `log_date` ascending (YYMMDD sort key derived from MMDDYY)
2. `sequence_id` ascending within each log date

This ensures the server's monotonicity validator never sees an ID that is out of order relative to an earlier event from the same scope.

### Batching
Events are grouped into batches of up to **500 events** per HTTP request. If the queue contains more than 500 events, multiple sequential requests are sent — the next batch only starts after the previous one completes successfully.

### Payload

```jsonc
// POST /v1/sync/events
{
  "deviceId": "PACTRKV1-SN12345",
  "syncedUpToAt": "2024-06-12T13:00:00Z",  // last successful sync timestamp
  "events": [
    // sorted ascending: log_date ASC, sequence_id ASC
    { /* EldEventCommon for log_date=061224, seq=1 */ },
    { /* EldEventCommon for log_date=061224, seq=2 */ },
    // ... up to 500 events
  ]
}
```

The `syncedUpToAt` field tells the server the client's "knowledge horizon" — the server returns all server-side changes (carrier edits, system events) that occurred after this timestamp.

---

## 5. Server Processing

The server processes each event in the batch **sequentially in order**:

```
For each event in batch (in received order):
  1. Validate JSON schema against the appropriate event-type schema
  2. Verify event_data_check_value (FMCSA checksum)
  3. Run validateSequenceId(proposedId, currentState, existingIds)
     → If errors: add to rejected list, continue to next event
     → If warnings only: log warnings, continue processing
  4. Compute and verify content_hash
  5. Compute chain_hash using previous active event's chain_hash
  6. INSERT into eld_events (with event_record_status=1)
  7. Update sequence_id_states
  8. Add to accepted list
```

**Partial acceptance is allowed.** A rejected event does not stop processing of subsequent events.

---

## 6. Conflict Types and Resolution

### 6a. Duplicate — identical content (idempotent retry)

**Condition:** The server already has an active record for `(eldDeviceId, logPeriodId, eventSequenceId)` with the **same `content_hash`**.

**Resolution:** The server returns the existing record's UUID in the `accepted` list. No error. The client marks the queue item as `synced`.

This handles the common case where the client retried a batch after a timeout.

### 6b. Duplicate — different content (conflict)

**Condition:** The server already has an active record for `(eldDeviceId, logPeriodId, eventSequenceId)` but with a **different `content_hash`**.

**Resolution:** The event is rejected with code `DUPLICATE`. The client must resolve manually:
- If the client's version is the correct one, the driver must use the edit flow (not the sync flow) to correct the record.
- If the server's version is correct, the client discards its version and marks the item `rejected`.

This situation should only occur due to a clock/data corruption issue and is logged as a compliance anomaly.

### 6c. Non-monotonic ID

**Condition:** `proposedId <= lastIssuedId` for this scope (sequence went backwards).

**Resolution:** The event is rejected with code `NON_MONOTONIC`. This indicates the client's local state diverged — the mobile app must reload `SequenceIdState` from the server via `GET /sync/status` before generating new events.

### 6d. Gap detection

**Condition:** `proposedId > lastIssuedId + 1` (one or more IDs were skipped).

**Resolution:** The event is **accepted** (gaps are allowed by 49 CFR Appendix A) but flagged with a `GAP_DETECTED` warning in the sync response. The compliance generator annotates affected log periods. Gaps of more than 10 IDs generate a `LARGE_GAP` warning.

### 6e. Server-side edit conflict

**Condition:** A carrier edit to an event occurred on the server since `syncedUpToAt`. The server has a newer version of an event that the client doesn't have yet.

**Resolution:** The updated event records are returned in `serverEvents` in the sync response. The client must:
1. Replace its local copy of those event records.
2. If the affected event has `requiresDriverReview: true`, surface a review prompt in the UI.
3. Re-derive HOS calculations from the updated event stream.

---

## 7. Sync Response Processing (Client)

```
Receive SyncBatchResponse:

For each id in accepted:
  → Mark offline_queue row as status='synced'

For each item in rejected:
  → Mark offline_queue row as status='rejected'
  → Show error notification to driver (if user-actionable)
  → Log to crash reporter for engineering triage

For each event in serverEvents:
  → Upsert into local event cache (keyed by id)
  → If event.audit.requiresDriverReview → enqueue driver review notification

Persist newSyncedUpToAt:
  → Write to AsyncStorage key "lastSyncedAt"
  → Use as syncedUpToAt in the next sync request
```

---

## 8. Retry Strategy

Failed HTTP requests (network error, 5xx server error) are retried with **exponential backoff**:

| Attempt | Delay |
|---|---|
| 1 (first retry) | 5 seconds |
| 2 | 15 seconds |
| 3 | 60 seconds |
| 4 | 5 minutes |
| 5+ | 15 minutes (capped) |

A request is considered failed if:
- The HTTP response is not received within **30 seconds**
- The response status is `500`, `502`, `503`, or `504`

A `400` or `207` response is **not retried** — it is a definitive server answer. The client processes the accepted/rejected lists and moves on.

After **5 consecutive failures**, the app shows a persistent "Sync failed" banner and stops auto-retrying until the driver manually taps "Retry".

---

## 9. Log Period Boundary Handling

Sequence IDs reset at midnight in the driver's home-terminal timezone. When an offline batch spans a midnight boundary:

1. The client groups events by `logDate` before sending.
2. Events from different log dates are sent in separate batches (earlier date first).
3. The server creates a new `log_periods` row automatically when the first event for a new `(driverId, logDate)` is received.

This ensures the monotonicity validator always operates within the correct scope.

---

## 10. Security

All sync traffic is over TLS 1.3 (minimum TLS 1.2). The client validates the server's certificate against the system trust store — no certificate pinning (to allow inspection proxies in enterprise environments), but the JWT provides mutual authentication.

Event payloads in the offline SQLite queue are **not encrypted at rest** by default. If the carrier's security policy requires at-rest encryption, enable Expo's SQLite encryption extension and set `EXPO_PUBLIC_ENCRYPT_OFFLINE_QUEUE=true`.

---

## 11. Observability

The following metrics are emitted to the backend telemetry pipeline after each sync run:

| Metric | Description |
|---|---|
| `sync.events.accepted` | Count of events successfully ingested |
| `sync.events.rejected` | Count of events rejected by the server |
| `sync.events.server_returned` | Count of server-side changes received |
| `sync.queue.depth` | Queue depth before the sync run |
| `sync.duration_ms` | Total wall-clock time for the sync run |
| `sync.retry_count` | Number of HTTP retries in this sync run |
| `sync.gap_warnings` | Number of sequence gap warnings in server response |
