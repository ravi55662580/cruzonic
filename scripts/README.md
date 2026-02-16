# /scripts — Automation Scripts

Shell and Node scripts for development workflow, CI/CD, database operations, and deployment automation.

## Scripts

| Script | Description |
|--------|-------------|
| `setup.sh` | First-time developer environment setup |
| `gen-types.sh` | Generate TypeScript types from Supabase schema |
| `seed.ts` | Seed the local Supabase database with test data |
| `check-env.ts` | Validate all required environment variables are set |

## Usage

### First-time setup

Run once after cloning the repository:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

This script will:
1. Check for required tools (Node, npm, Supabase CLI, Expo CLI)
2. Install all workspace dependencies (`npm install`)
3. Copy `.env.example` → `.env` for each service
4. Start the local Supabase stack
5. Run database migrations

### Generate Supabase TypeScript types

Run whenever the database schema changes:

```bash
./scripts/gen-types.sh
```

Outputs to `shared/src/types/supabase.generated.ts`.

Requires `SUPABASE_PROJECT_ID` to be set in your environment (or `.env`).

### Seed the database

Inserts sample drivers, vehicles, and trips into your local database:

```bash
npx ts-node scripts/seed.ts
```

### Validate environment

Useful in CI to catch missing variables before the build starts:

```bash
npx ts-node scripts/check-env.ts
```

## Adding New Scripts

- Shell scripts: use `#!/usr/bin/env bash` and `set -euo pipefail`.
- TypeScript scripts: use `ts-node` and import from `@cruzonic/shared` for types.
- Document every new script in the table above.
