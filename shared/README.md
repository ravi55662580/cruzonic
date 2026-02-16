# /shared — Common Types & Utilities

A TypeScript package shared across `backend`, `portal`, and `mobile`. Contains:

- **Domain types** — mirrors Supabase table schemas
- **Zod validation schemas** — single source of truth for data shapes
- **Utility functions** — date formatting, distance calculation, status helpers

By centralising types here, all three apps stay in sync with the database schema without duplicating type definitions.

## Folder Structure

```
shared/
├── src/
│   ├── types/
│   │   ├── driver.ts        # Driver profile types
│   │   ├── vehicle.ts       # Vehicle types
│   │   ├── trip.ts          # Trip & TripStatus types
│   │   ├── location.ts      # GPS location event types
│   │   ├── report.ts        # Report / analytics types
│   │   └── index.ts         # Re-exports all types
│   ├── schemas/
│   │   ├── driver.schema.ts  # Zod schemas for driver
│   │   ├── trip.schema.ts    # Zod schemas for trips
│   │   └── index.ts
│   ├── utils/
│   │   ├── date.ts          # Date formatting helpers
│   │   ├── geo.ts           # Haversine distance, coordinate utils
│   │   ├── status.ts        # Trip/driver status label helpers
│   │   └── index.ts
│   └── index.ts             # Package entry — exports everything
├── package.json
└── tsconfig.json
```

## Setup

This package is consumed by other workspaces via npm workspaces. You do not need to run it standalone.

```bash
# Build shared package (required before backend/portal can import it)
cd shared
npm install
npm run build
```

Or build from the root:

```bash
npm run build:shared
```

## Usage in Other Packages

Because `shared` is listed in `workspaces` in the root `package.json`, it is symlinked automatically:

```ts
// In backend or portal
import { Trip, TripStatus } from '@cruzonic/shared';
import { tripSchema } from '@cruzonic/shared/schemas';
import { formatDate, haversineDistance } from '@cruzonic/shared/utils';
```

## Adding New Types

1. Create or update the relevant file in `src/types/`.
2. Export from `src/types/index.ts`.
3. Export from `src/index.ts` (the package root).
4. Run `npm run build` to compile.
5. If the type mirrors a Supabase table, also update the Zod schema in `src/schemas/`.

## Type Generation from Supabase

You can auto-generate types directly from your Supabase schema and place them here:

```bash
npx supabase gen types typescript \
  --project-id <project-ref> \
  --schema public \
  > shared/src/types/supabase.generated.ts
```

Wrap the generated types with friendlier aliases in the other type files rather than importing the raw generated types directly across the codebase.
