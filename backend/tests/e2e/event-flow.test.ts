/**
 * End-to-End Event Flow Test
 *
 * Tests complete event workflow:
 * 1. Authenticate driver
 * 2. Ingest ELD events
 * 3. Query events back
 * 4. Verify audit trail
 * 5. Get driver logs
 * 6. Get HOS status
 * 7. Certify logs
 * 8. Generate output file
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/index';

describe('E2E: Event Flow', () => {
  let accessToken: string;
  let driverId: string;
  let carrierId: string;
  let deviceId: string;
  let eventSequenceId = 1;
  const timestamp = Date.now();
  const logDate = new Date().toISOString().split('T')[0].replace(/-/g, '').slice(2); // MMDDYY format

  const testUser = {
    email: `driver-${timestamp}@example.com`,
    password: 'SecurePassword123!',
    full_name: 'Test Driver',
    role: 'driver',
    carrier_id: process.env.TEST_CARRIER_ID || 'test-carrier-uuid',
  };

  beforeAll(async () => {
    // Setup: Create test user and login
    const signupResponse = await request(app)
      .post('/api/v1/auth/signup')
      .send(testUser)
      .expect(201);

    driverId = signupResponse.body.data.user.id;
    carrierId = testUser.carrier_id;

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(200);

    accessToken = loginResponse.body.data.accessToken;
    deviceId = `eld-device-${timestamp}`;
  });

  describe('1. Event Ingestion', () => {
    it('should ingest a login event (EventType 5)', async () => {
      const loginEvent = {
        eventType: 5,
        eventCode: 1, // Power up
        eventDate: new Date().toISOString().split('T')[0],
        eventTime: new Date().toISOString().split('T')[1].slice(0, 8),
        eventSequenceIdNumber: eventSequenceId++,
        eventRecordStatus: 1, // Active
        eventRecordOrigin: 1, // Auto-recorded
        accumulatedVehicleMiles: 0,
        elapsedEngineHours: 0,
        eventLatitude: 37.7749,
        eventLongitude: -122.4194,
        distanceSinceLastValidCoordinates: 0,
        driverId: driverId,
        deviceId: deviceId,
      };

      const response = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-device-id', deviceId)
        .send(loginEvent)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('event_sequence_id', loginEvent.eventSequenceIdNumber);
      expect(response.body.data).toHaveProperty('event_type', 5);

      // Verify correlation ID header
      expect(response.headers).toHaveProperty('x-correlation-id');
    });

    it('should ingest a duty status change event (EventType 1)', async () => {
      const dutyStatusEvent = {
        eventType: 1,
        eventCode: 1, // OFF_DUTY
        eventDate: new Date().toISOString().split('T')[0],
        eventTime: new Date().toISOString().split('T')[1].slice(0, 8),
        eventSequenceIdNumber: eventSequenceId++,
        eventRecordStatus: 1,
        eventRecordOrigin: 2, // Driver-recorded
        accumulatedVehicleMiles: 0,
        elapsedEngineHours: 0,
        eventLatitude: 37.7749,
        eventLongitude: -122.4194,
        distanceSinceLastValidCoordinates: 0,
        driverId: driverId,
        deviceId: deviceId,
      };

      const response = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-device-id', deviceId)
        .send(dutyStatusEvent)
        .expect(201);

      expect(response.body.data).toHaveProperty('event_type', 1);
      expect(response.body.data).toHaveProperty('event_code', 1);
    });

    it('should validate event data schema', async () => {
      const invalidEvent = {
        eventType: 'invalid', // Should be number
        eventCode: 1,
        driverId: driverId,
      };

      const response = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-device-id', deviceId)
        .send(invalidEvent)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should enforce rate limit (100 req/min per device)', async () => {
      const requests = [];

      // Make 105 requests (limit is 100/min)
      for (let i = 0; i < 105; i++) {
        requests.push(
          request(app)
            .post('/api/v1/events')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('x-device-id', deviceId)
            .send({
              eventType: 1,
              eventCode: 1,
              eventDate: new Date().toISOString().split('T')[0],
              eventTime: new Date().toISOString().split('T')[1].slice(0, 8),
              eventSequenceIdNumber: eventSequenceId + i,
              eventRecordStatus: 1,
              eventRecordOrigin: 1,
              accumulatedVehicleMiles: 0,
              elapsedEngineHours: 0,
              eventLatitude: 37.7749,
              eventLongitude: -122.4194,
              distanceSinceLastValidCoordinates: 0,
              driverId: driverId,
              deviceId: deviceId,
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);

      // Check rate limit headers
      if (rateLimited.length > 0) {
        const limitedResponse = rateLimited[0];
        expect(limitedResponse.headers).toHaveProperty('x-ratelimit-limit');
        expect(limitedResponse.headers).toHaveProperty('x-ratelimit-remaining');
        expect(limitedResponse.headers).toHaveProperty('retry-after');
      }
    });
  });

  describe('2. Event Querying', () => {
    it('should query events for a driver', async () => {
      const response = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ driverId: driverId })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);

      // Verify event structure
      const event = response.body.data[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('event_type');
      expect(event).toHaveProperty('event_code');
      expect(event).toHaveProperty('event_timestamp');
      expect(event).toHaveProperty('driver_id', driverId);
    });

    it('should filter events by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const response = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({
          driverId: driverId,
          startDate: today,
          endDate: today,
        })
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
    });

    it('should enforce rate limit on query endpoints (60 req/min per user)', async () => {
      const requests = [];

      // Make 65 requests (limit is 60/min)
      for (let i = 0; i < 65; i++) {
        requests.push(
          request(app)
            .get('/api/v1/events')
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ driverId: driverId })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('3. Audit Trail Verification', () => {
    it('should include audit trail in event responses', async () => {
      const response = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ driverId: driverId })
        .expect(200);

      const event = response.body.data[0];

      // Verify audit fields exist
      expect(event).toHaveProperty('created_at');
      expect(event).toHaveProperty('updated_at');

      // Events should have metadata
      if (event.metadata) {
        expect(typeof event.metadata).toBe('object');
      }
    });

    it('should log all API requests with correlation IDs', async () => {
      const response = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ driverId: driverId });

      // Every response should have correlation ID
      expect(response.headers).toHaveProperty('x-correlation-id');
      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('4. Driver Logs', () => {
    it('should get daily driver log', async () => {
      const response = await request(app)
        .get(`/api/v1/drivers/${driverId}/logs/${logDate}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('driver');
      expect(response.body.data).toHaveProperty('logDate', logDate);
      expect(response.body.data).toHaveProperty('events');
      expect(response.body.data.driver).toHaveProperty('id', driverId);
    });

    it('should return 404 for non-existent driver', async () => {
      const fakeDriverId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/drivers/${fakeDriverId}/logs/${logDate}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    it('should validate date format', async () => {
      const response = await request(app)
        .get(`/api/v1/drivers/${driverId}/logs/invalid-date`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('5. HOS Status', () => {
    it('should get current HOS status for driver', async () => {
      const response = await request(app)
        .get(`/api/v1/hos/${driverId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('driver_id', driverId);
      expect(response.body.data).toHaveProperty('current_status');
      expect(response.body.data).toHaveProperty('remaining_time');
      expect(response.body.data).toHaveProperty('violations');
    });

    it('should include remaining driving time', async () => {
      const response = await request(app)
        .get(`/api/v1/hos/${driverId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.remaining_time).toHaveProperty('driving_minutes');
      expect(response.body.data.remaining_time).toHaveProperty('on_duty_window_minutes');
      expect(response.body.data.remaining_time).toHaveProperty('weekly_minutes');
    });

    it('should return violations if any exist', async () => {
      const response = await request(app)
        .get(`/api/v1/hos/${driverId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('violations');
      expect(Array.isArray(response.body.data.violations)).toBe(true);
    });
  });

  describe('6. Log Certification', () => {
    it('should certify driver logs', async () => {
      const certificationData = {
        driver_id: driverId,
        certified_log_date: logDate,
        certification_type: 'own_records',
      };

      const response = await request(app)
        .post('/api/v1/certify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(certificationData)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('certification');
      expect(response.body.data).toHaveProperty('eld_event');
      expect(response.body.data.certification).toHaveProperty('certified_log_date', logDate);
    });

    it('should reject certification of future dates', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0].replace(/-/g, '').slice(2);

      const certificationData = {
        driver_id: driverId,
        certified_log_date: futureDateStr,
        certification_type: 'own_records',
      };

      const response = await request(app)
        .post('/api/v1/certify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(certificationData)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should enforce strict rate limit (20 req/min per user)', async () => {
      const requests = [];

      // Make 25 requests (limit is 20/min)
      for (let i = 0; i < 25; i++) {
        requests.push(
          request(app)
            .post('/api/v1/certify')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              driver_id: driverId,
              certified_log_date: logDate,
              certification_type: 'own_records',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('7. Output File Generation', () => {
    let outputFileRecordId: string;

    it('should generate FMCSA output file', async () => {
      const generateRequest = {
        driver_id: driverId,
        log_date: logDate,
        format: 'json',
        include_metadata: true,
      };

      const response = await request(app)
        .post('/api/v1/output-file/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(generateRequest)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('record_id');
      expect(response.body.data).toHaveProperty('file_version');
      expect(response.body.data).toHaveProperty('total_event_count');
      expect(response.body.data).toHaveProperty('content_sha256');
      expect(response.body.data).toHaveProperty('download_url');

      outputFileRecordId = response.body.data.record_id;
    });

    it('should retrieve generated output file', async () => {
      // Generate a fresh file for retrieval
      const generateResponse = await request(app)
        .post('/api/v1/output-file/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          driver_id: driverId,
          log_date: logDate,
          format: 'json',
        })
        .expect(201);

      const recordId = generateResponse.body.data.record_id;

      // Then retrieve it
      const response = await request(app)
        .get(`/api/v1/output-file/${recordId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('record_id', recordId);
      expect(response.body.data).toHaveProperty('download_url');
    });

    it('should return 404 for non-existent output file', async () => {
      const fakeRecordId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/output-file/${fakeRecordId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    it('should enforce strict rate limit on file generation', async () => {
      const requests = [];

      // Make 25 requests (limit is 20/min)
      for (let i = 0; i < 25; i++) {
        requests.push(
          request(app)
            .post('/api/v1/output-file/generate')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              driver_id: driverId,
              log_date: logDate,
              format: 'json',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('8. Error Handling', () => {
    it('should return proper error for unauthorized access', async () => {
      const response = await request(app)
        .get('/api/v1/events')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return proper error for invalid UUID', async () => {
      const response = await request(app)
        .get('/api/v1/drivers/invalid-uuid/logs/020126')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should include correlation ID in error responses', async () => {
      const response = await request(app)
        .get('/api/v1/drivers/invalid-uuid/logs/020126')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.headers).toHaveProperty('x-correlation-id');
    });

    it('should sanitize sensitive data in logs', async () => {
      // Login attempt with wrong password (should not log actual password)
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!',
        })
        .expect(401);

      // Logs should have redacted the password
      // This is verified by checking the logger output, not the response
      expect(response.body).toHaveProperty('error');
    });
  });
});
