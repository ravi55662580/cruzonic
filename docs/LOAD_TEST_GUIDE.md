# ELD Events Load Testing Guide

## Overview

The load testing suite simulates realistic ELD event volumes to measure database performance, identify bottlenecks, and validate scalability.

## Test Scenarios

### Full Load Test
- **Drivers**: 100
- **Duration**: 30 days
- **Expected Events**: ~200,000+
- **Purpose**: Simulate realistic production load

### Quick Load Test
- **Drivers**: 10
- **Duration**: 7 days
- **Expected Events**: ~3,500
- **Purpose**: Rapid testing and development

## Running Load Tests

### Prerequisites

```bash
cd backend
npm install
```

Ensure you have:
1. Supabase credentials configured in `.env`
2. Partitioned `eld_events` table (migration 20240120000000)
3. All constraints and indexes applied (migration 20240115000000)

### Run Full Load Test

```bash
npx ts-node src/scripts/load-test.ts
```

**Expected Duration**: 5-10 minutes

**What it tests**:
- ✅ Insert throughput (events/second)
- ✅ Batch insert performance
- ✅ Query performance on common patterns
- ✅ Partition pruning efficiency
- ✅ Hash chain integrity
- ✅ Storage growth

### Run Quick Test

```bash
# Edit CONFIG in load-test.ts:
# NUM_DRIVERS: 10
# NUM_DAYS: 7

npx ts-node src/scripts/load-test.ts
```

**Expected Duration**: 30-60 seconds

### Analyze Results

```bash
npx ts-node src/scripts/analyze-load-test.ts
```

Provides:
- 📊 Data distribution analysis
- 🔍 Index efficiency metrics
- 🗂️ Partition health check
- 🔎 Query pattern performance
- 💡 Optimization recommendations

## Realistic Event Generation

The load test generates realistic ELD events following FMCSA patterns:

### Typical Driver Shift (10 hours)

```
06:00 - Login (EventType 5)
06:02 - Engine Power-Up (EventType 6)
06:07 - Duty Status: ON_DUTY_NOT_DRIVING (EventType 1) - Pre-trip inspection
06:22 - Duty Status: DRIVING (EventType 1)
06:22-13:00 - Intermediate Logs every 10 min (EventType 2) - ~40 events
13:00 - Duty Status: ON_DUTY_NOT_DRIVING (EventType 1) - Break
13:30 - Duty Status: OFF_DUTY (EventType 1)
13:32 - Engine Shut-Down (EventType 6)
13:33 - Logout (EventType 5)
23:30 - Certification (EventType 4)
```

**Total**: ~50 events per driver per day

### Event Distribution (Expected)

| Event Type | Percentage | Description |
|------------|------------|-------------|
| Type 1 (Duty Status) | 8% | 4 status changes per shift |
| Type 2 (Intermediate) | 80% | 1 per 10 min while driving |
| Type 4 (Certification) | 2% | 1 per day |
| Type 5 (Login/Logout) | 4% | 2 per shift |
| Type 6 (Engine Power) | 4% | 2 per shift |
| Type 7 (Malfunction) | 2% | Occasional |

## Performance Metrics

### Insert Throughput

**Target**: >100 events/second

```
Acceptable: 100-500 events/sec
Good:       500-1000 events/sec
Excellent:  >1000 events/sec
```

**Factors**:
- Network latency to Supabase
- Batch size (optimal: 500-1000)
- Index overhead
- Trigger execution time

### Query Performance

| Query Type | Target | Description |
|------------|--------|-------------|
| Single driver timeline (7 days) | <100ms | Mobile app |
| Multi-driver (1 day) | <200ms | Fleet dashboard |
| Date range (30 days) | <500ms | Reports |
| Partition pruning (1 day) | <50ms | Focused queries |
| Hash chain verification | <100ms | Integrity checks |

### Storage Growth

**Expected per 100 drivers × 30 days**:

```
Events:      ~150,000 - 200,000
Table Size:  50-100 MB
Index Size:  30-60 MB
Total Size:  80-160 MB

Average Row Size: ~400-600 bytes
```

**Scaling estimate**:
- **1,000 drivers**: ~800 MB/month
- **10,000 drivers**: ~8 GB/month
- **100,000 drivers**: ~80 GB/month

## Bottleneck Identification

### Common Bottlenecks

#### 1. Insert Performance

**Symptom**: <50 events/second

**Causes**:
- Small batch sizes
- Network latency
- Index contention
- Missing partitions

**Solutions**:
```sql
-- Check for missing partitions
SELECT * FROM eld_events_partition_info
ORDER BY partition_name DESC LIMIT 5;

-- Create missing partitions
SELECT maintain_eld_events_partitions();

-- Optimize batch size
CONFIG.BATCH_SIZE = 1000; // Increase from 500
```

#### 2. Query Performance

**Symptom**: Queries >500ms

**Causes**:
- Missing partition pruning (no date filter)
- Sequential scans instead of index scans
- Outdated statistics

**Solutions**:
```sql
-- Verify partition pruning
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM eld_events
WHERE event_timestamp >= '2024-06-01'
  AND event_timestamp < '2024-07-01';
-- Look for: "Scan on eld_events_y2024m06" (specific partition)

-- Update statistics
ANALYZE eld_events;

-- Check index usage
EXPLAIN (ANALYZE)
SELECT * FROM eld_events
WHERE driver_id = 'xxx'
  AND event_timestamp >= now() - interval '7 days';
-- Look for: "Index Scan" or "Index Only Scan"
```

