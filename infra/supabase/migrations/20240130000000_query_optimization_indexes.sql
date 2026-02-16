-- ============================================================
-- Query Optimization Indexes
-- Migration: 20240130000000_query_optimization_indexes.sql
--
-- Adds indexes optimized for the most common query patterns:
-- 1. Driver's events for 24-hour period
-- 2. HOS remaining time calculations
-- 3. Unidentified driving records
-- 4. Daily log summary
-- 5. FMCSA export format
--
-- Target: Sub-100ms response time for all common queries
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- ELD EVENTS QUERY OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite index for fetching driver's events by date range
-- Usage: Daily log queries, timeline views
-- Query pattern: WHERE driver_id = ? AND event_timestamp BETWEEN ? AND ?
create index if not exists idx_eld_events_driver_timestamp_composite
  on public.eld_events(driver_id, event_timestamp desc, event_record_status)
  where event_record_status = 1; -- Only active records

comment on index idx_eld_events_driver_timestamp_composite is
  'Optimizes driver timeline queries. Covers: driver_id + timestamp range + active status filter.';

-- Composite index for log period queries
-- Usage: Daily log generation, certification
-- Query pattern: WHERE log_period_id = ? AND event_sequence_id
create index if not exists idx_eld_events_period_sequence_composite
  on public.eld_events(log_period_id, event_sequence_id, event_type)
  where event_record_status = 1;

comment on index idx_eld_events_period_sequence_composite is
  'Optimizes log period event retrieval in sequence order.';

-- Index for event type filtering with timestamp
-- Usage: Duty status changes, HOS calculations
-- Query pattern: WHERE driver_id = ? AND event_type = 1 AND event_timestamp BETWEEN ? AND ?
create index if not exists idx_eld_events_driver_type_timestamp
  on public.eld_events(driver_id, event_type, event_timestamp desc)
  where event_record_status = 1 and event_type = 1; -- Duty status events only

comment on index idx_eld_events_driver_type_timestamp is
  'Optimizes duty status change queries (EventType 1) for HOS calculations.';

-- Index for carrier-wide queries with date filter
-- Usage: Fleet-wide reports, compliance monitoring
-- Query pattern: WHERE carrier_id = ? AND event_date = ?
create index if not exists idx_eld_events_carrier_date_composite
  on public.eld_events(carrier_id, event_date, event_type)
  where event_record_status = 1;

comment on index idx_eld_events_carrier_date_composite is
  'Optimizes carrier-wide daily reports and compliance queries.';

-- Index for partition pruning with event_timestamp
-- Already exists: idx_eld_events_driver_ts (from partition migration)
-- This helps with BETWEEN queries on partitioned table

-- ─────────────────────────────────────────────────────────────────────────────
-- DUTY STATUS RECORDS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite index for active duty status queries
-- Usage: Current driver status, HOS calculations
-- Query pattern: WHERE driver_id = ? AND ended_at IS NULL
create index if not exists idx_duty_status_driver_active
  on public.duty_status_records(driver_id, started_at desc)
  where ended_at is null;

comment on index idx_duty_status_driver_active is
  'Finds current active duty status for a driver (WHERE ended_at IS NULL).';

-- Composite index for duty status timeline
-- Usage: Daily log summaries, HOS window calculations
-- Query pattern: WHERE driver_id = ? AND started_at >= ? AND started_at < ?
create index if not exists idx_duty_status_driver_time_range
  on public.duty_status_records(driver_id, started_at desc, ended_at desc, duty_status);

comment on index idx_duty_status_driver_time_range is
  'Optimizes duty status timeline queries for HOS calculations.';

-- Index for duty status aggregations by log period
-- Query pattern: WHERE log_period_id = ? AND duty_status = ?
create index if not exists idx_duty_status_period_status
  on public.duty_status_records(log_period_id, duty_status, duration_minutes);

comment on index idx_duty_status_period_status is
  'Optimizes aggregations of duty status by type (driving, on-duty, etc.).';

-- ─────────────────────────────────────────────────────────────────────────────
-- LOG PERIODS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite index for driver's log periods by date
-- Query pattern: WHERE driver_id = ? AND log_date BETWEEN ? AND ?
create index if not exists idx_log_periods_driver_date_range
  on public.log_periods(driver_id, log_date desc, status);

comment on index idx_log_periods_driver_date_range is
  'Optimizes queries for driver log periods within a date range.';

-- Index for uncertified logs (compliance alerts)
-- Query pattern: WHERE driver_id = ? AND status = 'open' AND log_date < ?
create index if not exists idx_log_periods_driver_uncertified
  on public.log_periods(driver_id, log_date desc)
  where status in ('open', 'closed'); -- Not yet certified

comment on index idx_log_periods_driver_uncertified is
  'Finds uncertified log periods for compliance alerts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- HOS CALCULATIONS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite index for current HOS status
-- Query pattern: WHERE driver_id = ? ORDER BY calculated_at DESC LIMIT 1
create index if not exists idx_hos_calc_driver_latest
  on public.hos_calculations(driver_id, calculated_at desc);

comment on index idx_hos_calc_driver_latest is
  'Finds latest HOS calculation for a driver (current remaining time).';

-- Index for HOS calculations by log period
create index if not exists idx_hos_calc_period
  on public.hos_calculations(log_period_id, calculated_at desc);

comment on index idx_hos_calc_period is
  'Retrieves HOS calculations for a specific log period.';

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIDENTIFIED DRIVER RECORDS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite index for pending unidentified records by vehicle
-- Query pattern: WHERE vehicle_id = ? AND status = 'pending' ORDER BY started_at DESC
create index if not exists idx_udr_vehicle_pending
  on public.unidentified_driver_records(vehicle_id, started_at desc)
  where status = 'pending';

