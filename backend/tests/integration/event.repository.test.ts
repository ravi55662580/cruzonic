/**
 * Event Repository Integration Tests
 *
 * Tests CRUD operations for ELD events against real database.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { supabase } from '../../src/config/supabase';
import { EventRepository } from '../../src/repositories/event.repository';
import { createTestCarrier, createTestDriver, deleteTestCarrier, setupTests, teardownTests } from './setup';

describe('EventRepository Integration Tests', () => {
  let repository: EventRepository;
  let testCarrierId: string;
  let testDriverId: string;
  let testDeviceId: string;

  beforeAll(async () => {
    await setupTests();
    repository = new EventRepository(supabase);

    // Create test carrier
    const carrier = await createTestCarrier();
    testCarrierId = carrier.id;

    // Create test driver
    const driver = await createTestDriver(testCarrierId);
    testDriverId = driver.id;

    // Create test ELD device
    const { data: device } = await supabase
      .from('eld_devices')
      .insert({
        carrier_id: testCarrierId,
        eld_registration_id: `TESTDEV${Date.now()}`,
        manufacturer: 'Test Manufacturer',
        model: 'Test Model',
        serial_number: `SN${Date.now()}`,
        status: 'active',
      })
      .select()
      .single();

    testDeviceId = device!.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testDeviceId) {
      await supabase.from('eld_devices').delete().eq('id', testDeviceId);
    }
    if (testCarrierId) {
      await deleteTestCarrier(testCarrierId);
    }
    await teardownTests();
  });

  describe('create', () => {
    it('should create a new ELD event', async () => {
      const timestamp = new Date().toISOString();
      const eventData = {
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 1,
        event_type: 1, // Change in driver duty status
        event_code: 1, // OFF_DUTY
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        event_latitude: '34.0522',
        event_longitude: '-118.2437',
        distance_last_coord: 0,
        location_description: 'Los Angeles, CA',
        record_status: 1, // Active
        record_origin: 1, // Auto-recorded
        audit_trail: {},
      };

      const event = await repository.create(eventData);

      expect(event).toBeDefined();
      expect(event.id).toBeDefined();
      expect(event.driver_id).toBe(testDriverId);
      expect(event.event_type).toBe(1);
      expect(event.event_code).toBe(1);

      // Cleanup
      await repository.delete(event.id);
    });
  });

  describe('findByDriverAndDateRange', () => {
    it('should find events within date range', async () => {
      const startDate = new Date('2025-02-15T00:00:00Z').toISOString();
      const endDate = new Date('2025-02-15T23:59:59Z').toISOString();
      const midDate = new Date('2025-02-15T12:00:00Z').toISOString();

      // Create test event
      const event = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 10,
        event_type: 1,
        event_code: 3, // DRIVING
        event_timestamp: midDate,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const events = await repository.findByDriverAndDateRange(testDriverId, startDate, endDate);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.id === event.id)).toBe(true);

      // Cleanup
      await repository.delete(event.id);
    });
  });

  describe('findByEventType', () => {
    it('should find events by type', async () => {
      const timestamp = new Date().toISOString();

      // Create events with different types
      const event1 = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 20,
        event_type: 1, // Duty status change
        event_code: 1,
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const event2 = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 21,
        event_type: 2, // Intermediate log
        event_code: 0,
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '130000',
        accumulated_vehicle_miles: '12346.0',
        elapsed_engine_hours: '1234.6',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const dutyStatusEvents = await repository.findByEventType(testDriverId, 1);

      expect(dutyStatusEvents.length).toBeGreaterThanOrEqual(1);
      expect(dutyStatusEvents.some((e) => e.id === event1.id)).toBe(true);
      expect(dutyStatusEvents.every((e) => e.event_type === 1)).toBe(true);

      // Cleanup
      await repository.delete(event1.id);
      await repository.delete(event2.id);
    });
  });

  describe('findLatestByDriver', () => {
    it('should find the most recent event', async () => {
      const olderTimestamp = new Date('2025-02-15T10:00:00Z').toISOString();
      const newerTimestamp = new Date('2025-02-15T14:00:00Z').toISOString();

      // Create older event
      const olderEvent = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 30,
        event_type: 1,
        event_code: 1,
        event_timestamp: olderTimestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '100000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      // Create newer event
      const newerEvent = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 31,
        event_type: 1,
        event_code: 3,
        event_timestamp: newerTimestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '140000',
        accumulated_vehicle_miles: '12350.0',
        elapsed_engine_hours: '1235.0',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const latest = await repository.findLatestByDriver(testDriverId);

      expect(latest).toBeDefined();
      expect(latest?.id).toBe(newerEvent.id);
      expect(latest?.event_sequence_id).toBe(31);

      // Cleanup
      await repository.delete(olderEvent.id);
      await repository.delete(newerEvent.id);
    });
  });

  describe('getNextSequenceId', () => {
    it('should return next sequence ID', async () => {
      const timestamp = new Date().toISOString();

      // Create event with sequence ID 100
      const event = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 100,
        event_type: 1,
        event_code: 1,
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const nextId = await repository.getNextSequenceId(testDriverId);

      expect(nextId).toBeGreaterThanOrEqual(101);

      // Cleanup
      await repository.delete(event.id);
    });

    it('should return 1 for driver with no events', async () => {
      // Create a new driver without events
      const newDriver = await createTestDriver(testCarrierId);

      const nextId = await repository.getNextSequenceId(newDriver.id);

      expect(nextId).toBe(1);

      // Cleanup
      await supabase.from('drivers').delete().eq('id', newDriver.id);
    });
  });

  describe('findByCarrier', () => {
    it('should find events for a carrier', async () => {
      const timestamp = new Date().toISOString();

      const event = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 200,
        event_type: 1,
        event_code: 1,
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const events = await repository.findByCarrier(testCarrierId);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.id === event.id)).toBe(true);
      expect(events.every((e) => e.carrier_id === testCarrierId)).toBe(true);

      // Cleanup
      await repository.delete(event.id);
    });

    it('should filter events by type for carrier', async () => {
      const timestamp = new Date().toISOString();

      const event = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 201,
        event_type: 3, // Change in driver indicator status
        event_code: 1,
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      const events = await repository.findByCarrier(testCarrierId, { eventType: 3, limit: 10 });

      expect(events.every((e) => e.event_type === 3)).toBe(true);
      expect(events.some((e) => e.id === event.id)).toBe(true);

      // Cleanup
      await repository.delete(event.id);
    });
  });

  describe('delete', () => {
    it('should delete an event', async () => {
      const timestamp = new Date().toISOString();

      const event = await repository.create({
        carrier_id: testCarrierId,
        driver_id: testDriverId,
        eld_device_id: testDeviceId,
        event_sequence_id: 999,
        event_type: 1,
        event_code: 1,
        event_timestamp: timestamp,
        event_date_mmddyy: '021525',
        event_time_hhmmss: '120000',
        accumulated_vehicle_miles: '12345.6',
        elapsed_engine_hours: '1234.5',
        record_status: 1,
        record_origin: 1,
        audit_trail: {},
      });

      await repository.delete(event.id);

      const found = await repository.findById(event.id);
      expect(found).toBeNull();
    });
  });
});
