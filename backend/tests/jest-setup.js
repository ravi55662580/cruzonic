/**
 * Jest Global Setup — runs before any test file is loaded
 *
 * Loads .env.test so SUPABASE_URL, SUPABASE_ANON_KEY, REDIS_URL, etc.
 * are available for both unit and E2E tests.
 */

const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
