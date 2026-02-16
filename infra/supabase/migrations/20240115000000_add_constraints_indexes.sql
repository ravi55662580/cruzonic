-- ============================================================
-- Enhanced Constraints and Indexes Migration
-- Migration: 20240115000000_add_constraints_indexes.sql
--
-- Adds comprehensive constraints and indexes for data integrity
-- and query performance optimization.
--
-- Changes:
-- 1. Additional NOT NULL constraints on FMCSA-required fields
-- 2. Additional unique constraints for data integrity
-- 3. Performance indexes on frequently queried columns
-- 4. Composite indexes for common query patterns
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIONAL NOT NULL CONSTRAINTS
-- Enforce FMCSA requirements at database level
-- ─────────────────────────────────────────────────────────────────────────────

-- eld_devices: All registration fields required
alter table public.eld_devices
  alter column registration_id set not null,
  alter column serial_number set not null,
  alter column device_model set not null,
  alter column manufacturer set not null,
  alter column firmware_version set not null,
  alter column fmcsa_certified_on set not null;

-- eld_events: Core FMCSA fields must always be present
alter table public.eld_events
  alter column event_sequence_id set not null,
  alter column event_record_status set not null,
  alter column event_record_origin set not null,
  alter column event_type set not null,
  alter column event_sub_type set not null,
  alter column event_date set not null,
  alter column event_time set not null,
  alter column timezone_offset set not null,
  alter column event_timestamp set not null,
  alter column accumulated_vehicle_miles set not null,
  alter column elapsed_engine_hours set not null,
  alter column malfunction_indicator_status set not null,
  alter column eld_malfunction_status set not null,
  alter column data_diagnostic_indicator_status set not null,
  alter column event_data_check_value set not null,
  alter column content_hash set not null,
  alter column chain_hash set not null,
  alter column event_metadata set not null,
  alter column version_number set not null;

-- log_periods: All fields required
alter table public.log_periods
  alter column carrier_id set not null,
  alter column driver_id set not null,
  alter column log_date set not null,
  alter column log_date_mmddyy set not null,
  alter column home_terminal_timezone set not null,
  alter column hos_ruleset set not null,
  alter column status set not null,
  alter column total_event_count set not null;

-- drivers: FMCSA identity fields required
alter table public.drivers
  alter column carrier_id set not null,
  alter column user_id set not null,
  alter column full_name set not null,
  alter column license_number set not null,
  alter column license_state set not null,
  alter column license_class set not null,
  alter column license_expiry set not null,
  alter column home_terminal_address set not null,
  alter column home_terminal_timezone set not null,
  alter column hos_ruleset set not null,
  alter column exempt_driver_type set not null,
  alter column status set not null;

-- vehicles: FMCSA CMV fields required
alter table public.vehicles
  alter column carrier_id set not null,
  alter column power_unit_number set not null,
  alter column vin set not null,
  alter column license_plate set not null,
  alter column license_plate_state set not null,
  alter column make set not null,
  alter column model set not null,
  alter column year set not null,
  alter column gvwr_lbs set not null,
  alter column vehicle_type set not null,
  alter column status set not null;

-- carriers: Business identity required
alter table public.carriers
  alter column dot_number set not null,
  alter column legal_name set not null,
  alter column address_line1 set not null,
  alter column city set not null,
  alter column state set not null,
  alter column zip set not null,
  alter column country set not null,
  alter column phone set not null,
  alter column email set not null,
  alter column status set not null,
  alter column subscription_tier set not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIONAL UNIQUE CONSTRAINTS
-- Prevent duplicate records and enforce FMCSA uniqueness rules
-- ─────────────────────────────────────────────────────────────────────────────

-- eld_events: Prevent duplicate sequence IDs across ALL event statuses
-- This is stronger than the partial unique index (which only covers active events)
comment on constraint idx_eld_events_device_seq_unique on public.eld_events is
  'Partial unique index: prevents duplicate active sequence IDs per device per period.';

-- Add index to enforce uniqueness on inactive events too (for audit trail)
create unique index idx_eld_events_device_period_seq_version
  on public.eld_events(eld_device_id, log_period_id, event_sequence_id, version_number);

