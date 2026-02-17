/**
 * Jest Setup - Loads environment variables before tests
 * This runs BEFORE test files are imported
 */

const dotenv = require('dotenv');
const path = require('path');

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

console.log('✅ Loaded test environment variables from .env.test');
