# ELD Events Partitioning Guide

## Overview

The `eld_events` table is partitioned using PostgreSQL's native table partitioning feature with **monthly RANGE partitions** based on `event_timestamp`. This is critical for performance as the events table will grow very large over time.

## Partition Strategy

- **Partition Key**: `event_timestamp` (TIMESTAMPTZ)
- **Partition Type**: RANGE (monthly boundaries)
- **Naming Convention**: `eld_events_yYYYYmMM` (e.g., `eld_events_y2024m06`)
- **Initial Partitions**: Past 6 months + current month + future 12 months
- **Automatic Management**: Yes (via `maintain_eld_events_partitions()` function)

## Architecture

```
eld_events (parent table - partitioned)
├── eld_events_y2024m01 (2024-01-01 to 2024-02-01)
├── eld_events_y2024m02 (2024-02-01 to 2024-03-01)
├── eld_events_y2024m03 (2024-03-01 to 2024-04-01)
├── ...
└── eld_events_y2025m12 (2025-12-01 to 2026-01-01)
```

## Benefits

### 1. **Query Performance**
- **Partition Pruning**: Queries with date filters only scan relevant partitions
- **Smaller Indexes**: Each partition has its own indexes (smaller, faster)
- **Parallel Scans**: Multiple partitions can be scanned in parallel

### 2. **Maintenance**
- **Fast Archival**: Detach old partitions instead of deleting millions of rows
- **Efficient Vacuuming**: Smaller partitions vacuum faster
- **Targeted Reindexing**: Rebuild indexes on specific partitions only

### 3. **Data Management**
- **Easy Archival**: Detach and archive old partitions to cold storage
- **Compliance**: 6-month FMCSA retention met by detaching (not deleting)
- **Backup Optimization**: Backup recent partitions more frequently

## Usage Guidelines

### ✅ DO: Always Include Date Filters

```sql
-- GOOD: Partition pruning works
SELECT * FROM eld_events
WHERE event_timestamp >= '2024-06-01'
  AND event_timestamp < '2024-07-01'
  AND driver_id = 'xxx';
-- Result: Scans only eld_events_y2024m06

-- GOOD: Using dynamic dates
SELECT * FROM eld_events
WHERE event_timestamp >= date_trunc('month', now())
  AND event_timestamp < date_trunc('month', now()) + interval '1 month';
-- Result: Scans only current month partition
```

### ❌ DON'T: Query Without Date Filters

```sql
-- BAD: Full table scan across ALL partitions
SELECT * FROM eld_events
WHERE driver_id = 'xxx';
-- Result: Scans all 19+ partitions (slow!)

-- BAD: Using event_date instead of event_timestamp
SELECT * FROM eld_events
WHERE event_date = '061224';
-- Result: Partition key not used, scans all partitions
```

### Date Filter Best Practices

1. **Always use `event_timestamp`** (the partition key)
2. **Use range filters**: `>=` and `<` instead of `BETWEEN`
3. **Use immutable functions**: `'2024-06-01'::timestamptz` not `CURRENT_DATE`
4. **Avoid OR across months**: Split into separate queries if needed

## Partition Management

### Manual Partition Creation

```sql
-- Create a partition for July 2024
SELECT create_eld_events_partition(
  '2024-07-01'::timestamptz,
  '2024-08-01'::timestamptz
);
```

### Automatic Partition Maintenance

```sql
-- Run monthly to create future partitions and archive old ones
SELECT maintain_eld_events_partitions();
```

**Automation Options:**

1. **pg_cron** (recommended if available):
```sql
SELECT cron.schedule(
  'maintain-eld-events-partitions',
  '0 0 1 * *',  -- Run at midnight on 1st of each month
  'SELECT maintain_eld_events_partitions()'
);
```

2. **Application-level cron** (if pg_cron unavailable):
```javascript
// backend/src/jobs/partition-maintenance.ts
import cron from 'node-cron';

cron.schedule('0 0 1 * *', async () => {
  await supabase.rpc('maintain_eld_events_partitions');
});
```

3. **Manual** (run via Supabase SQL editor):
```sql
SELECT maintain_eld_events_partitions();
```

### View Partition Information

```sql
-- See all partitions with sizes and row counts
SELECT * FROM eld_events_partition_info
ORDER BY partition_name;

-- Count rows per partition
SELECT
  tableoid::regclass as partition,
  count(*) as row_count,
  min(event_timestamp) as earliest,
  max(event_timestamp) as latest
FROM eld_events
GROUP BY tableoid
ORDER BY partition;
```

### Archive Old Partitions

The `maintain_eld_events_partitions()` function automatically **detaches** partitions older than 6 months. Detached partitions remain as standalone tables for archival.

```sql
-- List detached partitions ready for archival
SELECT tablename
FROM pg_tables
WHERE tablename ~ '^eld_events_y\d{4}m\d{2}$'
  AND tablename NOT IN (
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'eld_events'
  );

-- Archive to cold storage (Supabase Storage or S3)
-- Then drop the detached partition:
DROP TABLE eld_events_y2023m01;
```

## Query Optimization

### Verify Partition Pruning

Use `EXPLAIN` to verify that only relevant partitions are scanned:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM eld_events
WHERE event_timestamp >= '2024-06-01'
  AND event_timestamp < '2024-07-01'
  AND driver_id = 'xxx';
