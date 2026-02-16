# /backend — Express API Server

The central REST API for Cruzonic. Handles business logic, communicates with Supabase (PostgreSQL + Auth), and serves both the mobile driver app and the fleet web portal.

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express 5
- **Language:** TypeScript
- **Database / Auth:** Supabase (`@supabase/supabase-js`)
- **Validation:** Zod
- **Testing:** Jest + Supertest

## Folder Structure

```
backend/
├── src/
│   ├── config/          # Supabase client, env config
│   ├── middleware/       # Auth guards, error handler, logger
│   ├── modules/
│   │   ├── auth/        # Login, logout, token refresh
│   │   ├── drivers/     # Driver profiles & status
│   │   ├── vehicles/    # Vehicle CRUD & assignment
│   │   ├── trips/       # Trip lifecycle (start, update, end)
│   │   ├── tracking/    # Real-time location events
│   │   └── reports/     # Analytics & exports
│   ├── routes/          # Express router aggregator
│   ├── types/           # Local type extensions (import from /shared)
│   └── index.ts         # App entry point
├── tests/
├── .env.example
├── package.json
└── tsconfig.json
```

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=4000
NODE_ENV=development

# Supabase — get these from your Supabase project settings
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# JWT secret (used for verifying Supabase JWTs locally if needed)
JWT_SECRET=<your-jwt-secret>

# CORS — comma-separated allowed origins
CORS_ORIGINS=http://localhost:5173
```

### 3. Start development server

```bash
npm run dev       # ts-node-dev with hot reload
```

### 4. Other commands

```bash
npm run build     # Compile TypeScript to /dist
npm run start     # Run compiled output
npm run test      # Jest test suite
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
```

## Authentication Flow

All protected routes expect a `Bearer` token in the `Authorization` header. The token is a Supabase JWT issued at login. The backend validates it using `supabase.auth.getUser(token)` via the service role client.

```
Client  →  POST /auth/login  →  Supabase Auth
                              ←  { access_token, refresh_token }
Client  →  GET /trips (Authorization: Bearer <token>)
        →  middleware validates token with Supabase
        →  handler runs
```

## Key API Modules

| Prefix | Description |
|--------|-------------|
| `POST /auth/login` | Supabase email/password login |
| `POST /auth/refresh` | Refresh access token |
| `GET /drivers` | List all drivers (portal) |
| `GET /vehicles` | List fleet vehicles |
| `POST /trips` | Start a new trip |
| `PATCH /trips/:id` | Update trip status |
| `POST /tracking` | Receive GPS location event |
| `GET /reports/trips` | Trip summary report |

## Supabase Notes

- Use the **service role key** only in backend (never expose to client).
- Row Level Security (RLS) policies are defined in `/infra/supabase/migrations/`.
- Real-time subscriptions for tracking are handled via Supabase Realtime on the portal side — the backend only writes location events.