comment on index idx_eld_events_device_period_seq_version is
  'Enforces: each (device, period, sequence ID) can only have one event per version number.';

-- sequence_id_states: Already has unique(eld_device_id, log_period_id) ✓

-- certifications: Prevent duplicate certifications for same driver/date
create unique index idx_certifications_driver_date_type
  on public.certifications(certified_driver_id, certified_log_date, certification_type)
  where is_recertification = false;

comment on index idx_certifications_driver_date_type is
  'Prevents duplicate initial certifications. Re-certifications are allowed.';

-- audit_entries: Ensure one CREATED entry per event
create unique index idx_audit_entries_event_created
  on public.audit_entries(event_id)
  where action = 'CREATED';

comment on index idx_audit_entries_event_created is
  'Ensures exactly one CREATED audit entry per event record.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PERFORMANCE INDEXES
-- Optimize common query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- ── carriers ──────────────────────────────────────────────────────────────
create index idx_carriers_status on public.carriers(status)
  where status = 'active';

create index idx_carriers_subscription on public.carriers(subscription_tier, status);

-- ── drivers ───────────────────────────────────────────────────────────────
create index idx_drivers_carrier_status on public.drivers(carrier_id, status);

create index idx_drivers_status_available on public.drivers(carrier_id, status)
  where status = 'available';

create index idx_drivers_license_exp on public.drivers(license_expiry)
  where license_expiry > now();

comment on index idx_drivers_license_exp is
  'Drives expiration alert queries for fleet managers.';

create index idx_drivers_current_vehicle on public.drivers(current_vehicle_id)
  where current_vehicle_id is not null;

-- ── vehicles ──────────────────────────────────────────────────────────────
create index idx_vehicles_carrier_status on public.vehicles(carrier_id, status);

create index idx_vehicles_current_driver on public.vehicles(current_driver_id)
  where current_driver_id is not null;

create index idx_vehicles_vin_hash on public.vehicles using hash(vin);

comment on index idx_vehicles_vin_hash is
  'Hash index for exact VIN lookups (O(1) average case).';

-- ── eld_devices ───────────────────────────────────────────────────────────
create index idx_eld_devices_carrier_status on public.eld_devices(carrier_id, status);

create index idx_eld_devices_vehicle on public.eld_devices(current_vehicle_id)
  where current_vehicle_id is not null;

create index idx_eld_devices_registration on public.eld_devices(registration_id);

create index idx_eld_devices_serial_hash on public.eld_devices using hash(serial_number);

-- ── trailers ──────────────────────────────────────────────────────────────
create index idx_trailers_carrier_status on public.trailers(carrier_id, status);

create index idx_trailers_number on public.trailers(carrier_id, trailer_number);

-- ── log_periods ───────────────────────────────────────────────────────────
-- Additional indexes beyond existing carrier_date and driver_date
create index idx_log_periods_status on public.log_periods(carrier_id, status, log_date desc);

create index idx_log_periods_uncertified on public.log_periods(driver_id, log_date desc)
  where status in ('open', 'closed');

comment on index idx_log_periods_uncertified is
  'Drives "pending certification" dashboard for drivers.';

create index idx_log_periods_driver_status on public.log_periods(driver_id, status);

-- ── eld_events ────────────────────────────────────────────────────────────
-- Additional indexes beyond existing ones
create index idx_eld_events_status on public.eld_events(event_record_status, event_date)
  where event_record_status = 1;

create index idx_eld_events_type_subtype on public.eld_events(event_type, event_sub_type, event_date);

create index idx_eld_events_device_date on public.eld_events(eld_device_id, event_date desc);

create index idx_eld_events_device_type on public.eld_events(eld_device_id, event_type, event_date);

create index idx_eld_events_chain_lookup on public.eld_events(eld_device_id, log_period_id, event_sequence_id desc);

comment on index idx_eld_events_chain_lookup is
  'Optimizes previous-event lookups for hash chain verification.';

create index idx_eld_events_malfunction_flags on public.eld_events(eld_device_id, event_date)
  where malfunction_indicator_status = true or eld_malfunction_status = true;

create index idx_eld_events_driver_type_date on public.eld_events(driver_id, event_type, event_date desc);

create index idx_eld_events_vehicle_type_date on public.eld_events(vehicle_id, event_type, event_date desc);

