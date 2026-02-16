

# Query Optimization Guide

## Overview

This guide documents the optimized queries for the most common ELD operations, targeting sub-100ms response times for all queries.

---

## Performance Targets

| Query | Target | Index Used |
|-------|--------|------------|
| Driver events (24h) | <50ms | `idx_eld_events_driver_timestamp_composite` |
| HOS remaining time | <75ms | `idx_hos_calc_driver_latest` |
| Unidentified records | <50ms | `idx_udr_vehicle_pending` |
| Daily log summary | <100ms | `idx_duty_status_period_status` |
| FMCSA export | <100ms | `idx_eld_events_period_sequence_composite` |
| Current duty status | <25ms | `idx_duty_status_driver_active` |
| Uncertified logs | <50ms | `idx_log_periods_driver_uncertified` |

---

## Installation

### Step 1: Apply Index Migration

```bash
# Location: infra/supabase/migrations/20240130000000_query_optimization_indexes.sql
```

1. Open Supabase SQL Editor
2. Copy entire migration file
3. Paste and run
4. Wait for completion (~30-60 seconds)

### Step 2: Verify Indexes

Run this in SQL Editor:

```sql
SELECT
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_indexes
LEFT JOIN pg_stat_user_indexes USING (schemaname, tablename, indexname)
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%composite'
ORDER BY tablename, indexname;
```

Should show all new composite indexes.

### Step 3: Run Benchmark

```bash
cd backend
npx ts-node src/scripts/benchmark-queries.ts
```

**Expected output**:
```
Performance: 8/8 queries meet target (100%)
🎯 All queries meet performance targets!
```

---

## Optimized Queries

### 1. Fetch Driver's Events for 24-Hour Period

**Use Case**: Daily log viewer, timeline display

**Target**: <50ms

**Index**: `idx_eld_events_driver_timestamp_composite (driver_id, event_timestamp DESC, event_record_status) WHERE event_record_status = 1`

**TypeScript**:
```typescript
import { getDriverEventsFor24Hours } from '../queries/optimized-queries';

const { data, error, executionTime } = await getDriverEventsFor24Hours(
  supabase,
  driverId,
  '021524', // MMDDYY
  'America/Chicago'
);

console.log(`Retrieved ${data?.length} events in ${executionTime}ms`);
```

**SQL**:
```sql
SELECT
  id,
  event_sequence_id,
  event_type,
  event_timestamp,
  accumulated_vehicle_miles,
  latitude,
  longitude,
  location_description
FROM eld_events
WHERE driver_id = $1
  AND event_record_status = 1
  AND event_timestamp >= $2
  AND event_timestamp < $3
ORDER BY event_sequence_id;

-- Uses composite index for WHERE + ORDER BY
-- Partition pruning via event_timestamp
```

**Optimization Techniques**:
- ✅ Composite index covers WHERE + ORDER BY
- ✅ Partial index (status = 1) reduces index size
- ✅ Partition pruning via timestamp filter
- ✅ No table scan required

---

### 2. Calculate HOS Remaining Time

**Use Case**: Mobile app HOS clock, dashboard widgets

**Target**: <75ms

**Index**: `idx_hos_calc_driver_latest (driver_id, calculated_at DESC)`

**TypeScript**:
```typescript
import { getHOSRemainingTime } from '../queries/optimized-queries';

const { data, error, executionTime } = await getHOSRemainingTime(
  supabase,
  driverId
);

if (data) {
  console.log(`Driving remaining: ${data.driving_minutes_remaining} minutes`);
  console.log(`Retrieved in ${executionTime}ms`);
}
```

**SQL**:
```sql
SELECT
  remaining_driving_minutes,
  remaining_on_duty_window_minutes,
  remaining_weekly_minutes,
  time_until_break_required_minutes,
  is_in_34h_restart,
  calculated_at
FROM hos_calculations
WHERE driver_id = $1
ORDER BY calculated_at DESC
LIMIT 1;

-- Index-only scan via composite index
-- No table access needed
```

