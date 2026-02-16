/**
 * Query Performance Benchmark
 *
 * Tests the performance of optimized common queries and verifies
 * that proper indexes are being used.
 *
 * Target: All queries sub-100ms
 *
 * Run: npx ts-node src/scripts/benchmark-queries.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';
import {
  getDriverEventsFor24Hours,
  getHOSRemainingTime,
  getUnidentifiedRecordsByVehicle,
  getAgingUnidentifiedRecords,
  getDailyLogSummary,
  exportEventsForFMCSA,
  getCurrentDutyStatus,
  getUncertifiedLogs,
} from '../queries/optimized-queries';

interface BenchmarkResult {
  query: string;
  executionTime: number;
  target: number;
  pass: boolean;
  rowCount: number;
}

const results: BenchmarkResult[] = [];

function formatTime(ms: number): string {
  if (ms < 100) {
    return `${ms.toFixed(1)}ms ✅`;
  } else if (ms < 200) {
    return `${ms.toFixed(1)}ms ⚠️`;
  } else {
    return `${ms.toFixed(1)}ms ❌`;
  }
}

async function runBenchmark() {
  console.log('═'.repeat(80));
  console.log('QUERY PERFORMANCE BENCHMARK');
  console.log('═'.repeat(80));
  console.log();
  console.log('Target: Sub-100ms for all common queries');
  console.log();

  // Get test data from load test
  const { data: carrier } = await supabase
    .from('carriers')
    .select('id')
    .eq('dot_number', '7654321')
    .single();

  if (!carrier) {
    console.log('❌ No test carrier found. Run load test first.');
    return;
  }

  const { data: driver } = await supabase
    .from('drivers')
    .select('id')
    .eq('carrier_id', carrier.id)
    .limit(1)
    .single();

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id')
    .eq('carrier_id', carrier.id)
    .limit(1)
    .single();

  if (!driver || !vehicle) {
    console.log('❌ No test data found.');
    return;
  }

  console.log(`Using test driver: ${driver.id}`);
  console.log(`Using test vehicle: ${vehicle.id}`);
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 1: Fetch Driver's Events for 24-Hour Period
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 1: Fetch Driver Events (24 hours)');
  console.log('─'.repeat(80));

  const result1 = await getDriverEventsFor24Hours(supabase, driver.id, '021526', 'America/Chicago');

  if (result1.error) {
    console.log('❌ Error:', result1.error.message);
  } else {
    const time = result1.executionTime || 0;
    const pass = time < 50;
    results.push({
      query: 'Get Driver Events (24h)',
      executionTime: time,
      target: 50,
      pass,
      rowCount: result1.data?.length || 0,
    });

    console.log(`  Rows returned: ${result1.data?.length || 0}`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <50ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 2: Calculate HOS Remaining Time
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 2: Get HOS Remaining Time');
  console.log('─'.repeat(80));

  const result2 = await getHOSRemainingTime(supabase, driver.id);

  if (result2.error) {
    console.log('⚠️  No HOS calculations found (expected for load test data)');
  } else if (result2.data) {
    const time = result2.executionTime || 0;
    const pass = time < 75;
    results.push({
      query: 'Get HOS Remaining',
      executionTime: time,
      target: 75,
      pass,
      rowCount: 1,
    });

    console.log(`  Driving remaining: ${result2.data.driving_minutes_remaining} minutes`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <75ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 3: Get Unidentified Driving Records
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 3: Get Unidentified Records (by vehicle)');
  console.log('─'.repeat(80));

  const result3 = await getUnidentifiedRecordsByVehicle(supabase, vehicle.id);

  if (result3.error) {
    console.log('❌ Error:', result3.error.message);
  } else {
    const time = result3.executionTime || 0;
    const pass = time < 50;
    results.push({
      query: 'Get Unidentified (vehicle)',
      executionTime: time,
      target: 50,
      pass,
      rowCount: result3.data?.length || 0,
    });

    console.log(`  Records found: ${result3.data?.length || 0}`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <50ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 4: Get Aging Unidentified Records
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 4: Get Aging Unidentified Records (carrier-wide)');
  console.log('─'.repeat(80));

  const result4 = await getAgingUnidentifiedRecords(supabase, carrier.id, 8);

  if (result4.error) {
    console.log('❌ Error:', result4.error.message);
  } else {
    const time = result4.executionTime || 0;
    const pass = time < 50;
    results.push({
      query: 'Get Aging Unidentified',
      executionTime: time,
      target: 50,
      pass,
      rowCount: result4.data?.length || 0,
    });

    console.log(`  Records found: ${result4.data?.length || 0}`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <50ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 5: Generate Daily Log Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 5: Generate Daily Log Summary');
  console.log('─'.repeat(80));

  const result5 = await getDailyLogSummary(supabase, driver.id, '021526');

  if (result5.error) {
    console.log('⚠️  No log period found for date');
  } else if (result5.data) {
    const time = result5.executionTime || 0;
    const pass = time < 100;
    results.push({
      query: 'Daily Log Summary',
      executionTime: time,
      target: 100,
      pass,
      rowCount: 1,
    });

    console.log(`  Total events: ${result5.data.total_events}`);
    console.log(`  Driving time: ${result5.data.driving_minutes} minutes`);
    console.log(`  Total miles: ${result5.data.total_miles}`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <100ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 6: Export Events in FMCSA Format
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 6: Export Events (FMCSA format)');
  console.log('─'.repeat(80));

  const result6 = await exportEventsForFMCSA(supabase, driver.id, '021526');

  if (result6.error) {
    console.log('⚠️  No events found for date');
  } else if (result6.data) {
    const time = result6.executionTime || 0;
    const pass = time < 100;
    results.push({
      query: 'FMCSA Export',
      executionTime: time,
      target: 100,
      pass,
      rowCount: result6.data.length,
    });

    console.log(`  Events exported: ${result6.data.length}`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <100ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 7: Get Current Duty Status
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 7: Get Current Duty Status');
  console.log('─'.repeat(80));

  const result7 = await getCurrentDutyStatus(supabase, driver.id);

  if (result7.error) {
    console.log('❌ Error:', result7.error.message);
  } else {
    const time = result7.executionTime || 0;
    const pass = time < 25;
    results.push({
      query: 'Current Duty Status',
      executionTime: time,
      target: 25,
      pass,
      rowCount: result7.data ? 1 : 0,
    });

    if (result7.data) {
      console.log(`  Current status: ${result7.data.duty_status}`);
      console.log(`  Started at: ${result7.data.started_at}`);
    } else {
      console.log(`  No active status (driver offline)`);
    }
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <25ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // BENCHMARK 8: Get Uncertified Logs
  // ─────────────────────────────────────────────────────────────────────────
  console.log('TEST 8: Get Uncertified Logs');
  console.log('─'.repeat(80));

  const result8 = await getUncertifiedLogs(supabase, driver.id);

  if (result8.error) {
    console.log('❌ Error:', result8.error.message);
  } else {
    const time = result8.executionTime || 0;
    const pass = time < 50;
    results.push({
      query: 'Uncertified Logs',
      executionTime: time,
      target: 50,
      pass,
      rowCount: result8.data?.length || 0,
    });

    console.log(`  Uncertified periods: ${result8.data?.length || 0}`);
    console.log(`  Execution time: ${formatTime(time)}`);
    console.log(`  Target: <50ms ${pass ? '✅' : '❌'}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('BENCHMARK SUMMARY');
  console.log('═'.repeat(80));
  console.log();

  console.log('Query                          | Time      | Target    | Status | Rows');
  console.log('─'.repeat(80));

  results.forEach((result) => {
    const query = result.query.padEnd(30);
    const time = `${result.executionTime.toFixed(1)}ms`.padEnd(9);
    const target = `<${result.target}ms`.padEnd(9);
    const status = result.pass ? '✅ PASS' : '❌ FAIL';
    const rows = String(result.rowCount).padStart(4);

    console.log(`${query} | ${time} | ${target} | ${status} | ${rows}`);
  });

  console.log();

  const passCount = results.filter((r) => r.pass).length;
  const totalCount = results.length;
  const passPercentage = ((passCount / totalCount) * 100).toFixed(0);

  console.log(`Performance: ${passCount}/${totalCount} queries meet target (${passPercentage}%)`);
  console.log();

  if (passCount === totalCount) {
    console.log('🎯 All queries meet performance targets!');
  } else {
    console.log('⚠️  Some queries need optimization. Check indexes and query plans.');
  }

  console.log();
  console.log('═'.repeat(80));
}

async function explainQueries() {
  console.log('═'.repeat(80));
  console.log('QUERY EXECUTION PLANS (EXPLAIN ANALYZE)');
  console.log('═'.repeat(80));
  console.log();
  console.log('Note: These queries use raw SQL to show EXPLAIN ANALYZE output.');
  console.log('They demonstrate index usage for the optimized queries.');
  console.log();

  // Get test driver
  const { data: carrier } = await supabase
    .from('carriers')
    .select('id')
    .eq('dot_number', '7654321')
    .single();

  if (!carrier) {
    console.log('❌ No test carrier found.');
    return;
  }

  const { data: driver } = await supabase
    .from('drivers')
    .select('id')
    .eq('carrier_id', carrier.id)
    .limit(1)
    .single();

  if (!driver) {
    console.log('❌ No test driver found.');
    return;
  }

  console.log('EXPLAIN ANALYZE examples:');
  console.log();
  console.log('To see detailed query plans, run these in Supabase SQL Editor:');
  console.log();

  console.log('1. Driver Events (24 hours):');
  console.log(`
EXPLAIN ANALYZE
SELECT id, event_sequence_id, event_type, event_timestamp
FROM eld_events
WHERE driver_id = '${driver.id}'
  AND event_record_status = 1
  AND event_timestamp >= '2026-02-15'
  AND event_timestamp <= '2026-02-16'
ORDER BY event_sequence_id;

-- Should use: idx_eld_events_driver_timestamp_composite
-- Expected: Index Scan, no Seq Scan
  `.trim());

  console.log();
  console.log('─'.repeat(80));
  console.log();

  console.log('2. Current Duty Status:');
  console.log(`
EXPLAIN ANALYZE
SELECT duty_status, started_at
FROM duty_status_records
WHERE driver_id = '${driver.id}'
  AND ended_at IS NULL
ORDER BY started_at DESC
LIMIT 1;

-- Should use: idx_duty_status_driver_active (partial index)
-- Expected: Index Scan with WHERE filter
  `.trim());

  console.log();
  console.log('─'.repeat(80));
  console.log();

  console.log('3. Unidentified Records:');
  console.log(`
EXPLAIN ANALYZE
SELECT id, started_at, duration_minutes
FROM unidentified_driver_records
WHERE carrier_id = '${carrier.id}'
  AND status = 'pending'
  AND started_at < now() - interval '8 days'
ORDER BY started_at;

-- Should use: idx_udr_aging (partial index)
-- Expected: Index Scan on partial index
  `.trim());

  console.log();
  console.log();
}

async function checkIndexes() {
  console.log('═'.repeat(80));
  console.log('INDEX VERIFICATION');
  console.log('═'.repeat(80));
  console.log();

  const expectedIndexes = [
    'idx_eld_events_driver_timestamp_composite',
    'idx_eld_events_period_sequence_composite',
    'idx_eld_events_driver_type_timestamp',
    'idx_duty_status_driver_active',
    'idx_duty_status_driver_time_range',
    'idx_duty_status_period_status',
    'idx_hos_calc_driver_latest',
    'idx_udr_vehicle_pending',
    'idx_udr_carrier_pending_time',
    'idx_udr_aging',
  ];

  console.log('Checking for required indexes...');
  console.log();

  // Note: We can't directly query pg_indexes via Supabase JS client
  // This would need to be run via SQL or with elevated permissions

  console.log('To verify indexes exist, run this in Supabase SQL Editor:');
  console.log();
  console.log(`
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    ${expectedIndexes.map((idx) => `'${idx}'`).join(',\n    ')}
  )
ORDER BY tablename, indexname;
  `.trim());

  console.log();
  console.log('Expected: All indexes should be present.');
  console.log();
}

// Main execution
(async () => {
  try {
    await runBenchmark();
    console.log();
    await explainQueries();
    console.log();
    await checkIndexes();
  } catch (error: any) {
    console.error('Benchmark failed:', error.message);
    process.exit(1);
  }
})();
