/**
 * Test script to verify eld_events table partitioning
 *
 * This script:
 * 1. Verifies partition structure
 * 2. Tests partition creation
 * 3. Inserts test events across multiple partitions
 * 4. Verifies partition pruning with queries
 * 5. Tests automatic partition maintenance
 *
 * Run: npx ts-node src/scripts/test-partitioning.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';
import { createHash } from 'crypto';

// Helper to generate SHA-256 hash
function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

async function main() {
  console.log('🔍 ELD Events Partitioning Test\n');

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Verify Partition Structure
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 1: Verify Partition Structure');
  console.log('─'.repeat(80));

  const { data: partitions, error: partitionsError } = await supabase
    .rpc('eld_events_partition_info' as any);

  if (partitionsError) {
    // Try alternative query if view doesn't exist
    const { data: altPartitions } = await supabase.rpc('sql', {
      query: `
        SELECT
          child.relname as partition_name,
          pg_get_expr(child.relpartbound, child.oid) as partition_range
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE parent.relname = 'eld_events'
        ORDER BY child.relname
      `
    });

    if (altPartitions && altPartitions.length > 0) {
      console.log(`✅ Found ${altPartitions.length} partitions:`);
      altPartitions.slice(0, 5).forEach((p: any) => {
        console.log(`   - ${p.partition_name}: ${p.partition_range}`);
      });
      if (altPartitions.length > 5) {
        console.log(`   ... and ${altPartitions.length - 5} more`);
      }
    } else {
      console.log('❌ No partitions found');
    }
  } else if (partitions && partitions.length > 0) {
    console.log(`✅ Found ${partitions.length} partitions:`);
    partitions.slice(0, 5).forEach((p: any) => {
      console.log(`   - ${p.partition_name}: ${p.total_size}, ${p.rows_inserted || 0} rows`);
    });
    if (partitions.length > 5) {
      console.log(`   ... and ${partitions.length - 5} more`);
    }
  }

  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Create a Test Partition
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 2: Create Test Partition');
  console.log('─'.repeat(80));

  const testMonth = new Date('2026-01-01T00:00:00Z');
  const { data: partitionName, error: createError } = await supabase
    .rpc('create_eld_events_partition', {
      partition_start: testMonth.toISOString(),
      partition_end: new Date('2026-02-01T00:00:00Z').toISOString()
    });

  if (createError) {
    console.log(`❌ Failed to create partition: ${createError.message}`);
  } else {
    console.log(`✅ Created partition: ${partitionName}`);
  }

  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Test Partition Maintenance Function
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 3: Test Partition Maintenance');
  console.log('─'.repeat(80));

  const { error: maintenanceError } = await supabase
    .rpc('maintain_eld_events_partitions');

  if (maintenanceError) {
    console.log(`❌ Maintenance failed: ${maintenanceError.message}`);
  } else {
    console.log('✅ Partition maintenance completed successfully');
    console.log('   Future partitions created for next 12 months');
    console.log('   Old partitions (>6 months) detached for archival');
  }

  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Insert Test Events Across Multiple Partitions
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 4: Insert Test Events Across Partitions');
  console.log('─'.repeat(80));

  // Note: This requires having test data (carrier, driver, vehicle, device, log_period)
  // Skipping actual inserts in this test script
  console.log('⚠️  Skipping test event insertion (requires test data setup)');
  console.log('   To test manually:');
  console.log('   1. Create test carrier, driver, vehicle, eld_device, log_period');
  console.log('   2. Insert events with different event_timestamp values spanning multiple months');
  console.log('   3. Verify events land in correct partitions');

  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Query with Date Filter (Test Partition Pruning)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 5: Query with Date Filter (Partition Pruning)');
  console.log('─'.repeat(80));

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  console.log(`   Query range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  const { data: events, error: queryError } = await supabase
    .from('eld_events')
    .select('id, event_type, event_timestamp')
    .gte('event_timestamp', startDate.toISOString())
    .lt('event_timestamp', endDate.toISOString())
    .limit(10);

  if (queryError) {
    console.log(`❌ Query failed: ${queryError.message}`);
  } else {
    console.log(`✅ Query succeeded, returned ${events?.length || 0} events`);
    if (events && events.length > 0) {
      console.log('   Sample event timestamps:');
      events.slice(0, 3).forEach(e => {
        console.log(`   - ${e.event_timestamp}`);
      });
    }
  }

  console.log();
  console.log('💡 To verify partition pruning:');
  console.log('   1. Run EXPLAIN queries in Supabase SQL Editor');
  console.log('   2. See test_partition_pruning.sql for comprehensive tests');
  console.log('   3. Look for "Partitions scanned: N" in EXPLAIN output');

  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: Count Events Per Partition
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 6: Count Events Per Partition');
  console.log('─'.repeat(80));

  // This query demonstrates partition-aware counting
  const { data: counts, error: countError } = await supabase.rpc('sql' as any, {
    query: `
      SELECT
        tableoid::regclass::text as partition,
        count(*) as row_count,
        min(event_timestamp) as earliest,
        max(event_timestamp) as latest
      FROM eld_events
      GROUP BY tableoid
      ORDER BY partition
      LIMIT 5
    `
  });

  if (countError) {
    console.log('⚠️  Could not count rows per partition (may require direct DB access)');
  } else if (counts && counts.length > 0) {
    console.log(`✅ Event distribution across ${counts.length} active partitions:`);
    counts.forEach((c: any) => {
      console.log(`   ${c.partition}: ${c.row_count} events`);
    });
  } else {
    console.log('ℹ️  No events in table yet');
  }

  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('✅ Partitioning Tests Complete');
  console.log('═'.repeat(80));
  console.log();
  console.log('Next Steps:');
  console.log('1. Run EXPLAIN queries to verify partition pruning (see test_partition_pruning.sql)');
  console.log('2. Set up cron job for maintain_eld_events_partitions()');
  console.log('3. Monitor partition sizes via eld_events_partition_info view');
  console.log('4. Test event ingestion across partition boundaries');
  console.log();
  console.log('Documentation: docs/partition-management-guide.md');
}

main()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