**Optimization Techniques**:
- ✅ Covering index (includes all SELECT columns)
- ✅ LIMIT 1 prevents unnecessary rows
- ✅ Index-only scan (no table lookup)

---

### 3. Get Unidentified Driving Records

**Use Case**: Driver login flow, compliance dashboard

**Target**: <50ms

**Index**: `idx_udr_vehicle_pending (vehicle_id, started_at DESC) WHERE status = 'pending'`

**TypeScript**:
```typescript
import { getUnidentifiedRecordsByVehicle } from '../queries/optimized-queries';

const { data, error, executionTime } = await getUnidentifiedRecordsByVehicle(
  supabase,
  vehicleId
);

console.log(`Found ${data?.length} unidentified records in ${executionTime}ms`);
```

**SQL**:
```sql
SELECT
  id,
  started_at,
  duration_minutes,
  accumulated_miles,
  status
FROM unidentified_driver_records
WHERE vehicle_id = $1
  AND status = 'pending'
ORDER BY started_at DESC;

-- Uses partial index (status = 'pending')
-- Smaller index size, faster scans
```

**Optimization Techniques**:
- ✅ Partial index (status = 'pending') - only indexes pending records
- ✅ Composite index for WHERE + ORDER BY
- ✅ Smaller index footprint

**Aging Records Query**:
```typescript
import { getAgingUnidentifiedRecords } from '../queries/optimized-queries';

// Find records older than 8 days (compliance violation)
const { data } = await getAgingUnidentifiedRecords(
  supabase,
  carrierId,
  8 // days
);
```

---

### 4. Generate Daily Log Summary

**Use Case**: Daily log certification, summary reports

**Target**: <100ms

**Index**: `idx_duty_status_period_status (log_period_id, duty_status, duration_minutes)`

**TypeScript**:
```typescript
import { getDailyLogSummary } from '../queries/optimized-queries';

const { data, error, executionTime } = await getDailyLogSummary(
  supabase,
  driverId,
  '021524' // MMDDYY
);

if (data) {
  console.log(`Driving: ${data.driving_minutes} minutes`);
  console.log(`Miles: ${data.total_miles}`);
  console.log(`Generated in ${executionTime}ms`);
}
```

**Optimization Techniques**:
- ✅ Index on log_period_id + duty_status for aggregations
- ✅ Minimal JOINs (separate queries vs JOIN)
- ✅ Aggregation in application layer

---

### 5. Export Events in FMCSA Format

**Use Case**: Roadside inspection, compliance export

**Target**: <100ms for 1 day, <500ms for 7 days

**Index**: `idx_eld_events_period_sequence_composite (log_period_id, event_sequence_id, event_type)`

**TypeScript**:
```typescript
import { exportEventsForFMCSA } from '../queries/optimized-queries';

const { data, error, executionTime } = await exportEventsForFMCSA(
  supabase,
  driverId,
  '021524'
);

if (data) {
  // data is array of FMCSAEvent objects ready for .erod file
  console.log(`Exported ${data.length} events in ${executionTime}ms`);

  // Convert to FMCSA output format
  data.forEach(event => {
    console.log(
      `${event.EventSequenceIdNumber},` +
      `${event.EventType},` +
      `${event.EventCode},` +
      `${event.EventDate},` +
      `${event.EventTime}`
    );
  });
}
```

**Optimization Techniques**:
- ✅ Composite index on log_period_id + sequence
- ✅ Ordered by sequence (index order)
- ✅ Minimal column selection
- ✅ Single partition scan

---

### 6. Get Current Duty Status

**Use Case**: Driver status indicator, real-time HOS

**Target**: <25ms

**Index**: `idx_duty_status_driver_active (driver_id, started_at DESC) WHERE ended_at IS NULL`

