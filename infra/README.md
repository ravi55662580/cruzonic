# /infra — Infrastructure as Code

Configuration and tooling for deploying and operating the Cruzonic platform.

## Contents

```
infra/
├── supabase/
│   ├── migrations/          # SQL migration files (applied via supabase db push)
│   ├── seed.sql             # Reference seed data for staging/production
│   └── config.toml          # Local Supabase project config
├── docker/
│   ├── backend.Dockerfile   # Production Docker image for the Express API
│   └── docker-compose.yml   # Local full-stack environment (API + Supabase)
└── nginx/
    └── portal.conf          # Nginx config for serving the React portal SPA
```

## Supabase

### Local development

```bash
# Start local Supabase stack (PostgreSQL + Auth + Realtime + Studio)
npx supabase start

# Open Supabase Studio in the browser
# → http://localhost:54323

# Apply pending migrations
npx supabase db push

# Create a new migration
npx supabase migration new <migration-name>

# Stop local stack
npx supabase stop
```

### Production (Supabase Cloud)

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the `Project URL` and keys from **Settings > API**.
3. Push migrations:
   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
4. Enable **Realtime** on the `location_events` table in the Supabase Dashboard.
5. Set up **Row Level Security** policies — see `supabase/migrations/`.

## Docker

### Backend image

```bash
# Build the Express API image
docker build -f infra/docker/backend.Dockerfile -t cruzonic-backend .

# Run the container
docker run -p 4000:4000 --env-file backend/.env cruzonic-backend
```

### Local full-stack with Docker Compose

```bash
# Start API + local Supabase
docker compose -f infra/docker/docker-compose.yml up
```

## Nginx (Portal SPA)

The portal is a static SPA. The Nginx config handles client-side routing by redirecting all 404s to `index.html`.

```bash
# Copy config to your server
scp infra/nginx/portal.conf user@server:/etc/nginx/sites-available/cruzonic-portal
sudo nginx -t && sudo nginx -s reload
```

## Environment Variables

Each deployment environment (development, staging, production) needs its own set of environment variables. Never commit `.env` files. Use the `.env.example` templates in each service folder.

For CI/CD pipelines (GitHub Actions, etc.), store secrets as encrypted environment variables in your CI provider and inject them at build time.
