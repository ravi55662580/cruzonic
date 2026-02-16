# Changelog — Contract v1.x

All notable changes to the v1 API contract are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Version numbers follow [SemVer](https://semver.org/).

---

## [1.0.0] — 2024-06-12

**Initial locked contract release.**

### Added

#### REST API (`openapi.yaml`)

**ELD Event Ingestion**
- `POST /v1/eld/events` — Ingest a batch of up to 100 ELD events. Returns `207 Multi-Status` with per-event `accepted` / `rejected` lists.
- `GET /v1/eld/events` — Query events with filters: `driverId`, `eldDeviceId`, `logDate`, `eventType`, `status`, `from`, `to`, `limit`, `cursor`.
- `GET /v1/eld/events/{eventId}` — Retrieve a single event by UUID; optional `?includeHistory=true` returns full audit chain.

**Sequence ID Reservation**
- `POST /v1/eld/sequence-ids/reserve` — Pre-reserve a block of sequence IDs for offline use. Body: `{ eldDeviceId, logDate, count }`. Returns `{ reservationId, logDate, startId, endId, expiresAt }`.

**Log Periods**
- `GET /v1/log-periods` — List log periods with filters: `driverId`, `from`, `to`, `status`, `limit`, `cursor`.
- `GET /v1/log-periods/{logPeriodId}` — Retrieve a single log period including HOS summary and event count.
- `POST /v1/log-periods/{logPeriodId}/certify` — Submit a driver certification (EventType 4) for a log period. Body: `{ driverSignature, certifiedAt }`.

**Hours of Service**
- `GET /v1/hos/{driverId}/current` — Live HOS clock data: cycle used/available, shift elapsed/remaining, drive time remaining, break time used.
- `GET /v1/hos/{driverId}/violations` — List HOS violations with filters: `from`, `to`, `type`, `limit`, `cursor`.

**Compliance Export**
- `POST /v1/compliance/export` — Generate and retrieve an `.erod` file for a driver and date range. Returns a signed download URL.
- `GET /v1/compliance/records/{logPeriodId}` — Retrieve the finalized compliance record for a log period.

**Offline Sync**
- `POST /v1/sync/events` — Offline batch sync endpoint (up to 500 events). Accepts `{ deviceId, syncedUpToAt, events[] }`. Returns `{ accepted[], rejected[], serverEvents[], newSyncedUpToAt }`.
- `GET /v1/sync/status` — Retrieve the server's current `SequenceIdState` and `lastSyncedAt` for a device. Used by mobile to recover after `NON_MONOTONIC` rejection.

**Malfunctions & Diagnostics**
- `POST /v1/eld/malfunctions` — Report an ELD malfunction or diagnostic event (EventType 7).

**Unidentified Driving**
- `GET /v1/eld/unidentified-driving` — List unidentified driving records for a carrier with filters.
- `POST /v1/eld/unidentified-driving/{recordId}/claim` — Driver claims or rejects an unidentified driving period.

**Reusable Schemas**
- `EldEventCommon` — Full event payload schema (all 7 event types via `eventType` discriminator).
- `LocationPayload` — `{ latitude, longitude, distanceFromLastKnown, calculationMethod, nearestCityState }`.
- `VehiclePayload` — `{ cmvPowerUnitNumber, vin, licensePlate, licensePlateState, trailerNumbers[] }`.
- `DriverPayload` — `{ driverEldAccountId, driverLicenseNumber, driverLicenseState, coDriverEldAccountId? }`.
- `EldEventResponse` — Event record as returned by the API (adds `id`, `createdAt`, `updatedAt`, `audit`).
- `LogPeriodResponse` — Log period including `hosSummary` and `eventCount`.
- `HosCurrentResponse` — Live HOS clock fields.
- `ComplianceExportResponse` — `{ downloadUrl, expiresAt, generatedAt, recordCount }`.
- `SequenceIdReservationResponse` — Offline ID block reservation.
- `SyncBatchRequest` / `SyncBatchResponse` — Request and response shapes for `POST /v1/sync/events`.
- `Error` — Standard error envelope: `{ code, message, details? }`.

**Security**
- Bearer JWT authentication on all endpoints (except health checks).
- `X-Contract-Version` request header required — must equal `1.0.0`.
- All traffic over TLS 1.3 (minimum TLS 1.2).

#### Offline Sync Protocol (`sync-protocol.md`)

- Defined SQLite `offline_queue` table schema (columns: `id`, `event_payload`, `log_date`, `sequence_id`, `created_at`, `sync_attempts`, `last_attempt_at`, `status`).
- Unique index `uq_queue_seq` on `(log_date, sequence_id)` for local deduplication.
- Defined four sync trigger conditions: network restored, app foreground, periodic (5 min), manual.
- Sync debouncing — concurrent triggers collapse into a single run.
- Defined `sortOfflineBuffer()` sort order: `log_date` ASC (YYMMDD derived), then `sequence_id` ASC within each log date.
- Batching: up to 500 events per HTTP request; batches are sequential (next batch only starts after previous success).
- Defined `syncedUpToAt` knowledge horizon field.
- Server processing algorithm: sequential per-event validation (schema → checksum → sequence ID → content hash → chain hash → INSERT → state update).
- Partial acceptance: a rejected event does not block subsequent events.
- Six conflict resolution strategies:
  1. **Identical duplicate** — accepted idempotently; existing UUID returned.
  2. **Content-conflict duplicate** — rejected with `DUPLICATE`; requires manual edit flow.
  3. **Non-monotonic ID** — rejected with `NON_MONOTONIC`; device must reload state from `GET /sync/status`.
  4. **Gap detected** — accepted; flagged with `GAP_DETECTED` warning; gaps > 10 IDs generate `LARGE_GAP`.
  5. **Server-side edit** — updated records delivered in `serverEvents`; `requiresDriverReview` events surface review prompt.
  6. **Log period boundary** — events grouped by `logDate`; separate batches in chronological order.
- Retry strategy: exponential backoff — 5 s, 15 s, 60 s, 5 min, 15 min (capped). Stops auto-retry after 5 consecutive failures.
- Observability metrics: `sync.events.accepted`, `sync.events.rejected`, `sync.events.server_returned`, `sync.queue.depth`, `sync.duration_ms`, `sync.retry_count`, `sync.gap_warnings`.

---

<!-- New entries go above this line, newest first -->