create index idx_eld_events_carrier_date_type on public.eld_events(carrier_id, event_date desc, event_type);

-- Covering index for common event listing queries
create index idx_eld_events_driver_date_covering on public.eld_events(
  driver_id,
  event_date desc,
  event_time desc
) include (
  event_type,
  event_sub_type,
  event_record_status,
  location_description
);

comment on index idx_eld_events_driver_date_covering is
  'Covering index for driver event timeline queries (avoids heap lookups).';

-- ── duty_status_records ───────────────────────────────────────────────────
create index idx_dsr_driver_date_status on public.duty_status_records(
  driver_id,
  started_at::date,
  duty_status
);

create index idx_dsr_carrier_date on public.duty_status_records(carrier_id, started_at::date desc);

create index idx_dsr_active_segments on public.duty_status_records(driver_id, started_at desc)
  where ended_at is null;

comment on index idx_dsr_active_segments is
  'Current active duty segment per driver (for real-time HOS clock).';

create index idx_dsr_duty_status_filter on public.duty_status_records(log_period_id, duty_status);

-- ── hos_calculations ──────────────────────────────────────────────────────
create index idx_hos_calc_driver_date on public.hos_calculations(driver_id, calculated_at desc);

create index idx_hos_calc_restart_status on public.hos_calculations(driver_id, is_in_34h_restart);

create index idx_hos_calc_carrier_date on public.hos_calculations(carrier_id, calculated_at::date desc);

-- ── hos_violations ────────────────────────────────────────────────────────
create index idx_hos_viol_unacknowledged on public.hos_violations(carrier_id, started_at desc)
  where acknowledged_at is null;

comment on index idx_hos_viol_unacknowledged is
  'Active violations pending fleet manager review.';

create index idx_hos_viol_driver_type on public.hos_violations(driver_id, violation_type, started_at desc);

create index idx_hos_viol_type_severity on public.hos_violations(
  carrier_id,
  violation_type,
  severity,
  started_at desc
);

-- ── certifications ────────────────────────────────────────────────────────
create index idx_cert_driver_performed_at on public.certifications(
  certifying_driver_id,
  performed_at desc
);

create index idx_cert_carrier_date on public.certifications(carrier_id, certified_log_date desc);

create index idx_cert_recertifications on public.certifications(certified_driver_id, performed_at desc)
  where is_recertification = true;

create index idx_cert_log_period on public.certifications(log_period_id, performed_at desc);

-- ── unidentified_driver_records ───────────────────────────────────────────
create index idx_udr_device_status on public.unidentified_driver_records(
  eld_device_id,
  status,
  started_at desc
);

create index idx_udr_aging_calculation on public.unidentified_driver_records(
  carrier_id,
  started_at,
  status
) where status = 'pending' and started_at < (now() - interval '7 days');

comment on index idx_udr_aging_calculation is
  'Drives 8-day deadline alert: records approaching the FMCSA resolution requirement.';

create index idx_udr_claimed_driver on public.unidentified_driver_records(
  claimed_by_driver_id,
  claimed_at desc
) where status = 'claimed';

-- ── eld_malfunctions ──────────────────────────────────────────────────────
create index idx_eld_mal_carrier_active on public.eld_malfunctions(carrier_id, is_active, detected_at desc);

create index idx_eld_mal_code_active on public.eld_malfunctions(
  is_malfunction,
  malfunction_code,
  is_active
) where is_malfunction = true;

create index idx_eld_mal_diagnostic_active on public.eld_malfunctions(
  diagnostic_code,
  is_active
) where is_malfunction = false;

create index idx_eld_mal_paper_logs_required on public.eld_malfunctions(
  carrier_id,
  detected_at desc
) where paper_logs_required = true and is_active = true;

comment on index idx_eld_mal_paper_logs_required is
  'Active malfunctions requiring immediate paper log fallback.';

-- ── eld_records ───────────────────────────────────────────────────────────
create index idx_eld_records_driver_period on public.eld_records(driver_id, log_period_id);

create index idx_eld_records_device_date on public.eld_records(
  eld_device_id,
  generated_at::date desc
);

create index idx_eld_records_retention on public.eld_records(
  carrier_id,
  generated_at
) where archived_at is null and generated_at < (now() - interval '6 months');

