# ELD Data Flow — Hardware to FMCSA Output

End-to-end description of how driving data originates in the truck and travels through the Cruzonic platform to produce FMCSA-compliant output files.

---

## System Component Map

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  IN-VEHICLE HARDWARE                                                                  │
│                                                                                       │
│  ┌──────────────────┐   ┌─────────────────┐   ┌──────────────────────┐              │
│  │   ELD Device     │   │  GPS / GNSS     │   │    Engine ECM        │              │
│  │  (Telematics     │◄──│    Antenna      │   │  CAN Bus J1939/J1708 │              │
│  │   Control Unit)  │   │  lat/lng/speed  │   │  RPM · ODO · idle    │              │
│  │  FMCSA-reg'd     │◄──┤─────────────────┘   │                      │              │
│  └────────┬─────────┘   └─────────────────────┴──────────┬───────────┘              │
│           │ Bluetooth / USB                               │ CAN Bus                  │
└───────────┼───────────────────────────────────────────────┼──────────────────────────┘
            │                                               │
            ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  MOBILE APP — React Native (iOS / Android)                                            │
│                                                                                       │
│  ┌──────────────────────────────────────────────┐                                    │
│  │         Pacific Track SDK                    │                                    │
│  │  (Native iOS/Android module, embedded)       │                                    │
│  │                                               │                                    │
│  │  • Manages BT/USB connection to ELD device   │                                    │
│  │  • Parses raw ELD binary / NMEA streams      │                                    │
│  │  • Normalises to structured HOS event object │                                    │
│  │  • Provides onHOSEvent / onLocation /        │                                    │
│  │    onEngineEvent callbacks to the app        │                                    │
│  │  • Handles ELD malfunction codes (diag mode) │                                    │
│  └───────────────────────┬──────────────────────┘                                    │
│                          │ SDK callbacks                                              │
│  ┌───────────────────────▼──────────────────────┐                                    │
│  │       Offline Event Queue (SQLite)           │                                    │
│  │  Buffers events when connectivity is poor.   │                                    │
│  │  Drains to backend when network resumes.     │                                    │
│  └───────────────────────┬──────────────────────┘                                    │
│                          │ HTTPS REST + Bearer JWT                                    │
└──────────────────────────┼───────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  BACKEND — Express API Server (Node.js / TypeScript)                                  │
│                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Supabase JWT Auth Guard  ──►  Rate Limiter  ──►  Route Handlers                │ │
│  └────────────────────────────────────────────────────────────────────────────────-┘ │
│       │                    │                     │                    │               │
│       ▼                    ▼                     ▼                    ▼               │
│  ┌─────────┐        ┌──────────┐        ┌─────────────┐     ┌─────────────┐         │
│  │  ELD    │        │  HOS     │        │  Location   │     │  Engine     │         │
│  │  Data   │        │  Event   │        │  Aggregator │     │  Event      │         │
│  │Validator│        │Processor │        │             │     │  Handler    │         │
│  │         │        │          │        │             │     │             │         │
│  │schema ✓ │        │duty state│        │GPS batching │     │ignition     │         │
│  │tamper ✓ │        │HOS rules │        │geofencing   │     │idle time    │         │
│  │diag code│        │split/calc│        │speed check  │     │odometer     │         │
│  └────┬────┘        └────┬─────┘        └──────┬──────┘     └──────┬──────┘         │
│       │                  │                      │                   │                │
│       └──────────────────┴──────────────────────┴───────────────────┘                │
│                                       │                                               │
│       ┌───────────────────────────────┤ (same API, right-branch)                     │
│       │                               │                                               │
│       ▼                               ▼                                               │
│  ┌──────────────────────┐    ┌────────────────────────┐                              │
│  │  Compliance Output   │    │                        │                              │
│  │     Generator        │    │  Supabase PostgreSQL   │                              │
│  │                      │    │  (primary data store)  │                              │
│  │ 49 CFR Part 395 rules│    │                        │                              │
│  │ HOS calculation      │    │  Supabase Auth         │                              │
│  │ Violation detection  │    │  (JWT + RLS policies)  │                              │
│  │ Certified ELD rules  │    │                        │                              │
│  └──────────┬───────────┘    │  Supabase Realtime ────┼──► Fleet Portal WebSocket   │
│             │                │  (location_events)     │                              │
│             ▼                └────────────────────────┘                              │
│  ┌──────────────────────┐                                                             │
│  │  FMCSA Data          │                                                             │
│  │  Formatter           │                                                             │
│  │                      │                                                             │
│  │  49 CFR Part 395     │                                                             │
│  │  Appendix A spec     │                                                             │
│  │  File version: 1.1.0 │                                                             │
│  └──────────┬───────────┘                                                             │
└─────────────┼────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  FMCSA COMPLIANCE OUTPUTS                                                             │
│                                                                                       │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │  ELD Output File   │  │  Driver Log (PDF)   │  │  DOT Web Services Transfer   │  │
│  │     (.erod)        │  │                     │  │                              │  │
│  │  • Compressed      │  │  • 24-hr graph grid │  │  • Encrypted HTTPS upload    │  │
│  │  • Digitally signed│  │  • All duty status  │  │  • fmcsa.dot.gov portal      │  │
│  │  • Transfer via:   │  │    changes          │  │  • Used for remote           │  │
│  │    BT · USB · Web  │  │  • Violations noted │  │    inspections / audits      │  │
│  └────────┬───────────┘  └──────────┬──────────┘  └────────────┬─────────────────┘  │
└───────────┼─────────────────────────┼───────────────────────────┼────────────────────┘
            │                         │                           │
            ▼                         ▼                           ▼
      DOT Inspector            Driver / Fleet              FMCSA Safety
      (roadside)               Manager                     Analyst (federal)
