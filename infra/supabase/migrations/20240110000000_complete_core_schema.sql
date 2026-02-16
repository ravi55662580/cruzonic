-- ============================================================
-- Cruzonic Fleet Management Platform — Complete Core Schema
-- Migration: 20240110000000_complete_core_schema.sql
--
-- This file is the authoritative, self-contained DDL for the entire
-- Cruzonic database. It supersedes the piecemeal approach in
-- 20240101000000 (initial_schema) + 20240102000000 (eld_schema).
--
-- Run order: Apply after a clean database or after dropping all
-- existing public tables (use with caution in production).
--
-- Regulatory basis
-- ─────────────────────────────────────────────────────────────
-- 49 CFR Part 395, Subpart B — Electronic Logging Device Requirements
-- FMCSA ELD Technical Specification v1.1.0 (Appendix A to Subpart B)
-- 49 CFR §395.8(k) — 6-month records retention requirement
-- 49 CFR §395.30   — Driver rights to review and reject edits
--
-- Design principles
-- ─────────────────────────────────────────────────────────────
-- • TIMESTAMPTZ for every timestamp (all times stored as UTC).
-- • NUMERIC(p, s) for odometer and engine hours (no floating-point drift).
-- • JSONB for flexible metadata that varies by event type.
-- • All tables carry carrier_id for Row-Level Security partitioning.
-- • ELD event records are append-only; edits create new rows.
-- • Immutability enforced at the DB layer via BEFORE UPDATE triggers.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";    -- uuid_generate_v4()
create extension if not exists "pgcrypto";     -- crypt(), gen_random_bytes()
create extension if not exists "citext";       -- case-insensitive text (email, account IDs)

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- These are used by RLS policies and must be created before the policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns the carrier_id for the currently authenticated Supabase user.
create or replace function public.current_user_carrier_id()
  returns uuid
  language sql stable security definer
as $$
  select carrier_id from public.profiles where id = auth.uid();
$$;

-- Returns the role of the currently authenticated Supabase user.
create or replace function public.current_user_role()
  returns text
  language sql stable security definer
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Returns true when the current user is the driver identified by driver_id.
create or replace function public.is_own_driver_record(p_driver_id uuid)
  returns boolean
  language sql stable security definer
