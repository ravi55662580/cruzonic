/**
 * Jest Configuration for Integration Tests
 *
 * Runs integration tests against a real database.
 * Requires .env.test with test database credentials.
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/repositories/**/*.ts',
    '!src/repositories/index.ts',
  ],
  coverageDirectory: 'coverage/integration',
  testTimeout: 30000, // 30 seconds for database operations
  setupFiles: ['<rootDir>/tests/integration/jest-setup.js'], // Load env vars BEFORE imports
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