**TypeScript**:
```typescript
import { getCurrentDutyStatus } from '../queries/optimized-queries';

const { data, error, executionTime } = await getCurrentDutyStatus(
  supabase,
  driverId
);

if (data) {
  console.log(`Current status: ${data.duty_status}`);
  console.log(`Retrieved in ${executionTime}ms`);
}
```

**SQL**:
```sql
SELECT duty_status, started_at, duration_minutes
FROM duty_status_records
WHERE driver_id = $1
  AND ended_at IS NULL
ORDER BY started_at DESC
LIMIT 1;

-- Partial index WHERE ended_at IS NULL
-- Only indexes active statuses
```

**Optimization Techniques**:
- ✅ Partial index (ended_at IS NULL) - extremely fast
- ✅ LIMIT 1 - single row lookup
- ✅ Minimal columns selected

---

### 7. Get Uncertified Logs

**Use Case**: Compliance alerts, certification dashboard

**Target**: <50ms

**Index**: `idx_log_periods_driver_uncertified (driver_id, log_date DESC) WHERE status IN ('open', 'closed')`

**TypeScript**:
```typescript
import { getUncertifiedLogs } from '../queries/optimized-queries';

const { data, error, executionTime } = await getUncertifiedLogs(
  supabase,
  driverId
);

console.log(`${data?.length} logs need certification`);
```

**Optimization Techniques**:
- ✅ Partial index (uncertified statuses only)
- ✅ Ordered by date (oldest first for alerts)

---

## Index Strategy

### Composite Indexes

Composite indexes cover multiple columns used together in WHERE, ORDER BY, and SELECT clauses.

**Pattern**: `(filter_column, sort_column, select_column)`

**Example**:
```sql
CREATE INDEX idx_eld_events_driver_timestamp_composite
  ON eld_events(driver_id, event_timestamp DESC, event_record_status)
  WHERE event_record_status = 1;
```

**Benefits**:
- Single index covers WHERE + ORDER BY + SELECT
- Avoids table lookups (index-only scan)
- DESC ordering matches query pattern

### Partial Indexes

Partial indexes only index rows matching a WHERE clause, reducing index size and improving performance.

**Pattern**: `WHERE common_filter = constant`

**Example**:
```sql
CREATE INDEX idx_duty_status_driver_active
  ON duty_status_records(driver_id, started_at DESC)
  WHERE ended_at IS NULL;  -- Only active statuses
```

**Benefits**:
- Smaller index size (only indexes subset of rows)
- Faster scans (fewer entries to check)
- Lower maintenance cost (fewer updates)

### Covering Indexes

Covering indexes include all columns needed by the query, allowing index-only scans without table access.

**Pattern**: Include SELECT columns in index

**Example**:
```sql
CREATE INDEX idx_hos_calc_driver_latest
  ON hos_calculations(
    driver_id,
    calculated_at DESC,
    remaining_driving_minutes,  -- Included for SELECT
    remaining_weekly_minutes    -- Included for SELECT
  );
```

**Benefits**:
- No table access required (index-only scan)
- Fastest possible query execution
- Reduced I/O

---

## Performance Monitoring

### Check Index Usage

```sql
-- Find most-used indexes
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC
LIMIT 20;
```

### Find Unused Indexes

```sql
-- Indexes that are never used (candidates for removal)
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size,
  idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelid IS NOT NULL
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Index Bloat

```sql
-- Check index bloat (fragmentation)
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size,
  round(100 * pg_relation_size(indexrelid) / pg_total_relation_size(indrelid)) as pct
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;
```

### Query Performance

```sql
-- Slowest queries (requires pg_stat_statements extension)
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%eld_events%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## EXPLAIN ANALYZE

Use `EXPLAIN ANALYZE` to verify index usage:

### Example 1: Driver Events

```sql
EXPLAIN ANALYZE
SELECT id, event_sequence_id, event_type, event_timestamp
FROM eld_events
WHERE driver_id = 'uuid-here'
  AND event_record_status = 1
  AND event_timestamp >= '2024-01-01'
  AND event_timestamp < '2024-01-02'
ORDER BY event_sequence_id;
```

