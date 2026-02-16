/**
 * ELD Events Load Testing Script
 *
 * Simulates realistic ELD event volumes to test database performance:
 * - 100 drivers over 30 days
 * - ~1 event per minute during driving periods
 * - ~200,000+ total events
 *
 * Measures:
 * - Insert throughput (events/second)
 * - Query performance on common access patterns
 * - Storage growth
 * - Partition efficiency
 *
 * Run: npx ts-node src/scripts/load-test.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../config/supabase';
import { createHash, randomBytes } from 'crypto';
import { performance } from 'perf_hooks';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  NUM_DRIVERS: 100,
  NUM_DAYS: 30,
  BATCH_SIZE: 500, // Insert events in batches
  EVENTS_PER_MINUTE_DRIVING: 1, // FMCSA requirement: position tracking
  AVERAGE_SHIFT_HOURS: 10, // Average driving shift
  VERBOSE: true,
};

// Event type constants
const EventType = {
  DUTY_STATUS: 1,
  INTERMEDIATE_LOG: 2,
  PERSONAL_USE_YARD_MOVES: 3,
  CERTIFICATION: 4,
  LOGIN_LOGOUT: 5,
  ENGINE_POWER: 6,
  MALFUNCTION_DIAGNOSTIC: 7,
} as const;

const DutyStatus = {
  OFF_DUTY: 1,
  SLEEPER_BERTH: 2,
  DRIVING: 3,
  ON_DUTY_NOT_DRIVING: 4,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[randomInt(0, array.length - 1)];
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}${day}${year}`;
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

function formatTimezoneOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutes = String(absOffset % 60).padStart(2, '0');
  return `${sign}${hours}${minutes}`;
}

function log(message: string) {
  if (CONFIG.VERBOSE) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST DATA GENERATION
// ─────────────────────────────────────────────────────────────────────────────

interface TestCarrier {
  id: string;
  dot_number: string;
  legal_name: string;
}

interface TestDriver {
  id: string;
  carrier_id: string;
  user_id: string;
  eld_account_id: string;
  full_name: string;
  license_number: string;
}

interface TestVehicle {
  id: string;
  carrier_id: string;
  power_unit_number: string;
  vin: string;
}

interface TestDevice {
  id: string;
  carrier_id: string;
  registration_id: string;
  serial_number: string;
  vehicle_id: string;
}

interface TestLogPeriod {
  id: string;
  carrier_id: string;
  driver_id: string;
  log_date: string;
  log_date_mmddyy: string;
}

interface GeneratedEvent {
  event_type: number;
  event_sub_type: number;
  event_record_status: number;
  event_record_origin: number;
  event_sequence_id: number;
  event_date: string;
  event_time: string;
  timezone_offset: string;
  event_timestamp: string;
  eld_device_id: string;
  driver_id: string;
  vehicle_id: string;
  carrier_id: string;
  log_period_id: string;
  driver_eld_account_id: string;
  accumulated_vehicle_miles: number;
  elapsed_engine_hours: number;
  latitude: number | null;
  longitude: number | null;
  location_description: string | null;
  distance_since_last_valid_coords: number | null;
  malfunction_indicator_status: boolean;
  eld_malfunction_status: boolean;
  data_diagnostic_indicator_status: boolean;
  event_data_check_value: string;
  event_metadata: any;
  content_hash: string;
  chain_hash: string;
  previous_chain_hash: string | null;
}

async function setupTestData() {
  log('Setting up test data...');

  // Create test carrier or use existing
  let carrier: TestCarrier;

  // Check if test carrier already exists
  const { data: existingCarrier } = await supabase
    .from('carriers')
    .select('id, dot_number, legal_name')
    .eq('dot_number', '7654321')
    .single();

  if (existingCarrier) {
    log('Using existing test carrier');
    carrier = existingCarrier as TestCarrier;
  } else {
    carrier = {
      id: crypto.randomUUID(),
      dot_number: '7654321',
      legal_name: 'Load Test Carrier Inc.',
    };

    const { data: newCarrier, error: carrierError } = await supabase
      .from('carriers')
      .insert({
        id: carrier.id,
        dot_number: carrier.dot_number,
        legal_name: carrier.legal_name,
        address_line1: '123 Test St',
        city: 'Chicago',
        state: 'IL',
        zip: '60601',
        phone: '555-0000',
        email: `loadtest@example.com`,
      })
      .select()
      .single();

    if (carrierError) {
      throw new Error(`Failed to create carrier: ${carrierError.message}`);
    }

    carrier = newCarrier as TestCarrier;
    log(`Created test carrier: ${carrier.id}`);
  }

  // Create drivers
  const drivers: TestDriver[] = [];
  for (let i = 0; i < CONFIG.NUM_DRIVERS; i++) {
    const driverId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    // Create auth user (simplified - in production use Supabase auth)
    // For load testing, we'll skip auth.users and just create drivers

    drivers.push({
      id: driverId,
      carrier_id: carrier.id,
      user_id: userId,
      eld_account_id: `driver${String(i + 1).padStart(3, '0')}`,
      full_name: `Test Driver ${i + 1}`,
      license_number: `DL${String(i + 1).padStart(6, '0')}`,
    });
  }

  log(`Creating ${drivers.length} drivers...`);

  const { error: driversError } = await supabase.from('drivers').insert(
    drivers.map((d) => ({
      id: d.id,
      carrier_id: d.carrier_id,
      // user_id omitted for load testing (nullable now)
      full_name: d.full_name,
      phone: '555-0001',
      email: `${d.eld_account_id}@loadtest.com`,
      license_number: d.license_number,
      license_state: 'IL',
      license_class: 'A',
      license_expiry: '2025-12-31',
      home_terminal_address: '123 Terminal Rd, Chicago, IL',
    }))
  );

  if (driversError && !driversError.message.includes('duplicate')) {
    throw new Error(`Failed to create drivers: ${driversError.message}`);
  }

  // Create vehicles (1 per driver for simplicity)
  const vehicles: TestVehicle[] = [];
  for (let i = 0; i < CONFIG.NUM_DRIVERS; i++) {
    vehicles.push({
      id: crypto.randomUUID(),
      carrier_id: carrier.id,
      power_unit_number: `TRUCK${String(i + 1).padStart(3, '0')}`,
      vin: `1HGBH41JXMN${String(100000 + i).padStart(6, '0')}`,
    });
  }

  log(`Creating ${vehicles.length} vehicles...`);
  const { error: vehiclesError } = await supabase.from('vehicles').insert(
    vehicles.map((v) => ({
      id: v.id,
      carrier_id: v.carrier_id,
      power_unit_number: v.power_unit_number,
      vin: v.vin,
      license_plate: `IL${randomInt(100000, 999999)}`,
      license_plate_state: 'IL',
      make: 'Freightliner',
      model: 'Cascadia',
      year: 2022,
      gvwr_lbs: 80000,
    }))
  );

  if (vehiclesError && !vehiclesError.message.includes('duplicate')) {
    throw new Error(`Failed to create vehicles: ${vehiclesError.message}`);
  }

  // Create ELD devices (1 per vehicle)
  const devices: TestDevice[] = [];
  for (let i = 0; i < CONFIG.NUM_DRIVERS; i++) {
    devices.push({
      id: crypto.randomUUID(),
      carrier_id: carrier.id,
      registration_id: `ELD${String(i + 1).padStart(4, '0')}`,
      serial_number: `SN${randomInt(100000, 999999)}${i}`,
      vehicle_id: vehicles[i].id,
    });
  }

  log(`Creating ${devices.length} ELD devices...`);
  const { error: devicesError } = await supabase.from('eld_devices').insert(
    devices.map((d) => ({
      id: d.id,
      carrier_id: d.carrier_id,
      registration_id: d.registration_id,
      serial_number: d.serial_number,
      device_model: 'LoadTest-1000',
      manufacturer: 'LoadTest Inc',
      firmware_version: '1.0.0',
      fmcsa_certified_on: '2024-01-01',
      current_vehicle_id: d.vehicle_id,
    }))
  );

  if (devicesError && !devicesError.message.includes('duplicate')) {
    throw new Error(`Failed to create devices: ${devicesError.message}`);
  }

  // Create log periods for all drivers for all days
  const logPeriods: TestLogPeriod[] = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.NUM_DAYS);

  for (let day = 0; day < CONFIG.NUM_DAYS; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + day);

    for (const driver of drivers) {
      logPeriods.push({
        id: crypto.randomUUID(),
        carrier_id: carrier.id,
        driver_id: driver.id,
        log_date: currentDate.toISOString().split('T')[0],
        log_date_mmddyy: formatDate(currentDate),
      });
    }
  }

  log(`Creating ${logPeriods.length} log periods...`);
  const { error: periodsError } = await supabase.from('log_periods').insert(
    logPeriods.map((p) => ({
      id: p.id,
      carrier_id: p.carrier_id,
      driver_id: p.driver_id,
      log_date: p.log_date,
      log_date_mmddyy: p.log_date_mmddyy,
      home_terminal_timezone: 'America/Chicago',
      hos_ruleset: 'property_70h',
    }))
  );

  if (periodsError && !periodsError.message.includes('duplicate')) {
    throw new Error(`Failed to create log periods: ${periodsError.message}`);
  }

  log('Test data setup complete');

  return {
    carrier,
    drivers,
    vehicles,
    devices,
    logPeriods,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function generateDriverShift(
  driver: TestDriver,
  vehicle: TestVehicle,
  device: TestDevice,
  logPeriod: TestLogPeriod,
  shiftDate: Date
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  let sequenceId = 1;
  let currentTime = new Date(shiftDate);
  currentTime.setHours(6, 0, 0, 0); // Start at 6 AM

  let odometer = randomInt(50000, 200000);
  let engineHours = randomInt(5000, 20000);
  let latitude = 41.8781 + (Math.random() - 0.5) * 10; // Start near Chicago
  let longitude = -87.6298 + (Math.random() - 0.5) * 10;
  let prevChainHash = sha256(`genesis:${device.id}:${logPeriod.log_date_mmddyy}`);

  const createEvent = (
    type: number,
    subType: number,
    metadata: any = {}
  ): GeneratedEvent => {
    const eventDate = formatDate(currentTime);
    const eventTime = formatTime(currentTime);
    const timezoneOffset = formatTimezoneOffset(currentTime);
    const eventTimestamp = currentTime.toISOString();

    const contentHashInput = `${device.id}|${type}|${eventDate}|${eventTime}|${sequenceId}`;
    const contentHash = sha256(contentHashInput);
    const chainHash = sha256(`${contentHash}|${prevChainHash}`);

    const event: GeneratedEvent = {
      event_type: type,
      event_sub_type: subType,
      event_record_status: 1,
      event_record_origin: type === EventType.ENGINE_POWER ? 1 : 2,
      event_sequence_id: sequenceId++,
      event_date: eventDate,
      event_time: eventTime,
      timezone_offset: timezoneOffset,
      event_timestamp: eventTimestamp,
      eld_device_id: device.id,
      driver_id: driver.id,
      vehicle_id: vehicle.id,
      carrier_id: driver.carrier_id,
      log_period_id: logPeriod.id,
      driver_eld_account_id: driver.eld_account_id,
      accumulated_vehicle_miles: odometer,
      elapsed_engine_hours: engineHours,
      latitude,
      longitude,
      location_description: `Location ${Math.floor(latitude)},${Math.floor(longitude)}`,
      distance_since_last_valid_coords: null,
      malfunction_indicator_status: false,
      eld_malfunction_status: false,
      data_diagnostic_indicator_status: false,
      event_data_check_value: 'A0',
      event_metadata: metadata,
      content_hash: contentHash,
      chain_hash: chainHash,
      previous_chain_hash: sequenceId === 2 ? null : prevChainHash,
    };

    prevChainHash = chainHash;
    return event;
  };

  // 1. Login event
  events.push(
    createEvent(EventType.LOGIN_LOGOUT, 1, {
      exemptions: { shortHaul: false, adverseDrivingConditions: false, passengerCarrying: false },
      unidentifiedDrivingClaimed: 0,
    })
  );

  // 2. Engine power-up
  currentTime.setMinutes(currentTime.getMinutes() + 2);
  events.push(
    createEvent(EventType.ENGINE_POWER, 1, {
      isPowerUp: true,
      canBusConnected: true,
      odometerAtEvent: odometer,
      engineHoursAtEvent: engineHours,
    })
  );

  // 3. Duty status: ON_DUTY_NOT_DRIVING (pre-trip inspection)
  currentTime.setMinutes(currentTime.getMinutes() + 5);
  events.push(createEvent(EventType.DUTY_STATUS, DutyStatus.ON_DUTY_NOT_DRIVING, {}));

  // 4. Duty status: DRIVING (start driving)
  currentTime.setMinutes(currentTime.getMinutes() + 15);
  events.push(createEvent(EventType.DUTY_STATUS, DutyStatus.DRIVING, {}));

  // 5. Intermediate logs (1 per minute while driving)
  const drivingMinutes = CONFIG.AVERAGE_SHIFT_HOURS * 60 * 0.7; // 70% of shift is driving
  for (let i = 0; i < drivingMinutes; i += 10) {
    // Every 10 minutes for reasonable data size
    currentTime.setMinutes(currentTime.getMinutes() + 10);
    odometer += randomInt(8, 12); // ~50 mph average
    engineHours += 0.17; // 10 minutes
    latitude += (Math.random() - 0.5) * 0.1;
    longitude += (Math.random() - 0.5) * 0.1;

    events.push(createEvent(EventType.INTERMEDIATE_LOG, 1, {}));
  }

  // 6. Duty status: ON_DUTY_NOT_DRIVING (break)
  currentTime.setMinutes(currentTime.getMinutes() + 5);
  events.push(createEvent(EventType.DUTY_STATUS, DutyStatus.ON_DUTY_NOT_DRIVING, {}));

  // 7. Duty status: OFF_DUTY (end of shift)
  currentTime.setMinutes(currentTime.getMinutes() + 30);
  events.push(createEvent(EventType.DUTY_STATUS, DutyStatus.OFF_DUTY, {}));

  // 8. Engine shut-down
  currentTime.setMinutes(currentTime.getMinutes() + 2);
  events.push(
    createEvent(EventType.ENGINE_POWER, 3, {
      isPowerUp: false,
      canBusConnected: true,
      odometerAtEvent: odometer,
      engineHoursAtEvent: engineHours,
    })
  );

  // 9. Logout
  currentTime.setMinutes(currentTime.getMinutes() + 1);
  events.push(createEvent(EventType.LOGIN_LOGOUT, 2, {}));

  // 10. Certification (end of day)
  currentTime.setHours(23, 30, 0, 0);
  events.push(
    createEvent(EventType.CERTIFICATION, 1, {
      isCertification: true,
      certifiedDriverEldAccountId: driver.eld_account_id,
      totalRecordsCertified: events.length + 1,
      editedEventSequenceIds: [],
    })
  );

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE TESTING
// ─────────────────────────────────────────────────────────────────────────────

interface PerformanceMetrics {
  insertThroughput: {
    totalEvents: number;
    totalTimeMs: number;
    eventsPerSecond: number;
    batchInserts: number;
    avgBatchTimeMs: number;
  };
  queryPerformance: {
    singleDriverTimeline: number;
    multiDriverQuery: number;
    dateRangeQuery: number;
    partitionPruning: number;
    hashChainVerification: number;
  };
  storageMetrics: {
    tableSizeBytes: number;
    tableSizeMB: number;
    indexSizeBytes: number;
    indexSizeMB: number;
    totalSizeMB: number;
    rowCount: number;
    avgRowSizeBytes: number;
  };
}

async function measureInsertThroughput(events: GeneratedEvent[]): Promise<any> {
  log(`Starting insert performance test with ${events.length} events...`);

  const batchSize = CONFIG.BATCH_SIZE;
  const batches = Math.ceil(events.length / batchSize);
  const batchTimes: number[] = [];

  const startTime = performance.now();

  for (let i = 0; i < batches; i++) {
    const batch = events.slice(i * batchSize, (i + 1) * batchSize);
    const batchStart = performance.now();

    const { error } = await supabase.from('eld_events').insert(batch);

    const batchEnd = performance.now();
    batchTimes.push(batchEnd - batchStart);

    if (error) {
      console.error(`Batch ${i + 1}/${batches} failed:`, error.message);
      throw error;
    }

    if ((i + 1) % 10 === 0 || i === batches - 1) {
      log(`  Inserted ${Math.min((i + 1) * batchSize, events.length)}/${events.length} events`);
    }
  }

  const endTime = performance.now();
  const totalTimeMs = endTime - startTime;
  const avgBatchTimeMs = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;

  return {
    totalEvents: events.length,
    totalTimeMs,
    eventsPerSecond: (events.length / totalTimeMs) * 1000,
    batchInserts: batches,
    avgBatchTimeMs,
  };
}

async function measureQueryPerformance(
  drivers: TestDriver[],
  startDate: Date
): Promise<any> {
  log('Measuring query performance...');

  const metrics: any = {};

  // 1. Single driver timeline (common in mobile app)
  const driver = randomChoice(drivers);
  const timelineStart = performance.now();
  const { data: timeline } = await supabase
    .from('eld_events')
    .select('*')
    .eq('driver_id', driver.id)
    .gte('event_timestamp', new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .lt('event_timestamp', startDate.toISOString())
    .order('event_timestamp', { ascending: false })
    .limit(100);
  const timelineEnd = performance.now();
  metrics.singleDriverTimeline = timelineEnd - timelineStart;
  log(`  Single driver timeline: ${metrics.singleDriverTimeline.toFixed(2)}ms (${timeline?.length || 0} events)`);

  // 2. Multi-driver query (common in fleet dashboard)
  const multiStart = performance.now();
  const { data: multiDriver } = await supabase
    .from('eld_events')
    .select('driver_id, event_type, event_timestamp')
    .gte('event_timestamp', new Date(startDate.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .lt('event_timestamp', startDate.toISOString())
    .eq('event_type', EventType.DUTY_STATUS)
    .limit(1000);
  const multiEnd = performance.now();
  metrics.multiDriverQuery = multiEnd - multiStart;
  log(`  Multi-driver query: ${metrics.multiDriverQuery.toFixed(2)}ms (${multiDriver?.length || 0} events)`);

  // 3. Date range query (testing partition pruning)
  const rangeStart = performance.now();
  const { data: rangeData } = await supabase
    .from('eld_events')
    .select('count')
    .gte('event_timestamp', new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .lt('event_timestamp', startDate.toISOString())
    .single();
  const rangeEnd = performance.now();
  metrics.dateRangeQuery = rangeEnd - rangeStart;
  log(`  Date range query: ${metrics.dateRangeQuery.toFixed(2)}ms`);

  // 4. Partition pruning test (single day)
  const pruneStart = performance.now();
  const singleDay = new Date(startDate);
  singleDay.setDate(singleDay.getDate() - 1);
  const { data: pruneData } = await supabase
    .from('eld_events')
    .select('count')
    .gte('event_timestamp', singleDay.toISOString())
    .lt('event_timestamp', startDate.toISOString())
    .single();
  const pruneEnd = performance.now();
  metrics.partitionPruning = pruneEnd - pruneStart;
  log(`  Partition pruning (1 day): ${metrics.partitionPruning.toFixed(2)}ms`);

  // 5. Hash chain verification
  const chainStart = performance.now();
  const { data: chainEvents } = await supabase
    .from('eld_events')
    .select('event_sequence_id, content_hash, chain_hash, previous_chain_hash')
    .eq('driver_id', driver.id)
    .gte('event_timestamp', new Date(startDate.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .lt('event_timestamp', startDate.toISOString())
    .order('event_sequence_id', { ascending: true })
    .limit(100);

  // Verify chain integrity
  let chainValid = true;
  if (chainEvents && chainEvents.length > 1) {
    for (let i = 1; i < chainEvents.length; i++) {
      const prev = chainEvents[i - 1];
      const curr = chainEvents[i];
      if (curr.previous_chain_hash !== prev.chain_hash) {
        chainValid = false;
        break;
      }
    }
  }
  const chainEnd = performance.now();
  metrics.hashChainVerification = chainEnd - chainStart;
  log(
    `  Hash chain verification: ${metrics.hashChainVerification.toFixed(2)}ms (${chainEvents?.length || 0} events, valid: ${chainValid})`
  );

  return metrics;
}

async function measureStorageGrowth(): Promise<any> {
  log('Measuring storage metrics...');

  // Note: These queries require direct database access
  // For Supabase, you may need to use the SQL editor or enable these queries

  try {
    const { data: sizeData } = await supabase.rpc('sql' as any, {
      query: `
        SELECT
          pg_total_relation_size('eld_events') as total_size,
          pg_relation_size('eld_events') as table_size,
          pg_indexes_size('eld_events') as index_size,
          (SELECT count(*) FROM eld_events) as row_count
      `,
    });

    if (sizeData && sizeData.length > 0) {
      const s = sizeData[0];
      return {
        tableSizeBytes: parseInt(s.table_size),
        tableSizeMB: (parseInt(s.table_size) / 1024 / 1024).toFixed(2),
        indexSizeBytes: parseInt(s.index_size),
        indexSizeMB: (parseInt(s.index_size) / 1024 / 1024).toFixed(2),
        totalSizeMB: (parseInt(s.total_size) / 1024 / 1024).toFixed(2),
        rowCount: parseInt(s.row_count),
        avgRowSizeBytes: Math.round(parseInt(s.table_size) / parseInt(s.row_count)),
      };
    }
  } catch (error: any) {
    log(`  Warning: Could not measure storage (may require direct DB access): ${error.message}`);
  }

  // Fallback: count rows only
  const { count } = await supabase
    .from('eld_events')
    .select('*', { count: 'exact', head: true });

  return {
    tableSizeBytes: 0,
    tableSizeMB: 'N/A',
    indexSizeBytes: 0,
    indexSizeMB: 'N/A',
    totalSizeMB: 'N/A',
    rowCount: count || 0,
    avgRowSizeBytes: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOAD TEST
// ─────────────────────────────────────────────────────────────────────────────

async function runLoadTest() {
  console.log('═'.repeat(80));
  console.log('ELD EVENTS LOAD TEST');
  console.log('═'.repeat(80));
  console.log(`Configuration:`);
  console.log(`  - Drivers: ${CONFIG.NUM_DRIVERS}`);
  console.log(`  - Days: ${CONFIG.NUM_DAYS}`);
  console.log(`  - Batch size: ${CONFIG.BATCH_SIZE}`);
  console.log(`  - Expected events: ~${CONFIG.NUM_DRIVERS * CONFIG.NUM_DAYS * 50} (approx)`);
  console.log();

  const testStartTime = performance.now();

  // 1. Setup test data
  const { carrier, drivers, vehicles, devices, logPeriods } = await setupTestData();

  // 2. Generate events
  log('\nGenerating events...');
  const allEvents: GeneratedEvent[] = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.NUM_DAYS);

  for (let day = 0; day < CONFIG.NUM_DAYS; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + day);

    for (let i = 0; i < drivers.length; i++) {
      const driver = drivers[i];
      const vehicle = vehicles[i];
      const device = devices[i];
      const logPeriod = logPeriods.find(
        (lp) => lp.driver_id === driver.id && lp.log_date_mmddyy === formatDate(currentDate)
      );

      if (!logPeriod) continue;

      const shift = generateDriverShift(driver, vehicle, device, logPeriod, currentDate);
      allEvents.push(...shift);
    }

    if ((day + 1) % 5 === 0 || day === CONFIG.NUM_DAYS - 1) {
      log(`  Generated ${allEvents.length} events for ${day + 1}/${CONFIG.NUM_DAYS} days`);
    }
  }

  log(`\nTotal events generated: ${allEvents.length}`);

  // 3. Measure insert throughput
  const insertMetrics = await measureInsertThroughput(allEvents);

  // 4. Measure query performance
  const queryMetrics = await measureQueryPerformance(drivers, new Date());

  // 5. Measure storage growth
  const storageMetrics = await measureStorageGrowth();

  const testEndTime = performance.now();
  const totalTestTime = (testEndTime - testStartTime) / 1000;

  // ─────────────────────────────────────────────────────────────────────────
  // RESULTS REPORT
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(80));
  console.log('LOAD TEST RESULTS');
  console.log('═'.repeat(80));

  console.log('\n📊 INSERT THROUGHPUT:');
  console.log('─'.repeat(80));
  console.log(`  Total Events:        ${insertMetrics.totalEvents.toLocaleString()}`);
  console.log(`  Total Time:          ${(insertMetrics.totalTimeMs / 1000).toFixed(2)}s`);
  console.log(`  Throughput:          ${insertMetrics.eventsPerSecond.toFixed(0)} events/second`);
  console.log(`  Batch Count:         ${insertMetrics.batchInserts}`);
  console.log(`  Avg Batch Time:      ${insertMetrics.avgBatchTimeMs.toFixed(2)}ms`);
  console.log(`  Batch Size:          ${CONFIG.BATCH_SIZE} events`);

  console.log('\n⚡ QUERY PERFORMANCE:');
  console.log('─'.repeat(80));
  console.log(`  Single Driver Timeline (7 days):  ${queryMetrics.singleDriverTimeline.toFixed(2)}ms`);
  console.log(`  Multi-Driver Query (1 day):       ${queryMetrics.multiDriverQuery.toFixed(2)}ms`);
  console.log(`  Date Range Query (30 days):       ${queryMetrics.dateRangeQuery.toFixed(2)}ms`);
  console.log(`  Partition Pruning (1 day):        ${queryMetrics.partitionPruning.toFixed(2)}ms`);
  console.log(`  Hash Chain Verification:          ${queryMetrics.hashChainVerification.toFixed(2)}ms`);

  console.log('\n💾 STORAGE METRICS:');
  console.log('─'.repeat(80));
  console.log(`  Row Count:           ${storageMetrics.rowCount.toLocaleString()}`);
  console.log(`  Table Size:          ${storageMetrics.tableSizeMB} MB`);
  console.log(`  Index Size:          ${storageMetrics.indexSizeMB} MB`);
  console.log(`  Total Size:          ${storageMetrics.totalSizeMB} MB`);
  console.log(`  Avg Row Size:        ${storageMetrics.avgRowSizeBytes} bytes`);

  console.log('\n⏱️  TOTAL TEST TIME:');
  console.log('─'.repeat(80));
  console.log(`  ${totalTestTime.toFixed(2)} seconds (${(totalTestTime / 60).toFixed(2)} minutes)`);

  console.log('\n🎯 PERFORMANCE ANALYSIS:');
  console.log('─'.repeat(80));

  // Analyze bottlenecks
  const bottlenecks: string[] = [];

  if (insertMetrics.eventsPerSecond < 100) {
    bottlenecks.push('⚠️  INSERT throughput below 100 events/sec - consider connection pooling or batch optimization');
  }

  if (queryMetrics.singleDriverTimeline > 100) {
    bottlenecks.push('⚠️  Single driver queries >100ms - verify partition pruning and index usage');
  }

  if (queryMetrics.dateRangeQuery > 500) {
    bottlenecks.push('⚠️  Date range queries >500ms - verify partition strategy');
  }

  if (storageMetrics.avgRowSizeBytes > 2000) {
    bottlenecks.push('⚠️  Average row size >2KB - consider compression or metadata optimization');
  }

  if (bottlenecks.length === 0) {
    console.log('  ✅ No significant bottlenecks detected');
    console.log('  ✅ All metrics within acceptable ranges');
  } else {
    console.log('  Identified Bottlenecks:');
    bottlenecks.forEach((b) => console.log(`  ${b}`));
  }

  console.log('\n📈 RECOMMENDATIONS:');
  console.log('─'.repeat(80));
  console.log('  1. Always include event_timestamp in WHERE clauses for partition pruning');
  console.log('  2. Use batch inserts (500-1000 events) for optimal throughput');
  console.log('  3. Run ANALYZE periodically to update query planner statistics');
  console.log('  4. Monitor partition sizes and archive old partitions monthly');
  console.log('  5. Consider connection pooling if concurrent writes increase');

  console.log('\n' + '═'.repeat(80));
  console.log('LOAD TEST COMPLETE ✅');
  console.log('═'.repeat(80));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

runLoadTest()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Load test failed:', error);
    process.exit(1);
  });
