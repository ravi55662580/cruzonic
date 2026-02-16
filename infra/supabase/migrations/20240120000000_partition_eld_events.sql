-- ============================================================
-- ELD Events Table Partitioning Migration
-- Migration: 20240120000000_partition_eld_events.sql
--
-- Converts eld_events to a partitioned table with monthly RANGE partitions.
-- Critical for performance as the events table will grow very large.
--
-- Strategy:
-- 1. Rename existing eld_events table
-- 2. Create new partitioned eld_events table
-- 3. Create initial monthly partitions (past 6 months + future 12 months)
-- 4. Copy data from old table to partitioned table
-- 5. Recreate all indexes, triggers, and constraints
-- 6. Drop old table
-- 7. Create automatic partition management function
--
-- IMPORTANT: This migration may take time on large datasets.
-- Consider running during maintenance window.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Disable triggers and rename existing table
-- ─────────────────────────────────────────────────────────────────────────────

-- Disable the immutability trigger temporarily
drop trigger if exists trg_eld_events_immutable on public.eld_events;

-- Rename existing table to _old suffix
alter table if exists public.eld_events rename to eld_events_old;

-- Rename existing indexes to _old suffix to avoid conflicts
alter index if exists idx_eld_events_device_seq_unique rename to idx_eld_events_device_seq_unique_old;
alter index if exists idx_eld_events_device_period_seq_version rename to idx_eld_events_device_period_seq_version_old;
alter index if exists idx_eld_events_period_seq rename to idx_eld_events_period_seq_old;
alter index if exists idx_eld_events_driver_date rename to idx_eld_events_driver_date_old;
alter index if exists idx_eld_events_driver_ts rename to idx_eld_events_driver_ts_old;
alter index if exists idx_eld_events_vehicle_date rename to idx_eld_events_vehicle_date_old;
alter index if exists idx_eld_events_carrier_type rename to idx_eld_events_carrier_type_old;
alter index if exists idx_eld_events_content_hash rename to idx_eld_events_content_hash_old;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Create new partitioned table
-- Partition key: event_timestamp (TIMESTAMPTZ) for efficient range queries
-- ─────────────────────────────────────────────────────────────────────────────

