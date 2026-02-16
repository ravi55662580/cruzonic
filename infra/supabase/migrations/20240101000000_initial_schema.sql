-- ============================================================
-- Initial Schema: Cruzonic Fleet Management Platform
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('driver', 'fleet_manager', 'admin')),
  full_name  text not null default '',
  phone      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on new user signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'driver'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── vehicles ─────────────────────────────────────────────────────────────────
-- Note: current_driver_id FK is added after drivers table is created (circular dependency).
create table public.vehicles (
  id           uuid primary key default uuid_generate_v4(),
  plate_number text not null unique,
  make         text not null,
  model        text not null,
  year         integer not null,
  status       text not null default 'active' check (status in ('active', 'maintenance', 'retired')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── drivers ──────────────────────────────────────────────────────────────────
create table public.drivers (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  full_name      text not null,
  phone          text not null,
  license_number text not null unique,
  status         text not null default 'offline' check (status in ('available', 'on_trip', 'offline')),
  vehicle_id     uuid references public.vehicles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Add vehicles → drivers FK now that drivers exists
alter table public.vehicles
  add column current_driver_id uuid references public.drivers(id) on delete set null;

-- ── trips ─────────────────────────────────────────────────────────────────────
create table public.trips (
  id                   uuid primary key default uuid_generate_v4(),
  driver_id            uuid not null references public.drivers(id) on delete restrict,
  vehicle_id           uuid not null references public.vehicles(id) on delete restrict,
  status               text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  origin_address       text not null,
  destination_address  text not null,
  started_at           timestamptz,
  ended_at             timestamptz,
  distance_km          numeric(10, 2),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── location_events ───────────────────────────────────────────────────────────
create table public.location_events (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  latitude    float8 not null,
  longitude   float8 not null,
  speed_kmh   float4,
  heading     float4,
  accuracy_m  float4,
  recorded_at timestamptz not null default now()
);

-- Index for efficient time-range queries on location events
create index idx_location_events_trip_time on public.location_events(trip_id, recorded_at desc);
create index idx_location_events_vehicle   on public.location_events(vehicle_id, recorded_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.drivers        enable row level security;
alter table public.vehicles       enable row level security;
alter table public.trips          enable row level security;
alter table public.location_events enable row level security;

-- Fleet managers and admins can read all data
create policy "Fleet managers read all drivers"
  on public.drivers for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('fleet_manager', 'admin')
    )
  );

-- Drivers can read their own record
create policy "Driver reads own record"
  on public.drivers for select
  using (user_id = auth.uid());

-- Service role bypasses RLS (used by backend with service_role key)