#### 3. Storage Growth

**Symptom**: >1KB average row size

**Causes**:
- Large JSONB metadata
- Excessive indexes
- TOAST overhead

**Solutions**:
```sql
-- Check row size distribution
SELECT
  pg_column_size(event_metadata) as metadata_size,
  count(*) as count
FROM eld_events
GROUP BY pg_column_size(event_metadata)
ORDER BY count DESC
LIMIT 10;

-- Compress event_metadata if large
-- Consider moving large fields to separate table
```

#### 4. Partition Management

**Symptom**: INSERT fails with "no partition found"

**Cause**: Missing future partitions

**Solution**:
```sql
-- Check future partitions
SELECT * FROM eld_events_partition_info
WHERE partition_name > 'eld_events_y' || to_char(now(), 'YYYYMM');

-- Create future partitions
SELECT maintain_eld_events_partitions();

-- Schedule monthly maintenance
SELECT cron.schedule(
  'maintain-eld-events-partitions',
  '0 0 1 * *',
  'SELECT maintain_eld_events_partitions()'
);
```

## Performance Tuning

### Connection Pooling

For high-concurrency scenarios:

```typescript
// backend/src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(url, key, {
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'x-connection-pool': 'true',
    },
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
```

### Batch Insert Optimization

```typescript
// Optimal batch size: 500-1000 events
const BATCH_SIZE = 1000;

// Use single transaction for better performance
const { error } = await supabase
  .from('eld_events')
  .insert(eventBatch);
```

### Query Optimization

```typescript
// ✅ GOOD: Always include date filter
const { data } = await supabase
  .from('eld_events')
  .select('*')
  .eq('driver_id', driverId)
  .gte('event_timestamp', startDate)
  .lt('event_timestamp', endDate)
  .order('event_timestamp', { ascending: false });

// ❌ BAD: Missing date filter (scans all partitions)
const { data } = await supabase
  .from('eld_events')
  .select('*')
  .eq('driver_id', driverId);
```

### Index Maintenance

```sql
-- Rebuild indexes on old partitions (optional)
REINDEX TABLE eld_events_y2024m01;

-- Vacuum old partitions
VACUUM ANALYZE eld_events_y2024m01;

-- Monitor bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  n_tup_ins,
  n_tup_upd,
  n_tup_del,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE tablename LIKE 'eld_events_y%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

## Monitoring

### Real-Time Monitoring

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity
WHERE datname = current_database();

-- Long-running queries
SELECT
  pid,
  now() - pg_stat_activity.query_start AS duration,
  query,
  state
FROM pg_stat_activity
WHERE state != 'idle'
  AND query NOT ILIKE '%pg_stat_activity%'
ORDER BY duration DESC;

-- Lock contention
SELECT
  blocked_locks.pid AS blocked_pid,
  blocked_activity.usename AS blocked_user,
  blocking_locks.pid AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query AS blocked_statement,
  blocking_activity.query AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### Performance Alerts

Set up alerts for:
- Insert throughput drops below 50 events/sec
- Query latency exceeds 500ms
- Table size grows >10% per week
- Missing future partitions (next month)
- Failed partition maintenance runs

## Cleanup

After load testing:

```sql
-- Remove test data (optional)
DELETE FROM eld_events WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);

-- Clean up test entities
DELETE FROM eld_devices WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM vehicles WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM drivers WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM log_periods WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM carriers WHERE legal_name LIKE '%Load Test%';

-- Vacuum to reclaim space
VACUUM ANALYZE eld_events;
```

## Best Practices

1. **Always test in staging first** before running against production
2. **Monitor during tests** to catch issues early
3. **Run during off-peak hours** for production load tests
4. **Keep batch sizes between 500-1000** for optimal performance
5. **Include date filters in all queries** for partition pruning
6. **Run ANALYZE** after large data loads
7. **Archive old partitions** monthly to maintain performance
8. **Schedule partition maintenance** to avoid INSERT failures

## Troubleshooting

### Test Fails Immediately

**Error**: "Failed to create carrier: duplicate key"

**Solution**: Test data already exists. Either:
```sql
-- Clean up old test data
DELETE FROM carriers WHERE legal_name LIKE '%Load Test%';
```

Or modify carrier name in script:
```typescript
legal_name: `Load Test Carrier ${Date.now()}`,
```

### Low Insert Throughput

**Check**:
1. Network latency to Supabase
2. Concurrent load on database
3. Index overhead
4. Partition availability

### Queries Still Slow After Optimization

**Check**:
```sql
-- Verify indexes exist
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'eld_events'
ORDER BY indexname;

-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'eld_events'
ORDER BY idx_scan DESC;
```

## References

- Load Test Script: [backend/src/scripts/load-test.ts](../backend/src/scripts/load-test.ts)
- Analysis Script: [backend/src/scripts/analyze-load-test.ts](../backend/src/scripts/analyze-load-test.ts)
- Partition Guide: [docs/partition-management-guide.md](partition-management-guide.md)
- Constraints Migration: [infra/supabase/migrations/20240115000000_add_constraints_indexes.sql](../infra/supabase/migrations/20240115000000_add_constraints_indexes.sql)
