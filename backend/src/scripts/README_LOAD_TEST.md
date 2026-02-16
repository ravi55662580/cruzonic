# Load Testing Scripts - Quick Start

## 🚀 Quick Start

### Run Full Load Test (100 drivers × 30 days)

```bash
cd backend
npx ts-node src/scripts/load-test.ts
```

**Expected**:
- ~200,000 events generated
- 5-10 minute runtime
- Performance report generated

### Run Quick Test (10 drivers × 7 days)

```bash
# Edit CONFIG in load-test.ts first:
# NUM_DRIVERS: 10, NUM_DAYS: 7

npx ts-node src/scripts/load-test.ts
```

**Expected**:
- ~3,500 events generated
- 30-60 second runtime
- Quick validation

### Analyze Existing Data

```bash
npx ts-node src/scripts/analyze-load-test.ts
```

### Generate Performance Report

```bash
npx ts-node src/scripts/generate-performance-report.ts
```

## 📁 Scripts Overview

| Script | Purpose | Duration | Output |
|--------|---------|----------|--------|
| `load-test.ts` | Full load test | 5-10 min | Performance metrics |
| `load-test-quick.ts` | Quick test guide | N/A | Instructions |
| `analyze-load-test.ts` | Analyze data | 1-2 min | Analysis report |
| `generate-performance-report.ts` | Export report | <1 min | Markdown file |

## 📊 What Gets Tested

### Insert Performance
- Batch insert throughput (events/second)
- Partition routing efficiency
- Hash chain generation overhead
- Constraint validation

### Query Performance
- Single driver timeline (mobile app pattern)
- Multi-driver queries (dashboard pattern)
- Date range queries (reporting pattern)
- Partition pruning effectiveness
- Hash chain verification

### Storage Metrics
- Table size growth
- Index size overhead
- Average row size
- Partition distribution

## 📈 Performance Targets

| Metric | Target | Good | Excellent |
|--------|--------|------|-----------|
| Insert Throughput | >100 events/sec | >500 | >1000 |
| Single Driver Query | <100ms | <50ms | <20ms |
| Multi-Driver Query | <200ms | <100ms | <50ms |
| Date Range Query | <500ms | <200ms | <100ms |
| Avg Row Size | <1KB | <600 bytes | <400 bytes |

## 🔍 Bottleneck Detection

The scripts automatically detect:

- ⚠️ Low insert throughput (<50 events/sec)
- ⚠️ Slow queries (>500ms)
- ⚠️ Missing partitions
- ⚠️ Large row sizes (>2KB)
- ⚠️ Uneven data distribution
- ⚠️ Index inefficiency

## 💡 Common Issues & Solutions

### Issue: Low Insert Throughput

**Symptoms**: <50 events/second

**Solutions**:
```typescript
// Increase batch size
CONFIG.BATCH_SIZE = 1000;

// Check for missing partitions
await supabase.rpc('maintain_eld_events_partitions');
```

### Issue: Slow Queries

**Symptoms**: Queries >500ms

**Solutions**:
```sql
-- Verify partition pruning (must include event_timestamp)
EXPLAIN (ANALYZE) SELECT * FROM eld_events
WHERE event_timestamp >= '2024-06-01'
  AND event_timestamp < '2024-07-01';

-- Update statistics
ANALYZE eld_events;
```

### Issue: No Partition Found

**Symptoms**: INSERT fails with "no partition"

**Solutions**:
```sql
-- Create missing partitions
SELECT maintain_eld_events_partitions();

-- Schedule monthly
SELECT cron.schedule('maintain-partitions', '0 0 1 * *',
  'SELECT maintain_eld_events_partitions()');
```

## 🧹 Cleanup After Testing

```sql
-- Remove test data
DELETE FROM eld_events WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);

-- Clean up test entities
DELETE FROM log_periods WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM eld_devices WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM vehicles WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM drivers WHERE carrier_id IN (
  SELECT id FROM carriers WHERE legal_name LIKE '%Load Test%'
);
DELETE FROM carriers WHERE legal_name LIKE '%Load Test%';

-- Reclaim space
VACUUM ANALYZE eld_events;
```

## 📚 Documentation

- **[Load Test Guide](../../../docs/LOAD_TEST_GUIDE.md)** - Complete guide
- **[Load Test Summary](../../../docs/LOAD_TEST_SUMMARY.md)** - Implementation overview
- **[Partition Guide](../../../docs/partition-management-guide.md)** - Partitioning details

## 🎯 Best Practices

1. **Always test in staging first** before production
2. **Run during off-peak hours** for production tests
3. **Monitor during tests** to catch issues early
4. **Keep batch sizes 500-1000** for optimal performance
5. **Include date filters** in all queries for partition pruning
6. **Run ANALYZE** after large data loads
7. **Schedule partition maintenance** monthly

## ⚡ Pro Tips

- Use `VERBOSE: false` in CONFIG for cleaner output
- Adjust `NUM_DRIVERS` and `NUM_DAYS` for custom tests
- Check partition health before running: `SELECT * FROM eld_events_partition_info`
- Monitor `pg_stat_activity` during tests to see active queries
- Use `EXPLAIN (ANALYZE, BUFFERS)` to debug slow queries

## 🔗 Related

- Test partition pruning: `infra/supabase/test_partition_pruning.sql`
- Partition management: `SELECT maintain_eld_events_partitions()`
- Event ingestion: `backend/src/services/event-ingestion.service.ts`

---

**Questions?** See [LOAD_TEST_GUIDE.md](../../../docs/LOAD_TEST_GUIDE.md) for comprehensive documentation.