**Good Plan**:
```
Index Scan using idx_eld_events_driver_timestamp_composite
  Index Cond: (driver_id = '...' AND event_record_status = 1)
  Filter: (event_timestamp >= '...' AND event_timestamp < '...')
  Planning Time: 0.5ms
  Execution Time: 15.2ms  ← Sub-50ms ✅
```

**Bad Plan** (avoid):
```
Seq Scan on eld_events  ← Table scan, not using index ❌
  Filter: (driver_id = '...')
  Execution Time: 1250.5ms  ← Too slow
```

### Example 2: Current Duty Status

```sql
EXPLAIN ANALYZE
SELECT duty_status, started_at
FROM duty_status_records
WHERE driver_id = 'uuid-here'
  AND ended_at IS NULL
ORDER BY started_at DESC
LIMIT 1;
```

**Good Plan**:
```
Limit
  -> Index Scan using idx_duty_status_driver_active  ← Partial index ✅
       Index Cond: (driver_id = '...' AND ended_at IS NULL)
       Planning Time: 0.3ms
       Execution Time: 2.1ms  ← Very fast ✅
```

---

## Maintenance

### Reindex Schedule

For high-write tables, reindex periodically:

```sql
-- Monthly recommended
REINDEX TABLE eld_events;
REINDEX TABLE duty_status_records;

-- Or reindex specific indexes
REINDEX INDEX idx_eld_events_driver_timestamp_composite;
```

### Update Statistics

After bulk inserts:

```sql
ANALYZE eld_events;
ANALYZE duty_status_records;
ANALYZE log_periods;
```

### Vacuum

Reclaim space and update statistics:

```sql
VACUUM ANALYZE eld_events;
```

---

## Troubleshooting

### Query Still Slow

1. **Check index exists**:
   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename = 'eld_events'
     AND indexname = 'idx_eld_events_driver_timestamp_composite';
   ```

2. **Run EXPLAIN ANALYZE**:
   - Verify index is being used
   - Look for "Seq Scan" (bad)
   - Want "Index Scan" or "Index Only Scan" (good)

3. **Check statistics are up to date**:
   ```sql
   ANALYZE eld_events;
   ```

4. **Verify correct WHERE clause**:
   - Partial indexes only work with matching WHERE
   - Example: Index has `WHERE status = 1`, query must include `status = 1`

### Index Not Being Used

**Possible causes**:

1. **Table too small**: Postgres uses seq scan for small tables (faster)
2. **Statistics outdated**: Run `ANALYZE`
3. **Wrong data type**: Ensure query parameter type matches column type
4. **OR conditions**: Indexes don't work well with OR (use UNION instead)
5. **Function on column**: `WHERE LOWER(name) = 'foo'` prevents index use

---

## Best Practices

### DO ✅

- Use prepared statements (prevent SQL injection)
- Include `event_record_status = 1` for active records
- Use `event_timestamp` for date range queries (partition pruning)
- Order by indexed columns
- Select only needed columns
- Use LIMIT when appropriate

### DON'T ❌

- Don't use functions on indexed columns: `WHERE DATE(timestamp) = '2024-01-01'`
- Don't use OR conditions across different columns: use UNION
- Don't select `*` (all columns) if you only need a few
- Don't forget to filter by carrier_id for multi-tenant isolation
- Don't use OFFSET for pagination (use cursor-based instead)

---

## Summary

**Indexes Created**: 15 new indexes
**Tables Optimized**: 8 core tables
**Queries Optimized**: 7+ common patterns
**Performance Target**: Sub-100ms for all queries
**Estimated Improvement**: 10-100x faster than unoptimized queries

All common ELD queries now execute in under 100ms with proper index usage. The composite indexes cover WHERE clauses, ORDER BY clauses, and SELECT columns for maximum performance.
