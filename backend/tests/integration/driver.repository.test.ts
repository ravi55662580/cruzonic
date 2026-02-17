/**
 * Driver Repository Integration Tests
 *
 * Tests CRUD operations against real database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { supabase } from '../../src/config/supabase';
import { DriverRepository } from '../../src/repositories/driver.repository';
import { createTestCarrier, deleteTestCarrier, setupTests, teardownTests } from './setup';

describe('DriverRepository Integration Tests', () => {
  let repository: DriverRepository;
  let testCarrierId: string;

  beforeAll(async () => {
    await setupTests();
    repository = new DriverRepository(supabase);

    // Create test carrier
    const carrier = await createTestCarrier();
    testCarrierId = carrier.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testCarrierId) {
      await deleteTestCarrier(testCarrierId);
    }
    await teardownTests();
  });

  describe('create', () => {
    it('should create a new driver', async () => {
      const timestamp = Date.now();
      const driverData = {
        carrier_id: testCarrierId,
        driver_eld_account_id: `TEST${timestamp}`,
        full_name: 'John Doe',
        email: `john${timestamp}@example.com`,
        phone: '+15555551234',
        license_number: `DL${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'offline' as const,
      };

      const driver = await repository.create(driverData);

      expect(driver).toBeDefined();
      expect(driver.id).toBeDefined();
      expect(driver.full_name).toBe('John Doe');
      expect(driver.carrier_id).toBe(testCarrierId);
      expect(driver.status).toBe('offline');

      // Cleanup
      await repository.delete(driver.id);
    });

    it('should fail when creating driver with duplicate ELD account ID', async () => {
      const timestamp = Date.now();
      const eldAccountId = `DUPLICATE${timestamp}`;

      const driverData = {
        carrier_id: testCarrierId,
        driver_eld_account_id: eldAccountId,
        full_name: 'Duplicate Driver',
        email: `dup${timestamp}@example.com`,
        phone: '+15555559999',
        license_number: `DL${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'offline' as const,
      };

      // Create first driver
      const driver1 = await repository.create(driverData);

      // Try to create second driver with same ELD account ID
      await expect(repository.create(driverData)).rejects.toThrow();

      // Cleanup
      await repository.delete(driver1.id);
    });
  });

  describe('findById', () => {
    it('should find driver by ID', async () => {
      const timestamp = Date.now();
      const created = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `FIND${timestamp}`,
        full_name: 'Find Me',
        email: `find${timestamp}@example.com`,
        phone: '+15555556789',
        license_number: `DL${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'offline' as const,
      });

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.full_name).toBe('Find Me');

      // Cleanup
      await repository.delete(created.id);
    });

    it('should return null for non-existent driver', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const found = await repository.findById(nonExistentId);

      expect(found).toBeNull();
    });
  });

  describe('findByEldAccountId', () => {
    it('should find driver by ELD account ID', async () => {
      const timestamp = Date.now();
      const eldAccountId = `ELD${timestamp}`;

      const created = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: eldAccountId,
        full_name: 'ELD Driver',
        email: `eld${timestamp}@example.com`,
        phone: '+15555554321',
        license_number: `DL${timestamp}`,
        license_state: 'TX',
        license_class: 'B',
        license_expiry: '2026-06-30',
        home_terminal_timezone: 'America/Chicago',
        hos_ruleset: 'USA_PASSENGER_70H_8D',
        status: 'active' as const,
      });

      const found = await repository.findByEldAccountId(testCarrierId, eldAccountId);

      expect(found).toBeDefined();
      expect(found?.driver_eld_account_id).toBe(eldAccountId);
      expect(found?.full_name).toBe('ELD Driver');

      // Cleanup
      await repository.delete(created.id);
    });
  });

  describe('findByCarrier', () => {
    it('should find all drivers for a carrier', async () => {
      const timestamp = Date.now();

      // Create multiple drivers
      const driver1 = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `CARR1_${timestamp}`,
        full_name: 'Carrier Driver 1',
        email: `carr1_${timestamp}@example.com`,
        phone: '+15555551111',
        license_number: `DL1${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'active' as const,
      });

      const driver2 = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `CARR2_${timestamp}`,
        full_name: 'Carrier Driver 2',
        email: `carr2_${timestamp}@example.com`,
        phone: '+15555552222',
        license_number: `DL2${timestamp}`,
        license_state: 'TX',
        license_class: 'B',
        license_expiry: '2026-01-15',
        home_terminal_timezone: 'America/Chicago',
        hos_ruleset: 'USA_PROPERTY_60H_7D',
        status: 'offline' as const,
      });

      const drivers = await repository.findByCarrier(testCarrierId);

      expect(drivers.length).toBeGreaterThanOrEqual(2);
      expect(drivers.some((d) => d.id === driver1.id)).toBe(true);
      expect(drivers.some((d) => d.id === driver2.id)).toBe(true);

      // Cleanup
      await repository.delete(driver1.id);
      await repository.delete(driver2.id);
    });

    it('should filter drivers by status', async () => {
      const timestamp = Date.now();

      const activeDriver = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `ACTIVE_${timestamp}`,
        full_name: 'Active Driver',
        email: `active_${timestamp}@example.com`,
        phone: '+15555553333',
        license_number: `DLA${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'active' as const,
      });

      const drivers = await repository.findByCarrier(testCarrierId, 'active');

      expect(drivers.length).toBeGreaterThanOrEqual(1);
      expect(drivers.every((d) => d.status === 'active')).toBe(true);
      expect(drivers.some((d) => d.id === activeDriver.id)).toBe(true);

      // Cleanup
      await repository.delete(activeDriver.id);
    });
  });

  describe('update', () => {
    it('should update driver information', async () => {
      const timestamp = Date.now();

      const created = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `UPDATE${timestamp}`,
        full_name: 'Original Name',
        email: `update${timestamp}@example.com`,
        phone: '+15555554444',
        license_number: `DL${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'offline' as const,
      });

      const updated = await repository.update(created.id, {
        full_name: 'Updated Name',
        phone: '+15555555555',
      });

      expect(updated.full_name).toBe('Updated Name');
      expect(updated.phone).toBe('+15555555555');
      expect(updated.id).toBe(created.id);

      // Cleanup
      await repository.delete(created.id);
    });
  });

  describe('updateStatus', () => {
    it('should update driver status', async () => {
      const timestamp = Date.now();

      const created = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `STATUS${timestamp}`,
        full_name: 'Status Driver',
        email: `status${timestamp}@example.com`,
        phone: '+15555556666',
        license_number: `DL${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'offline' as const,
      });

      const updated = await repository.updateStatus(created.id, 'driving');

      expect(updated.status).toBe('driving');
      expect(updated.id).toBe(created.id);

      // Cleanup
      await repository.delete(created.id);
    });
  });

  describe('delete', () => {
    it('should delete a driver', async () => {
      const timestamp = Date.now();

      const created = await repository.create({
        carrier_id: testCarrierId,
        driver_eld_account_id: `DELETE${timestamp}`,
        full_name: 'Delete Me',
        email: `delete${timestamp}@example.com`,
        phone: '+15555557777',
        license_number: `DL${timestamp}`,
        license_state: 'CA',
        license_class: 'A',
        license_expiry: '2025-12-31',
        home_terminal_timezone: 'America/Los_Angeles',
        hos_ruleset: 'USA_PROPERTY_70H_8D',
        status: 'offline' as const,
      });

      await repository.delete(created.id);

      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });
  });

  describe('count', () => {
    it('should count drivers', async () => {
      const count = await repository.count({ carrier_id: testCarrierId });

      expect(count).toBeGreaterThanOrEqual(0);
      expect(typeof count).toBe('number');
    });
  });
});
