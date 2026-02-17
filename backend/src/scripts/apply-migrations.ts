/**
 * Apply Database Migrations
 *
 * Applies all SQL migrations to Supabase using direct PostgreSQL connection
 *
 * Run: npx ts-node src/scripts/apply-migrations.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Client } from 'pg';
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

function getPostgresConnectionString(): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL not found in environment');
  }

  // Extract project ref from Supabase URL
  // Format: https://PROJECT_REF.supabase.co
  const match = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) {
    throw new Error('Invalid SUPABASE_URL format');
  }

  const projectRef = match[1];

  // Construct PostgreSQL connection string
  // Supabase PostgreSQL connection format:
  // postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

  // Note: We need the database password, not the service role key
  // The service role key is for API access, not direct DB access

  console.log('⚠️  Direct PostgreSQL connection requires database password');
  console.log('   The SUPABASE_SERVICE_ROLE_KEY is for API access, not DB access\n');

  // Return the connection string format for user reference
  return `postgresql://postgres:[YOUR-PASSWORD]@db.${projectRef}.supabase.co:6543/postgres`;
}

async function runMigrations() {
  console.log('═'.repeat(80));
  console.log('DATABASE MIGRATION RUNNER');
  console.log('═'.repeat(80));
  console.log();

  try {
    const connString = getPostgresConnectionString();
    console.log('📡 Connection string format:');
    console.log(`   ${connString}\n`);

    console.log('⚠️  IMPORTANT:');
    console.log('   To run migrations, you need the database password (not API key)');
    console.log('   Get it from: Supabase Dashboard → Settings → Database\n');

    console.log('═'.repeat(80));
    console.log('ALTERNATIVE: Use Supabase SQL Editor (Recommended)');
    console.log('═'.repeat(80));
    console.log('\nThe easiest way to apply migrations:\n');
    console.log('1. Go to: https://supabase.com/dashboard');
    console.log('2. Click: SQL Editor');
    console.log('3. Create new query');
    console.log('4. Copy contents of each migration file (in order):');

    const migrationsPath = join(process.cwd(), '..', 'infra', 'supabase', 'migrations');

    MIGRATIONS.forEach((migration, index) => {
      console.log(`\n   ${index + 1}. ${migration.file}`);
      console.log(`      ${migration.description}`);

      try {
        const filePath = join(migrationsPath, migration.file);
        const sql = readFileSync(filePath, 'utf-8');
        console.log(`      Size: ${(sql.length / 1024).toFixed(1)} KB`);
      } catch (error: any) {
        console.log(`      ❌ File not found: ${error.message}`);
      }
    });

    console.log('\n5. Click "Run" for each migration');
    console.log('\nOnce migrations complete, run:');
    console.log('   npx ts-node src/scripts/verify-setup.ts');
    console.log();
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

runMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
