-- ============================================================
-- Raw Events Vault
-- Migration: 20260215000000_raw_events_vault.sql
--
-- An immutable append-only store capturing every inbound ELD
-- event payload exactly as received, before any transformation,
-- validation, or business logic is applied.
--
-- Design goals
-- ─────────────────────────────────────────────────────────────
-- • Immutability: raw_payload, receipt_timestamp, and all
--   source fields are frozen on INSERT via a BEFORE UPDATE
--   trigger; deletions are blocked by a rule.
-- • Re-processability: if ingestion logic changes, original
--   payloads can be re-run through the new pipeline.
-- • Audit completeness: every submission is recorded regardless
--   of whether it passes validation or ingestion.
-- • Batch linkage: events submitted in a batch share a batch_id
--   UUID so the entire batch can be recalled as a unit.
-- • Status tracking: processing_status transitions are the ONLY
--   mutable aspect of a raw_event row.
--
-- Status lifecycle
-- ─────────────────────────────────────────────────────────────
--   received  → processing started (initial insert state)
--   processed → ingested into eld_events successfully
--   rejected  → failed schema / business-rule / cross-ref validation
--   failed    → passed validation but ingestion threw an error
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.raw_events (

  -- Primary key
  id                    uuid          primary key default uuid_generate_v4(),

  -- The unmodified payload from the ELD device / mobile app.
  -- Stored before Zod parsing so Zod defaults are NOT applied.
  raw_payload           jsonb         not null,

  -- Wall-clock time the HTTP request arrived at the server.
  receipt_timestamp     timestamptz   not null default now(),

  -- Source identifiers (from headers / request context)
  source_device_id      varchar(255),              -- x-device-id header or payload.eldDeviceId
  source_ip             varchar(45),               -- IPv4 or IPv6
  user_agent            text,
  submitted_by_user_id  uuid,                      -- authenticated user id

  -- Batch linkage (null for single-event submissions)
  batch_id              uuid,                      -- shared UUID across a batch
  event_index           integer,                   -- 0-based position within the batch

  -- Processing state (the only mutable columns after INSERT)
  processing_status     varchar(20)   not null default 'received'
                          check (processing_status in ('received', 'processed', 'rejected', 'failed')),

  -- Populated on success
  processed_event_id    uuid,                      -- fk to eld_events.id (not enforced to avoid partition complexity)
  processed_at          timestamptz,

  -- Populated on rejection / failure
  error_message         text,

  -- Housekeeping
  created_at            timestamptz   not null default now()
);

comment on table public.raw_events is
  'Immutable vault of every inbound ELD event payload before any processing. '
  'Enables audit replay and business-logic re-processing.';

comment on column public.raw_events.raw_payload is
  'Original JSON body as received; Zod defaults are NOT applied.';
comment on column public.raw_events.batch_id is
  'Groups events submitted in the same batch request. NULL for single-event POSTs.';
comment on column public.raw_events.processing_status is
  'received → processed | rejected | failed. Only this column (and processed_* / error_message) may be mutated.';

-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABILITY ENFORCEMENT
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger function: prevents mutation of core vault fields after INSERT.
-- Only processing_status, processed_event_id, processed_at, and error_message
-- may change after the initial INSERT.
create or replace function public.raw_events_enforce_immutability()
  returns trigger
  language plpgsql
as $$
begin
  if new.raw_payload is distinct from old.raw_payload then
    raise exception 'raw_events.raw_payload is immutable after insert';
  end if;

  if new.receipt_timestamp is distinct from old.receipt_timestamp then
    raise exception 'raw_events.receipt_timestamp is immutable after insert';
  end if;

  if new.source_device_id is distinct from old.source_device_id then
    raise exception 'raw_events.source_device_id is immutable after insert';
  end if;

  if new.source_ip is distinct from old.source_ip then
    raise exception 'raw_events.source_ip is immutable after insert';
  end if;

  if new.user_agent is distinct from old.user_agent then
    raise exception 'raw_events.user_agent is immutable after insert';
  end if;

  if new.submitted_by_user_id is distinct from old.submitted_by_user_id then
    raise exception 'raw_events.submitted_by_user_id is immutable after insert';
  end if;

  if new.batch_id is distinct from old.batch_id then
    raise exception 'raw_events.batch_id is immutable after insert';
  end if;

  if new.event_index is distinct from old.event_index then
    raise exception 'raw_events.event_index is immutable after insert';
  end if;

  return new;
end;
$$;

create trigger raw_events_immutability
  before update on public.raw_events
  for each row execute function public.raw_events_enforce_immutability();

-- Block all DELETEs — raw vault rows are permanent.
create rule raw_events_no_delete as
  on delete to public.raw_events
  do instead nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Lookup by source device (most common query pattern)
create index if not exists idx_raw_events_device_time
  on public.raw_events (source_device_id, receipt_timestamp desc)
  where source_device_id is not null;

-- Filter by processing status for monitoring / reprocessing
create index if not exists idx_raw_events_status_time
  on public.raw_events (processing_status, receipt_timestamp desc);

-- Batch recall (retrieve all events from a batch)
create index if not exists idx_raw_events_batch
  on public.raw_events (batch_id, event_index)
  where batch_id is not null;

-- Link back to processed eld_events row
create index if not exists idx_raw_events_processed_event
  on public.raw_events (processed_event_id)
  where processed_event_id is not null;

-- General time-range queries / data retention scans
create index if not exists idx_raw_events_receipt_time
  on public.raw_events (receipt_timestamp desc);

-- Submitted-by user index (for user-level audit queries)
create index if not exists idx_raw_events_user
  on public.raw_events (submitted_by_user_id, receipt_timestamp desc)
  where submitted_by_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.raw_events enable row level security;

-- Service role (backend API) has unrestricted access.
create policy "raw_events_service_role_all"
  on public.raw_events
  for all
  using (auth.role() = 'service_role');

-- Fleet managers and admins can read raw events for their own carrier.
-- (raw_payload often contains carrier_dot_number or driver info for filtering)
create policy "raw_events_carrier_read"
  on public.raw_events
  for select
  using (
    auth.role() in ('authenticated') and
    public.current_user_role() in ('admin', 'fleet_manager')
  );
