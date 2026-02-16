-- ============================================================
-- ELD Events Partition Pruning Tests
-- File: test_partition_pruning.sql
--
-- Tests to verify that PostgreSQL query planner correctly
-- prunes partitions when filtering by date ranges.
--
-- Run these queries and examine the EXPLAIN output to verify
-- that only relevant partitions are scanned.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: Single Month Query
-- Expected: Should scan only 1 partition
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  id,
  event_type,
  event_timestamp,
  driver_eld_account_id,
  location_description
from public.eld_events
where event_timestamp >= '2024-06-01'::timestamptz
  and event_timestamp < '2024-07-01'::timestamptz
  and event_record_status = 1
order by event_timestamp desc;

-- Look for: "Partitions scanned: 1" or "Scan on eld_events_y2024m06"

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: Quarter Query (3 months)
-- Expected: Should scan only 3 partitions
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  driver_id,
  count(*) as event_count,
  min(event_timestamp) as first_event,
  max(event_timestamp) as last_event
from public.eld_events
where event_timestamp >= '2024-04-01'::timestamptz
  and event_timestamp < '2024-07-01'::timestamptz
  and event_type = 1  -- Duty status changes only
group by driver_id
order by event_count desc
limit 100;

-- Look for: "Partitions scanned: 3" (April, May, June)

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: Current Month Only
-- Expected: Should scan only current month partition
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  carrier_id,
  event_type,
  count(*) as event_count
from public.eld_events
where event_timestamp >= date_trunc('month', now())
  and event_timestamp < date_trunc('month', now()) + interval '1 month'
group by carrier_id, event_type
order by carrier_id, event_type;

-- Look for: Only one partition in the plan

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: Single Day Query
-- Expected: Should scan only 1 partition
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  event_sequence_id,
  event_type,
  event_sub_type,
  event_timestamp,
  location_description
from public.eld_events
where driver_id = 'uuid-placeholder'::uuid  -- Replace with actual driver_id
  and event_timestamp >= '2024-06-15'::timestamptz
  and event_timestamp < '2024-06-16'::timestamptz
order by event_sequence_id;

-- Look for: Single partition scan

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: Year Query (12 months)
-- Expected: Should scan 12 partitions
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  date_trunc('month', event_timestamp) as month,
  event_type,
  count(*) as event_count
from public.eld_events
where event_timestamp >= '2024-01-01'::timestamptz
  and event_timestamp < '2025-01-01'::timestamptz
group by date_trunc('month', event_timestamp), event_type
order by month, event_type;

-- Look for: "Partitions scanned: 12"

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: No Date Filter (Full Table Scan)
-- Expected: Should scan ALL partitions (anti-pattern)
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select count(*)
from public.eld_events
where event_type = 6;  -- Engine power events

-- Look for: All partitions scanned (this is what we want to AVOID in production)
-- This demonstrates the importance of including date filters

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: Hash Chain Verification (Single Device, Single Day)
-- Expected: Should scan only 1 partition
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
with event_chain as (
  select
    event_sequence_id,
    content_hash,
    chain_hash,
    previous_chain_hash,
    lag(chain_hash) over (order by event_sequence_id) as computed_previous_hash
  from public.eld_events
  where eld_device_id = 'uuid-placeholder'::uuid  -- Replace with actual device_id
    and event_timestamp >= '2024-06-15'::timestamptz
    and event_timestamp < '2024-06-16'::timestamptz
    and event_record_status = 1
  order by event_sequence_id
)
select
  event_sequence_id,
  case
    when previous_chain_hash is null then 'GENESIS'
    when previous_chain_hash = computed_previous_hash then 'VALID'
    else 'BROKEN'
  end as chain_status
from event_chain
where previous_chain_hash is null or previous_chain_hash != computed_previous_hash;

-- Look for: Single partition scan

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: Multi-Driver Timeline (Date Range)
-- Expected: Should scan partitions only for specified date range
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  e.driver_id,
  d.full_name,
  e.event_type,
  e.event_timestamp,
  e.location_description
