# Integration Tests

Integration tests for the ELD backend repository pattern, verifying CRUD operations against a real Supabase database.

## Setup

### 1. Create Test Database

**IMPORTANT:** Never run integration tests against your production database!

Create a separate Supabase project for testing:

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Name it something like "eld-backend-test"
3. Run the same database migrations as your production database
4. Get your project URL and service role key from Settings → API

### 2. Configure Test Environment

Copy the example environment file:

```bash
cp .env.test.example .env.test
```

Edit `.env.test` and fill in your test database credentials:

```env
SUPABASE_URL=https://your-test-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-test-service-role-key
SUPABASE_ANON_KEY=your-test-anon-key
```

### 3. Install Dependencies

```bash
npm install --save-dev jest ts-jest @types/jest
```

## Running Tests

### Run All Integration Tests

```bash
npm run test:integration
```

### Run Specific Test File

```bash
npm run test:integration -- driver.repository.test.ts
```

### Run with Coverage

```bash
npm run test:integration -- --coverage
```

### Run in Watch Mode

```bash
npm run test:integration -- --watch
```

## Test Structure

### Repository Tests

- **`driver.repository.test.ts`** - Tests for DriverRepository CRUD operations
- **`event.repository.test.ts`** - Tests for EventRepository CRUD operations
- **`log-period.repository.test.ts`** - Tests for LogPeriodRepository CRUD operations

### Test Helpers

- **`setup.ts`** - Shared setup/teardown functions and test data creation

## What's Tested

### Base Repository Operations

- ✅ **Create** - Insert new records
- ✅ **Read** - Find by ID, find all, find with filters
- ✅ **Update** - Update existing records
- ✅ **Delete** - Remove records
- ✅ **Count** - Count records with filters

### Driver Repository

- Find by ELD account ID
- Find by carrier ID
- Find by user ID
- Update driver status
- Find driver with carrier information

### Event Repository

- Find events by date range
- Find events by type
- Find latest event for driver
- Get next sequence ID
- Find events by carrier

### Log Period Repository

- Find by driver and date
- Find by driver with status filter
- Update status (certified, rejected)
- Increment event count
- Find or create log period
- Find uncertified log periods older than N days

## Test Data

All tests create isolated test data and clean up after themselves:

1. Test carriers are created with unique DOT numbers
2. Test drivers are created with unique ELD account IDs
3. All test data is deleted after tests complete
4. Tests use transactions where possible for isolation

## Continuous Integration

Add this to your CI pipeline (e.g., GitHub Actions):

```yaml
- name: Run Integration Tests
  run: npm run test:integration
  env:
    SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
```

## Troubleshooting

### Connection Errors

If you see connection errors:

1. Verify your `.env.test` credentials are correct
2. Check that your test database is accessible
3. Ensure your IP is whitelisted in Supabase (if using IP restrictions)

### Test Failures

If tests fail:

1. Check that database migrations are up to date
2. Verify test data cleanup is working (no leftover test data)
3. Run tests individually to isolate failures
4. Check Supabase logs for database errors

### Performance Issues

If tests are slow:

1. Ensure connection pooling is configured (5-20 connections)
2. Run tests in parallel: `npm run test:integration -- --maxWorkers=4`
3. Optimize test data creation (create once, reuse where possible)

## Best Practices

1. **Isolation** - Each test should be independent and not rely on other tests
2. **Cleanup** - Always clean up test data, even if tests fail
3. **Meaningful Assertions** - Test both success and failure cases
4. **Descriptive Names** - Use clear test names that describe what's being tested
5. **Don't Test Implementation** - Test behavior, not internal implementation details

## Connection Pooling

Integration tests use the configured connection pooling:

- **Minimum connections**: 5
- **Maximum connections**: 20
- **Connection timeout**: 10 seconds
- **Retry attempts**: 3 with exponential backoff

These settings can be adjusted in `.env.test`.

## Graceful Error Handling

Tests verify that:

- Database connection failures are handled gracefully
- Retry logic works for transient failures
- Error messages are informative and actionable
- Resources are cleaned up even on failure