create table public.eld_events (
  id                                uuid          not null default uuid_generate_v4(),

  -- Tenant & relationship keys
  carrier_id                        uuid          not null references public.carriers(id) on delete cascade,
  log_period_id                     uuid          not null references public.log_periods(id) on delete restrict,
  driver_id                         uuid          not null references public.drivers(id) on delete restrict,
  vehicle_id                        uuid          not null references public.vehicles(id) on delete restrict,
  eld_device_id                     uuid          not null references public.eld_devices(id) on delete restrict,

  -- FMCSA Appendix A §7.3 required fields
  event_sequence_id                 integer       not null
    check (event_sequence_id between 1 and 65535),
  event_record_status               smallint      not null
    check (event_record_status between 1 and 4),
  event_record_origin               smallint      not null
    check (event_record_origin between 1 and 4),
  event_type                        smallint      not null
    check (event_type between 1 and 7),
  event_sub_type                    smallint      not null check (event_sub_type >= 1),

  -- Date & time
  event_date                        char(6)       not null
    check (event_date ~ '^(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\d{2}$'),
  event_time                        char(6)       not null
    check (event_time ~ '^([01]\d|2[0-3])[0-5]\d[0-5]\d$'),
  timezone_offset                   char(5)       not null
    check (timezone_offset ~ '^[+-](0\d|1[0-4])[0-5]\d$'),
  -- PARTITION KEY: event_timestamp
  event_timestamp                   timestamptz   not null,

  -- Odometer and engine hours
  accumulated_vehicle_miles         numeric(9, 1) not null check (accumulated_vehicle_miles >= 0),
  elapsed_engine_hours              numeric(7, 1) not null check (elapsed_engine_hours >= 0),

  -- Location
  latitude                          numeric(9, 6)
    check (latitude between -90 and 90),
  longitude                         numeric(10, 6)
    check (longitude between -180 and 180),
  location_description              varchar(60),
  distance_since_last_valid_coords  numeric(6, 1)
    check (distance_since_last_valid_coords >= 0),

  -- Status indicator flags
  malfunction_indicator_status      boolean       not null default false,
  eld_malfunction_status            boolean       not null default false,
  data_diagnostic_indicator_status  boolean       not null default false,

  -- FMCSA checksum
  event_data_check_value            char(2)       not null
    check (event_data_check_value ~ '^[0-9A-Fa-f]{2}$'),

  annotation                        varchar(60),

  -- Event-type-specific denormalized fields
  driver_eld_account_id             varchar(60),
  co_driver_eld_account_id          varchar(60),
  previous_duty_status              smallint
    check (previous_duty_status between 1 and 4),
  is_personal_use_active            boolean,
  is_yard_moves_active              boolean,
  malfunction_code                  char(1)
    check (malfunction_code in ('P','E','T','L','R','S','O')),
  diagnostic_code                   char(1)
    check (diagnostic_code in ('1','2','3','4','5','6')),

  -- Event-type-specific flexible payload
  event_metadata                    jsonb         not null default '{}'::jsonb,

  -- Versioning
  version_number                    smallint      not null default 1
    check (version_number >= 1),
  previous_version_id               uuid,
  original_version_id               uuid,

  -- Tamper-evidence hash chain
  content_hash                      char(64)      not null
    check (content_hash ~ '^[0-9a-f]{64}$'),
  chain_hash                        char(64)      not null
    check (chain_hash ~ '^[0-9a-f]{64}$'),
  previous_chain_hash               char(64)
    check (previous_chain_hash ~ '^[0-9a-f]{64}$'),

  -- Cross-field constraints
  check (
    (latitude is not null and longitude is not null)
    or distance_since_last_valid_coords is not null
  ),
  check (
    not (malfunction_code is not null and diagnostic_code is not null)
  ),
  check (
    event_type not in (1, 4, 5)
    or driver_eld_account_id is not null
  ),
  check (
    (latitude is null and longitude is null)
    or location_description is not null
  ),
  check (
    (version_number = 1 and previous_version_id is null)
    or (version_number > 1 and previous_version_id is not null)
  ),

  created_at                        timestamptz   not null default now(),

  -- Primary key must include partition key
  primary key (id, event_timestamp)

) partition by range (event_timestamp);

comment on table public.eld_events is
  'Partitioned table: All 7 FMCSA event types. Monthly RANGE partitions on event_timestamp for scalability.';

comment on column public.eld_events.event_timestamp is
  'PARTITION KEY: Server-derived TIMESTAMPTZ for range queries and partition pruning.';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Create initial monthly partitions
-- Create partitions for past 6 months + current month + future 12 months
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function to create a monthly partition
create or replace function public.create_eld_events_partition(
  partition_start timestamptz,
  partition_end timestamptz
)
  returns text
  language plpgsql
as $$
declare
  partition_name text;
  partition_year text;
  partition_month text;
begin
  -- Extract year and month from start date
  partition_year := to_char(partition_start, 'YYYY');
  partition_month := to_char(partition_start, 'MM');
  partition_name := 'eld_events_y' || partition_year || 'm' || partition_month;

  -- Create partition if it doesn't exist
  execute format(
    'create table if not exists public.%I partition of public.eld_events
     for values from (%L) to (%L)',
    partition_name,
    partition_start,
    partition_end
  );

  return partition_name;
end;
$$;

comment on function public.create_eld_events_partition is
  'Creates a monthly partition for eld_events table. Returns partition name.';

-- Create partitions for past 6 months
do $$
declare
  partition_start timestamptz;
  partition_end timestamptz;
  i integer;
begin
  for i in 6 downto 1 loop
    partition_start := date_trunc('month', now() - (i || ' months')::interval);
    partition_end := partition_start + interval '1 month';
    perform public.create_eld_events_partition(partition_start, partition_end);
  end loop;
end;
$$;

-- Create partition for current month
do $$
declare
  partition_start timestamptz;
  partition_end timestamptz;
begin
  partition_start := date_trunc('month', now());
  partition_end := partition_start + interval '1 month';
  perform public.create_eld_events_partition(partition_start, partition_end);
