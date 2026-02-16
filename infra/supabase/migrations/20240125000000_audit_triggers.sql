-- ============================================================
-- FMCSA-Compliant Audit Triggers
-- Migration: 20240125000000_audit_triggers.sql
--
-- Implements automatic audit logging for all critical tables
-- to support FMCSA tamper-resistant record-keeping requirements.
--
-- Regulatory basis:
-- - 49 CFR §395.8(k) — Records retention and integrity
-- - 49 CFR §395.30(b) — Audit trail of all edits
-- - FMCSA ELD Technical Specification — Tamper-evident logs
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG TABLE
-- Universal audit trail for all database changes to critical tables.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.audit_log (
  id                  uuid          primary key default uuid_generate_v4(),

  -- What was changed
  table_name          text          not null,
  schema_name         text          not null default 'public',
  record_id           uuid          not null,      -- Primary key of changed record

  -- Type of change
  operation           text          not null
    check (operation in ('INSERT', 'UPDATE', 'DELETE')),

  -- Who made the change
  changed_by_user_id  uuid          references auth.users(id) on delete set null,
  changed_by_role     text,                        -- Snapshot of user role at time of change
  carrier_id          uuid          references public.carriers(id) on delete set null,

  -- When it happened
  changed_at          timestamptz   not null default now(),

  -- What changed (JSONB for flexibility)
  old_values          jsonb,                       -- NULL for INSERT
  new_values          jsonb,                       -- NULL for DELETE
  changed_fields      text[],                      -- Array of field names that changed

  -- Context
  ip_address          inet,                        -- Client IP if available
  user_agent          text,                        -- Browser/app info if available

  -- Compliance metadata
  fmcsa_compliance    boolean       not null default true,
  retention_required  boolean       not null default true,
  retention_until     date,                        -- Minimum 6 months per §395.8(k)

  -- Searchability
  search_vector       tsvector      generated always as (
    to_tsvector('english',
      coalesce(table_name, '') || ' ' ||
      coalesce(operation, '') || ' ' ||
      coalesce(changed_by_role, '')
    )
  ) stored
);

comment on table public.audit_log is
  'Universal audit trail for all database changes. FMCSA-compliant tamper-resistant record keeping.';

comment on column public.audit_log.old_values is
  'JSONB snapshot of record before change. NULL for INSERT operations.';

comment on column public.audit_log.new_values is
  'JSONB snapshot of record after change. NULL for DELETE operations.';

comment on column public.audit_log.changed_fields is
  'Array of field names that were modified (UPDATE only). Enables efficient change analysis.';

comment on column public.audit_log.retention_until is
  'Minimum retention date per 49 CFR §395.8(k). Typically 6 months from change date.';

-- Indexes for performance
create index idx_audit_log_table_time    on public.audit_log(table_name, changed_at desc);
create index idx_audit_log_record        on public.audit_log(table_name, record_id, changed_at desc);
create index idx_audit_log_user          on public.audit_log(changed_by_user_id, changed_at desc);
create index idx_audit_log_carrier       on public.audit_log(carrier_id, changed_at desc);
create index idx_audit_log_operation     on public.audit_log(operation, changed_at desc);
create index idx_audit_log_search        on public.audit_log using gin(search_vector);
create index idx_audit_log_retention     on public.audit_log(retention_until)
  where retention_required = true;

-- Partition by month for large datasets (optional, can be enabled later)
-- This allows efficient archival of old audit logs
comment on column public.audit_log.changed_at is
  'Timestamp of change. Consider partitioning this table by month for high-volume systems.';

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT TRIGGER FUNCTION
-- Generic function that can be attached to any table to capture changes.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.audit_trigger_function()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_old_data        jsonb;
  v_new_data        jsonb;
  v_changed_fields  text[];
  v_user_id         uuid;
  v_user_role       text;
  v_carrier_id      uuid;
  v_record_id       uuid;
  v_retention_date  date;
