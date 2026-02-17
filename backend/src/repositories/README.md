# Repository Pattern

This directory contains the data access layer implementing the Repository pattern for database operations.

## Overview

The repository pattern abstracts database operations behind a clean, object-oriented interface. This provides several benefits:

- **Separation of Concerns** - Business logic (services) is decoupled from data access
- **Testability** - Easy to mock repositories for unit testing
- **Consistency** - Standardized CRUD operations across all entities
- **Maintainability** - Changes to database queries are centralized
- **Error Handling** - Consistent error handling and retry logic

## Architecture

```
┌─────────────┐
│ Controller  │  - HTTP request handling
└──────┬──────┘
       │
┌──────▼──────┐
│  Service    │  - Business logic
└──────┬──────┘
       │
┌──────▼──────┐
│ Repository  │  - Data access abstraction
└──────┬──────┘
       │
┌──────▼──────┐
│  Supabase   │  - Database client
│   Client    │
└─────────────┘
```

## Available Repositories

### BaseRepository

Abstract base class providing common CRUD operations:

- `findById(id)` - Find single record by ID
- `findAll(filters)` - Find all records matching filters
- `create(data)` - Insert new record
- `update(id, data)` - Update existing record
- `delete(id)` - Remove record
- `count(filters)` - Count records

### DriverRepository

Extends BaseRepository with driver-specific operations:

- `findByEldAccountId(carrierId, eldAccountId)` - Find by ELD account
- `findByCarrier(carrierId, status?)` - Find all drivers for carrier
- `findByIdWithCarrier(driverId)` - Find with joined carrier data
- `updateStatus(driverId, status)` - Update driver status
- `findByUserId(userId)` - Find driver by user account

### EventRepository

Extends BaseRepository with event-specific operations:

- `findByDriverAndDateRange(driverId, start, end, limit?)` - Events in date range
- `findByEventType(driverId, eventType, start?, end?)` - Filter by event type
- `findLatestByDriver(driverId)` - Get most recent event
- `getNextSequenceId(driverId)` - Get next sequence number
- `findByCarrier(carrierId, filters?)` - Find carrier events

### LogPeriodRepository

Extends BaseRepository with log period operations:

- `findByDriverAndDate(driverId, logDate)` - Find by driver and date
- `findByDriver(driverId, status?)` - Find all log periods for driver
- `updateStatus(id, status, data?)` - Update certification status
- `incrementEventCount(id)` - Increment event counter
- `findOrCreate(driverId, logDate)` - Find existing or create new
- `findUncertifiedOlderThan(driverId, daysOld)` - Find uncertified logs

## Usage Examples

### Basic CRUD Operations

```typescript
import { supabase } from '../config/supabase';
import { DriverRepository } from '../repositories';

const driverRepo = new DriverRepository(supabase);

// Create
const driver = await driverRepo.create({
  carrier_id: 'uuid',
  driver_eld_account_id: 'DRV001',
  full_name: 'John Doe',
  // ... other fields
});

// Read
const found = await driverRepo.findById(driver.id);

// Update
const updated = await driverRepo.update(driver.id, {
  full_name: 'John Smith',
});

// Delete
await driverRepo.delete(driver.id);
```

### Using Repository Container

The recommended approach is to use the RepositoryContainer for consistent access:

```typescript
import { supabase } from '../config/supabase';
import { createRepositories } from '../repositories';

// Create repository container
const repos = createRepositories(supabase);

// Access repositories
const driver = await repos.drivers.findById('uuid');
const events = await repos.events.findByDriverAndDateRange(
  'driver-uuid',
  '2025-02-01T00:00:00Z',
  '2025-02-01T23:59:59Z'
);
const logPeriod = await repos.logPeriods.findOrCreate('driver-uuid', '020125');
```

### In Services

Services should use repositories instead of direct Supabase queries:

**Before (direct Supabase):**
```typescript
export async function getDriver(driverId: string) {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', driverId)
    .single();

  if (error) throw new DatabaseError('Failed to find driver');
  return data;
}
```

**After (with repository):**
```typescript
import { DriverRepository } from '../repositories';

export async function getDriver(driverId: string, driverRepo: DriverRepository) {
  const driver = await driverRepo.findById(driverId);

  if (!driver) {
    throw new NotFoundError('Driver');
  }

  return driver;
}
```

### Error Handling

Repositories throw standardized errors from the ApiError hierarchy:

```typescript
try {
  const driver = await driverRepo.findById('invalid-uuid');
} catch (error) {
  if (error instanceof NotFoundError) {
    // Handle not found
  } else if (error instanceof DatabaseError) {
    // Handle database error
  }
}
```

All database operations are automatically wrapped with retry logic for transient failures (connection errors, timeouts).

### Connection Pooling

