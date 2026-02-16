# Database Schema

All tables live in the `public` schema of Supabase (PostgreSQL 15).

## ERD

The full interactive ERD is maintained in **[database-erd.dbml](database-erd.dbml)**.

Import it at [dbdiagram.io](https://dbdiagram.io) → New Diagram → paste file content to render the diagram with all relationships and cardinalities.

## Migrations

| File | Description |
|------|-------------|
| `20240101000000_initial_schema.sql` | Core tables: profiles, drivers, vehicles, trips, location_events |
| `20240102000000_eld_schema.sql` | Full ELD schema: carriers, eld_devices, log_periods, eld_events, HOS, compliance, audit |

Apply with:
```bash
npx supabase db push
```

---

## Multi-Tenancy

Every data row belongs to exactly one **carrier** via a `carrier_id` foreign key. Supabase Row Level Security (RLS) enforces isolation:

- **`support` role** — reads across all carriers (Cruzonic staff only)
- **`admin` / `fleet_manager` role** — reads their carrier's data only
- **`driver` role** — reads their own records only
- **Backend API** (service_role key) — bypasses RLS; all writes go through the API

---

## Table Groups

### Multi-Tenant Core

| Table | Description |
|-------|-------------|
| `carriers` | Tenant root. One row per fleet/motor carrier. Holds DOT number, legal name, subscription tier. |
| `profiles` | Extends `auth.users`. Every Supabase user has a profile with a role and `carrier_id`. |

### Fleet Assets

| Table | Description |
|-------|-------------|
| `drivers` | CDL holders. Includes home terminal, HOS ruleset, exempt driver type. |
| `vehicles` | CMVs (power units). Includes VIN, GVWR, power unit number. |
| `trailers` | Trailers coupled to CMVs during trips. Up to 2 per CMV. |
| `eld_devices` | FMCSA-registered ELD hardware. Linked to the vehicle it is currently installed in. |

### Assignment History

| Table | Description |
|-------|-------------|
| `vehicle_eld_assignments` | Full history of which ELD was installed in which vehicle. |
| `driver_vehicle_assignments` | Full history of which driver operated which vehicle (including trailer numbers). |

### ELD Event Stream

| Table | Description |
|-------|-------------|
| `log_periods` | One row per driver per 24-hour HOS period. Drives certification lifecycle. |
| `eld_events` | **Append-only.** All 7 FMCSA event types. Original records preserved on edit via `event_record_status` + `previous_version_id` chain. Two database triggers enforce immutability. |
| `sequence_id_states` | Persists the last-issued sequence ID per `(eld_device × log_period)` for the `SequenceIdManager`. |

#### `eld_events` immutability contract

Original records are **never** deleted. When an edit occurs:
1. The existing row's `event_record_status` is updated to `2` (Inactive-Changed).
2. A new row is inserted with `event_record_status = 1` (Active), `version_number` incremented, and `previous_version_id` pointing to the superseded row.

A trigger (`trg_eld_events_immutable`) enforces that only `event_record_status` may be changed on existing rows — all other fields are frozen.

#### Hash chain

Each `eld_events` row stores:
- `content_hash` — SHA-256 of the 13 FMCSA event data fields
- `chain_hash` — SHA-256 of (`content_hash` ∥ `previous_chain_hash`)
- `previous_chain_hash` — the preceding active record's `chain_hash`

Any modification to data fields breaks the chain hash of all subsequent records.

### Materialized HOS Data

| Table | Description |
|-------|-------------|
| `duty_status_records` | Contiguous duty-status intervals derived from EventType 1 events. One row per segment. |
| `hos_calculations` | Computed HOS window snapshot per driver per log period. Drives the mobile HOS clock. |
| `hos_violations` | Detected HOS rule violations. Seven violation types matching 49 CFR §395. |

### Compliance Outputs

| Table | Description |
|-------|-------------|
| `certifications` | Materialized from EventType 4. Driver's certification of a 24-hour log period. |
| `unidentified_driver_records` | Driving without a logged-in driver. Must be claimed/rejected within 8 days. |
| `eld_malfunctions` | Active and resolved malfunction/diagnostic events (codes P–O and 1–6). |
| `eld_records` | **Fully immutable.** Finalized `.erod` files. Trigger prevents modification of core fields. Retained 6 months per 49 CFR §395.8(k). |

### Audit

| Table | Description |
|-------|-------------|
| `audit_entries` | Append-only audit trail. One row per action on an `eld_events` row. Stores actor, timestamp, device/IP, field-level diff, and edit reason code. |

---

## Key Constraints Summary

| Constraint | Table | Rule |
|-----------|-------|------|
| No duplicate sequence IDs | `eld_events` | `UNIQUE (eld_device_id, log_period_id, event_sequence_id) WHERE event_record_status = 1` |
| One log period per driver per day | `log_periods` | `UNIQUE (driver_id, log_date)` |
| One HOS calculation per driver per period | `hos_calculations` | `UNIQUE (driver_id, log_period_id)` |
| One finalized record per driver per period | `eld_records` | `UNIQUE (driver_id, log_period_id)` |
| Malfunction/diagnostic mutual exclusion | `eld_events`, `eld_malfunctions` | `CHECK NOT (malfunction_code IS NOT NULL AND diagnostic_code IS NOT NULL)` |
| GPS or distance required | `eld_events` | `CHECK (lat/lon IS NOT NULL OR distance_since_last_valid IS NOT NULL)` |
| eld_records immutable | `eld_records` | Trigger prevents changes to core fields |
| eld_events data frozen | `eld_events` | Trigger allows only `event_record_status` change |