as $$
  select exists (
    select 1 from public.drivers
    where id = p_driver_id and user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 1 — MULTI-TENANT CORE
-- ─────────────────────────────────────────────────────────────────────────────

-- carriers ─────────────────────────────────────────────────────────────────
-- Root of the multi-tenant hierarchy. Every data row in the platform
-- belongs to exactly one carrier. Carriers map 1:1 to USDOT numbers.
create table public.carriers (
  id                uuid          primary key default uuid_generate_v4(),

  -- FMCSA registration
  dot_number        varchar(8)    not null unique
    check (dot_number ~ '^\d{1,8}$'),
  mc_number         varchar(8)
    check (mc_number ~ '^\d{1,8}$'),

  -- Business identity
  legal_name        text          not null,
  dba_name          text,

  -- Contact & address
  address_line1     text          not null,
  address_line2     text,
  city              text          not null,
  state             char(2)       not null,
  zip               varchar(10)   not null,
  country           char(2)       not null default 'US',
  phone             varchar(20)   not null,
  email             citext        not null unique,

  -- Billing & status
  status            text          not null default 'active'
    check (status in ('active', 'suspended', 'inactive')),
  subscription_tier text          not null default 'starter'
    check (subscription_tier in ('starter', 'professional', 'enterprise')),

  -- Carrier-level feature flags and HOS rule defaults
  -- Stored as JSONB so new config fields can be added without schema changes.
  -- Shape: { personalUseEnabled: bool, yardMovesEnabled: bool,
  --          defaultHosRuleset: string, adverseDrivingEnabled: bool }
  settings          jsonb         not null default '{}'::jsonb,

  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

comment on table public.carriers is
  'Multi-tenant root. Every data row in the platform belongs to exactly one carrier.';

-- profiles ─────────────────────────────────────────────────────────────────
-- Extends auth.users. Auto-created via trigger on signup.
-- Matches Supabase's convention of one profile row per auth.users row.
create table public.profiles (
  id              uuid          primary key references auth.users(id) on delete cascade,
  carrier_id      uuid          not null references public.carriers(id) on delete cascade,

  -- Role-based access control
  role            text          not null
    check (role in ('driver', 'fleet_manager', 'admin', 'support')),

  -- Personal info (duplicated from auth.users for convenience)
  full_name       text          not null default '',
  phone           varchar(20)   not null default '',
  is_active       boolean       not null default true,

  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

comment on table public.profiles is
  'Extends auth.users. Auto-created via trigger on new signup.';

-- Auto-create a profile stub when a new user is created in auth.users.
-- The trigger populates role and carrier_id from raw_user_meta_data,
-- which the admin SDK sets when creating users via the management API.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql security definer
as $$
begin
  insert into public.profiles (id, carrier_id, role, full_name)
  values (
    new.id,
    (new.raw_user_meta_data->>'carrier_id')::uuid,
    coalesce(new.raw_user_meta_data->>'role', 'driver'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 2 — FLEET ASSETS
-- ─────────────────────────────────────────────────────────────────────────────

-- drivers ──────────────────────────────────────────────────────────────────
-- Commercial Motor Vehicle drivers (CDL holders).
-- One drivers row per auth.users account that has role='driver'.
create table public.drivers (
  id                      uuid          primary key default uuid_generate_v4(),
  carrier_id              uuid          not null references public.carriers(id) on delete cascade,
  user_id                 uuid          not null unique references auth.users(id) on delete restrict,

  -- Identity
  full_name               text          not null,
  phone                   varchar(20)   not null,
  email                   citext        not null,

  -- Commercial Driver's License
  license_number          text          not null,
  license_state           char(2)       not null,
  license_class           char(1)       not null check (license_class in ('A', 'B', 'C')),
  license_expiry          date          not null,

  -- HOS configuration
  -- home_terminal_timezone: IANA timezone string, determines log period boundaries.
  home_terminal_address   text          not null,
  home_terminal_timezone  text          not null default 'America/Chicago',
  hos_ruleset             text          not null default 'property_70h'
    check (hos_ruleset in (
      'property_60h', 'property_70h',
      'passenger_60h', 'passenger_70h'
    )),
  exempt_driver_type      text          not null default 'none'
    check (exempt_driver_type in ('none', 'short_haul', 'agriculture', 'construction')),

  -- Driver-level exemption flags (HOS engine reads these at runtime).
  -- Shape: { shortHaul: bool, adverseDrivingConditions: bool, passengerCarrying: bool }
  exemptions              jsonb         not null default '{}'::jsonb,

  -- Denormalized live state (updated on every relevant ELD event).
  -- Kept for dashboard O(1) reads; source of truth is eld_events.
  status                  text          not null default 'offline'
    check (status in ('available', 'on_trip', 'offline', 'inactive', 'suspended')),
  current_vehicle_id      uuid,                     -- FK added below (circular dep)
  current_duty_status     smallint
    check (current_duty_status between 1 and 4),    -- 1=OFF 2=SB 3=D 4=ON

  unique (carrier_id, license_number, license_state),

  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now()
);

comment on table public.drivers is
  'Commercial Motor Vehicle drivers (CDL holders). One row per driver account.';
comment on column public.drivers.home_terminal_timezone is
  'IANA timezone string (e.g. America/Chicago). Determines midnight log-period boundary.';
comment on column public.drivers.hos_ruleset is
  'HOS rule set: property_60h (60h/7-day), property_70h (70h/8-day), passenger variants.';

-- vehicles ─────────────────────────────────────────────────────────────────
-- Commercial Motor Vehicles (power units). One row per physical truck/bus.
create table public.vehicles (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete cascade,

  -- FMCSA-required identifiers
  power_unit_number     varchar(10)   not null,     -- Carrier-assigned truck number
  vin                   char(17)      not null unique
    check (length(vin) = 17),                       -- ISO 3779
  license_plate         varchar(12)   not null,
  license_plate_state   char(2)       not null,

  -- Vehicle specs
  make                  text          not null,
  model                 text          not null,
  year                  smallint      not null check (year between 1900 and 2100),
  gvwr_lbs              integer       not null check (gvwr_lbs > 0),
  vehicle_type          text          not null default 'tractor'
    check (vehicle_type in ('tractor', 'straight_truck', 'bus', 'other')),

  status                text          not null default 'active'
    check (status in ('active', 'maintenance', 'retired')),

  -- Denormalized live state
  current_driver_id     uuid,                       -- FK added below (circular dep with drivers)

  unique (carrier_id, power_unit_number),

  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

comment on table public.vehicles is
  'Commercial Motor Vehicles (CMVs / power units). One row per physical truck or bus.';
comment on column public.vehicles.gvwr_lbs is
  'Gross Vehicle Weight Rating in pounds. Must exceed 10,001 lbs for ELD applicability under §395.20.';

-- Add circular FK: drivers.current_vehicle_id → vehicles
alter table public.drivers
  add constraint fk_drivers_current_vehicle
    foreign key (current_vehicle_id) references public.vehicles(id) on delete set null;

-- Add circular FK: vehicles.current_driver_id → drivers
alter table public.vehicles
  add constraint fk_vehicles_current_driver
    foreign key (current_driver_id) references public.drivers(id) on delete set null;

-- trailers ─────────────────────────────────────────────────────────────────
-- Trailers that can be coupled to CMVs. FMCSA requires up to 2 trailer
-- numbers to be recorded on power-up and login events.
create table public.trailers (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete cascade,

  trailer_number        varchar(10)   not null,
  license_plate         varchar(12),
  license_plate_state   char(2),
  trailer_type          text          not null default 'dry_van'
    check (trailer_type in ('dry_van', 'flatbed', 'refrigerated', 'tanker', 'lowboy', 'other')),
  status                text          not null default 'active'
    check (status in ('active', 'maintenance', 'retired')),

  unique (carrier_id, trailer_number),

  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

comment on table public.trailers is
  'Trailers that can be coupled to CMVs. Up to 2 per CMV per trip per FMCSA requirements.';

-- eld_devices ──────────────────────────────────────────────────────────────
-- FMCSA-registered Electronic Logging Devices. One physical device per CMV.
-- The registration_id (e.g. "PACTRKV1") is embedded in every ELD event record.
create table public.eld_devices (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete cascade,

  -- FMCSA registration (Appendix A §4.1)
  registration_id       varchar(8)    not null
    check (registration_id ~ '^[A-Z0-9]{4,8}$'),   -- e.g. "PACTRKV1"
  serial_number         text          not null unique,
  device_model          text          not null,
  manufacturer          text          not null,
  firmware_version      text          not null,
  fmcsa_certified_on    date          not null,     -- Date added to FMCSA registry

  -- Current assignment (denormalized; source of truth is vehicle_eld_assignments)
  current_vehicle_id    uuid
    references public.vehicles(id) on delete set null,

  status                text          not null default 'active'
    check (status in ('active', 'inactive', 'malfunctioning', 'decommissioned')),

  unique (carrier_id, registration_id),

  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

comment on table public.eld_devices is
  'FMCSA-registered ELD hardware units. One per CMV. registration_id appears in every .erod file.';
comment on column public.eld_devices.registration_id is
  'FMCSA-assigned ELD Registration ID. 4–8 uppercase alphanumeric chars. Unique per carrier.';

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 3 — ASSIGNMENT HISTORY
-- Full audit trail of asset pairings.
-- Required for compliance: the .erod file must reflect the correct CMV/ELD
-- relationship for the date of each event.
-- ─────────────────────────────────────────────────────────────────────────────

-- vehicle_eld_assignments ──────────────────────────────────────────────────
-- Records when each ELD was installed in and removed from a vehicle.
-- A null unassigned_at means the device is currently installed.
create table public.vehicle_eld_assignments (
  id              uuid          primary key default uuid_generate_v4(),
  vehicle_id      uuid          not null references public.vehicles(id) on delete restrict,
  eld_device_id   uuid          not null references public.eld_devices(id) on delete restrict,
  assigned_at     timestamptz   not null default now(),
  unassigned_at   timestamptz,
  assigned_by     uuid          references public.profiles(id) on delete set null,

  check (unassigned_at is null or unassigned_at > assigned_at)
);

comment on table public.vehicle_eld_assignments is
  'Full installation history: which ELD was in which vehicle at any given time.';

create index idx_vea_vehicle_time  on public.vehicle_eld_assignments(vehicle_id, assigned_at desc);
create index idx_vea_device_time   on public.vehicle_eld_assignments(eld_device_id, assigned_at desc);

-- driver_vehicle_assignments ───────────────────────────────────────────────
-- Records when each driver was assigned to a vehicle (and which trailers
-- were coupled at the time of assignment).
create table public.driver_vehicle_assignments (
  id              uuid          primary key default uuid_generate_v4(),
  driver_id       uuid          not null references public.drivers(id) on delete restrict,
  vehicle_id      uuid          not null references public.vehicles(id) on delete restrict,
  assigned_at     timestamptz   not null default now(),
  unassigned_at   timestamptz,
  assigned_by     uuid          references public.profiles(id) on delete set null,
  trailer1_id     uuid          references public.trailers(id) on delete set null,
  trailer2_id     uuid          references public.trailers(id) on delete set null,

  check (unassigned_at is null or unassigned_at > assigned_at),
  check (trailer1_id is null or trailer1_id <> trailer2_id)
);

comment on table public.driver_vehicle_assignments is
  'Full assignment history: which driver operated which vehicle (and trailers) at any given time.';

create index idx_dva_driver_time  on public.driver_vehicle_assignments(driver_id, assigned_at desc);
create index idx_dva_vehicle_time on public.driver_vehicle_assignments(vehicle_id, assigned_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 4 — ELD EVENT STREAM
-- Core immutable event tables. Original records are never deleted.
-- Edit history is tracked via event_record_status + previous_version_id chain.
-- ─────────────────────────────────────────────────────────────────────────────

-- log_periods ──────────────────────────────────────────────────────────────
-- One row per driver per 24-hour HOS log period (midnight–midnight in the
-- driver's home-terminal timezone). Drives the certification lifecycle.
create table public.log_periods (
  id                      uuid          primary key default uuid_generate_v4(),
  carrier_id              uuid          not null references public.carriers(id) on delete cascade,
  driver_id               uuid          not null references public.drivers(id) on delete restrict,

  -- Log date in two representations (both derived from the same day):
  log_date                date          not null,   -- native DATE for range queries
  log_date_mmddyy         char(6)       not null    -- MMDDYY for .erod file headers
    check (log_date_mmddyy ~ '^(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\d{2}$'),

  home_terminal_timezone  text          not null,   -- IANA, determines period boundaries
  hos_ruleset             text          not null,   -- Snapshot of driver's ruleset on this day

  -- Certification lifecycle
  status                  text          not null default 'open'
    check (status in ('open', 'closed', 'certified', 'recertified')),
  certified_at            timestamptz,              -- When driver first certified
  recertified_at          timestamptz,              -- When driver last re-certified after edit

  -- Anti-tampering event count.
  -- Incremented on each INSERT to eld_events for this period.
  -- Must match totalRecordsCertified in the EventType 4 record.
  total_event_count       integer       not null default 0 check (total_event_count >= 0),

  unique (driver_id, log_date),

  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now()
);

comment on table public.log_periods is
  'One row per driver per 24-hour HOS log period (midnight–midnight in home-terminal tz).';
comment on column public.log_periods.total_event_count is
  'Incremented on each eld_events INSERT. Cross-checked against EventType 4 certification count.';

create index idx_log_periods_carrier_date on public.log_periods(carrier_id, log_date desc);
create index idx_log_periods_driver_date  on public.log_periods(driver_id, log_date desc);

-- eld_events ───────────────────────────────────────────────────────────────
-- Append-only table for all 7 FMCSA event types.
-- Immutability contract:
--   • New records are always INSERTed, never UPDATEd (except event_record_status).
--   • To edit: INSERT new row (status=1) + UPDATE old row's status to 2.
--   • Enforced by trg_eld_events_immutable trigger below.
create table public.eld_events (
  id                                uuid          primary key default uuid_generate_v4(),

  -- Tenant & relationship keys
  carrier_id                        uuid          not null references public.carriers(id) on delete cascade,
  log_period_id                     uuid          not null references public.log_periods(id) on delete restrict,
  driver_id                         uuid          not null references public.drivers(id) on delete restrict,
  vehicle_id                        uuid          not null references public.vehicles(id) on delete restrict,
  eld_device_id                     uuid          not null references public.eld_devices(id) on delete restrict,

  -- ── FMCSA Appendix A §7.3 required fields ─────────────────────────────
  -- Sequence & status
  event_sequence_id                 integer       not null
    check (event_sequence_id between 1 and 65535),
  event_record_status               smallint      not null
    check (event_record_status between 1 and 4),
    -- 1 = Active  2 = Inactive-Changed  3 = Inactive-ChangeRequested
    -- 4 = Inactive-AssumedUnidentifiedDriver
  event_record_origin               smallint      not null
    check (event_record_origin between 1 and 4),
    -- 1 = Automatic  2 = Driver  3 = Other authenticated user  4 = Unidentified driver
  event_type                        smallint      not null
    check (event_type between 1 and 7),
    -- 1=DutyStatus  2=IntermLog  3=PersonalUse/YardMoves  4=Certification
    -- 5=Login/Logout  6=EnginePower  7=Malfunction/Diagnostic
  event_sub_type                    smallint      not null check (event_sub_type >= 1),

  -- Date & time
  -- event_date: MMDDYY in driver's home-terminal timezone.
  -- event_time: HHMMSS in UTC.
  -- event_timestamp: server-derived TIMESTAMPTZ for efficient range queries.
  event_date                        char(6)       not null
    check (event_date ~ '^(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\d{2}$'),
  event_time                        char(6)       not null
    check (event_time ~ '^([01]\d|2[0-3])[0-5]\d[0-5]\d$'),
  timezone_offset                   char(5)       not null
    check (timezone_offset ~ '^[+-](0\d|1[0-4])[0-5]\d$'),
  -- Derived ISO 8601 timestamp (stored for JOIN/range queries; computed on insert).
  event_timestamp                   timestamptz   not null,

  -- Odometer and engine hours
  -- NUMERIC avoids floating-point rounding errors that would break hash chains.
  accumulated_vehicle_miles         numeric(9, 1) not null check (accumulated_vehicle_miles >= 0),
  elapsed_engine_hours              numeric(7, 1) not null check (elapsed_engine_hours >= 0),

  -- Location
  -- GPS coordinates: null when GPS is unavailable (reduced-precision fallback).
  latitude                          numeric(9, 6)
    check (latitude between -90 and 90),
  longitude                         numeric(10, 6)
    check (longitude between -180 and 180),
  location_description              varchar(60),
  -- Distance since last valid GPS fix (tenths of a mile).
  -- Required (not null) when lat/lon are null.
  distance_since_last_valid_coords  numeric(6, 1)
    check (distance_since_last_valid_coords >= 0),

  -- Status indicator flags
  malfunction_indicator_status      boolean       not null default false,
  eld_malfunction_status            boolean       not null default false,
  data_diagnostic_indicator_status  boolean       not null default false,

  -- FMCSA checksum (Appendix A §7.3.2)
  -- Two-character hex value computed over all encoded fields.
  event_data_check_value            char(2)       not null
    check (event_data_check_value ~ '^[0-9A-Fa-f]{2}$'),

  -- Optional driver annotation (≤60 chars, required for some event types)
  annotation                        varchar(60),

  -- ── Event-type-specific denormalized fields ────────────────────────────
  -- These columns are used by different event types. Constraints below
  -- enforce which are required for each event type.
  driver_eld_account_id             varchar(60),  -- EventTypes 1, 3, 4, 5
  co_driver_eld_account_id          varchar(60),  -- EventType 5 (team driving)
  previous_duty_status              smallint      -- EventType 1 only
    check (previous_duty_status between 1 and 4),
  is_personal_use_active            boolean,      -- EventType 1 context flag
  is_yard_moves_active              boolean,      -- EventType 1 context flag
  malfunction_code                  char(1)       -- EventType 7 (malfunction)
    check (malfunction_code in ('P','E','T','L','R','S','O')),
  diagnostic_code                   char(1)       -- EventType 7 (diagnostic)
    check (diagnostic_code in ('1','2','3','4','5','6')),

  -- ── Event-type-specific flexible payload ──────────────────────────────
  -- JSONB blob for fields that vary by event type and cannot be denormalized
  -- efficiently (e.g. exemptions on login, certifiedDate on certification,
  -- trailerNumbers on power-up). Validated in application code against
  -- the JSON Schema files in /shared/src/eld/json-schemas/.
  event_metadata                    jsonb         not null default '{}'::jsonb,

  -- ── Versioning (immutability chain) ───────────────────────────────────
  version_number                    smallint      not null default 1
    check (version_number >= 1),
  -- Self-reference to the row this one supersedes (null for version 1).
  previous_version_id               uuid
    references public.eld_events(id) on delete restrict,
  -- Points to the original (version 1) row; equals id when version_number = 1.
  original_version_id               uuid
    references public.eld_events(id) on delete restrict,

  -- ── Tamper-evidence hash chain ─────────────────────────────────────────
  -- SHA-256 hex strings (64 lowercase hex chars each).
  -- Algorithm: see /shared/src/eld/audit-trail.ts → computeContentHash/computeChainHash.
  content_hash                      char(64)      not null
    check (content_hash ~ '^[0-9a-f]{64}$'),
  chain_hash                        char(64)      not null
    check (chain_hash ~ '^[0-9a-f]{64}$'),
  -- null for the first event in a log period (genesis record).
  previous_chain_hash               char(64)
    check (previous_chain_hash ~ '^[0-9a-f]{64}$'),

  -- ── Cross-field constraints ─────────────────────────────────────────────
  -- GPS: if no coordinates, distance_since_last_valid_coords must be provided.
  check (
    (latitude is not null and longitude is not null)
    or distance_since_last_valid_coords is not null
  ),
  -- Malfunction/diagnostic are mutually exclusive (EventType 7).
  check (
    not (malfunction_code is not null and diagnostic_code is not null)
  ),
  -- original_version_id must equal id for version 1 records.
  -- (Enforced in app layer; DB constraint would be circular, so only noted here.)

  created_at                        timestamptz   not null default now()
  -- NO updated_at — this table is append-only.
);

comment on table public.eld_events is
  'Append-only. All 7 FMCSA event types. Edit history preserved via event_record_status chain.';
comment on column public.eld_events.event_timestamp is
  'Server-derived TIMESTAMPTZ for range queries. Computed from event_date + event_time + timezone_offset on insert.';
comment on column public.eld_events.accumulated_vehicle_miles is
  'NUMERIC(9,1) — tenths-of-a-mile precision. NUMERIC avoids floating-point drift in hash inputs.';
comment on column public.eld_events.event_metadata is
  'JSONB for event-type-specific fields (trailer numbers, certifiedDate, exemptions, etc.). Validated against /shared JSON schemas.';
comment on column public.eld_events.content_hash is
  'SHA-256 of canonical event data fields. See HashableEventFields in audit-trail.ts.';
comment on column public.eld_events.chain_hash is
  'SHA-256 of (content_hash || previous_chain_hash). Links this record to its predecessor.';

-- Indexes
create unique index idx_eld_events_device_seq_unique
  on public.eld_events(eld_device_id, log_period_id, event_sequence_id)
  where event_record_status = 1;  -- only active records; inactive can share seq IDs

create index idx_eld_events_period_seq       on public.eld_events(log_period_id, event_sequence_id);
create index idx_eld_events_driver_date      on public.eld_events(driver_id, event_date);
create index idx_eld_events_driver_ts        on public.eld_events(driver_id, event_timestamp desc);
create index idx_eld_events_vehicle_date     on public.eld_events(vehicle_id, event_date);
create index idx_eld_events_carrier_type     on public.eld_events(carrier_id, event_type, event_date);
create index idx_eld_events_content_hash     on public.eld_events(content_hash);

-- Immutability trigger: only event_record_status may be changed on existing rows.
create or replace function public.allow_eld_event_status_update()
  returns trigger
  language plpgsql
as $$
begin
  -- Allow update only when all data fields are unchanged and the new status
  -- is one of the valid inactive values (2, 3, 4).
  if (
    new.id                  = old.id
    and new.event_sequence_id   = old.event_sequence_id
    and new.event_type          = old.event_type
    and new.event_date          = old.event_date
    and new.event_time          = old.event_time
    and new.content_hash        = old.content_hash
    and new.chain_hash          = old.chain_hash
    and new.event_timestamp     = old.event_timestamp
    and new.event_record_status in (2, 3, 4)
  ) then
    return new;
  end if;
  raise exception
    'eld_events is append-only. '
    'To edit a record: INSERT a new version (event_record_status=1) with previous_version_id '
    'pointing here, then UPDATE this row''s event_record_status to 2, 3, or 4. '
    'No other columns may be modified.';
end;
$$;

create trigger trg_eld_events_immutable
  before update on public.eld_events
  for each row execute function public.allow_eld_event_status_update();

-- sequence_id_states ───────────────────────────────────────────────────────
-- Persists the last-issued sequence ID for each (eld_device_id, log_period_id)
-- scope. Used by SequenceIdManager on both mobile (offline) and backend (sync).
create table public.sequence_id_states (
  id                uuid          primary key default uuid_generate_v4(),
  eld_device_id     uuid          not null references public.eld_devices(id) on delete cascade,
  log_period_id     uuid          not null references public.log_periods(id) on delete cascade,

  -- 0 means no events have been issued yet this period.
  last_issued_id    integer       not null default 0
    check (last_issued_id between 0 and 65535),
  last_issued_at    timestamptz   not null default now(),

  -- Should always be 0. Values > 0 indicate a sequence wraparound anomaly
  -- that must be investigated and reported as a compliance issue.
  wrap_around_count smallint      not null default 0 check (wrap_around_count >= 0),

  updated_at        timestamptz   not null default now(),

  unique (eld_device_id, log_period_id)
);

comment on table public.sequence_id_states is
  'Last-issued sequence ID per (eld_device_id × log_period). Used by SequenceIdManager.';
comment on column public.sequence_id_states.wrap_around_count is
  'Should always be 0. Non-zero values flag a sequence anomaly requiring compliance review.';

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 5 — MATERIALIZED HOS DATA
-- Derived from the ELD event stream. Updated on each relevant event insert.
-- Source of truth is always eld_events; these tables are read replicas.
-- ─────────────────────────────────────────────────────────────────────────────

-- duty_status_records ──────────────────────────────────────────────────────
-- Materializes duty-status time intervals from EventType 1 records.
-- One row per contiguous duty-status segment (the interval between two
-- consecutive EventType 1 events for the same driver).
create table public.duty_status_records (
  id                      uuid          primary key default uuid_generate_v4(),
  carrier_id              uuid          not null references public.carriers(id) on delete cascade,
  log_period_id           uuid          not null references public.log_periods(id) on delete cascade,
  driver_id               uuid          not null references public.drivers(id) on delete restrict,

  -- The EventType 1 row that started this segment.
  source_eld_event_id     uuid          not null unique
    references public.eld_events(id) on delete restrict,

  -- Duty status
  duty_status             smallint      not null check (duty_status between 1 and 4),
  previous_duty_status    smallint      check (previous_duty_status between 1 and 4),

  -- Time bounds
  -- started_at: TIMESTAMPTZ derived from the source event's timestamp.
  -- ended_at: TIMESTAMPTZ when the NEXT EventType 1 event arrives. Null if current segment.
  -- duration_minutes: NUMERIC(7,2) to accumulate tenths-of-minute precision.
  started_at              timestamptz   not null,
  ended_at                timestamptz,
  duration_minutes        numeric(7, 2) check (duration_minutes >= 0),

  -- Location snapshot at segment start
  location_description    varchar(60),
  latitude                numeric(9, 6),
  longitude               numeric(10, 6),

  -- Exemption flags active during this segment (denormalized from context events)
  is_personal_use_active  boolean       not null default false,
  is_yard_moves_active    boolean       not null default false,

  check (ended_at is null or ended_at > started_at),

  created_at              timestamptz   not null default now()
);

comment on table public.duty_status_records is
  'Materialized duty-status intervals from EventType 1 events. One row per contiguous segment.';
comment on column public.duty_status_records.duration_minutes is
  'NUMERIC(7,2) — sub-minute precision needed for HOS clock accuracy (vs. integer minutes).';

create index idx_dsr_driver_time    on public.duty_status_records(driver_id, started_at desc);
create index idx_dsr_period_status  on public.duty_status_records(log_period_id, duty_status);

-- hos_calculations ─────────────────────────────────────────────────────────
-- Computed HOS window snapshot for a driver at the end of a log period
-- (or on-demand when the mobile app requests current clock data).
-- One row per (driver_id, log_period_id); updated in-place as new events arrive.
create table public.hos_calculations (
  id                                        uuid          primary key default uuid_generate_v4(),
  carrier_id                                uuid          not null references public.carriers(id) on delete cascade,
  driver_id                                 uuid          not null references public.drivers(id) on delete restrict,
  log_period_id                             uuid          not null references public.log_periods(id) on delete cascade,
  calculated_at                             timestamptz   not null,
  hos_ruleset                               text          not null,

  -- ── Rolling window accumulators (all in minutes) ─────────────────────
  -- NUMERIC avoids integer truncation in multi-day accumulations.
  driving_minutes_today                     numeric(7, 2) not null default 0,
  on_duty_minutes_today                     numeric(7, 2) not null default 0,
  driving_minutes_7day                      numeric(8, 2) not null default 0,   -- rolling 7 days
  on_duty_minutes_7day                      numeric(8, 2) not null default 0,
  driving_minutes_8day                      numeric(8, 2) not null default 0,   -- rolling 8 days
  on_duty_minutes_8day                      numeric(8, 2) not null default 0,

  -- ── Remaining time (null = limit not applicable to this ruleset) ─────
  remaining_driving_minutes                 numeric(7, 2),  -- until 11h driving limit
  remaining_on_duty_window_minutes          numeric(7, 2),  -- until 14h window expires
  remaining_weekly_minutes                  numeric(8, 2),  -- remaining 60 or 70h limit
  time_until_break_required_minutes         numeric(7, 2),  -- until mandatory 30-min break

  -- Consecutive off-duty/sleeper-berth streak (for 34h restart and reset calculations)
  consecutive_off_duty_minutes              numeric(7, 2) not null default 0,

  -- ── 34-hour restart ──────────────────────────────────────────────────
  is_in_34h_restart                         boolean       not null default false,
  restart_started_at                        timestamptz,    -- when the restart began
  restart_eligible_at                       timestamptz,    -- when the restart completes

  -- ── Exemption state snapshots ──────────────────────────────────────
  is_adverse_conditions_active              boolean       not null default false,
  adverse_conditions_invoked_at             timestamptz,
  is_short_haul_active                      boolean       not null default false,

  unique (driver_id, log_period_id),

  created_at                                timestamptz   not null default now()
);

comment on table public.hos_calculations is
  'Computed HOS snapshot per driver per log period. Drives the mobile HOS clock display.';
comment on column public.hos_calculations.driving_minutes_today is
  'NUMERIC(7,2) — tenths-of-minute precision for sub-minute accuracy in multi-event accumulation.';

create index idx_hos_calc_carrier_time on public.hos_calculations(carrier_id, calculated_at desc);
create index idx_hos_calc_driver       on public.hos_calculations(driver_id, log_period_id);

-- hos_violations ───────────────────────────────────────────────────────────
-- HOS rule violations detected by the rule engine.
-- Each row represents one violation condition (start → end duration).
create table public.hos_violations (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete cascade,
  driver_id             uuid          not null references public.drivers(id) on delete restrict,
  log_period_id         uuid          not null references public.log_periods(id) on delete cascade,

  -- The ELD event whose arrival caused this violation to be detected.
  trigger_event_id      uuid
    references public.eld_events(id) on delete set null,

  violation_type        text          not null check (violation_type in (
    'DRIVING_LIMIT_EXCEEDED',     -- 11h driving limit
    'ON_DUTY_WINDOW_EXCEEDED',    -- 14h on-duty window
    'BREAK_VIOLATION',            -- 30-min break requirement
    'WEEKLY_LIMIT_EXCEEDED',      -- 60h/7-day or 70h/8-day
    'INSUFFICIENT_OFF_DUTY',      -- <10h off duty before shift
    'FALSIFICATION_SUSPECTED',    -- engine running while Off Duty
    'UNASSIGNED_DRIVING_TIME'     -- driving detected, no driver logged in
  )),
  severity              text          not null check (severity in ('warning', 'violation')),

  -- When the violation condition started and ended.
  started_at            timestamptz   not null,
  ended_at              timestamptz,
  duration_minutes      numeric(7, 2) check (duration_minutes >= 0),

  -- Structured context for the UI and compliance reporting.
  -- Shape varies by violation_type, e.g.:
  --   DRIVING_LIMIT_EXCEEDED: { limit_minutes: 660, actual_minutes: 695 }
  --   BREAK_VIOLATION: { last_break_at: "...", driving_since_break_minutes: 490 }
  details               jsonb         not null default '{}'::jsonb,

  -- Acknowledgement (fleet manager or admin reviews and dismisses the alert)
  acknowledged_by       uuid          references public.profiles(id) on delete set null,
  acknowledged_at       timestamptz,

  check (ended_at is null or ended_at > started_at),

  created_at            timestamptz   not null default now()
);

comment on table public.hos_violations is
  'HOS rule violations detected by the rule engine. Each row = one violation condition.';
comment on column public.hos_violations.details is
  'JSONB context for compliance UI: limit vs actual values, timestamps, affected events.';

create index idx_hos_viol_driver_time  on public.hos_violations(driver_id, started_at desc);
create index idx_hos_viol_carrier_type on public.hos_violations(carrier_id, violation_type);
create index idx_hos_viol_period       on public.hos_violations(log_period_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 6 — COMPLIANCE OUTPUTS
-- ─────────────────────────────────────────────────────────────────────────────

-- certifications ───────────────────────────────────────────────────────────
-- Materialized from EventType 4 (certification) events.
-- Records every time a driver certifies (or re-certifies) a log period.
-- Ref: 49 CFR §395.8(h) — certifications required within 13 days.
create table public.certifications (
  id                        uuid          primary key default uuid_generate_v4(),
  carrier_id                uuid          not null references public.carriers(id) on delete cascade,

  -- Source ELD event (EventType 4)
  source_eld_event_id       uuid          not null unique
    references public.eld_events(id) on delete restrict,

  log_period_id             uuid          not null references public.log_periods(id) on delete restrict,

  -- The driver performing the certification action
  certifying_driver_id      uuid          not null references public.drivers(id) on delete restrict,
  -- The driver whose records are being certified (differs on EventSubType 2 / co-driver certs)
  certified_driver_id       uuid          not null references public.drivers(id) on delete restrict,

  -- Certification details
  certification_type        text          not null
    check (certification_type in ('own_records', 'co_driver_records')),
  certified_log_date        char(6)       not null
    check (certified_log_date ~ '^(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\d{2}$'),
  total_records_certified   integer       not null check (total_records_certified >= 1),

  -- False = initial certification; True = re-certification after subsequent edit.
  is_recertification        boolean       not null default false,

  -- Sequence IDs of events that changed since last certification (for re-certs).
  -- Stored as JSONB array; empty array for initial certifications.
  edited_event_sequence_ids jsonb         not null default '[]'::jsonb,

  performed_at              timestamptz   not null,
  created_at                timestamptz   not null default now()
);

comment on table public.certifications is
  'Materialized from EventType 4 events. One row per driver certification of a log period.';
comment on column public.certifications.total_records_certified is
  'Anti-tampering event count. Must match log_periods.total_event_count at certification time.';

create index idx_cert_driver_date on public.certifications(certified_driver_id, certified_log_date);

-- unidentified_driver_records ──────────────────────────────────────────────
-- Driving detected while no driver was logged into the ELD.
-- Must be resolved (claimed or rejected) within 8 days.
-- Ref: 49 CFR §395.30(c).
create table public.unidentified_driver_records (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete cascade,
  vehicle_id            uuid          not null references public.vehicles(id) on delete restrict,
  eld_device_id         uuid          not null references public.eld_devices(id) on delete restrict,
  log_period_id         uuid          not null references public.log_periods(id) on delete cascade,

  -- Duration of the unidentified driving segment
  started_at            timestamptz   not null,
  ended_at              timestamptz,
  duration_minutes      numeric(7, 2) check (duration_minutes >= 0),
  accumulated_miles     numeric(7, 1) not null default 0 check (accumulated_miles >= 0),

  -- Resolution state
  status                text          not null default 'pending'
    check (status in ('pending', 'claimed', 'rejected', 'expired')),
  claimed_by_driver_id  uuid          references public.drivers(id) on delete set null,
  claimed_at            timestamptz,
  -- The EventType 5 (login) event where the driver accepted this driving record.
  claim_eld_event_id    uuid          references public.eld_events(id) on delete set null,
  rejection_reason      text,

  -- Location snapshot for the start of the unidentified driving segment
  start_latitude        numeric(9, 6),
  start_longitude       numeric(10, 6),
  start_location_desc   varchar(60),

  check (ended_at is null or ended_at > started_at),

  created_at            timestamptz   not null default now()
);

comment on table public.unidentified_driver_records is
  'Driving detected without a logged-in driver. Must be resolved within 8 days per §395.30(c).';

create index idx_udr_vehicle_time   on public.unidentified_driver_records(vehicle_id, started_at desc);
create index idx_udr_carrier_status on public.unidentified_driver_records(carrier_id, status);
create index idx_udr_pending_age    on public.unidentified_driver_records(carrier_id, started_at)
  where status = 'pending';   -- drives the "aging" alert dashboard query

-- eld_malfunctions ─────────────────────────────────────────────────────────
-- Active and resolved ELD malfunction and data-diagnostic conditions.
-- Materialized from EventType 7 events.
-- Malfunctions require paper-log fallback within 8 days (§395.34).
-- Diagnostics are non-critical but must be corrected.
create table public.eld_malfunctions (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete cascade,
  source_eld_event_id   uuid          not null references public.eld_events(id) on delete restrict,
  driver_id             uuid          not null references public.drivers(id) on delete restrict,
  vehicle_id            uuid          not null references public.vehicles(id) on delete restrict,
  eld_device_id         uuid          not null references public.eld_devices(id) on delete restrict,

  -- Code classification
  is_malfunction        boolean       not null,
  malfunction_code      char(1)
    check (malfunction_code in ('P','E','T','L','R','S','O')),
  diagnostic_code       char(1)
    check (diagnostic_code in ('1','2','3','4','5','6')),

  -- Lifecycle
  is_active             boolean       not null default true,
  detected_at           timestamptz   not null,
  resolved_at           timestamptz,
  duration_minutes      numeric(7, 2) check (duration_minutes >= 0),

  -- Log period dates whose data may be compromised by this condition.
  -- Stored as JSONB array of MMDDYY strings (e.g. ["061224","061324"]).
  affected_log_periods  jsonb         not null default '[]'::jsonb,

  -- Paper logs required for malfunctions (§395.34); false for diagnostics.
  paper_logs_required   boolean       not null default false,

  -- FMCSA notification requirement: carrier must notify ELD provider within 8 days.
  provider_notified_at  timestamptz,

  -- Fleet manager acknowledgement
  acknowledged_by       uuid          references public.profiles(id) on delete set null,
  acknowledged_at       timestamptz,

  check (not (malfunction_code is not null and diagnostic_code is not null)),
  check (
    (is_malfunction = true  and malfunction_code is not null)
    or (is_malfunction = false and diagnostic_code is not null)
  ),
  check (resolved_at is null or resolved_at > detected_at),

  created_at            timestamptz   not null default now()
);

comment on table public.eld_malfunctions is
  'Active and resolved ELD malfunction/diagnostic conditions (EventType 7).';
comment on column public.eld_malfunctions.affected_log_periods is
  'JSONB array of MMDDYY dates whose data quality may be compromised by this condition.';

create index idx_eld_mal_device_active  on public.eld_malfunctions(eld_device_id, is_active);
create index idx_eld_mal_driver_active  on public.eld_malfunctions(driver_id, is_active);
create index idx_eld_mal_carrier_time   on public.eld_malfunctions(carrier_id, detected_at desc);

-- eld_records ──────────────────────────────────────────────────────────────
-- Immutable, finalized .erod compliance files. Append-only — no UPDATE or DELETE.
-- Retained for a minimum of 6 months per 49 CFR §395.8(k).
create table public.eld_records (
  id                    uuid          primary key default uuid_generate_v4(),
  carrier_id            uuid          not null references public.carriers(id) on delete restrict,
  driver_id             uuid          not null references public.drivers(id) on delete restrict,
  log_period_id         uuid          not null references public.log_periods(id) on delete restrict,
  eld_device_id         uuid          not null references public.eld_devices(id) on delete restrict,

  -- File metadata
  file_version          varchar(10)   not null default '1.1.0',  -- FMCSA spec version
  erod_storage_path     text          not null,    -- path in Supabase Storage
  pdf_storage_path      text,                      -- human-readable PDF log
  file_size_bytes       integer       not null check (file_size_bytes > 0),
  total_event_count     integer       not null check (total_event_count > 0),

  -- Tamper evidence
  content_sha256        char(64)      not null
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  carrier_signature     text          not null,    -- Base64 digital signature

  -- Generation provenance
  generated_at          timestamptz   not null,
  generated_by          uuid          references public.profiles(id) on delete set null,

  -- Transfer to law enforcement (recorded when the .erod file is delivered)
  transfer_method       text          check (transfer_method in ('web', 'bluetooth', 'usb', 'on_screen')),
  transferred_at        timestamptz,
  transferred_to_ip     inet,         -- Inspector IP for web transfers

  -- Retention lifecycle
  archived_at           timestamptz,  -- When moved to cold storage after 6-month window

  unique (driver_id, log_period_id),

  created_at            timestamptz   not null default now()
  -- NO updated_at — this table is intentionally append-only per §395.8(k).
);

comment on table public.eld_records is
  'Immutable finalized .erod compliance files. Append-only. Retained 6+ months per §395.8(k).';

-- Only transfer_method, transferred_at, transferred_to_ip, and archived_at
-- may be set after initial insert (they start null and are written once).
create or replace function public.prevent_eld_record_modification()
  returns trigger
  language plpgsql
as $$
begin
  if (
    new.id                = old.id
    and new.carrier_id    = old.carrier_id
    and new.driver_id     = old.driver_id
    and new.log_period_id = old.log_period_id
    and new.content_sha256    = old.content_sha256
    and new.carrier_signature = old.carrier_signature
    and new.generated_at  = old.generated_at
    and new.created_at    = old.created_at
  ) then
    return new;   -- only transfer/archive metadata changed: allow
  end if;
  raise exception
    'eld_records is immutable — only transfer and archive metadata may be added after creation.';
end;
$$;

create trigger trg_eld_records_immutable
  before update on public.eld_records
  for each row execute function public.prevent_eld_record_modification();

create index idx_eld_records_carrier_time on public.eld_records(carrier_id, generated_at desc);
create index idx_eld_records_hash         on public.eld_records(content_sha256);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 7 — AUDIT
-- ─────────────────────────────────────────────────────────────────────────────

-- audit_entries ────────────────────────────────────────────────────────────
-- Append-only audit trail. One row per action on any eld_events record.
-- Supports the AuditAction enum: CREATED, EDITED, DRIVER_CERTIFIED,
-- DRIVER_CONFIRMED_EDIT, DRIVER_REJECTED_EDIT, ASSUMED_FROM_UNIDENTIFIED, ARCHIVED.
-- Ref: 49 CFR §395.30(b) — drivers must be able to review and confirm/reject edits.
create table public.audit_entries (
  id                      uuid          primary key default uuid_generate_v4(),

  -- The event record this entry describes.
  event_id                uuid          not null references public.eld_events(id) on delete restrict,
  -- The superseded version (null for CREATED entries).
  previous_version_id     uuid          references public.eld_events(id) on delete restrict,

  -- Action type
  action                  text          not null check (action in (
    'CREATED',
    'EDITED',
    'DRIVER_CERTIFIED',
    'DRIVER_CONFIRMED_EDIT',
    'DRIVER_REJECTED_EDIT',
    'ASSUMED_FROM_UNIDENTIFIED',
    'ARCHIVED'
  )),

  -- Actor identity
  actor_type              text          not null
    check (actor_type in ('DRIVER','CO_DRIVER','CARRIER','SUPPORT','SYSTEM')),
  actor_user_id           uuid          references public.profiles(id) on delete set null,
  actor_display_name      text          not null,
  actor_organization_id   uuid          references public.carriers(id) on delete set null,

  -- Timing and device context
  performed_at            timestamptz   not null,
  eld_device_id           uuid          references public.eld_devices(id) on delete set null,
  ip_address              inet,
  user_agent              text,
  mobile_device_id        text,         -- Expo Application.androidId / identifierForVendor

  -- Edit-specific fields (null for non-EDITED actions)
  edit_reason_code        text,         -- matches EditReasonCode enum in audit-trail.ts
  edit_reason_text        text,         -- required when edit_reason_code = 'OTHER'

  -- Field-level diff: JSONB array of FieldDiff objects.
  -- Shape: [{ fieldPath, previousValue, newValue, isRequiredField }, ...]
  -- Empty array for non-edit actions.
  changed_fields          jsonb         not null default '[]'::jsonb,

  -- For DRIVER_REJECTED_EDIT: the version the driver chose to reinstate.
  reverted_to_version_id  uuid          references public.eld_events(id) on delete restrict,

  -- edit_reason_text is required when code is 'OTHER'
  check (
    edit_reason_code <> 'OTHER'
    or (edit_reason_text is not null and length(edit_reason_text) >= 20)
  ),

  created_at              timestamptz   not null default now()
  -- NO updated_at — append-only table.
);

comment on table public.audit_entries is
  'Append-only audit trail. One row per action on an eld_events record.';
comment on column public.audit_entries.changed_fields is
  'JSONB array of FieldDiff objects from audit-trail.ts. Empty for non-edit actions.';
comment on column public.audit_entries.edit_reason_code is
  'Must match EditReasonCode enum. Required for action=EDITED. OTHER requires edit_reason_text ≥20 chars.';

create index idx_audit_event_time  on public.audit_entries(event_id, performed_at desc);
create index idx_audit_actor_time  on public.audit_entries(actor_user_id, performed_at desc);
create index idx_audit_org_time    on public.audit_entries(actor_organization_id, performed_at desc);
create index idx_audit_action      on public.audit_entries(action, performed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- All tables enable RLS. The backend service_role key bypasses all policies.
-- Direct client (authenticated) access is read-only; all writes go via the API.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.carriers                   enable row level security;
alter table public.profiles                   enable row level security;
alter table public.drivers                    enable row level security;
alter table public.vehicles                   enable row level security;
alter table public.trailers                   enable row level security;
alter table public.eld_devices                enable row level security;
alter table public.vehicle_eld_assignments    enable row level security;
alter table public.driver_vehicle_assignments enable row level security;
alter table public.log_periods                enable row level security;
alter table public.eld_events                 enable row level security;
alter table public.sequence_id_states         enable row level security;
alter table public.duty_status_records        enable row level security;
alter table public.hos_calculations           enable row level security;
alter table public.hos_violations             enable row level security;
alter table public.certifications             enable row level security;
alter table public.unidentified_driver_records enable row level security;
alter table public.eld_malfunctions           enable row level security;
alter table public.eld_records                enable row level security;
alter table public.audit_entries              enable row level security;

-- ── carriers ──────────────────────────────────────────────────────────────
-- Users see only their own carrier; support role sees all.
create policy "carriers_select"
  on public.carriers for select
  using (
    id = public.current_user_carrier_id()
    or public.current_user_role() = 'support'
  );

-- ── profiles ──────────────────────────────────────────────────────────────
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_select_managers"
  on public.profiles for select
  using (
    carrier_id = public.current_user_carrier_id()
    and public.current_user_role() in ('fleet_manager', 'admin', 'support')
  );

-- ── drivers ───────────────────────────────────────────────────────────────
create policy "drivers_select_own"
  on public.drivers for select
  using (user_id = auth.uid());

create policy "drivers_select_carrier"
  on public.drivers for select
  using (
    carrier_id = public.current_user_carrier_id()
    and public.current_user_role() in ('fleet_manager', 'admin', 'support')
  );

-- ── vehicles ──────────────────────────────────────────────────────────────
create policy "vehicles_select_carrier"
  on public.vehicles for select
  using (carrier_id = public.current_user_carrier_id());

-- ── trailers ──────────────────────────────────────────────────────────────
create policy "trailers_select_carrier"
  on public.trailers for select
  using (carrier_id = public.current_user_carrier_id());

-- ── eld_devices ───────────────────────────────────────────────────────────
create policy "eld_devices_select_carrier"
  on public.eld_devices for select
  using (carrier_id = public.current_user_carrier_id());

-- ── assignment history ────────────────────────────────────────────────────
create policy "vea_select_carrier"
  on public.vehicle_eld_assignments for select
  using (
    vehicle_id in (
      select id from public.vehicles where carrier_id = public.current_user_carrier_id()
    )
  );

create policy "dva_select_carrier"
  on public.driver_vehicle_assignments for select
  using (
    driver_id in (
      select id from public.drivers where carrier_id = public.current_user_carrier_id()
    )
  );

-- ── log_periods ───────────────────────────────────────────────────────────
create policy "log_periods_select_carrier"
  on public.log_periods for select
  using (carrier_id = public.current_user_carrier_id());

-- ── eld_events ────────────────────────────────────────────────────────────
-- Fleet managers and admins see all events for their carrier.
create policy "eld_events_select_carrier"
  on public.eld_events for select
  using (carrier_id = public.current_user_carrier_id());

-- Drivers can only see their own events.
create policy "eld_events_select_own_driver"
  on public.eld_events for select
  using (public.is_own_driver_record(driver_id));

-- ── sequence_id_states ────────────────────────────────────────────────────
-- Access via ELD device ownership → carrier chain.
create policy "sequence_id_states_select_carrier"
  on public.sequence_id_states for select
  using (
    eld_device_id in (
      select id from public.eld_devices
      where carrier_id = public.current_user_carrier_id()
    )
  );

-- ── duty_status_records ───────────────────────────────────────────────────
create policy "dsr_select_carrier"
  on public.duty_status_records for select
  using (carrier_id = public.current_user_carrier_id());

-- ── hos_calculations ──────────────────────────────────────────────────────
create policy "hos_calc_select_carrier"
  on public.hos_calculations for select
  using (carrier_id = public.current_user_carrier_id());

-- ── hos_violations ────────────────────────────────────────────────────────
create policy "hos_viol_select_carrier"
  on public.hos_violations for select
  using (carrier_id = public.current_user_carrier_id());

-- ── certifications ────────────────────────────────────────────────────────
create policy "certs_select_carrier"
  on public.certifications for select
  using (carrier_id = public.current_user_carrier_id());

-- ── unidentified_driver_records ───────────────────────────────────────────
create policy "udr_select_carrier"
  on public.unidentified_driver_records for select
  using (carrier_id = public.current_user_carrier_id());

-- ── eld_malfunctions ──────────────────────────────────────────────────────
create policy "eld_mal_select_carrier"
  on public.eld_malfunctions for select
  using (carrier_id = public.current_user_carrier_id());

-- ── eld_records ───────────────────────────────────────────────────────────
create policy "eld_records_select_carrier"
  on public.eld_records for select
  using (carrier_id = public.current_user_carrier_id());

-- ── audit_entries ─────────────────────────────────────────────────────────
-- Fleet managers and admins see all audit entries for their carrier.
-- Drivers can only see entries for their own events.
create policy "audit_select_carrier"
  on public.audit_entries for select
  using (
    actor_organization_id = public.current_user_carrier_id()
    or public.current_user_role() in ('fleet_manager', 'admin')
  );

create policy "audit_select_own_driver"
  on public.audit_entries for select
  using (
    event_id in (
      select id from public.eld_events where public.is_own_driver_record(driver_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Service role: The Supabase service_role key bypasses all RLS policies.
--    Use it exclusively in the backend API (never in client code).
--    Never grant INSERT/UPDATE/DELETE to anon or authenticated roles directly.
--
-- 2. Retained legacy tables: trips, location_events (from migration 0001)
--    are still present if migrating from an existing database. They are not
--    referenced by the ELD schema and can be dropped when no longer needed.
--
-- 3. Updated_at triggers: add these via Supabase or a shared helper function
--    if you want updated_at to be maintained automatically:
--      create trigger set_updated_at before update on public.<table>
--        for each row execute function public.moddatetime(updated_at);
--    Requires the moddatetime extension or a custom function.
