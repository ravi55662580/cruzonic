# /portal — Fleet Management Web Dashboard

The Cruzonic fleet management portal for fleet operators. Provides a real-time overview of the fleet, driver management, trip monitoring, vehicle tracking on a live map, and analytics/reporting.

## Tech Stack

- **Framework:** React 18
- **Build Tool:** Vite
- **Language:** TypeScript
- **Auth:** Supabase Auth (`@supabase/supabase-js`)
- **State / Server State:** TanStack Query (React Query) v5
- **Routing:** React Router v6
- **UI Components:** shadcn/ui + Tailwind CSS
- **Maps:** Mapbox GL JS (or Leaflet — swappable)
- **Charts:** Recharts
- **Real-time:** Supabase Realtime (live vehicle tracking)

## Folder Structure

```
portal/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui base components
│   │   ├── map/             # Fleet live map components
│   │   ├── drivers/         # Driver list, profile cards
│   │   ├── vehicles/        # Vehicle list, assignment UI
│   │   ├── trips/           # Trip table, detail view
│   │   └── reports/         # Charts, export buttons
│   ├── pages/
│   │   ├── Dashboard.tsx    # Overview with KPIs
│   │   ├── Map.tsx          # Live fleet map
│   │   ├── Drivers.tsx      # Driver management
│   │   ├── Vehicles.tsx     # Vehicle management
│   │   ├── Trips.tsx        # Trip history & live
│   │   ├── Reports.tsx      # Analytics
│   │   └── Settings.tsx     # Org / account settings
│   ├── hooks/               # Custom React hooks
│   ├── services/
│   │   ├── supabase.ts      # Supabase client init
│   │   └── api.ts           # Backend API client
│   ├── store/               # Global state (Zustand)
│   ├── types/               # Local type extensions
│   ├── lib/                 # Utilities (date, format, etc.)
│   ├── App.tsx
│   └── main.tsx
├── public/
├── .env.example
├── index.html
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

## Setup

### 1. Install dependencies

```bash
cd portal
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_API_URL=http://localhost:4000
VITE_MAPBOX_TOKEN=<mapbox-public-token>
```

> Note: Vite requires the `VITE_` prefix for environment variables exposed to the browser.

### 3. Start development server

```bash
npm run dev
# → http://localhost:5173
```

### 4. Other commands

```bash
npm run build       # Production build to /dist
npm run preview     # Preview production build locally
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

## Authentication

Login uses **Supabase Auth** with email/password. The `AuthProvider` component wraps the router and redirects unauthenticated users to `/login`. Session state is managed through Supabase's `onAuthStateChange` listener.

Only users with the `fleet_manager` or `admin` role (stored in the `profiles` table) are permitted to access the portal.

## Real-time Fleet Tracking

The live map subscribes to the `location_events` table via **Supabase Realtime**:

```ts
supabase
  .channel('location_events')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_events' }, handler)
  .subscribe();
```

Vehicle markers update on the map as new GPS events arrive from the backend.

## Production Build

```bash
npm run build
# Output: portal/dist/
```

The `dist/` folder is a static SPA — deploy to Vercel, Netlify, or serve via Nginx. See `/infra/` for deployment configs.