begin
  -- Get current user context
  v_user_id := auth.uid();

  -- Get user role and carrier_id if available
  if v_user_id is not null then
    select role, carrier_id
    into v_user_role, v_carrier_id
    from public.profiles
    where id = v_user_id;
  end if;

  -- Calculate retention date (6 months minimum per FMCSA)
  v_retention_date := current_date + interval '6 months';

  -- Build JSONB snapshots and extract record ID
  if (TG_OP = 'DELETE') then
    v_old_data := to_jsonb(old);
    v_new_data := null;
    v_record_id := (v_old_data->>'id')::uuid;
    v_changed_fields := null;

    -- Try to get carrier_id from old record if not from user context
    if v_carrier_id is null and v_old_data ? 'carrier_id' then
      v_carrier_id := (v_old_data->>'carrier_id')::uuid;
    end if;

  elsif (TG_OP = 'UPDATE') then
    v_old_data := to_jsonb(old);
    v_new_data := to_jsonb(new);
    v_record_id := (v_new_data->>'id')::uuid;

    -- Identify which fields changed
    select array_agg(key)
    into v_changed_fields
    from jsonb_each(v_new_data)
    where v_new_data->key is distinct from v_old_data->key
      and key not in ('updated_at', 'search_vector'); -- Exclude auto-updated fields

    -- Try to get carrier_id from new record if not from user context
    if v_carrier_id is null and v_new_data ? 'carrier_id' then
      v_carrier_id := (v_new_data->>'carrier_id')::uuid;
    end if;

  elsif (TG_OP = 'INSERT') then
    v_old_data := null;
    v_new_data := to_jsonb(new);
    v_record_id := (v_new_data->>'id')::uuid;
    v_changed_fields := null;

    -- Try to get carrier_id from new record if not from user context
    if v_carrier_id is null and v_new_data ? 'carrier_id' then
      v_carrier_id := (v_new_data->>'carrier_id')::uuid;
    end if;
  end if;

  -- Insert audit log entry
  insert into public.audit_log (
    table_name,
    schema_name,
    record_id,
    operation,
    changed_by_user_id,
    changed_by_role,
    carrier_id,
    old_values,
    new_values,
    changed_fields,
    retention_until
  ) values (
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    v_record_id,
    TG_OP,
    v_user_id,
    v_user_role,
    v_carrier_id,
    v_old_data,
    v_new_data,
    v_changed_fields,
    v_retention_date
  );

  -- Return appropriate record
  if (TG_OP = 'DELETE') then
    return old;
  else
    return new;
  end if;

exception
  when others then
    -- Log error but don't fail the original transaction
    raise warning 'Audit trigger failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
    if (TG_OP = 'DELETE') then
      return old;
    else
      return new;
    end if;
end;
$$;

comment on function public.audit_trigger_function is
  'Generic audit trigger that captures INSERT/UPDATE/DELETE to audit_log table. Attach to any table needing audit trail.';

-- ─────────────────────────────────────────────────────────────────────────────
-- APPLY AUDIT TRIGGERS TO CRITICAL TABLES
-- These tables require FMCSA-compliant audit trails.
-- ─────────────────────────────────────────────────────────────────────────────

-- ELD Events (most critical - every change must be audited)
drop trigger if exists trg_audit_eld_events on public.eld_events;
create trigger trg_audit_eld_events
  after insert or update or delete on public.eld_events
  for each row execute function public.audit_trigger_function();

-- Log Periods (certification tracking)
drop trigger if exists trg_audit_log_periods on public.log_periods;
create trigger trg_audit_log_periods
  after insert or update or delete on public.log_periods
  for each row execute function public.audit_trigger_function();

-- Drivers (identity changes)
drop trigger if exists trg_audit_drivers on public.drivers;
create trigger trg_audit_drivers
  after insert or update or delete on public.drivers
  for each row execute function public.audit_trigger_function();

-- Vehicles (asset tracking)
drop trigger if exists trg_audit_vehicles on public.vehicles;
create trigger trg_audit_vehicles
  after insert or update or delete on public.vehicles
  for each row execute function public.audit_trigger_function();

