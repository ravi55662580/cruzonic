# Cruzonic — Fleet Management Platform

A full-stack monorepo for the Cruzonic fleet management platform, consisting of a driver mobile app, a fleet management web portal, and a shared backend API.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js + Express |
| Database | Supabase (PostgreSQL) |
| Authentication | Supabase Auth |
| Mobile App | React Native (iOS & Android) |
| Web Portal | React (Vite) |
| Infrastructure | Docker, Supabase Cloud |

## Repository Structure

```
cruzonic/
├── backend/      # Express REST API server
├── mobile/       # React Native driver app (iOS & Android)
├── portal/       # React fleet management web dashboard
├── shared/       # Shared TypeScript types and utilities
├── docs/         # Project documentation
├── scripts/      # Dev & CI/CD automation scripts
└── infra/        # Infrastructure-as-code (Docker, env configs)
```

## Prerequisites

- Node.js >= 18.x
- npm >= 9.x (or yarn / pnpm)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (for mobile)
- Docker (for local Supabase)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/cruzonic.git
cd cruzonic

# 2. Install root dev dependencies
npm install

# 3. Copy environment templates
cp backend/.env.example backend/.env
cp portal/.env.example portal/.env
cp mobile/.env.example mobile/.env

# 4. Start local Supabase
npx supabase start

# 5. Run backend
cd backend && npm install && npm run dev

# 6. Run portal (new terminal)
cd portal && npm install && npm run dev

# 7. Run mobile app (new terminal)
cd mobile && npm install && npx expo start
```

## Environment Variables

Each service has its own `.env.example` file. The required Supabase variables are:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # backend only
```

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for branch conventions, commit style, and PR guidelines.

## License

MIT
