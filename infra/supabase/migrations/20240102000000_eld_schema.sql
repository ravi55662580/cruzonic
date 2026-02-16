-- ============================================================
-- Migration: ELD Full Schema
-- Cruzonic Fleet Management Platform
--
-- Run after: 20240101000000_initial_schema.sql
-- Regulatory basis: 49 CFR Part 395, Subpart B (FMCSA ELD)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- MULTI-TENANT CORE
-- ─────────────────────────────────────────────────────────────────────────────

create table public.carriers (
  id                 uuid        primary key default uuid_generate_v4(),
  dot_number         varchar(8)  not null unique check (dot_number ~ '^[0-9]{1,8}$'),
  mc_number          varchar(8)  check (mc_number ~ '^[0-9]{1,8}$'),
  legal_name         text        not null,
  dba_name           text,
  address_line1      text        not null,
  city               text        not null,
  state              char(2)     not null,
  zip                varchar(10) not null,
  country            char(2)     not null default 'US',
  phone              varchar(20) not null,
  email              text        not null unique,
  status             text        not null default 'active'
    check (status in ('active', 'suspended', 'inactive')),
  subscription_tier  text        not null default 'starter'
    check (subscription_tier in ('starter', 'professional', 'enterprise')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Add carrier_id to existing tables (profiles, vehicles, drivers from migration 0001)
alter table public.profiles add column carrier_id uuid references public.carriers(id) on delete cascade;
alter table public.vehicles add column carrier_id uuid references public.carriers(id) on delete cascade;
alter table public.drivers  add column carrier_id uuid references public.carriers(id) on delete cascade;
alter table public.drivers  add column email text;
alter table public.vehicles add column power_unit_number varchar(10);
alter table public.vehicles add column vin char(17) unique;
alter table public.vehicles add column license_plate_state char(2);
alter table public.vehicles add column gvwr_lbs integer;
alter table public.vehicles add column vehicle_type text default 'tractor'
  check (vehicle_type in ('tractor', 'straight_truck', 'bus', 'other'));

-- ─────────────────────────────────────────────────────────────────────────────
-- FLEET ASSETS
-- ─────────────────────────────────────────────────────────────────────────────

create table public.trailers (
  id                  uuid        primary key default uuid_generate_v4(),
  carrier_id          uuid        not null references public.carriers(id) on delete cascade,
  trailer_number      varchar(10) not null,
  license_plate       varchar(12),
  license_plate_state char(2),
  trailer_type        text        not null default 'dry_van'
    check (trailer_type in ('dry_van', 'flatbed', 'refrigerated', 'tanker', 'lowboy', 'other')),
  status              text        not null default 'active'
    check (status in ('active', 'maintenance', 'retired')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (carrier_id, trailer_number)
);

create table public.eld_devices (
  id                  uuid        primary key default uuid_generate_v4(),
  carrier_id          uuid        not null references public.carriers(id) on delete cascade,
  registration_id     varchar(8)  not null,
  serial_number       text        not null unique,
  device_model        text        not null,
  manufacturer        text        not null,
  firmware_version    text        not null,
  fmcsa_certified_on  date        not null,
  current_vehicle_id  uuid        references public.vehicles(id) on delete set null,
  status              text        not null default 'active'
    check (status in ('active', 'inactive', 'malfunctioning', 'decommissioned')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Extend drivers table with ELD/HOS fields
alter table public.drivers
  add column license_state           char(2),
  add column license_class           char(1)     check (license_class in ('A', 'B', 'C')),
  add column license_expiry          date,
  add column home_terminal_address   text,
  add column home_terminal_timezone  text        default 'America/Chicago',
  add column hos_ruleset             text        default 'property_70h'
    check (hos_ruleset in ('property_60h', 'property_70h', 'passenger_60h', 'passenger_70h')),
  add column exempt_driver_type      text        default 'none'
    check (exempt_driver_type in ('none', 'short_haul', 'agriculture', 'construction')),
  add column current_vehicle_id      uuid        references public.vehicles(id) on delete set null,
  add column current_duty_status     smallint    check (current_duty_status between 1 and 4);

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSIGNMENT HISTORY
-- ─────────────────────────────────────────────────────────────────────────────

create table public.vehicle_eld_assignments (
  id             uuid        primary key default uuid_generate_v4(),
  vehicle_id     uuid        not null references public.vehicles(id) on delete restrict,
  eld_device_id  uuid        not null references public.eld_devices(id) on delete restrict,
  assigned_at    timestamptz not null default now(),
  unassigned_at  timestamptz,
  assigned_by    uuid        references public.profiles(id) on delete set null,
  check (unassigned_at is null or unassigned_at > assigned_at)
);

create index idx_vea_vehicle_time   on public.vehicle_eld_assignments(vehicle_id, assigned_at desc);
create index idx_vea_device_time    on public.vehicle_eld_assignments(eld_device_id, assigned_at desc);

create table public.driver_vehicle_assignments (
  id             uuid        primary key default uuid_generate_v4(),
  driver_id      uuid        not null references public.drivers(id) on delete restrict,
  vehicle_id     uuid        not null references public.vehicles(id) on delete restrict,
  assigned_at    timestamptz not null default now(),
  unassigned_at  timestamptz,
  assigned_by    uuid        references public.profiles(id) on delete set null,
  trailer1_id    uuid        references public.trailers(id) on delete set null,
  trailer2_id    uuid        references public.trailers(id) on delete set null,
  check (unassigned_at is null or unassigned_at > assigned_at)
);

create index idx_dva_driver_time  on public.driver_vehicle_assignments(driver_id, assigned_at desc);
create index idx_dva_vehicle_time on public.driver_vehicle_assignments(vehicle_id, assigned_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ELD EVENT STREAM
-- ─────────────────────────────────────────────────────────────────────────────

create table public.log_periods (
  id                      uuid    primary key default uuid_generate_v4(),
  carrier_id              uuid    not null references public.carriers(id) on delete cascade,
  driver_id               uuid    not null references public.drivers(id) on delete restrict,
  log_date                date    not null,
  log_date_mmddyy         char(6) not null,
  home_terminal_timezone  text    not null,
  status                  text    not null default 'open'
    check (status in ('open', 'closed', 'certified', 'recertified')),
  total_event_count       integer not null default 0,
  hos_ruleset             text    not null,
  certified_at            timestamptz,
  recertified_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (driver_id, log_date)
);

create index idx_log_periods_carrier_date on public.log_periods(carrier_id, log_date desc);

create table public.eld_events (
  id                                uuid        primary key default uuid_generate_v4(),
  carrier_id                        uuid        not null references public.carriers(id) on delete cascade,
  log_period_id                     uuid        not null references public.log_periods(id) on delete restrict,
  driver_id                         uuid        not null references public.drivers(id) on delete restrict,
  vehicle_id                        uuid        not null references public.vehicles(id) on delete restrict,
  eld_device_id                     uuid        not null references public.eld_devices(id) on delete restrict,

  -- FMCSA Appendix A required fields
  event_sequence_id                 integer     not null check (event_sequence_id between 1 and 65535),
  event_record_status               smallint    not null check (event_record_status between 1 and 4),
  event_record_origin               smallint    not null check (event_record_origin between 1 and 4),
  event_type                        smallint    not null check (event_type between 1 and 7),
  event_sub_type                    smallint    not null check (event_sub_type >= 1),
  event_date                        char(6)     not null check (event_date ~ '^(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{2}$'),
  event_time                        char(6)     not null check (event_time ~ '^([01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]$'),
  timezone_offset                   char(5)     not null check (timezone_offset ~ '^[+-](0[0-9]|1[0-4])[0-5][0-9]$'),
  accumulated_vehicle_miles         numeric(9,1) not null check (accumulated_vehicle_miles >= 0),
  elapsed_engine_hours              numeric(7,1) not null check (elapsed_engine_hours >= 0),
  latitude                          float8      check (latitude between -90 and 90),
  longitude                         float8      check (longitude between -180 and 180),
  location_description              varchar(60),
  distance_since_last_valid_coords  numeric(6,1) check (distance_since_last_valid_coords >= 0),
  malfunction_indicator_status      boolean     not null default false,
  eld_malfunction_status            boolean     not null default false,
  data_diagnostic_indicator_status  boolean     not null default false,
  event_data_check_value            char(2)     not null check (event_data_check_value ~ '^[0-9A-Fa-f]{2}$'),
  annotation                        varchar(60),

  -- Event-type-specific fields
  driver_eld_account_id             varchar(60),
  co_driver_eld_account_id          varchar(60),
  malfunction_code                  char(1)     check (malfunction_code in ('P','E','T','L','R','S','O')),
  diagnostic_code                   char(1)     check (diagnostic_code in ('1','2','3','4','5','6')),

  -- Versioning (immutability chain)
  version_number                    smallint    not null default 1 check (version_number >= 1),
  previous_version_id               uuid        references public.eld_events(id) on delete restrict,
  original_version_id               uuid        references public.eld_events(id) on delete restrict,

  -- Tamper-evidence hashes
  content_hash                      char(64)    not null check (content_hash ~ '^[0-9a-f]{64}$'),
  chain_hash                        char(64)    not null check (chain_hash ~ '^[0-9a-f]{64}$'),
  previous_chain_hash               char(64)    check (previous_chain_hash ~ '^[0-9a-f]{64}$'),

  -- GPS constraint: if lat is null, distance must be non-null
  check (
    (latitude is not null and longitude is not null)
    or distance_since_last_valid_coords is not null
  ),
  -- Malfunction/diagnostic mutual exclusion
  check (NOT (malfunction_code is not null and diagnostic_code is not null)),

  created_at timestamptz not null default now()
);

-- Unique sequence ID per device per log period (prevents duplicates)
create unique index idx_eld_events_device_seq_unique
  on public.eld_events(eld_device_id, log_period_id, event_sequence_id)
  where event_record_status = 1; -- only active records

create index idx_eld_events_period_seq      on public.eld_events(log_period_id, event_sequence_id);
create index idx_eld_events_driver_date     on public.eld_events(driver_id, event_date);
create index idx_eld_events_carrier_type    on public.eld_events(carrier_id, event_type, event_date);
create index idx_eld_events_vehicle_date    on public.eld_events(vehicle_id, event_date);
create index idx_eld_events_content_hash    on public.eld_events(content_hash);

-- Prevent UPDATE on eld_events (append-only — status changes go via new row + previous_version_id)
create or replace function public.prevent_eld_event_update()
returns trigger language plpgsql as $$
begin
  raise exception
    'eld_events is append-only. To edit a record, insert a new version with event_record_status=1 and set previous_version_id on the new row, then update the old row''s event_record_status to 2.';
end;
$$;

-- Allow only event_record_status to be changed (to mark old version as inactive)
create or replace function public.allow_eld_event_status_update()
returns trigger language plpgsql as $$
begin
  if (new.id                 = old.id
  and new.event_sequence_id  = old.event_sequence_id
  and new.event_type         = old.event_type
  and new.event_date         = old.event_date
  and new.event_time         = old.event_time
  and new.content_hash       = old.content_hash
  and new.chain_hash         = old.chain_hash
  and new.event_record_status in (2, 3, 4)  -- only allowed status changes
  ) then
    return new;
  end if;
  raise exception
    'Only event_record_status may be changed on an existing eld_events row (to 2, 3, or 4).';
end;
$$;

create trigger trg_eld_events_immutable
  before update on public.eld_events
  for each row execute function public.allow_eld_event_status_update();

create table public.sequence_id_states (
  id                uuid    primary key default uuid_generate_v4(),
  eld_device_id     uuid    not null references public.eld_devices(id) on delete cascade,
  log_period_id     uuid    not null references public.log_periods(id) on delete cascade,
  last_issued_id    integer not null default 0 check (last_issued_id between 0 and 65535),
  last_issued_at    timestamptz not null default now(),
  wrap_around_count smallint not null default 0,
  updated_at        timestamptz not null default now(),
  unique (eld_device_id, log_period_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MATERIALIZED HOS DATA
-- ─────────────────────────────────────────────────────────────────────────────

create table public.duty_status_records (
  id                    uuid        primary key default uuid_generate_v4(),
  carrier_id            uuid        not null references public.carriers(id) on delete cascade,
  log_period_id         uuid        not null references public.log_periods(id) on delete cascade,
  driver_id             uuid        not null references public.drivers(id) on delete restrict,
  source_eld_event_id   uuid        not null unique references public.eld_events(id) on delete restrict,
  duty_status           smallint    not null check (duty_status between 1 and 4),
  previous_duty_status  smallint    check (previous_duty_status between 1 and 4),
  started_at            timestamptz not null,
  ended_at              timestamptz,
  duration_minutes      numeric(7,2) check (duration_minutes >= 0),
  location_description  varchar(60),
  latitude              float8,
  longitude             float8,
  is_personal_use_active boolean    not null default false,
  is_yard_moves_active   boolean    not null default false,
  created_at            timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);

create index idx_dsr_driver_time   on public.duty_status_records(driver_id, started_at desc);
create index idx_dsr_period_status on public.duty_status_records(log_period_id, duty_status);

create table public.hos_calculations (
  id                                      uuid        primary key default uuid_generate_v4(),
  carrier_id                              uuid        not null references public.carriers(id) on delete cascade,
  driver_id                               uuid        not null references public.drivers(id) on delete restrict,
  log_period_id                           uuid        not null references public.log_periods(id) on delete cascade,
  calculated_at                           timestamptz not null,
  hos_ruleset                             text        not null,
  driving_minutes_today                   integer     not null default 0,
  on_duty_minutes_today                   integer     not null default 0,
  driving_minutes_7day                    integer     not null default 0,
  on_duty_minutes_7day                    integer     not null default 0,
  driving_minutes_8day                    integer     not null default 0,
  on_duty_minutes_8day                    integer     not null default 0,
  remaining_driving_minutes               integer,
  remaining_on_duty_window_minutes        integer,
  remaining_weekly_minutes                integer,
  time_until_break_required_minutes       integer,
  consecutive_off_duty_minutes            integer     not null default 0,
  is_in_34h_restart                       boolean     not null default false,
  restart_started_at                      timestamptz,
  restart_eligible_at                     timestamptz,
  is_adverse_conditions_active            boolean     not null default false,
  adverse_conditions_invoked_at           timestamptz,
  is_short_haul_active                    boolean     not null default false,
  created_at                              timestamptz not null default now(),
  unique (driver_id, log_period_id)
);

create index idx_hos_calc_carrier_time on public.hos_calculations(carrier_id, calculated_at desc);

create table public.hos_violations (
  id               uuid        primary key default uuid_generate_v4(),
  carrier_id       uuid        not null references public.carriers(id) on delete cascade,
  driver_id        uuid        not null references public.drivers(id) on delete restrict,
  log_period_id    uuid        not null references public.log_periods(id) on delete cascade,
  trigger_event_id uuid        references public.eld_events(id) on delete set null,
  violation_type   text        not null check (violation_type in (
    'DRIVING_LIMIT_EXCEEDED',
    'ON_DUTY_WINDOW_EXCEEDED',
    'BREAK_VIOLATION',
    'WEEKLY_LIMIT_EXCEEDED',
    'INSUFFICIENT_OFF_DUTY',
    'FALSIFICATION_SUSPECTED',
    'UNASSIGNED_DRIVING_TIME'
  )),
  severity          text       not null check (severity in ('warning', 'violation')),
  started_at        timestamptz not null,
  ended_at          timestamptz,
  duration_minutes  integer,
  details           jsonb,
  acknowledged_by   uuid        references public.profiles(id) on delete set null,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_hos_viol_driver_time   on public.hos_violations(driver_id, started_at desc);
create index idx_hos_viol_carrier_type  on public.hos_violations(carrier_id, violation_type);
create index idx_hos_viol_period        on public.hos_violations(log_period_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- COMPLIANCE OUTPUTS
-- ─────────────────────────────────────────────────────────────────────────────

create table public.certifications (
  id                       uuid        primary key default uuid_generate_v4(),
  carrier_id               uuid        not null references public.carriers(id) on delete cascade,
  source_eld_event_id      uuid        not null unique references public.eld_events(id) on delete restrict,
  log_period_id            uuid        not null references public.log_periods(id) on delete restrict,
  certifying_driver_id     uuid        not null references public.drivers(id) on delete restrict,
  certified_driver_id      uuid        not null references public.drivers(id) on delete restrict,
  certification_type       text        not null check (certification_type in ('own_records', 'co_driver_records')),
  certified_log_date       char(6)     not null,
  total_records_certified  integer     not null check (total_records_certified >= 1),
  is_recertification       boolean     not null default false,
  performed_at             timestamptz not null,
  created_at               timestamptz not null default now()
);

create index idx_cert_driver_date on public.certifications(certified_driver_id, certified_log_date);

create table public.unidentified_driver_records (
  id                    uuid        primary key default uuid_generate_v4(),
  carrier_id            uuid        not null references public.carriers(id) on delete cascade,
  vehicle_id            uuid        not null references public.vehicles(id) on delete restrict,
  eld_device_id         uuid        not null references public.eld_devices(id) on delete restrict,
  log_period_id         uuid        not null references public.log_periods(id) on delete cascade,
  started_at            timestamptz not null,
  ended_at              timestamptz,
  duration_minutes      integer     check (duration_minutes >= 0),
  accumulated_miles     numeric(7,1) not null default 0,
  status                text        not null default 'pending'
    check (status in ('pending', 'claimed', 'rejected', 'expired')),
  claimed_by_driver_id  uuid        references public.drivers(id) on delete set null,
  claimed_at            timestamptz,
  claim_eld_event_id    uuid        references public.eld_events(id) on delete set null,
  rejection_reason      text,
  created_at            timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);

create index idx_udr_vehicle_time  on public.unidentified_driver_records(vehicle_id, started_at desc);
create index idx_udr_carrier_status on public.unidentified_driver_records(carrier_id, status);

create table public.eld_malfunctions (
  id                    uuid    primary key default uuid_generate_v4(),
  carrier_id            uuid    not null references public.carriers(id) on delete cascade,
  source_eld_event_id   uuid    not null references public.eld_events(id) on delete restrict,
  driver_id             uuid    not null references public.drivers(id) on delete restrict,
  vehicle_id            uuid    not null references public.vehicles(id) on delete restrict,
  eld_device_id         uuid    not null references public.eld_devices(id) on delete restrict,
  is_malfunction        boolean not null,
  malfunction_code      char(1) check (malfunction_code in ('P','E','T','L','R','S','O')),
  diagnostic_code       char(1) check (diagnostic_code in ('1','2','3','4','5','6')),
  is_active             boolean not null default true,
  detected_at           timestamptz not null,
  resolved_at           timestamptz,
  duration_minutes      integer,
  affected_log_periods  text[]  not null default '{}',
  paper_logs_required   boolean not null default false,
  acknowledged_by       uuid    references public.profiles(id) on delete set null,
  acknowledged_at       timestamptz,
  created_at            timestamptz not null default now(),
  check (NOT (malfunction_code is not null and diagnostic_code is not null)),
  check (
    (is_malfunction = true and malfunction_code is not null)
    or (is_malfunction = false and diagnostic_code is not null)
  ),
  check (resolved_at is null or resolved_at > detected_at)
);

create index idx_eld_mal_device_active  on public.eld_malfunctions(eld_device_id, is_active);
create index idx_eld_mal_driver_active  on public.eld_malfunctions(driver_id, is_active);
create index idx_eld_mal_carrier_time   on public.eld_malfunctions(carrier_id, detected_at desc);

create table public.eld_records (
  id                 uuid    primary key default uuid_generate_v4(),
  carrier_id         uuid    not null references public.carriers(id) on delete restrict,
  driver_id          uuid    not null references public.drivers(id) on delete restrict,
  log_period_id      uuid    not null references public.log_periods(id) on delete restrict,
  eld_device_id      uuid    not null references public.eld_devices(id) on delete restrict,
  file_version       varchar(10) not null default '1.1.0',
  erod_storage_path  text    not null,
  pdf_storage_path   text,
  file_size_bytes    integer not null check (file_size_bytes > 0),
  total_event_count  integer not null check (total_event_count > 0),
  content_sha256     char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  carrier_signature  text    not null,
  generated_at       timestamptz not null,
  generated_by       uuid    references public.profiles(id) on delete set null,
  transfer_method    text    check (transfer_method in ('web', 'bluetooth', 'usb', 'on_screen')),
  transferred_at     timestamptz,
  transferred_to_ip  inet,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  -- NO updated_at — immutable record per 49 CFR §395.8(k)
  unique (driver_id, log_period_id)
);

-- Prevent any modification of eld_records (fully immutable)
create or replace function public.prevent_eld_record_modification()
returns trigger language plpgsql as $$
begin
  -- Allow only transfer_method, transferred_at, transferred_to_ip,
  -- and archived_at to be set (they start null and are written once)
  if (new.id               = old.id
  and new.carrier_id       = old.carrier_id
  and new.driver_id        = old.driver_id
  and new.log_period_id    = old.log_period_id
  and new.content_sha256   = old.content_sha256
  and new.carrier_signature = old.carrier_signature
  ) then
    return new;
  end if;
  raise exception 'eld_records is immutable — only transfer and archive metadata may be added.';
end;
$$;

create trigger trg_eld_records_immutable
  before update on public.eld_records
  for each row execute function public.prevent_eld_record_modification();

create index idx_eld_records_carrier_time on public.eld_records(carrier_id, generated_at desc);
create index idx_eld_records_hash         on public.eld_records(content_sha256);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT
-- ─────────────────────────────────────────────────────────────────────────────

create table public.audit_entries (
  id                      uuid    primary key default uuid_generate_v4(),
  event_id                uuid    not null references public.eld_events(id) on delete restrict,
  previous_version_id     uuid    references public.eld_events(id) on delete restrict,
  action                  text    not null check (action in (
    'CREATED', 'EDITED', 'DRIVER_CERTIFIED',
    'DRIVER_CONFIRMED_EDIT', 'DRIVER_REJECTED_EDIT',
    'ASSUMED_FROM_UNIDENTIFIED', 'ARCHIVED'
  )),
  actor_type              text    not null check (actor_type in ('DRIVER','CO_DRIVER','CARRIER','SUPPORT','SYSTEM')),
  actor_user_id           uuid    references public.profiles(id) on delete set null,
  actor_display_name      text    not null,
  actor_organization_id   uuid    references public.carriers(id) on delete set null,
  performed_at            timestamptz not null,
  eld_device_id           uuid    references public.eld_devices(id) on delete set null,
  ip_address              inet,
  user_agent              text,
  mobile_device_id        text,
  edit_reason_code        text,
  edit_reason_text        text,
  changed_fields          jsonb   not null default '[]',
  reverted_to_version_id  uuid    references public.eld_events(id) on delete restrict,
  created_at              timestamptz not null default now()
);

create index idx_audit_event_time  on public.audit_entries(event_id, performed_at desc);
create index idx_audit_actor_time  on public.audit_entries(actor_user_id, performed_at desc);
create index idx_audit_org_time    on public.audit_entries(actor_organization_id, performed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.carriers                  enable row level security;
alter table public.trailers                  enable row level security;
alter table public.eld_devices               enable row level security;
alter table public.vehicle_eld_assignments   enable row level security;
alter table public.driver_vehicle_assignments enable row level security;
alter table public.log_periods               enable row level security;
alter table public.eld_events                enable row level security;
alter table public.sequence_id_states        enable row level security;
alter table public.duty_status_records       enable row level security;
alter table public.hos_calculations          enable row level security;
alter table public.hos_violations            enable row level security;
alter table public.certifications            enable row level security;
alter table public.unidentified_driver_records enable row level security;
alter table public.eld_malfunctions          enable row level security;
alter table public.eld_records               enable row level security;
alter table public.audit_entries             enable row level security;

-- Helper: get the carrier_id of the current authenticated user
create or replace function public.current_user_carrier_id()
returns uuid language sql stable as $$
  select carrier_id from public.profiles where id = auth.uid();
$$;

-- Helper: get the role of the current authenticated user
create or replace function public.current_user_role()
returns text language sql stable as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Carriers: admins see their own carrier; support sees all
create policy "carrier_select"
  on public.carriers for select
  using (
    id = public.current_user_carrier_id()
    or public.current_user_role() = 'support'
  );

-- Carrier-scoped tables: fleet_managers and admins see their carrier's data
-- Template policy (applied to each ELD table):
create policy "eld_events_carrier_select"
  on public.eld_events for select
  using (carrier_id = public.current_user_carrier_id());

create policy "eld_events_driver_select"
  on public.eld_events for select
  using (driver_id in (
    select id from public.drivers where user_id = auth.uid()
  ));

create policy "log_periods_carrier_select"
  on public.log_periods for select
  using (carrier_id = public.current_user_carrier_id());

create policy "hos_violations_carrier_select"
  on public.hos_violations for select
  using (carrier_id = public.current_user_carrier_id());

create policy "eld_records_carrier_select"
  on public.eld_records for select
  using (carrier_id = public.current_user_carrier_id());

create policy "audit_entries_carrier_select"
  on public.audit_entries for select
  using (
    actor_organization_id = public.current_user_carrier_id()
    or public.current_user_role() in ('fleet_manager', 'admin')
  );

-- sequence_id_states: only readable by the carrier that owns the ELD device.
-- Joins through eld_devices to determine carrier ownership.
create policy "sequence_id_states_carrier_select"
  on public.sequence_id_states for select
  using (
    eld_device_id in (
      select id from public.eld_devices
      where carrier_id = public.current_user_carrier_id()
    )
  );

-- Service role (backend API with service_role key) bypasses all RLS policies.
-- Do not grant INSERT/UPDATE/DELETE to anon or authenticated roles —
-- all writes must go through the backend API.