```

---

## Step-by-Step Data Flow

### Step 1 — Hardware Event Generation

| Source | Data Produced | Protocol |
|--------|--------------|----------|
| Engine ECM | Ignition on/off, RPM, odometer, idle duration | CAN Bus J1939 / J1708 |
| GPS/GNSS | Latitude, longitude, speed, heading, accuracy | NMEA 0183 / proprietary |
| ELD Device | Combines both sources + driver input events | Internal |

The ELD device is the physical unit installed in the CMV (Commercial Motor Vehicle). It must be registered on the FMCSA ELD list and comply with 49 CFR Part 395 Subpart B.

---

### Step 2 — Pacific Track SDK Integration

The **Pacific Track SDK** is embedded as a native module inside the React Native app. It is the bridge between the physical ELD hardware and the application layer.

**SDK responsibilities:**
- Discovers and connects to the ELD device via Bluetooth (classic or BLE) or USB
- Reads the raw binary / proprietary data stream from the device
- Normalises data into structured `ELDEvent` objects
- Emits typed callbacks consumed by the React Native app:

```ts
// SDK callback shape (simplified)
interface ELDEvent {
  type: 'HOS_CHANGE' | 'LOCATION' | 'ENGINE' | 'MALFUNCTION' | 'DIAGNOSTIC';
  timestamp: string;            // ISO 8601 UTC
  driverId: string;
  vehicleId: string;
  payload: HOSPayload | LocationPayload | EnginePayload | MalfunctionPayload;
}

interface HOSPayload {
  previousStatus: DutyStatus;
  newStatus: DutyStatus;        // 'OFF' | 'SB' | 'D' | 'ON'
  location: string;             // city/state or coords if no city lookup
  annotation: string | null;
}

interface LocationPayload {
  latitude: number;
  longitude: number;
  speedMph: number;
  engineMiles: number;
  engineHours: number;
}
```

**ELD malfunction detection:**
If the SDK detects a hardware malfunction (power loss, GPS failure, timing error, etc.) it emits a `MALFUNCTION` event with the appropriate FMCSA diagnostic code (codes P, E, T, L, R, S, O). The driver app surfaces this visually and the backend logs it to the `eld_diagnostics` table.

---

### Step 3 — Offline Event Queue

The React Native app maintains an **offline queue** backed by SQLite (via `expo-sqlite`). When network connectivity is unavailable (dead zones, tunnels), ELD events are written to the local queue. When connectivity restores, the queue drains to the backend in chronological order. This ensures no HOS data is lost and the backend always receives events in sequence.

```
App receives SDK event
        │
        ├── Network available? ──YES──► POST /eld/events (immediate)
        │
        └── Network unavailable ──────► INSERT INTO offline_queue (SQLite)
                                              │
                                              ▼ (on reconnect)
                                        Drain queue in order
                                        POST /eld/events (batch)
