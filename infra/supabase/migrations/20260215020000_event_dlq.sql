-- ============================================================================
-- Event Dead-Letter Queue (DLQ)
--
-- Captures ELD events that fail ingestion after all retry attempts are
-- exhausted.  Admins can inspect entries, trigger manual re-ingestion,
-- or mark them as discarded.
--
-- Status lifecycle:
--   pending   → default on creation; awaiting admin action
--   retrying  → admin-triggered retry is currently in-flight
--   resolved  → event was successfully re-ingested by admin retry
--   discarded → admin explicitly discarded the entry (no re-ingestion)
--
-- Immutability:
--   original_payload, source_device_id, first_failure_at, source_endpoint
--   and created_at are write-once (protected by the trigger below).
-- ============================================================================

-- Table ──────────────────────────────────────────────────────────────────────

create table if not exists public.event_dlq (
  id                    uuid          primary key default uuid_generate_v4(),

  -- Original event data exactly as it was about to be ingested
  original_payload      jsonb         not null,

  -- Failure tracking
  failure_reason        text          not null,
  retry_count           integer       not null default 0,
  first_failure_at      timestamptz   not null default now(),
  last_failure_at       timestamptz   not null default now(),

  -- Workflow state
  status                varchar(20)   not null default 'pending'
    constraint event_dlq_status_check
      check (status in ('pending', 'retrying', 'resolved', 'discarded')),

  -- Source context (for filtering and audit)
  source_device_id      varchar(255),
  source_endpoint       varchar(100),  -- '/events' or '/events/batch'
  batch_index           integer,       -- position in original batch (null = single event)

  -- Cross-reference to raw_events vault (nullable — vault capture may have failed)
  raw_vault_id          uuid,

  -- Resolution metadata (populated when status = resolved | discarded)
  resolved_at           timestamptz,
  resolved_by_user_id   uuid,
  resolution_notes      text,

  -- Timestamps
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

-- Immutability trigger ───────────────────────────────────────────────────────

create or replace function public.prevent_dlq_core_mutation()
returns trigger
language plpgsql
as $$
begin
  -- Core fields must never be altered after creation
  if new.original_payload    is distinct from old.original_payload    then
    raise exception 'event_dlq.original_payload is immutable';
  end if;
  if new.first_failure_at    is distinct from old.first_failure_at    then
    raise exception 'event_dlq.first_failure_at is immutable';
  end if;
  if new.source_device_id    is distinct from old.source_device_id    then
    raise exception 'event_dlq.source_device_id is immutable';
  end if;
  if new.source_endpoint     is distinct from old.source_endpoint     then
    raise exception 'event_dlq.source_endpoint is immutable';
  end if;
  if new.created_at          is distinct from old.created_at          then
    raise exception 'event_dlq.created_at is immutable';
  end if;

  -- Always bump updated_at on any permitted change
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists prevent_dlq_core_mutation_trigger on public.event_dlq;

create trigger prevent_dlq_core_mutation_trigger
  before update on public.event_dlq
  for each row execute function public.prevent_dlq_core_mutation();

-- Indexes ────────────────────────────────────────────────────────────────────

-- Primary admin query: list pending entries sorted newest-first
create index if not exists event_dlq_status_created_idx
  on public.event_dlq (status, created_at desc);

-- Filter by device
create index if not exists event_dlq_device_idx
  on public.event_dlq (source_device_id, status, created_at desc)
  where source_device_id is not null;

-- Cross-reference to raw vault
create index if not exists event_dlq_raw_vault_idx
  on public.event_dlq (raw_vault_id)
  where raw_vault_id is not null;

-- Alert depth query: count pending entries quickly
create index if not exists event_dlq_pending_idx
  on public.event_dlq (status)
  where status = 'pending';

-- Resolution audit
create index if not exists event_dlq_resolved_by_idx
  on public.event_dlq (resolved_by_user_id, resolved_at desc)
  where resolved_by_user_id is not null;

-- Comments ───────────────────────────────────────────────────────────────────

comment on table  public.event_dlq is 'Dead-letter queue for ELD events that failed ingestion after all retry attempts';
comment on column public.event_dlq.original_payload     is 'Full IngestEventParams snapshot — ready for direct re-ingestion';
comment on column public.event_dlq.failure_reason       is 'Last error message from the failed ingestion attempt';
comment on column public.event_dlq.retry_count          is 'Number of admin-triggered retry attempts (not the original backoff retries)';
comment on column public.event_dlq.source_endpoint      is 'API endpoint that originated the event: /events or /events/batch';
comment on column public.event_dlq.batch_index          is 'Zero-based position within the original batch request (null for single-event requests)';
comment on column public.event_dlq.raw_vault_id         is 'FK to raw_events.id — present when the raw vault capture succeeded';