from public.eld_events e
join public.drivers d on d.id = e.driver_id
where e.carrier_id = 'uuid-placeholder'::uuid  -- Replace with actual carrier_id
  and e.event_timestamp >= now() - interval '7 days'
  and e.event_timestamp < now()
  and e.event_type = 1  -- Duty status changes
order by e.driver_id, e.event_timestamp desc;

-- Look for: Only recent partitions scanned (1-2 depending on current date)

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 9: Partition Boundary Query
-- Expected: Should scan exactly 2 partitions (spanning boundary)
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  count(*) as total_events,
  count(distinct date_trunc('month', event_timestamp)) as months_covered
from public.eld_events
where event_timestamp >= '2024-06-25'::timestamptz
  and event_timestamp < '2024-07-05'::timestamptz;

-- Look for: Exactly 2 partitions scanned (June and July)

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 10: Index-Only Scan Test
-- Expected: Should use covering index without heap access
-- ─────────────────────────────────────────────────────────────────────────────

explain (analyze, buffers, verbose)
select
  driver_id,
  event_date,
  event_time,
  event_type,
  event_sub_type,
  event_record_status,
  location_description
from public.eld_events
where driver_id = 'uuid-placeholder'::uuid  -- Replace with actual driver_id
  and event_timestamp >= now() - interval '1 day'
  and event_timestamp < now()
order by event_date desc, event_time desc;

-- Look for: "Index Only Scan" or "Heap Fetches: 0" (covering index)

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- ─────────────────────────────────────────────────────────────────────────────

-- Show all partitions and their row counts
select * from public.eld_events_partition_info
order by partition_name;

-- Count rows per partition
select
  tableoid::regclass as partition,
  count(*) as row_count,
  min(event_timestamp) as earliest_event,
  max(event_timestamp) as latest_event
from public.eld_events
group by tableoid
order by partition;

-- Show partition constraint for each partition
select
  child.relname as partition_name,
  pg_get_expr(child.relpartbound, child.oid) as partition_constraint
from pg_inherits
join pg_class parent on pg_inherits.inhparent = parent.oid
join pg_class child on pg_inherits.inhrelid = child.oid
where parent.relname = 'eld_events'
order by child.relname;

-- ─────────────────────────────────────────────────────────────────────────────
-- PERFORMANCE COMPARISON
-- Compare partitioned vs non-partitioned query performance
-- ─────────────────────────────────────────────────────────────────────────────

-- If you still have eld_events_old table, you can compare:
-- (This will only work immediately after migration before dropping _old table)

-- Partitioned table query
explain (analyze, buffers, timing on)
select count(*) from public.eld_events
where event_timestamp >= '2024-06-01'::timestamptz
  and event_timestamp < '2024-07-01'::timestamptz;

-- Old table query (if still exists)
-- explain (analyze, buffers, timing on)
-- select count(*) from public.eld_events_old
-- where event_timestamp >= '2024-06-01'::timestamptz
--   and event_timestamp < '2024-07-01'::timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- EXPECTED RESULTS SUMMARY
-- ─────────────────────────────────────────────────────────────────────────────

/*
PARTITION PRUNING SUCCESS INDICATORS:

1. EXPLAIN output should show:
   - "Partitions scanned: N" where N < total partitions
   - "Scan on eld_events_yYYYYmMM" naming specific partition(s)
   - "Pruned partitions: M" showing how many were skipped

2. Query performance improvements:
   - Faster execution time for date-filtered queries
   - Fewer buffer reads
   - Lower planning time

3. Index usage:
   - "Index Scan" or "Index Only Scan" preferred over "Seq Scan"
   - Covering indexes should show "Heap Fetches: 0"

4. Red flags (indicates partition pruning NOT working):
   - "Seq Scan on eld_events" (no specific partition named)
   - All partitions scanned when date filter is present
   - High planning time

TROUBLESHOOTING:

If partition pruning is not working:
1. Ensure WHERE clause uses event_timestamp (the partition key)
2. Use immutable functions in date comparisons (e.g., '2024-06-01'::timestamptz)
3. Avoid OR conditions across different months
4. Check that constraint_exclusion is enabled: SHOW constraint_exclusion;
5. Update statistics: ANALYZE eld_events;

*/
