/**
 * Performance Report Generator
 *
 * Generates a comprehensive performance report from load test results
 * Exports to both console and markdown file
 *
 * Run: npx ts-node src/scripts/generate-performance-report.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface PerformanceReport {
  timestamp: string;
  summary: {
    totalEvents: number;
    totalDrivers: number;
    dateRange: { start: string; end: string };
    avgEventsPerDriver: number;
  };
  performance: {
    insertThroughput: string;
    avgQueryTime: string;
    partitionCount: number;
    tableSizeMB: string;
    indexSizeMB: string;
  };
  bottlenecks: string[];
  recommendations: string[];
  partitionDetails: any[];
}

async function generateReport(): Promise<PerformanceReport> {
  const report: PerformanceReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalEvents: 0,
      totalDrivers: 0,
      dateRange: { start: '', end: '' },
      avgEventsPerDriver: 0,
    },
    performance: {
      insertThroughput: 'N/A',
      avgQueryTime: 'N/A',
      partitionCount: 0,
      tableSizeMB: 'N/A',
      indexSizeMB: 'N/A',
    },
    bottlenecks: [],
    recommendations: [],
    partitionDetails: [],
  };

  // Collect summary data
  const { count } = await supabase.from('eld_events').select('*', { count: 'exact', head: true });

  report.summary.totalEvents = count || 0;

  const { data: driverCount } = await supabase
    .rpc('sql' as any, {
      query: 'SELECT count(DISTINCT driver_id) as count FROM eld_events',
    })
    .then(({ data }) => ({ data: data?.[0]?.count || 0 }))
    .catch(() => ({ data: 0 }));

  report.summary.totalDrivers = driverCount as number;

  const { data: dateRange } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT
          min(event_timestamp)::text as start,
          max(event_timestamp)::text as end
        FROM eld_events
      `,
    })
    .then(({ data }) => ({ data: data?.[0] }))
    .catch(() => ({ data: null }));

  if (dateRange) {
    report.summary.dateRange = {
      start: dateRange.start || '',
      end: dateRange.end || '',
    };
  }

  report.summary.avgEventsPerDriver =
    report.summary.totalDrivers > 0
      ? Math.round(report.summary.totalEvents / report.summary.totalDrivers)
      : 0;

  // Collect performance data
  const { data: partitions } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT count(*) as count
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        WHERE parent.relname = 'eld_events'
      `,
    })
    .then(({ data }) => ({ data: data?.[0]?.count || 0 }))
    .catch(() => ({ data: 0 }));

  report.performance.partitionCount = partitions as number;

  const { data: sizeData } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT
          pg_size_pretty(pg_relation_size('eld_events'))::text as table_size,
          pg_size_pretty(pg_indexes_size('eld_events'))::text as index_size
      `,
    })
    .then(({ data }) => ({ data: data?.[0] }))
    .catch(() => ({ data: null }));

  if (sizeData) {
    report.performance.tableSizeMB = sizeData.table_size || 'N/A';
    report.performance.indexSizeMB = sizeData.index_size || 'N/A';
  }

  // Identify bottlenecks
  if (report.summary.totalEvents > 0) {
    const avgRowsPerPartition =
      report.performance.partitionCount > 0
        ? report.summary.totalEvents / report.performance.partitionCount
        : 0;

    if (avgRowsPerPartition > 100000) {
      report.bottlenecks.push(
        `⚠️  High partition density (${Math.round(avgRowsPerPartition).toLocaleString()} events/partition) - consider archiving old data`
      );
    }

    if (report.performance.partitionCount < 3) {
      report.bottlenecks.push('⚠️  Low partition count - verify partition maintenance is running');
    }

    // Check for future partitions
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const nextMonthPartition = `eld_events_y${nextMonth.getFullYear()}m${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

    const { data: hasNextMonth } = await supabase
      .rpc('sql' as any, {
        query: `
          SELECT EXISTS (
            SELECT 1 FROM pg_class WHERE relname = '${nextMonthPartition}'
          ) as exists
        `,
      })
      .then(({ data }) => ({ data: data?.[0]?.exists }))
      .catch(() => ({ data: false }));

    if (!hasNextMonth) {
      report.bottlenecks.push(
        `⚠️  Next month partition (${nextMonthPartition}) not found - run maintain_eld_events_partitions()`
      );
    }
  }

  // Generate recommendations
  report.recommendations = [
    '✅ Run ANALYZE eld_events monthly to update query planner statistics',
    '✅ Schedule SELECT maintain_eld_events_partitions() via cron (monthly)',
    '✅ Monitor partition sizes via eld_events_partition_info view',
    '✅ Always include event_timestamp in WHERE clauses for partition pruning',
    '✅ Use batch inserts (500-1000 events) for optimal throughput',
    '✅ Archive partitions older than 6 months to cold storage',
  ];

  if (report.summary.totalEvents < 1000) {
    report.recommendations.push(
      '💡 Current dataset is small - run load-test.ts to generate realistic test data'
    );
  }

  if (report.performance.partitionCount === 0) {
    report.recommendations.push(
      '⚠️  No partitions detected - apply migration 20240120000000_partition_eld_events.sql'
    );
  }

  // Get partition details
  const { data: partitionList } = await supabase
    .rpc('sql' as any, {
      query: `
        SELECT
          child.relname as name,
          pg_get_expr(child.relpartbound, child.oid) as range,
          pg_size_pretty(pg_total_relation_size(child.oid)) as size,
          stat.n_tup_ins as inserts
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        LEFT JOIN pg_stat_all_tables stat ON stat.relid = child.oid
        WHERE parent.relname = 'eld_events'
        ORDER BY child.relname DESC
        LIMIT 12
      `,
    })
    .catch(() => ({ data: [] }));

  report.partitionDetails = partitionList || [];

  return report;
}

function formatReportConsole(report: PerformanceReport) {
  console.log('\n' + '═'.repeat(80));
  console.log('ELD EVENTS PERFORMANCE REPORT');
  console.log('═'.repeat(80));
  console.log(`Generated: ${new Date(report.timestamp).toLocaleString()}`);
  console.log();

  console.log('📊 SUMMARY');
  console.log('─'.repeat(80));
  console.log(`  Total Events:        ${report.summary.totalEvents.toLocaleString()}`);
  console.log(`  Total Drivers:       ${report.summary.totalDrivers.toLocaleString()}`);
  console.log(`  Avg Events/Driver:   ${report.summary.avgEventsPerDriver.toLocaleString()}`);
  console.log(
    `  Date Range:          ${report.summary.dateRange.start.split('T')[0]} to ${report.summary.dateRange.end.split('T')[0]}`
  );
  console.log();

  console.log('⚡ PERFORMANCE');
  console.log('─'.repeat(80));
  console.log(`  Partition Count:     ${report.performance.partitionCount}`);
  console.log(`  Table Size:          ${report.performance.tableSizeMB}`);
  console.log(`  Index Size:          ${report.performance.indexSizeMB}`);
  console.log();

  if (report.partitionDetails.length > 0) {
    console.log('🗂️  PARTITIONS (Recent)');
    console.log('─'.repeat(80));
    report.partitionDetails.slice(0, 6).forEach((p) => {
      console.log(
        `  ${p.name.padEnd(25)} ${p.size.padEnd(10)} ${(p.inserts || 0).toLocaleString()} events`
      );
    });
    console.log();
  }

  if (report.bottlenecks.length > 0) {
    console.log('⚠️  BOTTLENECKS');
    console.log('─'.repeat(80));
    report.bottlenecks.forEach((b) => console.log(`  ${b}`));
    console.log();
  } else {
    console.log('✅ NO BOTTLENECKS DETECTED');
    console.log();
  }

  console.log('💡 RECOMMENDATIONS');
  console.log('─'.repeat(80));
  report.recommendations.forEach((r) => console.log(`  ${r}`));
  console.log();

  console.log('═'.repeat(80));
}

function formatReportMarkdown(report: PerformanceReport): string {
  const md: string[] = [];

  md.push('# ELD Events Performance Report\n');
  md.push(`**Generated**: ${new Date(report.timestamp).toLocaleString()}\n`);
  md.push('---\n');

  md.push('## Summary\n');
  md.push('| Metric | Value |');
  md.push('|--------|-------|');
  md.push(`| Total Events | ${report.summary.totalEvents.toLocaleString()} |`);
  md.push(`| Total Drivers | ${report.summary.totalDrivers.toLocaleString()} |`);
  md.push(`| Avg Events per Driver | ${report.summary.avgEventsPerDriver.toLocaleString()} |`);
  md.push(
    `| Date Range | ${report.summary.dateRange.start.split('T')[0]} to ${report.summary.dateRange.end.split('T')[0]} |`
  );
  md.push('');

  md.push('## Performance Metrics\n');
  md.push('| Metric | Value |');
  md.push('|--------|-------|');
  md.push(`| Partition Count | ${report.performance.partitionCount} |`);
  md.push(`| Table Size | ${report.performance.tableSizeMB} |`);
  md.push(`| Index Size | ${report.performance.indexSizeMB} |`);
  md.push('');

  if (report.partitionDetails.length > 0) {
    md.push('## Recent Partitions\n');
    md.push('| Partition | Size | Events |');
    md.push('|-----------|------|--------|');
    report.partitionDetails.slice(0, 12).forEach((p) => {
      md.push(`| ${p.name} | ${p.size} | ${(p.inserts || 0).toLocaleString()} |`);
    });
    md.push('');
  }

  if (report.bottlenecks.length > 0) {
    md.push('## ⚠️ Bottlenecks\n');
    report.bottlenecks.forEach((b) => md.push(`- ${b}`));
    md.push('');
  }

  md.push('## Recommendations\n');
  report.recommendations.forEach((r) => md.push(`- ${r}`));
  md.push('');

  md.push('---');
  md.push('*Report generated by generate-performance-report.ts*');

  return md.join('\n');
}

async function main() {
  console.log('Generating performance report...\n');

  const report = await generateReport();

  // Display to console
  formatReportConsole(report);

  // Export to markdown file
  const markdown = formatReportMarkdown(report);
  const outputPath = join(process.cwd(), 'docs', 'PERFORMANCE_REPORT.md');

  writeFileSync(outputPath, markdown);

  console.log(`📄 Report saved to: ${outputPath}`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