end;
$$;

-- Create partitions for future 12 months
do $$
declare
  partition_start timestamptz;
  partition_end timestamptz;
  i integer;
begin
  for i in 1..12 loop
    partition_start := date_trunc('month', now() + (i || ' months')::interval);
    partition_end := partition_start + interval '1 month';
    perform public.create_eld_events_partition(partition_start, partition_end);
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Recreate all indexes on partitioned table
-- Indexes are created on the parent table and automatically inherited by partitions
-- ─────────────────────────────────────────────────────────────────────────────

-- Unique indexes (must include partition key)
create unique index idx_eld_events_device_seq_unique
  on public.eld_events(eld_device_id, log_period_id, event_sequence_id, event_timestamp)
  where event_record_status = 1;

create unique index idx_eld_events_device_period_seq_version
  on public.eld_events(eld_device_id, log_period_id, event_sequence_id, version_number, event_timestamp);

-- Performance indexes
create index idx_eld_events_period_seq on public.eld_events(log_period_id, event_sequence_id, event_timestamp);
create index idx_eld_events_driver_date on public.eld_events(driver_id, event_date, event_timestamp);
create index idx_eld_events_driver_ts on public.eld_events(driver_id, event_timestamp desc);
create index idx_eld_events_vehicle_date on public.eld_events(vehicle_id, event_date, event_timestamp);
create index idx_eld_events_carrier_type on public.eld_events(carrier_id, event_type, event_date, event_timestamp);
create index idx_eld_events_content_hash on public.eld_events(content_hash, event_timestamp);
create index idx_eld_events_status on public.eld_events(event_record_status, event_date, event_timestamp)
  where event_record_status = 1;
create index idx_eld_events_type_subtype on public.eld_events(event_type, event_sub_type, event_date, event_timestamp);
create index idx_eld_events_device_date on public.eld_events(eld_device_id, event_date desc, event_timestamp desc);
create index idx_eld_events_device_type on public.eld_events(eld_device_id, event_type, event_date, event_timestamp);
create index idx_eld_events_chain_lookup on public.eld_events(eld_device_id, log_period_id, event_sequence_id desc, event_timestamp desc);
create index idx_eld_events_malfunction_flags on public.eld_events(eld_device_id, event_date, event_timestamp)
  where malfunction_indicator_status = true or eld_malfunction_status = true;
create index idx_eld_events_driver_type_date on public.eld_events(driver_id, event_type, event_date desc, event_timestamp desc);
create index idx_eld_events_vehicle_type_date on public.eld_events(vehicle_id, event_type, event_date desc, event_timestamp desc);
create index idx_eld_events_carrier_date_type on public.eld_events(carrier_id, event_date desc, event_type, event_timestamp desc);

-- Covering index
create index idx_eld_events_driver_date_covering on public.eld_events(
  driver_id,
  event_date desc,
  event_time desc,
  event_timestamp desc
) include (
  event_type,
  event_sub_type,
  event_record_status,
  location_description
);

-- JSONB indexes
create index idx_eld_events_login_exemptions on public.eld_events(
  (event_metadata->>'shortHaul'),
  event_timestamp
) where event_type = 5 and event_sub_type = 1;

create index idx_eld_events_cert_edited_seqs on public.eld_events(
  event_type,
  jsonb_array_length(event_metadata->'editedEventSequenceIds'),
  event_timestamp
) where event_type = 4 and jsonb_array_length(event_metadata->'editedEventSequenceIds') > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Recreate foreign key references from partitioned table
-- Note: Self-referencing FKs (previous_version_id, original_version_id) will be
-- recreated after data migration to avoid circular dependency issues
-- ─────────────────────────────────────────────────────────────────────────────

-- These will be created after data migration (see step 7)

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Copy data from old table to partitioned table
-- This INSERT will automatically route rows to correct partitions
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  rows_migrated bigint;
begin
  -- Only attempt migration if old table exists and has data
  if exists (select 1 from information_schema.tables where table_name = 'eld_events_old') then
    insert into public.eld_events
    select * from public.eld_events_old;

    get diagnostics rows_migrated = row_count;
    raise notice 'Migrated % rows from eld_events_old to partitioned eld_events', rows_migrated;
  else
    raise notice 'No eld_events_old table found - starting fresh with partitioned table';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: Add self-referencing foreign keys