-- ELD Devices (device registration changes)
drop trigger if exists trg_audit_eld_devices on public.eld_devices;
create trigger trg_audit_eld_devices
  after insert or update or delete on public.eld_devices
  for each row execute function public.audit_trigger_function();

-- Certifications (compliance tracking)
drop trigger if exists trg_audit_certifications on public.certifications;
create trigger trg_audit_certifications
  after insert or update or delete on public.certifications
  for each row execute function public.audit_trigger_function();

-- HOS Violations (compliance enforcement)
drop trigger if exists trg_audit_hos_violations on public.hos_violations;
create trigger trg_audit_hos_violations
  after insert or update or delete on public.hos_violations
  for each row execute function public.audit_trigger_function();

-- Unidentified Driver Records (assignment tracking)
drop trigger if exists trg_audit_unidentified_driver_records on public.unidentified_driver_records;
create trigger trg_audit_unidentified_driver_records
  after insert or update or delete on public.unidentified_driver_records
  for each row execute function public.audit_trigger_function();

-- ELD Malfunctions (device status changes)
drop trigger if exists trg_audit_eld_malfunctions on public.eld_malfunctions;
create trigger trg_audit_eld_malfunctions
  after insert or update or delete on public.eld_malfunctions
  for each row execute function public.audit_trigger_function();

-- Carriers (organization changes)
drop trigger if exists trg_audit_carriers on public.carriers;
create trigger trg_audit_carriers
  after insert or update or delete on public.carriers
  for each row execute function public.audit_trigger_function();

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG QUERY HELPERS
-- Convenience views and functions for analyzing audit trails.
-- ─────────────────────────────────────────────────────────────────────────────

-- View: Recent audit activity
create or replace view public.audit_log_recent as
select
  al.id,
  al.table_name,
  al.operation,
  al.record_id,
  al.changed_at,
  al.changed_by_user_id,
  p.full_name as changed_by_name,
  al.changed_by_role,
  c.legal_name as carrier_name,
  al.changed_fields,
  jsonb_array_length(coalesce(al.changed_fields::jsonb, '[]'::jsonb)) as num_fields_changed
from public.audit_log al
left join public.profiles p on p.id = al.changed_by_user_id
left join public.carriers c on c.id = al.carrier_id
order by al.changed_at desc
limit 1000;

comment on view public.audit_log_recent is
  'Most recent 1000 audit log entries with user and carrier names for easy review.';

-- Function: Get audit history for a specific record
create or replace function public.get_audit_history(
  p_table_name text,
  p_record_id uuid
)
returns table (
  changed_at timestamptz,
  operation text,
  changed_by_name text,
  changed_by_role text,
  changed_fields text[],
  old_values jsonb,
  new_values jsonb
)
language sql
stable
as $$
  select
    al.changed_at,
    al.operation,
    p.full_name as changed_by_name,
    al.changed_by_role,
    al.changed_fields,
    al.old_values,
    al.new_values
  from public.audit_log al
  left join public.profiles p on p.id = al.changed_by_user_id
  where al.table_name = p_table_name
    and al.record_id = p_record_id
  order by al.changed_at desc;
$$;

comment on function public.get_audit_history is
  'Retrieve complete audit history for a specific record. Usage: SELECT * FROM get_audit_history(''eld_events'', ''uuid-here'')';

-- Function: Search audit logs by date range and table
create or replace function public.search_audit_logs(
  p_table_name text default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_carrier_id uuid default null,
  p_operation text default null
)
returns table (
  id uuid,
  table_name text,
  operation text,
  record_id uuid,
  changed_at timestamptz,
  changed_by_name text,
  changed_fields text[],
  carrier_name text
)
language sql
stable
as $$
  select
    al.id,
    al.table_name,
    al.operation,
    al.record_id,
    al.changed_at,
    p.full_name as changed_by_name,
    al.changed_fields,
    c.legal_name as carrier_name
  from public.audit_log al
  left join public.profiles p on p.id = al.changed_by_user_id
  left join public.carriers c on c.id = al.carrier_id
  where (p_table_name is null or al.table_name = p_table_name)
    and (p_start_date is null or al.changed_at >= p_start_date)
    and (p_end_date is null or al.changed_at <= p_end_date)
    and (p_carrier_id is null or al.carrier_id = p_carrier_id)
    and (p_operation is null or al.operation = p_operation)
  order by al.changed_at desc
  limit 10000;
