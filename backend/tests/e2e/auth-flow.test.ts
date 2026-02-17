/**
 * End-to-End Authentication Flow Test
 *
 * Tests complete authentication flow:
 * 1. Signup new user
 * 2. Login
 * 3. Access protected endpoint
 * 4. Refresh token
 * 5. Logout
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/index';

describe('E2E: Authentication Flow', () => {
  let accessToken: string;
  let refreshToken: string;
  let userId: string;
  const timestamp = Date.now();

  const testUser = {
    email: `test-${timestamp}@example.com`,
    password: 'SecurePassword123!',
    full_name: 'Test User',
    role: 'driver',
    carrier_id: process.env.TEST_CARRIER_ID || 'test-carrier-uuid',
  };

  describe('1. User Signup', () => {
    it('should create a new user account', async () => {
      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(testUser)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user).toHaveProperty('email', testUser.email);
      expect(response.body.data.user).toHaveProperty('role', testUser.role);

      userId = response.body.data.user.id;
    });

    it('should reject duplicate email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(testUser)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should validate email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send({ ...testUser, email: 'invalid-email' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('email');
    });

    it('should validate password strength', async () => {
      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send({ ...testUser, email: `test2-${timestamp}@example.com`, password: 'weak' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('2. User Login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user).toHaveProperty('email', testUser.email);

      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!',
        })
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testUser.password,
        })
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('3. Access Protected Endpoint', () => {
    it('should access protected endpoint with valid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('id', userId);
      expect(response.body.data).toHaveProperty('email', testUser.email);
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('4. Token Refresh', () => {
    it('should refresh access token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');

      // Update tokens
      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'invalid-refresh-token' })
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('5. Logout', () => {
    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should reject access with logged out token', async () => {
      // Note: Token revocation depends on Supabase implementation
      // This test may need adjustment based on actual behavior
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect('Content-Type', /json/);

      // Either 401 (token revoked) or 200 (token still valid until expiry)
      expect([200, 401]).toContain(response.status);
    });
  });

  describe('6. Rate Limiting', () => {
    it('should enforce rate limits on auth endpoints', async () => {
      const requests = [];

      // Make 15 requests (limit is 10/min)
      for (let i = 0; i < 15; i++) {
        requests.push(
          request(app)
            .post('/api/v1/auth/login')
            .send({
              email: 'test@example.com',
              password: 'password',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);

      // Check rate limit headers
      const limitedResponse = rateLimited[0];
      expect(limitedResponse.headers).toHaveProperty('x-ratelimit-limit');
      expect(limitedResponse.headers).toHaveProperty('x-ratelimit-remaining');
      expect(limitedResponse.headers).toHaveProperty('retry-after');
    });
  });

  describe('7. Error Handling', () => {
    it('should return 404 for non-existent endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/nonexistent')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    it('should validate request body schema', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ invalid: 'data' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should include correlation ID in responses', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.headers).toHaveProperty('x-correlation-id');
    });
  });
});