-- Must be done after data migration to avoid constraint violations
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.eld_events
  add constraint fk_eld_events_previous_version
    foreign key (previous_version_id, event_timestamp)
    references public.eld_events(id, event_timestamp)
    on delete restrict
    not valid;

alter table public.eld_events
  add constraint fk_eld_events_original_version
    foreign key (original_version_id, event_timestamp)
    references public.eld_events(id, event_timestamp)
    on delete restrict
    not valid;

-- Validate constraints in background (non-blocking)
alter table public.eld_events validate constraint fk_eld_events_previous_version;
alter table public.eld_events validate constraint fk_eld_events_original_version;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: Recreate immutability trigger
-- ─────────────────────────────────────────────────────────────────────────────

create trigger trg_eld_events_immutable
  before update on public.eld_events
  for each row execute function public.allow_eld_event_status_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: Update RLS policies to reference new table
-- Policies are automatically recreated on the partitioned table
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.eld_events enable row level security;

create policy "eld_events_select_carrier"
  on public.eld_events for select
  using (carrier_id = public.current_user_carrier_id());

create policy "eld_events_select_own_driver"
  on public.eld_events for select
  using (public.is_own_driver_record(driver_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 10: Update foreign key references FROM other tables TO eld_events
-- Other tables reference eld_events, need to update those constraints
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop old FK constraints
alter table public.duty_status_records drop constraint if exists duty_status_records_source_eld_event_id_fkey;
alter table public.certifications drop constraint if exists certifications_source_eld_event_id_fkey;
alter table public.unidentified_driver_records drop constraint if exists unidentified_driver_records_claim_eld_event_id_fkey;
alter table public.eld_malfunctions drop constraint if exists eld_malfunctions_source_eld_event_id_fkey;
alter table public.hos_violations drop constraint if exists hos_violations_trigger_event_id_fkey;
alter table public.audit_entries drop constraint if exists audit_entries_event_id_fkey;
alter table public.audit_entries drop constraint if exists audit_entries_previous_version_id_fkey;
alter table public.audit_entries drop constraint if exists audit_entries_reverted_to_version_id_fkey;

-- Recreate FK constraints pointing to partitioned table
-- Note: FKs to partitioned tables cannot reference specific partitions,
-- they must reference the parent table. This is supported in PostgreSQL 11+.

alter table public.duty_status_records
  add constraint duty_status_records_source_eld_event_id_fkey
    foreign key (source_eld_event_id)
    references public.eld_events(id)
    on delete restrict;

alter table public.certifications
  add constraint certifications_source_eld_event_id_fkey
    foreign key (source_eld_event_id)
    references public.eld_events(id)
    on delete restrict;

alter table public.unidentified_driver_records
  add constraint unidentified_driver_records_claim_eld_event_id_fkey
    foreign key (claim_eld_event_id)
    references public.eld_events(id)
    on delete set null;

alter table public.eld_malfunctions
  add constraint eld_malfunctions_source_eld_event_id_fkey
    foreign key (source_eld_event_id)
    references public.eld_events(id)
    on delete restrict;

alter table public.hos_violations
  add constraint hos_violations_trigger_event_id_fkey
    foreign key (trigger_event_id)
    references public.eld_events(id)
    on delete set null;

alter table public.audit_entries
  add constraint audit_entries_event_id_fkey
    foreign key (event_id)
    references public.eld_events(id)
    on delete restrict;

alter table public.audit_entries
  add constraint audit_entries_previous_version_id_fkey
    foreign key (previous_version_id)
    references public.eld_events(id)
    on delete restrict;

alter table public.audit_entries
  add constraint audit_entries_reverted_to_version_id_fkey
    foreign key (reverted_to_version_id)
    references public.eld_events(id)
    on delete restrict;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 11: Drop old table and indexes
-- ─────────────────────────────────────────────────────────────────────────────

drop table if exists public.eld_events_old cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTOMATIC PARTITION MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────────────

-- Function to automatically create future partitions
create or replace function public.maintain_eld_events_partitions()
  returns void
  language plpgsql
as $$
declare
  partition_start timestamptz;
  partition_end timestamptz;
  partition_name text;
  partition_exists boolean;
  i integer;
begin
  -- Create partitions for next 12 months if they don't exist
  for i in 1..12 loop
    partition_start := date_trunc('month', now() + (i || ' months')::interval);
    partition_end := partition_start + interval '1 month';

    -- Check if partition already exists
    partition_name := 'eld_events_y' || to_char(partition_start, 'YYYY') || 'm' || to_char(partition_start, 'MM');

    select exists (
      select 1 from pg_tables where tablename = partition_name
    ) into partition_exists;

    if not partition_exists then
      perform public.create_eld_events_partition(partition_start, partition_end);
      raise notice 'Created partition: %', partition_name;
    end if;
  end loop;

  -- Archive old partitions (detach partitions older than 6 months)
  -- This doesn't delete data, just detaches for manual archival
  for partition_name in
    select child.relname
    from pg_inherits
    join pg_class parent on pg_inherits.inhparent = parent.oid
    join pg_class child on pg_inherits.inhrelid = child.oid
    where parent.relname = 'eld_events'
      and child.relname ~ '^eld_events_y\d{4}m\d{2}$'
      and child.relname < 'eld_events_y' || to_char(now() - interval '6 months', 'YYYYMM')
  loop
    execute format(
      'alter table public.eld_events detach partition public.%I',
      partition_name
    );
    raise notice 'Detached old partition for archival: %', partition_name;
  end loop;
end;
$$;

comment on function public.maintain_eld_events_partitions is
  'Auto-creates future monthly partitions and detaches old partitions for archival. Run monthly via cron.';

-- Create a scheduled job to maintain partitions (requires pg_cron extension)
-- Uncomment if pg_cron is available:
-- select cron.schedule(
--   'maintain-eld-events-partitions',
--   '0 0 1 * *',  -- Run at midnight on the 1st of every month
--   'select public.maintain_eld_events_partitions()'
-- );

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTITION INFORMATION VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- View showing all partitions and their row counts
create or replace view public.eld_events_partition_info as
select
  child.relname as partition_name,
  pg_get_expr(child.relpartbound, child.oid) as partition_range,
  pg_size_pretty(pg_total_relation_size(child.oid)) as total_size,
  (select count(*) from pg_catalog.pg_class c where c.relname = child.relname) as index_count,
  n_tup_ins as rows_inserted,
  n_tup_upd as rows_updated,
  n_tup_del as rows_deleted,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_inherits
join pg_class parent on pg_inherits.inhparent = parent.oid
join pg_class child on pg_inherits.inhrelid = child.oid
left join pg_stat_all_tables stat on stat.relid = child.oid
where parent.relname = 'eld_events'
order by child.relname;

comment on view public.eld_events_partition_info is
  'Shows all eld_events partitions with size, row counts, and vacuum statistics.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ANALYZE
-- Update statistics for query planner
-- ─────────────────────────────────────────────────────────────────────────────

analyze public.eld_events;

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION COMPLETE
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  raise notice '
  ════════════════════════════════════════════════════════════════════════════
  ✓ ELD Events Partitioning Migration Complete
  ════════════════════════════════════════════════════════════════════════════

  Partitioned table: public.eld_events
  Partition strategy: RANGE by event_timestamp (monthly)
  Partitions created: Past 6 months + current + future 12 months

  Next steps:
  1. Verify partition pruning with EXPLAIN queries
  2. Monitor partition sizes: SELECT * FROM eld_events_partition_info
  3. Schedule monthly maintenance: SELECT maintain_eld_events_partitions()
  4. Consider setting up pg_cron for automatic partition management

  Performance tips:
  - Always include event_timestamp in WHERE clauses for partition pruning
  - Use date ranges for optimal query performance
  - Monitor partition sizes and detach old partitions as needed

  ════════════════════════════════════════════════════════════════════════════
  ';
end;
$$;