comment on index idx_eld_records_retention is
  'Records approaching the 6-month retention threshold for archival processing.';

create index idx_eld_records_transferred on public.eld_records(
  carrier_id,
  transferred_at desc
) where transferred_at is not null;

-- ── audit_entries ─────────────────────────────────────────────────────────
create index idx_audit_action_performed on public.audit_entries(action, performed_at desc);

create index idx_audit_event_action on public.audit_entries(event_id, action, performed_at desc);

create index idx_audit_device_time on public.audit_entries(eld_device_id, performed_at desc)
  where eld_device_id is not null;

create index idx_audit_edit_actions on public.audit_entries(event_id, performed_at desc)
  where action in ('EDITED', 'DRIVER_CONFIRMED_EDIT', 'DRIVER_REJECTED_EDIT');

create index idx_audit_carrier_action_time on public.audit_entries(
  actor_organization_id,
  action,
  performed_at desc
);

-- ── assignment history ────────────────────────────────────────────────────
create index idx_vea_active_assignments on public.vehicle_eld_assignments(
  vehicle_id,
  assigned_at desc
) where unassigned_at is null;

create index idx_vea_device_active on public.vehicle_eld_assignments(
  eld_device_id,
  assigned_at desc
) where unassigned_at is null;

create index idx_dva_active_assignments on public.driver_vehicle_assignments(
  driver_id,
  assigned_at desc
) where unassigned_at is null;

create index idx_dva_vehicle_active on public.driver_vehicle_assignments(
  vehicle_id,
  assigned_at desc
) where unassigned_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION-BASED INDEXES
-- Extract JSONB fields for efficient filtering
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on event metadata for EventType 5 (login exemptions)
create index idx_eld_events_login_exemptions on public.eld_events(
  (event_metadata->>'shortHaul')
) where event_type = 5 and event_sub_type = 1;

comment on index idx_eld_events_login_exemptions is
  'Enables filtering drivers by active short-haul exemption status.';

-- Index for certification events with edited sequences
create index idx_eld_events_cert_edited_seqs on public.eld_events(
  event_type,
  jsonb_array_length(event_metadata->'editedEventSequenceIds')
) where event_type = 4 and jsonb_array_length(event_metadata->'editedEventSequenceIds') > 0;

comment on index idx_eld_events_cert_edited_seqs is
  'Recertification events with edited sequences (for audit trail analysis).';

-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIONAL CHECK CONSTRAINTS
-- Enforce business rules at database level
-- ─────────────────────────────────────────────────────────────────────────────

-- eld_events: Driver account ID required for EventTypes 1, 4, 5
alter table public.eld_events
  add constraint chk_eld_events_driver_account_required
    check (
      event_type not in (1, 4, 5)
      or driver_eld_account_id is not null
    );

comment on constraint chk_eld_events_driver_account_required on public.eld_events is
  'FMCSA requirement: EventTypes 1 (duty status), 4 (certification), and 5 (login) must have driver_eld_account_id.';

-- eld_events: Location description required when GPS available
alter table public.eld_events
  add constraint chk_eld_events_location_desc_with_gps
    check (
      (latitude is null and longitude is null)
      or location_description is not null
    );

-- eld_events: Version chain integrity
alter table public.eld_events
  add constraint chk_eld_events_version_chain
    check (
      (version_number = 1 and previous_version_id is null)
      or (version_number > 1 and previous_version_id is not null)
    );

-- certifications: Total records must be positive
alter table public.certifications
  add constraint chk_certifications_total_positive
    check (total_records_certified > 0);

-- certifications: Edited sequences required for re-certifications
alter table public.certifications
  add constraint chk_certifications_recert_requires_edits
    check (
      is_recertification = false
      or jsonb_array_length(edited_event_sequence_ids) > 0
    );

-- hos_calculations: Remaining time cannot be negative
alter table public.hos_calculations
  add constraint chk_hos_calc_remaining_nonnegative
    check (
      (remaining_driving_minutes is null or remaining_driving_minutes >= 0)
      and (remaining_on_duty_window_minutes is null or remaining_on_duty_window_minutes >= 0)
      and (remaining_weekly_minutes is null or remaining_weekly_minutes >= 0)
      and (time_until_break_required_minutes is null or time_until_break_required_minutes >= 0)
    );

