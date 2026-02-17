/**
 * Migration Runner Script
 *
 * Applies database migrations to Supabase
 *
 * Run: npx ts-node src/scripts/run-migrations.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = [
  {
    name: 'Core Schema',
    file: '20240110000000_complete_core_schema.sql',
    description: 'Creates all base tables, RLS policies, and helper functions',
  },
  {
    name: 'Constraints & Indexes',
    file: '20240115000000_add_constraints_indexes.sql',
    description: 'Adds performance indexes and data integrity constraints',
  },
  {
    name: 'Table Partitioning',
    file: '20240120000000_partition_eld_events.sql',
    description: 'Converts eld_events to partitioned table with monthly partitions',
  },
];

async function runMigration(name: string, sql: string): Promise<boolean> {
  console.log(`\n📝 Running migration: ${name}...`);

  try {
    // Split SQL into individual statements (simple split by semicolon)
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Skip comments and empty statements
      if (!stmt || stmt.startsWith('--') || stmt.length < 10) {
        continue;
      }

      try {
        // Use rpc to execute raw SQL
        const { error } = await supabase.rpc('exec_sql' as any, {
          query: stmt + ';',
        });

        if (error) {
          // Some errors are acceptable (e.g., "already exists")
          if (
            error.message.includes('already exists') ||
            error.message.includes('does not exist')
          ) {
            console.log(`  ⚠️  Statement ${i + 1}: ${error.message.substring(0, 80)}...`);
          } else {
            console.log(`  ❌ Statement ${i + 1}: ${error.message.substring(0, 80)}...`);
            errorCount++;
          }
        } else {
          successCount++;
          if ((i + 1) % 10 === 0) {
            console.log(`  ✅ Executed ${i + 1}/${statements.length} statements...`);
          }
        }
      } catch (err: any) {
        console.log(`  ❌ Statement ${i + 1} error: ${err.message.substring(0, 80)}...`);
        errorCount++;
      }
    }

    console.log(`\n  Summary: ${successCount} succeeded, ${errorCount} errors`);
    return errorCount === 0;
  } catch (error: any) {
    console.error(`  ❌ Migration failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('DATABASE MIGRATION RUNNER');
  console.log('═'.repeat(80));
  console.log('\nThis will apply all migrations to your Supabase database.\n');

  const migrationsPath = join(process.cwd(), '..', 'infra', 'supabase', 'migrations');

  for (const migration of MIGRATIONS) {
    try {
      const filePath = join(migrationsPath, migration.file);
      console.log(`\n📂 Reading: ${migration.file}`);
      console.log(`   ${migration.description}`);

      const sql = readFileSync(filePath, 'utf-8');
      console.log(`   Size: ${(sql.length / 1024).toFixed(1)} KB`);

      // Note: Supabase doesn't have a built-in exec_sql RPC by default
      // We'll need to use a different approach
      console.log(
        `\n⚠️  Cannot execute via RPC - Supabase doesn't support arbitrary SQL execution via API`
      );
      console.log(`   You need to run this manually in Supabase SQL Editor:`);
      console.log(`   1. Go to https://supabase.com/dashboard`);
      console.log(`   2. Navigate to SQL Editor`);
      console.log(`   3. Copy and paste the contents of: ${migration.file}`);
      console.log(`   4. Click "Run"`);
    } catch (error: any) {
      console.error(`❌ Error reading migration file: ${error.message}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('MANUAL MIGRATION REQUIRED');
  console.log('═'.repeat(80));
  console.log('\nSupabase API does not allow executing arbitrary DDL statements.');
  console.log('You must apply migrations manually through the Supabase Dashboard.\n');
  console.log('See docs/SETUP_STEPS.md for detailed instructions.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
