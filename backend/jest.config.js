/**
 * Jest Configuration — Unit & E2E Tests
 *
 * Covers:
 *   tests/unit/**   — pure-function tests, no DB/network (fast)
 *   tests/e2e/**    — full HTTP stack via supertest (requires running server + DB)
 *
 * For integration/repository tests (real DB required), use:
 *   npm run test:integration
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  roots: ['<rootDir>/tests/unit', '<rootDir>/tests/e2e'],

  testMatch: ['**/*.test.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        // Allow importing from src/ without full type checking during tests
        strict: false,
        esModuleInterop: true,
      },
    }],
  },

  moduleFileExtensions: ['ts', 'js', 'json'],

  // Load test environment variables before any test code runs
  setupFiles: ['<rootDir>/tests/jest-setup.js'],

  // Global timeout: unit tests are fast; E2E/stress tests override per-suite
  testTimeout: 30_000,

  // Group stress tests separately (run only when needed)
  testPathIgnorePatterns: [
    // Include stress tests only when STRESS=1 env var is set
    ...(process.env.STRESS !== '1' ? ['<rootDir>/tests/e2e/ingestion-stress.test.ts'] : []),
  ],

  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  collectCoverageFrom: [
    'src/services/retry.service.ts',
    'src/services/idempotency.service.ts',
    'src/services/dlq.service.ts',
    'src/services/event-ingestion.service.ts',
    'src/services/event-validation.service.ts',
    'src/middleware/idempotency.ts',
    'src/middleware/raw-vault.ts',
  ],
  coverageDirectory: 'coverage/unit',
  coverageReporters: ['text', 'lcov'],
};