-- hos_calculations: 34h restart requires start timestamp
alter table public.hos_calculations
  add constraint chk_hos_calc_restart_consistency
    check (
      is_in_34h_restart = false
      or (restart_started_at is not null and restart_eligible_at is not null)
    );

-- hos_violations: Duration consistency
alter table public.hos_violations
  add constraint chk_hos_viol_duration_consistency
    check (
      (ended_at is null and duration_minutes is null)
      or (ended_at is not null and duration_minutes is not null and duration_minutes > 0)
    );

-- unidentified_driver_records: Claimed status requires driver and timestamp
alter table public.unidentified_driver_records
  add constraint chk_udr_claim_consistency
    check (
      status <> 'claimed'
      or (claimed_by_driver_id is not null and claimed_at is not null)
    );

-- eld_malfunctions: Code consistency
alter table public.eld_malfunctions
  add constraint chk_eld_mal_code_consistency
    check (
      (is_malfunction = true and malfunction_code is not null and diagnostic_code is null)
      or (is_malfunction = false and diagnostic_code is not null and malfunction_code is null)
    );

-- drivers: Current vehicle consistency
alter table public.drivers
  add constraint chk_drivers_vehicle_status_consistency
    check (
      current_vehicle_id is null
      or status in ('available', 'on_trip')
    );

comment on constraint chk_drivers_vehicle_status_consistency on public.drivers is
  'Drivers can only have a current vehicle when available or on trip.';

-- vehicles: Current driver consistency
alter table public.vehicles
  add constraint chk_vehicles_driver_status_consistency
    check (
      current_driver_id is null
      or status = 'active'
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC FUNCTION: Allocate Next Sequence ID
-- Atomically increments and returns the next sequence ID for a device/period
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.allocate_next_sequence_id(
  p_eld_device_id uuid,
  p_log_date text
)
  returns integer
  language plpgsql
  security definer
as $$
declare
  v_log_period_id uuid;
  v_next_id integer;
begin
  -- Find or create log period
  select id into v_log_period_id
  from public.log_periods
  where log_date_mmddyy = p_log_date
    and driver_id = (
      select driver_id from public.eld_events
      where eld_device_id = p_eld_device_id
      order by created_at desc
      limit 1
    )
  limit 1;

  if v_log_period_id is null then
    raise exception 'Log period not found for date % and device %', p_log_date, p_eld_device_id;
  end if;

  -- Atomic increment using INSERT ... ON CONFLICT
  insert into public.sequence_id_states (eld_device_id, log_period_id, last_issued_id)
  values (p_eld_device_id, v_log_period_id, 1)
  on conflict (eld_device_id, log_period_id)
  do update set
    last_issued_id = sequence_id_states.last_issued_id + 1,
    last_issued_at = now(),
    updated_at = now(),
    wrap_around_count = case
      when sequence_id_states.last_issued_id >= 65535 then sequence_id_states.wrap_around_count + 1
      else sequence_id_states.wrap_around_count
    end
  returning last_issued_id into v_next_id;

  -- Enforce FMCSA range
  if v_next_id > 65535 then
    raise exception 'Sequence ID overflow: device % period % exceeded 65535 limit', p_eld_device_id, v_log_period_id;
  end if;

  return v_next_id;
end;
$$;

comment on function public.allocate_next_sequence_id is
  'Atomically allocates the next sequence ID (1-65535) for a device/period scope. Thread-safe.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ANALYZE
-- Update statistics for query planner
-- ─────────────────────────────────────────────────────────────────────────────

analyze public.carriers;
analyze public.profiles;
analyze public.drivers;
analyze public.vehicles;
analyze public.trailers;
analyze public.eld_devices;
analyze public.vehicle_eld_assignments;
analyze public.driver_vehicle_assignments;
analyze public.log_periods;
analyze public.eld_events;
analyze public.sequence_id_states;
analyze public.duty_status_records;
analyze public.hos_calculations;
analyze public.hos_violations;
analyze public.certifications;
analyze public.unidentified_driver_records;
analyze public.eld_malfunctions;
analyze public.eld_records;
analyze public.audit_entries;