```

---

### Step 4 — Backend API Ingestion

**Endpoint:** `POST /eld/events`
**Auth:** Supabase JWT (driver role)
**Body:** Array of `ELDEvent` objects

The API dispatches each event to the appropriate processor based on `event.type`:

| Processor | Handles | Output table |
|-----------|---------|-------------|
| `ELDDataValidator` | Schema validation, tamper detection, device ID check | `eld_raw_events` |
| `HOSEventProcessor` | Duty status changes, HOS rule calculations (property / passenger / short-haul exemptions) | `hos_events` |
| `LocationAggregator` | GPS de-duplication, speed threshold events, geofence entry/exit | `location_events` |
| `EngineEventHandler` | Ignition cycles, idle tracking, odometer sync | `engine_events` |

All processors write to Supabase PostgreSQL via the service-role client (bypasses RLS). The `location_events` table has Realtime enabled — each INSERT is streamed to the Fleet Portal via WebSocket.

---

### Step 5 — Compliance Output Generator

The Compliance Output Generator is a service module inside the Express API. It is triggered:
- On demand (driver taps "Export Logs" in the app)
- Automatically at end of each 24-hour log period (midnight local time)
- By a fleet manager from the portal

**Processing logic:**

```
Pull all hos_events + location_events + engine_events for (driver, date_range)
        │
        ▼
Apply 49 CFR §395 HOS rules
  - 11-hour driving limit
  - 14-hour on-duty window
  - 30-minute break requirement
  - 60/70-hour weekly limit
  - Sleeper berth provisions
        │
        ▼
Detect violations → attach to event record
        │
        ▼
Emit to FMCSA Data Formatter
```

---

### Step 6 — FMCSA Data Formatter

Formats the normalised records according to the **FMCSA ELD Technical Specification (49 CFR Part 395, Appendix A to Subpart B)**. Output file version: **1.1.0**.

The `.erod` (ELD Record Output Data) file contains:

```
File header
  └── File version, creation timestamp, ELD device identifier, timezone
Driver info section
  └── CDL number, name, carrier DOT number, co-driver
CMV section
  └── VIN, CMV power unit number, license plate
ELD events (one record per event)
  └── Event type code, duty status, timestamp, location,
      engine hours, engine miles, odometer, lat/lng,
      origin (driver / auto / assumed / editable)
Malfunctions & diagnostics
  └── Active diagnostic codes, timestamps
Unidentified driving periods
```

The file is **digitally signed** with the carrier's certificate before transfer.

---

### Step 7 — Output Delivery

| Output | Format | Transfer Method | Consumer |
|--------|--------|-----------------|----------|
| ELD Output File | `.erod` (UTF-8) | Bluetooth, USB, or HTTPS web upload | DOT Inspector (roadside) |
| Driver Daily Log | PDF (24-hr graph grid) | Email / in-app download | Driver, Fleet Manager |
| DOT Web Transfer | HTTPS POST to FMCSA portal | Encrypted TLS 1.2+ | FMCSA Safety Analyst |
| Real-time Dashboard | WebSocket stream | Supabase Realtime → React portal | Fleet Manager |
| HOS Summary | JSON API response | REST | Driver mobile app |

---

## Key Regulatory References

| Regulation | Description |
|-----------|-------------|
| 49 CFR Part 395 | Hours of Service of Drivers |
| 49 CFR Part 395 Subpart B | Electronic Logging Devices |
| 49 CFR Part 395 Appendix A | ELD Technical Specification (file format) |
| 49 CFR §395.8 | Driver's record of duty status (RODS) |
| 49 CFR §395.11 | Supporting documents |
| FMCSA ELD Final Rule (Dec 2015) | Mandate for CMV carriers |

---

## Error & Malfunction Handling

FMCSA defines 8 ELD malfunction codes that must be detected and reported:

| Code | Malfunction |
|------|-------------|
| P | Power compliance |
| E | Engine synchronisation compliance |
| T | Timing compliance |
| L | Positioning compliance (GPS) |
| R | Data recording compliance |
| S | Data transfer compliance |
| O | Other ELD detected malfunction |
| (additional diagnostic) | D codes for data diagnostics |

When a malfunction is detected:
1. SDK emits `MALFUNCTION` event
2. Driver app shows persistent in-app alert
3. Backend logs to `eld_diagnostics` table
4. Compliance generator marks affected log periods
5. Paper logs must be used until malfunction is resolved (49 CFR §395.34)