comment on index idx_udr_vehicle_pending is
  'Finds pending unidentified driving records for a vehicle.';

-- Composite index for carrier-wide unidentified records
-- Query pattern: WHERE carrier_id = ? AND status = 'pending' AND started_at >= ?
create index if not exists idx_udr_carrier_pending_time
  on public.unidentified_driver_records(carrier_id, started_at desc)
  where status = 'pending';

comment on index idx_udr_carrier_pending_time is
  'Finds all pending unidentified records for a carrier (compliance dashboard).';

-- Index for aging unidentified records (>8 days = violation)
-- Query pattern: WHERE carrier_id = ? AND status = 'pending' AND started_at < now() - interval '8 days'
create index if not exists idx_udr_aging
  on public.unidentified_driver_records(carrier_id, started_at)
  where status = 'pending';

comment on index idx_udr_aging is
  'Finds aging unidentified records approaching 8-day violation threshold.';

-- ─────────────────────────────────────────────────────────────────────────────
-- CERTIFICATIONS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Index for driver's certifications by date
-- Query pattern: WHERE certified_driver_id = ? AND certified_log_date = ?
create index if not exists idx_cert_driver_date
  on public.certifications(certified_driver_id, certified_log_date desc);

comment on index idx_cert_driver_date is
  'Finds certifications for a driver by log date.';

-- Index for uncertified logs (via log_periods join)
-- Already covered by log_periods indexes

-- ─────────────────────────────────────────────────────────────────────────────
-- DRIVERS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Index for carrier's active drivers
-- Query pattern: WHERE carrier_id = ? AND status IN ('available', 'on_trip')
create index if not exists idx_drivers_carrier_status
  on public.drivers(carrier_id, status, full_name)
  where status in ('available', 'on_trip', 'offline'); -- Active statuses

comment on index idx_drivers_carrier_status is
  'Finds active drivers for a carrier (dashboard, dispatch).';

-- Index for driver lookup by license
-- Query pattern: WHERE license_number = ? AND license_state = ?
create index if not exists idx_drivers_license
  on public.drivers(license_number, license_state);

comment on index idx_drivers_license is
  'Lookup driver by license number and state (FMCSA verification).';

-- ─────────────────────────────────────────────────────────────────────────────
-- VEHICLES OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Index for carrier's active vehicles
create index if not exists idx_vehicles_carrier_status
  on public.vehicles(carrier_id, status, power_unit_number)
  where status = 'active';

comment on index idx_vehicles_carrier_status is
  'Finds active vehicles for a carrier.';

-- ─────────────────────────────────────────────────────────────────────────────
-- HOS VIOLATIONS OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Index for active violations by driver
-- Query pattern: WHERE driver_id = ? AND ended_at IS NULL
create index if not exists idx_hos_viol_driver_active
  on public.hos_violations(driver_id, started_at desc)
  where ended_at is null;

comment on index idx_hos_viol_driver_active is
  'Finds active (ongoing) HOS violations for a driver.';

-- Index for carrier violation reports
-- Query pattern: WHERE carrier_id = ? AND started_at >= ? ORDER BY started_at DESC
create index if not exists idx_hos_viol_carrier_time
  on public.hos_violations(carrier_id, started_at desc, violation_type);

comment on index idx_hos_viol_carrier_time is
  'Carrier-wide violation reports by date range.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ANALYSIS AND VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

comment on schema public is
  'Query optimization indexes added 2024-01-30.

Common Query Patterns Optimized:
1. Driver timeline (24-hour): idx_eld_events_driver_timestamp_composite
2. HOS calculations: idx_eld_events_driver_type_timestamp, idx_duty_status_driver_time_range
3. Unidentified records: idx_udr_vehicle_pending, idx_udr_carrier_pending_time
4. Daily summaries: idx_eld_events_period_sequence_composite, idx_duty_status_period_status
5. FMCSA exports: idx_eld_events_period_sequence_composite

Performance Target: Sub-100ms for all common queries

Index Strategy:
- Composite indexes covering WHERE + ORDER BY + SELECT columns
- Partial indexes (WHERE clauses) for common filters
- DESC ordering for timeline queries (most recent first)
- Covering indexes to avoid table lookups

Verification:
Run EXPLAIN ANALYZE on common queries to verify index usage.
See: backend/src/scripts/benchmark-queries.ts
';

-- ─────────────────────────────────────────────────────────────────────────────
-- STATISTICS UPDATE
-- ─────────────────────────────────────────────────────────────────────────────

-- Update table statistics for better query planning
analyze public.eld_events;
analyze public.duty_status_records;
analyze public.log_periods;
analyze public.hos_calculations;
analyze public.unidentified_driver_records;
analyze public.drivers;
analyze public.vehicles;
analyze public.certifications;
analyze public.hos_violations;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEX MAINTENANCE NOTES
-- ─────────────────────────────────────────────────────────────────────────────

comment on table public.eld_events is
  'ELD event records with optimized indexes for common queries.

Index Maintenance:
- REINDEX periodically on high-write tables (monthly recommended)
- ANALYZE after bulk inserts (>10,000 rows)
- Monitor index bloat with pg_stat_user_indexes
- Consider BRIN indexes for very large partitions (>10M rows)

Performance Monitoring:
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = ''public''
ORDER BY idx_scan DESC;

Unused Indexes:
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = ''public'' AND idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
';
