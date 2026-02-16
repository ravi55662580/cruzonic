/**
 * Setup Verification Script
 *
 * Checks if all prerequisites for load testing are met
 *
 * Run: npx ts-node src/scripts/verify-setup.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';

async function verifySetup() {
  console.log('🔍 Verifying Load Test Setup\n');
  console.log('═'.repeat(80));

  const checks = {
    connection: false,
    eldEventsTable: false,
    partitionedTable: false,
    partitionFunctions: false,
    sampleData: false,
  };

  // Check 1: Supabase Connection
  try {
    const { error } = await supabase.from('carriers').select('count').limit(1);
    if (!error) {
      console.log('✅ Supabase connection successful');
      checks.connection = true;
    } else {
      console.log(`❌ Supabase connection failed: ${error.message}`);
    }
  } catch (error: any) {
    console.log(`❌ Supabase connection error: ${error.message}`);
  }

  // Check 2: eld_events table exists
  try {
    const { error } = await supabase.from('eld_events').select('count').limit(1);
    if (!error) {
      console.log('✅ eld_events table exists');
      checks.eldEventsTable = true;
    } else {
      console.log(`❌ eld_events table not found: ${error.message}`);
    }
  } catch (error: any) {
    console.log(`❌ eld_events table error: ${error.message}`);
  }

  // Check 3: Partitioned table (check for partitions)
  if (checks.connection) {
    try {
      const { data, error } = await supabase.rpc('sql' as any, {
        query: `
          SELECT count(*) as count
          FROM pg_inherits
          JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
          WHERE parent.relname = 'eld_events'
        `,
      });

      if (!error && data && data[0]?.count > 0) {
        console.log(`✅ Partitioned table detected (${data[0].count} partitions)`);
        checks.partitionedTable = true;
      } else {
        console.log('⚠️  eld_events table is not partitioned');
      }
    } catch (error: any) {
      console.log('⚠️  Could not check partitioning (may need direct DB access)');
    }
  }

  // Check 4: Partition management functions
  if (checks.connection) {
    try {
      await supabase.rpc('create_eld_events_partition', {
        partition_start: '2099-01-01T00:00:00Z',
        partition_end: '2099-02-01T00:00:00Z',
      });
      console.log('✅ Partition management functions available');
      checks.partitionFunctions = true;
    } catch (error: any) {
      console.log('❌ Partition management functions not found');
    }
  }

  // Check 5: Sample data exists
  if (checks.eldEventsTable) {
    try {
      const { count } = await supabase
        .from('eld_events')
        .select('*', { count: 'exact', head: true });

      if (count && count > 0) {
        console.log(`✅ Sample data exists (${count} events)`);
        checks.sampleData = true;
      } else {
        console.log('⚠️  No events in database (ready for load test)');
      }
    } catch (error: any) {
      console.log(`⚠️  Could not check sample data: ${error.message}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('SETUP STATUS');
  console.log('═'.repeat(80) + '\n');

  const allChecks = Object.values(checks).every((v) => v);
  const readyForLoadTest =
    checks.connection && checks.eldEventsTable && checks.partitionedTable;

  if (allChecks) {
    console.log('🎉 All checks passed! Ready for load testing.\n');
    console.log('Next steps:');
    console.log('  1. Run: npx ts-node src/scripts/load-test.ts');
    console.log('  2. After test: npx ts-node src/scripts/analyze-load-test.ts');
    console.log('  3. Generate report: npx ts-node src/scripts/generate-performance-report.ts');
  } else if (readyForLoadTest) {
    console.log('✅ Ready for load testing!\n');
    console.log('Next steps:');
    console.log('  Run: npx ts-node src/scripts/load-test.ts');
  } else {
    console.log('⚠️  Setup incomplete. Please complete the following:\n');

    if (!checks.connection) {
      console.log('❌ Fix Supabase connection:');
      console.log('   - Check .env file has correct SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
      console.log('   - Verify credentials are valid');
      console.log();
    }

    if (!checks.eldEventsTable) {
      console.log('❌ Apply database migrations:');
      console.log('   1. Run: infra/supabase/migrations/20240110000000_complete_core_schema.sql');
      console.log('   2. Run: infra/supabase/migrations/20240115000000_add_constraints_indexes.sql');
      console.log('   3. Run: infra/supabase/migrations/20240120000000_partition_eld_events.sql');
      console.log();
    }

    if (checks.eldEventsTable && !checks.partitionedTable) {
      console.log('⚠️  Apply partitioning migration:');
      console.log('   Run: infra/supabase/migrations/20240120000000_partition_eld_events.sql');
      console.log();
    }

    if (checks.partitionedTable && !checks.partitionFunctions) {
      console.log('⚠️  Partition functions missing (should be created by migration)');
      console.log('   Verify migration 20240120000000_partition_eld_events.sql ran completely');
      console.log();
    }
  }

  console.log('═'.repeat(80));
}

verifySetup()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nError:', error.message);
    process.exit(1);
  });
