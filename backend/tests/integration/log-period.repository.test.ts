/**
 * Log Period Repository Integration Tests
 *
 * Tests CRUD operations for log periods against real database.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { supabase } from '../../src/config/supabase';
import { LogPeriodRepository } from '../../src/repositories/log-period.repository';
import { createTestCarrier, createTestDriver, deleteTestCarrier, setupTests, teardownTests } from './setup';

describe('LogPeriodRepository Integration Tests', () => {
  let repository: LogPeriodRepository;
  let testCarrierId: string;
  let testDriverId: string;

  beforeAll(async () => {
    await setupTests();
    repository = new LogPeriodRepository(supabase);

    // Create test carrier
    const carrier = await createTestCarrier();
    testCarrierId = carrier.id;

    // Create test driver
    const driver = await createTestDriver(testCarrierId);
    testDriverId = driver.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testCarrierId) {
      await deleteTestCarrier(testCarrierId);
    }
    await teardownTests();
  });

  describe('create', () => {
    it('should create a new log period', async () => {
      const logPeriodData = {
        driver_id: testDriverId,
        log_date_mmddyy: '021525',
        status: 'active' as const,
        total_event_count: 0,
      };

      const logPeriod = await repository.create(logPeriodData);

      expect(logPeriod).toBeDefined();
      expect(logPeriod.id).toBeDefined();
      expect(logPeriod.driver_id).toBe(testDriverId);
      expect(logPeriod.log_date_mmddyy).toBe('021525');
      expect(logPeriod.status).toBe('active');
      expect(logPeriod.total_event_count).toBe(0);

      // Cleanup
      await repository.delete(logPeriod.id);
    });
  });

  describe('findByDriverAndDate', () => {
    it('should find log period by driver and date', async () => {
      const logDate = '021625';

      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: logDate,
        status: 'active' as const,
        total_event_count: 5,
      });

      const found = await repository.findByDriverAndDate(testDriverId, logDate);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.log_date_mmddyy).toBe(logDate);

      // Cleanup
      await repository.delete(created.id);
    });

    it('should return null for non-existent log period', async () => {
      const found = await repository.findByDriverAndDate(testDriverId, '999999');

      expect(found).toBeNull();
    });
  });

  describe('findByDriver', () => {
    it('should find all log periods for a driver', async () => {
      // Create multiple log periods
      const logPeriod1 = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '021725',
        status: 'active' as const,
        total_event_count: 3,
      });

      const logPeriod2 = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '021825',
        status: 'certified' as const,
        total_event_count: 10,
        certified_at: new Date().toISOString(),
      });

      const logPeriods = await repository.findByDriver(testDriverId);

      expect(logPeriods.length).toBeGreaterThanOrEqual(2);
      expect(logPeriods.some((lp) => lp.id === logPeriod1.id)).toBe(true);
      expect(logPeriods.some((lp) => lp.id === logPeriod2.id)).toBe(true);

      // Cleanup
      await repository.delete(logPeriod1.id);
      await repository.delete(logPeriod2.id);
    });

    it('should filter log periods by status', async () => {
      const activeLogPeriod = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '021925',
        status: 'active' as const,
        total_event_count: 2,
      });

      const certifiedLogPeriod = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '022025',
        status: 'certified' as const,
        total_event_count: 8,
        certified_at: new Date().toISOString(),
      });

      const activeLogPeriods = await repository.findByDriver(testDriverId, 'active');

      expect(activeLogPeriods.every((lp) => lp.status === 'active')).toBe(true);
      expect(activeLogPeriods.some((lp) => lp.id === activeLogPeriod.id)).toBe(true);

      // Cleanup
      await repository.delete(activeLogPeriod.id);
      await repository.delete(certifiedLogPeriod.id);
    });
  });

  describe('updateStatus', () => {
    it('should update log period status to certified', async () => {
      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '022125',
        status: 'active' as const,
        total_event_count: 5,
      });

      const updated = await repository.updateStatus(created.id, 'certified');

      expect(updated.status).toBe('certified');
      expect(updated.certified_at).toBeDefined();
      expect(updated.id).toBe(created.id);

      // Cleanup
      await repository.delete(created.id);
    });

    it('should update log period status to rejected with reason', async () => {
      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '022225',
        status: 'active' as const,
        total_event_count: 3,
      });

      const updated = await repository.updateStatus(created.id, 'rejected', {
        rejection_reason: 'Missing signature',
      });

      expect(updated.status).toBe('rejected');
      expect(updated.rejected_at).toBeDefined();
      expect(updated.rejection_reason).toBe('Missing signature');

      // Cleanup
      await repository.delete(created.id);
    });
  });

  describe('incrementEventCount', () => {
    it('should increment event count', async () => {
      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '022325',
        status: 'active' as const,
        total_event_count: 5,
      });

      const updated = await repository.incrementEventCount(created.id);

      expect(updated.total_event_count).toBe(6);
      expect(updated.id).toBe(created.id);

      // Cleanup
      await repository.delete(created.id);
    });
  });

  describe('findOrCreate', () => {
    it('should find existing log period', async () => {
      const logDate = '022425';

      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: logDate,
        status: 'active' as const,
        total_event_count: 3,
      });

      const foundOrCreated = await repository.findOrCreate(testDriverId, logDate);

      expect(foundOrCreated.id).toBe(created.id);
      expect(foundOrCreated.total_event_count).toBe(3);

      // Cleanup
      await repository.delete(created.id);
    });

    it('should create new log period if not exists', async () => {
      const logDate = '022525';

      // Ensure it doesn't exist
      const existing = await repository.findByDriverAndDate(testDriverId, logDate);
      if (existing) {
        await repository.delete(existing.id);
      }

      const foundOrCreated = await repository.findOrCreate(testDriverId, logDate);

      expect(foundOrCreated).toBeDefined();
      expect(foundOrCreated.log_date_mmddyy).toBe(logDate);
      expect(foundOrCreated.status).toBe('active');
      expect(foundOrCreated.total_event_count).toBe(0);

      // Cleanup
      await repository.delete(foundOrCreated.id);
    });
  });

  describe('findUncertifiedOlderThan', () => {
    it('should find uncertified log periods older than N days', async () => {
      // Create old log period (14 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 14);
      const oldLogDate =
        String(oldDate.getMonth() + 1).padStart(2, '0') +
        String(oldDate.getDate()).padStart(2, '0') +
        String(oldDate.getFullYear()).slice(-2);

      const oldLogPeriod = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: oldLogDate,
        status: 'active' as const,
        total_event_count: 5,
      });

      // Create recent log period (1 day ago)
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 1);
      const recentLogDate =
        String(recentDate.getMonth() + 1).padStart(2, '0') +
        String(recentDate.getDate()).padStart(2, '0') +
        String(recentDate.getFullYear()).slice(-2);

      const recentLogPeriod = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: recentLogDate,
        status: 'active' as const,
        total_event_count: 3,
      });

      const uncertified = await repository.findUncertifiedOlderThan(testDriverId, 13);

      expect(uncertified.some((lp) => lp.id === oldLogPeriod.id)).toBe(true);
      expect(uncertified.every((lp) => lp.status === 'active')).toBe(true);

      // Cleanup
      await repository.delete(oldLogPeriod.id);
      await repository.delete(recentLogPeriod.id);
    });
  });

  describe('update', () => {
    it('should update log period fields', async () => {
      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '022625',
        status: 'active' as const,
        total_event_count: 2,
      });

      const updated = await repository.update(created.id, {
        total_event_count: 10,
        notes: 'Updated notes',
      });

      expect(updated.total_event_count).toBe(10);
      expect(updated.notes).toBe('Updated notes');

      // Cleanup
      await repository.delete(created.id);
    });
  });

  describe('delete', () => {
    it('should delete a log period', async () => {
      const created = await repository.create({
        driver_id: testDriverId,
        log_date_mmddyy: '022725',
        status: 'active' as const,
        total_event_count: 1,
      });

      await repository.delete(created.id);

      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });
  });
});
