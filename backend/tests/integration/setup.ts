/**
 * Integration Test Setup
 *
 * Configures test environment for integration tests against real database.
 */

// IMPORTANT: Load environment variables FIRST before any imports that depend on them
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// Now import modules that depend on environment variables
import { supabase } from '../../src/config/supabase';
import { logger } from '../../src/utils/logger';

/**
 * Setup function to run before all tests
 */
export async function setupTests() {
  logger.info('Setting up integration tests');

  // Verify database connection
  const { error } = await supabase.from('carriers').select('id').limit(1);

  if (error) {
    logger.error('Failed to connect to test database', { error });
    throw new Error('Database connection failed. Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.test');
  }

  logger.info('Test database connection verified');
}

/**
 * Teardown function to run after all tests
 */
export async function teardownTests() {
  logger.info('Tearing down integration tests');
  // Cleanup is handled by transaction rollback in individual tests
}

/**
 * Create a test carrier for use in tests
 */
export async function createTestCarrier() {
  // Generate 7-digit DOT number (fits in VARCHAR(8))
  const dotNumber = String(Date.now()).slice(-7);

  const { data, error } = await supabase
    .from('carriers')
    .insert({
      dot_number: dotNumber,
      legal_name: 'Test Carrier Inc',
      address_line1: '123 Test St',
      city: 'Test City',
      state: 'CA',
      zip: '90001',
      phone: '+15555551234',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test carrier: ${error.message}`);
  }

  return data;
}

/**
 * Create a test driver for use in tests
 */
export async function createTestDriver(carrierId: string) {
  const timestamp = Date.now();

  const { data, error } = await supabase
    .from('drivers')
    .insert({
      carrier_id: carrierId,
      driver_eld_account_id: `TEST${timestamp}`,
      full_name: 'Test Driver',
      email: `test${timestamp}@example.com`,
      phone: '+15555555555',
      license_number: `DL${timestamp}`,
      license_state: 'CA',
      license_class: 'A',
      license_expiry: '2025-12-31',
      home_terminal_timezone: 'America/Los_Angeles',
      hos_ruleset: 'USA_PROPERTY_70H_8D',
      status: 'offline',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test driver: ${error.message}`);
  }

  return data;
}

/**
 * Delete test carrier and all related data
 */
export async function deleteTestCarrier(carrierId: string) {
  // Delete in reverse order of foreign keys
  await supabase.from('eld_events').delete().eq('carrier_id', carrierId);
  await supabase.from('drivers').delete().eq('carrier_id', carrierId);
  await supabase.from('carriers').delete().eq('id', carrierId);
}

/**
 * Delete test driver and all related data
 */
export async function deleteTestDriver(driverId: string) {
  await supabase.from('eld_events').delete().eq('driver_id', driverId);
  await supabase.from('log_periods').delete().eq('driver_id', driverId);
  await supabase.from('drivers').delete().eq('id', driverId);
}