```

**Look for:**
- `Scan on eld_events_y2024m06` (specific partition named)
- `Partitions scanned: 1` (or small number)
- Low `Buffers: shared hit/read` values

**Red flags:**
- `Seq Scan on eld_events` (no partition named)
- All partitions scanned
- High planning time

### Covering Indexes

The partition includes covering indexes for common queries:

```sql
-- This query uses index-only scan (no heap access)
SELECT driver_id, event_date, event_type, location_description
FROM eld_events
WHERE driver_id = 'xxx'
  AND event_timestamp >= now() - interval '1 day'
  AND event_timestamp < now()
ORDER BY event_date DESC;
```

## Indexes on Partitioned Tables

Indexes are created on the **parent table** and automatically inherited by all partitions. This means:

1. **Automatic inheritance**: New partitions get all indexes
2. **Partition-local indexes**: Each partition has its own index (smaller, faster)
3. **Unique constraints**: Must include partition key (`event_timestamp`)

### Unique Constraints

```sql
-- GOOD: Includes partition key
CREATE UNIQUE INDEX idx_example
  ON eld_events(eld_device_id, event_sequence_id, event_timestamp);

-- BAD: Missing partition key (will fail)
CREATE UNIQUE INDEX idx_example
  ON eld_events(eld_device_id, event_sequence_id);
```

## Foreign Keys

Foreign keys to partitioned tables reference the **parent table**, not individual partitions:

```sql
-- Other tables reference the parent table
ALTER TABLE duty_status_records
  ADD CONSTRAINT fk_source_event
    FOREIGN KEY (source_eld_event_id)
    REFERENCES eld_events(id);  -- References parent, not partition
```

## Backup Strategy

### Partition-Aware Backups

1. **Recent partitions** (last 3 months): Backup daily
2. **Older partitions** (3-6 months): Backup weekly
3. **Detached partitions** (>6 months): Archive to cold storage

```bash
# Backup specific partition
pg_dump -t eld_events_y2024m06 -F c > eld_events_2024_06.dump

# Restore specific partition
pg_restore -t eld_events_y2024m06 eld_events_2024_06.dump
```

## Migration Notes

The migration from non-partitioned to partitioned table:

1. ✅ Renames old table to `eld_events_old`
2. ✅ Creates new partitioned table
3. ✅ Creates 19 initial partitions (past 6 + current + future 12)
4. ✅ Copies all data to partitioned table
5. ✅ Recreates all indexes and constraints
6. ✅ Updates foreign key references
7. ✅ Drops old table

**Migration Safety:**
- Non-destructive (old table kept until end)
- Atomic (transaction-safe)
- Validates all constraints after migration
- Zero downtime (with proper planning)

## Troubleshooting

### Partition Pruning Not Working

**Problem**: All partitions scanned even with date filter

**Solutions:**
1. Ensure `event_timestamp` (partition key) is in WHERE clause
2. Use immutable date values: `'2024-06-01'::timestamptz`
3. Avoid functions on partition key: `date_trunc(event_timestamp, ...)` breaks pruning
4. Check constraint exclusion: `SHOW constraint_exclusion;` (should be `partition` or `on`)
5. Update statistics: `ANALYZE eld_events;`

### Slow Inserts

**Problem**: INSERT performance degraded after partitioning

**Solutions:**
1. Ensure future partitions exist (run `maintain_eld_events_partitions()`)
2. Batch inserts instead of row-by-row
3. Disable triggers during bulk inserts (if appropriate)
4. Check for lock contention on partition metadata

### Partition Overflow

**Problem**: INSERT fails with "no partition found"

**Solution:**
```sql
-- Create missing partition
SELECT create_eld_events_partition(
  date_trunc('month', '2025-05-15'::timestamptz),
  date_trunc('month', '2025-05-15'::timestamptz) + interval '1 month'
);

-- Or run maintenance function
SELECT maintain_eld_events_partitions();
```

## Monitoring

### Track Partition Sizes

```sql
-- Monitor partition growth
SELECT
  partition_name,
  total_size,
  rows_inserted,
  last_analyze
FROM eld_events_partition_info
ORDER BY partition_name DESC
LIMIT 12;
```

### Alert on Missing Future Partitions

```sql
-- Alert if no partition exists for next month
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'eld_events_y' || to_char(now() + interval '1 month', 'YYYYMM')
  )
  THEN 'WARNING: Next month partition missing!'
  ELSE 'OK'
END as partition_status;
```

## Performance Benchmarks

Expected query performance improvements (vs non-partitioned):

| Query Type | Improvement | Notes |
|------------|-------------|-------|
| Single day | 10-20x | Only 1 partition scanned |
| Single month | 5-10x | Smaller index, fewer rows |
| 3 months | 3-5x | 3 partitions vs full table |
| Year | 2-3x | 12 partitions vs full table |
| Full table | 1x (same) | No date filter = no benefit |

## References

- [PostgreSQL Table Partitioning Docs](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Partition Pruning](https://www.postgresql.org/docs/current/ddl-partitioning.html#DDL-PARTITION-PRUNING)
- Migration file: `infra/supabase/migrations/20240120000000_partition_eld_events.sql`
- Test file: `infra/supabase/test_partition_pruning.sql`
