/**
 * Load Test Results Analysis
 *
 * Analyzes ELD events table performance and provides recommendations
 *
 * Run: npx ts-node src/scripts/analyze-load-test.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';
import { performance } from 'perf_hooks';

interface AnalysisResult {
  dataDistribution: any;
  indexEfficiency: any;
  partitionHealth: any;
  queryPatterns: any;
  recommendations: string[];
}

async function analyzeDataDistribution() {
  console.log('📊 Analyzing Data Distribution...\n');

  const { data: eventsByType } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT
          event_type,
          count(*) as count,
          min(event_timestamp) as earliest,
          max(event_timestamp) as latest
        FROM eld_events
        GROUP BY event_type
        ORDER BY event_type
      `,
    })
    .catch(() => ({ data: null }));

  if (eventsByType) {
    console.log('Events by Type:');
    eventsByType.forEach((row: any) => {
      const typeName = ['', 'DutyStatus', 'IntermediateLog', 'PersonalUse', 'Certification', 'Login', 'EnginePower', 'Malfunction'][row.event_type];
      console.log(`  Type ${row.event_type} (${typeName}): ${row.count.toLocaleString()} events`);
    });
    console.log();
  }

  const { data: eventsByDriver } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT
          count(DISTINCT driver_id) as driver_count,
          count(*) as total_events,
          round(count(*)::numeric / count(DISTINCT driver_id), 0) as avg_per_driver,
          max(driver_events.cnt) as max_per_driver,
          min(driver_events.cnt) as min_per_driver
        FROM eld_events
        CROSS JOIN LATERAL (
          SELECT count(*) as cnt
          FROM eld_events e2
          WHERE e2.driver_id = eld_events.driver_id
          GROUP BY driver_id
        ) driver_events
      `,
    })
    .catch(() => ({ data: null }));

  if (eventsByDriver && eventsByDriver.length > 0) {
    const stats = eventsByDriver[0];
    console.log('Events by Driver:');
    console.log(`  Total Drivers:      ${stats.driver_count}`);
    console.log(`  Total Events:       ${stats.total_events?.toLocaleString()}`);
    console.log(`  Avg per Driver:     ${stats.avg_per_driver}`);
    console.log(`  Max per Driver:     ${stats.max_per_driver}`);
    console.log(`  Min per Driver:     ${stats.min_per_driver}`);
    console.log();
  }

  return { eventsByType, eventsByDriver };
}

async function analyzeIndexEfficiency() {
  console.log('🔍 Analyzing Index Efficiency...\n');

  // Test index usage on common queries
  const tests = [
    {
      name: 'Driver + Date Filter',
      query: () =>
        supabase
          .from('eld_events')
          .select('*')
          .eq('driver_id', crypto.randomUUID()) // Dummy driver
          .gte('event_timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(100),
    },
    {
      name: 'Event Type + Date',
      query: () =>
        supabase
          .from('eld_events')
          .select('*')
          .eq('event_type', 1)
          .gte('event_timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(100),
    },
    {
      name: 'Device + Sequence',
      query: () =>
        supabase
          .from('eld_events')
          .select('*')
          .eq('eld_device_id', crypto.randomUUID()) // Dummy device
          .gte('event_timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('event_sequence_id')
          .limit(100),
    },
  ];

  const results = [];
  for (const test of tests) {
    const start = performance.now();
    await test.query();
    const end = performance.now();
    const time = end - start;
    results.push({ name: test.name, time });
    console.log(`  ${test.name}: ${time.toFixed(2)}ms`);
  }
  console.log();

  return results;
}

async function analyzePartitionHealth() {
  console.log('🗂️  Analyzing Partition Health...\n');

  const { data: partitions } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT
          child.relname as partition_name,
          pg_get_expr(child.relpartbound, child.oid) as range,
          pg_size_pretty(pg_total_relation_size(child.oid)) as size,
          stat.n_tup_ins as inserts,
          stat.n_tup_upd as updates,
          stat.n_tup_del as deletes,
          stat.last_autovacuum,
          stat.last_autoanalyze
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        LEFT JOIN pg_stat_all_tables stat ON stat.relid = child.oid
        WHERE parent.relname = 'eld_events'
        ORDER BY child.relname DESC
        LIMIT 10
      `,
    })
    .catch(() => ({ data: null }));

  if (partitions) {
    console.log('Recent Partitions:');
    partitions.forEach((p: any) => {
      console.log(`  ${p.partition_name}: ${p.size}, ${p.inserts || 0} inserts`);
    });
    console.log();

    // Check for missing future partitions
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthName = `eld_events_y${nextMonth.getFullYear()}m${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

    const hasNextMonth = partitions.some((p: any) => p.partition_name === nextMonthName);
    if (!hasNextMonth) {
      console.log(`⚠️  Warning: Next month partition (${nextMonthName}) not found!`);
      console.log('   Run: SELECT maintain_eld_events_partitions();');
      console.log();
    }
  }

  return partitions;
}

async function analyzeQueryPatterns() {
  console.log('🔎 Analyzing Query Patterns...\n');

  // Simulate common query patterns and measure
  const patterns = [];

  // Pattern 1: Mobile app - get driver's events for today
  const pattern1Start = performance.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  await supabase
    .from('eld_events')
    .select('*')
    .gte('event_timestamp', today.toISOString())
    .lt('event_timestamp', tomorrow.toISOString())
    .limit(1000);
  const pattern1End = performance.now();
  patterns.push({ name: 'Mobile: Today\'s events', time: pattern1End - pattern1Start });

  // Pattern 2: Dashboard - active drivers now
  const pattern2Start = performance.now();
  const last1Hour = new Date(Date.now() - 60 * 60 * 1000);
  await supabase
    .from('eld_events')
    .select('driver_id, event_type, event_timestamp')
    .gte('event_timestamp', last1Hour.toISOString())
    .eq('event_type', 1) // Duty status
    .limit(500);
  const pattern2End = performance.now();
  patterns.push({ name: 'Dashboard: Active drivers', time: pattern2End - pattern2Start });

  // Pattern 3: Compliance - weekly summary
  const pattern3Start = performance.now();
  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await supabase
    .from('eld_events')
    .select('count')
    .gte('event_timestamp', last7Days.toISOString())
    .eq('event_type', 1)
    .single();
  const pattern3End = performance.now();
  patterns.push({ name: 'Compliance: Weekly summary', time: pattern3End - pattern3Start });

  patterns.forEach((p) => {
    const status = p.time < 100 ? '✅' : p.time < 500 ? '⚠️' : '❌';
    console.log(`  ${status} ${p.name}: ${p.time.toFixed(2)}ms`);
  });
  console.log();

  return patterns;
}

function generateRecommendations(analysis: AnalysisResult): string[] {
  const recommendations: string[] = [];

  // Check query performance
  const slowQueries = analysis.queryPatterns.filter((q: any) => q.time > 200);
  if (slowQueries.length > 0) {
    recommendations.push('🔧 Some queries are slow (>200ms). Review EXPLAIN plans and consider additional indexes.');
  }

  // Check partition health
  if (analysis.partitionHealth && analysis.partitionHealth.length > 0) {
    const recentPartition = analysis.partitionHealth[0];
    if (!recentPartition.last_autoanalyze) {
      recommendations.push('📊 Recent partitions have not been analyzed. Run ANALYZE eld_events;');
    }
  }

  // Data distribution
  if (analysis.dataDistribution.eventsByDriver) {
    const stats = analysis.dataDistribution.eventsByDriver[0];
    const imbalance = (stats.max_per_driver - stats.min_per_driver) / stats.avg_per_driver;
    if (imbalance > 2) {
      recommendations.push('⚖️  Uneven data distribution across drivers detected. Consider if this is expected.');
    }
  }

  // Index efficiency
  const avgIndexTime = analysis.indexEfficiency.reduce((sum: number, r: any) => sum + r.time, 0) / analysis.indexEfficiency.length;
  if (avgIndexTime > 100) {
    recommendations.push('🔍 Average index lookup time >100ms. Verify indexes are being used with EXPLAIN.');
  }

  // General recommendations
  recommendations.push('✅ Always include event_timestamp in WHERE clauses for partition pruning');
  recommendations.push('✅ Run maintain_eld_events_partitions() monthly to create future partitions');
  recommendations.push('✅ Monitor partition sizes via eld_events_partition_info view');

  return recommendations;
}

async function runAnalysis() {
  console.log('═'.repeat(80));
  console.log('ELD EVENTS LOAD TEST ANALYSIS');
  console.log('═'.repeat(80));
  console.log();

  const analysis: AnalysisResult = {
    dataDistribution: await analyzeDataDistribution(),
    indexEfficiency: await analyzeIndexEfficiency(),
    partitionHealth: await analyzePartitionHealth(),
    queryPatterns: await analyzeQueryPatterns(),
    recommendations: [],
  };

  analysis.recommendations = generateRecommendations(analysis);

  console.log('═'.repeat(80));
  console.log('RECOMMENDATIONS');
  console.log('═'.repeat(80));
  analysis.recommendations.forEach((rec) => console.log(rec));
  console.log();

  console.log('═'.repeat(80));
  console.log('ANALYSIS COMPLETE ✅');
  console.log('═'.repeat(80));
}

runAnalysis()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