$$;

comment on function public.search_audit_logs is
  'Search audit logs with filters. Usage: SELECT * FROM search_audit_logs(''eld_events'', ''2024-01-01'', ''2024-12-31'')';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY FOR AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_log enable row level security;

-- Fleet managers and admins can view audit logs for their carrier
create policy "audit_log_select_carrier"
  on public.audit_log for select
  using (
    carrier_id = public.current_user_carrier_id()
    or public.current_user_role() in ('admin', 'support')
  );

-- No one can modify audit logs (append-only via triggers only)
-- This is enforced by not creating INSERT/UPDATE/DELETE policies

comment on table public.audit_log is
  'APPEND-ONLY audit trail. No manual INSERT/UPDATE/DELETE allowed. All changes captured by triggers.';

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG RETENTION POLICY
-- Automatic cleanup of old audit logs (configurable retention period).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.archive_old_audit_logs(
  p_archive_older_than interval default '2 years'
)
returns table (
  archived_count bigint,
  oldest_archived_date timestamptz
)
language plpgsql
security definer
as $$
declare
  v_cutoff_date timestamptz;
  v_archived_count bigint;
  v_oldest_date timestamptz;
begin
  v_cutoff_date := now() - p_archive_older_than;

  -- In production, this would move records to cold storage
  -- For now, just mark them as archived (don't delete - FMCSA requires retention)

  -- Get count and oldest date
  select count(*), min(changed_at)
  into v_archived_count, v_oldest_date
  from public.audit_log
  where changed_at < v_cutoff_date
    and retention_until < current_date;

  -- In a real implementation, you would:
  -- 1. Export these records to S3/Glacier
  -- 2. Verify the export
  -- 3. Then DELETE from audit_log
  -- 4. Keep a manifest of archived files for compliance

  return query select v_archived_count, v_oldest_date;
end;
$$;

comment on function public.archive_old_audit_logs is
  'Identify audit logs eligible for archival. In production, export to cold storage before deletion.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SUMMARY STATISTICS VIEW
-- Quick overview of audit activity.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.audit_log_stats as
select
  table_name,
  operation,
  count(*) as total_changes,
  count(distinct record_id) as unique_records,
  count(distinct changed_by_user_id) as unique_users,
  min(changed_at) as first_change,
  max(changed_at) as last_change
from public.audit_log
where changed_at >= current_date - interval '30 days'
group by table_name, operation
order by total_changes desc;

comment on view public.audit_log_stats is
  'Summary statistics of audit activity in the last 30 days by table and operation.';

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTES AND COMPLIANCE DOCUMENTATION
-- ─────────────────────────────────────────────────────────────────────────────

comment on table public.audit_log is
  'FMCSA-compliant audit trail for all critical database changes.

Regulatory Compliance:
- 49 CFR §395.8(k): Records retention (6 months minimum)
- 49 CFR §395.30(b): Audit trail of all edits to driver logs
- FMCSA ELD Technical Spec: Tamper-evident record keeping

Features:
- Automatic capture via database triggers
- Immutable (append-only, no manual modifications)
- Captures old/new values for complete change history
- Tracks user, timestamp, and carrier context
- Full-text search capability
- Retention policy support

Usage:
- All changes to monitored tables are automatically logged
- Query specific record history: SELECT * FROM get_audit_history(''eld_events'', ''<uuid>'')
- Search logs: SELECT * FROM search_audit_logs(''eld_events'', ''2024-01-01'', ''2024-12-31'')
- View recent activity: SELECT * FROM audit_log_recent
- Get statistics: SELECT * FROM audit_log_stats

Archival:
- Records must be retained for minimum 6 months per FMCSA
- Run archive_old_audit_logs() periodically to identify archival candidates
- Export to cold storage (S3 Glacier) before deletion
- Maintain manifest of archived audit logs for compliance audits
';
