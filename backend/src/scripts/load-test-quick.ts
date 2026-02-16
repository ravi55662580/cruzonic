/**
 * Quick Load Test - Smaller dataset for rapid testing
 *
 * Configuration:
 * - 10 drivers
 * - 7 days
 * - ~3,500 events
 *
 * Run: npx ts-node src/scripts/load-test-quick.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runQuickTest() {
  console.log('🚀 Running Quick Load Test (10 drivers × 7 days)...\n');

  // Modify the main load test script temporarily
  const config = `
const CONFIG = {
  NUM_DRIVERS: 10,
  NUM_DAYS: 7,
  BATCH_SIZE: 100,
  EVENTS_PER_MINUTE_DRIVING: 1,
  AVERAGE_SHIFT_HOURS: 10,
  VERBOSE: true,
};
  `.trim();

  console.log('Configuration:');
  console.log(config);
  console.log();

  // Note: This is a wrapper - actual implementation would modify CONFIG
  // For now, you can manually edit CONFIG in load-test.ts and run:
  console.log('To run quick test:');
  console.log('1. Edit backend/src/scripts/load-test.ts');
  console.log('2. Change CONFIG.NUM_DRIVERS to 10');
  console.log('3. Change CONFIG.NUM_DAYS to 7');
  console.log('4. Run: npx ts-node src/scripts/load-test.ts');
  console.log();
  console.log('Expected results:');
  console.log('  - ~3,500 events');
  console.log('  - ~30 seconds total time');
  console.log('  - Insert throughput: 100-200 events/sec');
  console.log('  - Query performance: <50ms for single driver');
}

runQuickTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