Repositories use the configured Supabase client with connection pooling:

- **Min connections**: 5
- **Max connections**: 20
- **Connection timeout**: 10 seconds
- **Retry attempts**: 3 with exponential backoff

Configure these in `.env`:

```env
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_CONNECTION_TIMEOUT=10000
DB_MAX_RETRIES=3
DB_RETRY_DELAY=1000
```

### Retry Logic

Database operations automatically retry on connection failures:

```typescript
import { withRetry } from '../config/supabase';

// Automatic retry for database operations
const driver = await withRetry(
  () => driverRepo.findById('uuid'),
  'getDriver'
);
```

The retry logic handles:
- Connection refused (ECONNREFUSED)
- Timeouts (ETIMEDOUT)
- DNS failures (ENOTFOUND)
- Generic connection errors

## Testing

### Unit Testing (with Mocks)

```typescript
import { DriverRepository } from '../repositories';

// Mock repository
const mockDriverRepo = {
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
} as any;

// Use in tests
mockDriverRepo.findById.mockResolvedValue({ id: 'uuid', full_name: 'Test' });

const result = await myService(mockDriverRepo);
```

### Integration Testing (Real Database)

Run integration tests against a test database:

```bash
npm run test:integration
```

See `tests/integration/README.md` for setup instructions.

## Best Practices

### 1. Use Repositories in Services

**✅ DO:**
```typescript
export class DriverService {
  constructor(private driverRepo: DriverRepository) {}

  async getDriver(id: string) {
    return this.driverRepo.findById(id);
  }
}
```

**❌ DON'T:**
```typescript
export async function getDriver(id: string) {
  // Direct Supabase usage in service
  const { data } = await supabase.from('drivers').select('*').eq('id', id);
  return data;
}
```

### 2. Inject Repositories via Constructor

**✅ DO:**
```typescript
export class DriverController {
  constructor(private repos: RepositoryContainer) {}

  async getDriver(req, res) {
    const driver = await this.repos.drivers.findById(req.params.id);
    return this.success(res, driver);
  }
}
```

### 3. Use Type-Safe Interfaces

All repository methods are fully typed with TypeScript interfaces:

```typescript
const driver: Driver = await driverRepo.findById('uuid');
//     ^-- Fully typed Driver interface
```

### 4. Handle Null Results

Repository methods return `null` for not found (instead of throwing):

```typescript
const driver = await driverRepo.findById('uuid');

if (!driver) {
  throw new NotFoundError('Driver');
}

// driver is guaranteed non-null here
console.log(driver.full_name);
```

### 5. Use Filters for Complex Queries

```typescript
const activeDrivers = await driverRepo.findAll({
  carrier_id: 'uuid',
  status: 'active',
});
```

### 6. Leverage Specialized Methods

Use repository-specific methods instead of generic findAll:

**✅ DO:**
```typescript
const drivers = await driverRepo.findByCarrier('carrier-uuid', 'active');
```

**❌ DON'T:**
```typescript
const allDrivers = await driverRepo.findAll({ carrier_id: 'carrier-uuid' });
const activeDrivers = allDrivers.filter(d => d.status === 'active');
```

## Extending Repositories

To add a new repository:

1. **Create interface** for the entity type
2. **Extend BaseRepository** with entity-specific methods
3. **Export from index.ts**
4. **Add to RepositoryContainer**

Example:

```typescript
// 1. Create repository
export class VehicleRepository extends BaseRepository<Vehicle> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'vehicles');
  }

  async findByCarrier(carrierId: string): Promise<Vehicle[]> {
    return this.findAll({ carrier_id: carrierId });
  }
}

// 2. Add to RepositoryContainer
export class RepositoryContainer {
  public readonly drivers: DriverRepository;
  public readonly events: EventRepository;
  public readonly logPeriods: LogPeriodRepository;
  public readonly vehicles: VehicleRepository; // New

  constructor(supabase: SupabaseClient) {
    this.drivers = new DriverRepository(supabase);
    this.events = new EventRepository(supabase);
    this.logPeriods = new LogPeriodRepository(supabase);
    this.vehicles = new VehicleRepository(supabase); // New
  }
}
```

## Performance Considerations

1. **Use Indexes** - Ensure database has proper indexes for common queries
2. **Limit Results** - Use pagination for large result sets
3. **Select Specific Fields** - Override `select('*')` when only few fields needed
4. **Connection Pooling** - Reuse connections via pooling (already configured)
5. **Batch Operations** - Use transactions for multiple related operations

## Migration from Direct Queries

To migrate existing code:

1. Identify direct Supabase queries in services
2. Replace with repository method calls
3. Inject repositories via constructor/parameters
4. Update tests to mock repositories instead of Supabase client

This can be done incrementally - old and new patterns can coexist during migration.
