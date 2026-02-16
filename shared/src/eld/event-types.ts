/**
 * FMCSA ELD Event Type Constants & Enumerations
 *
 * Source: 49 CFR Part 395, Subpart B — Electronic Logging Devices
 *         Appendix A to Subpart B — ELD Technical Specifications (v1.1.0)
 *
 * Section references are noted inline for each group.
 */

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.1  EVENT TYPE CODES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary category of an ELD event record.
 * Encoded as a single digit (1–7) in the .erod file.
 */
export enum ELDEventType {
  /** A change in the driver's duty-status (Off Duty, Sleeper Berth, Driving, On Duty Not Driving). */
  DUTY_STATUS_CHANGE        = 1,
  /** Automatically recorded position/engine snapshot every 60 minutes while driving. */
  INTERMEDIATE_LOG          = 2,
  /** Driver activates or cancels an ELD-exempt indication (Personal Use or Yard Moves). */
  PERSONAL_USE_YARD_MOVES   = 3,
  /** Driver certifies (or re-certifies) the accuracy of their own or a co-driver's records. */
  CERTIFICATION             = 4,
  /** Driver logs in or out of the ELD. */
  LOGIN_LOGOUT              = 5,
  /** The CMV's engine powers up or shuts down. */
  ENGINE_POWER              = 6,
  /** A malfunction or data-diagnostic event is logged or cleared. */
  MALFUNCTION_DIAGNOSTIC    = 7,
}

export const ELD_EVENT_TYPE_DESCRIPTIONS: Record<ELDEventType, string> = {
  [ELDEventType.DUTY_STATUS_CHANGE]:      'Change in driver\'s duty-status',
  [ELDEventType.INTERMEDIATE_LOG]:        'Intermediate log (auto, ≤60 min while driving)',
  [ELDEventType.PERSONAL_USE_YARD_MOVES]: 'Change in driver\'s indication of authorized personal use / yard moves',
  [ELDEventType.CERTIFICATION]:           'Driver\'s certification / re-certification of records',
  [ELDEventType.LOGIN_LOGOUT]:            'Driver login / logout activity',
  [ELDEventType.ENGINE_POWER]:            'CMV engine power-up / shut-down',
  [ELDEventType.MALFUNCTION_DIAGNOSTIC]:  'ELD malfunction / data-diagnostic event',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.2  DUTY-STATUS SUB-TYPE CODES  (EventType = 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four FMCSA-defined duty statuses a driver may be in at any moment.
 * Used as the event sub-type when EventType = DUTY_STATUS_CHANGE (1).
 */
export enum DutyStatus {
  OFF_DUTY          = 1,
  SLEEPER_BERTH     = 2,
  DRIVING           = 3,
  ON_DUTY_NOT_DRIVING = 4,
}

export const DUTY_STATUS_DESCRIPTIONS: Record<DutyStatus, string> = {
  [DutyStatus.OFF_DUTY]:           'Off Duty',
  [DutyStatus.SLEEPER_BERTH]:      'Sleeper Berth',
  [DutyStatus.DRIVING]:            'Driving',
  [DutyStatus.ON_DUTY_NOT_DRIVING]:'On-Duty Not Driving',
};

/** Abbreviated labels used on the 24-hour HOS graph grid (driver logs). */
export const DUTY_STATUS_ABBREVIATIONS: Record<DutyStatus, string> = {
  [DutyStatus.OFF_DUTY]:           'OFF',
  [DutyStatus.SLEEPER_BERTH]:      'SB',
  [DutyStatus.DRIVING]:            'D',
  [DutyStatus.ON_DUTY_NOT_DRIVING]:'ON',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.3  INTERMEDIATE-LOG SUB-TYPE CODES  (EventType = 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indicates the precision of coordinates available when the intermediate log
 * was recorded.
 */
export enum IntermediateLogSubType {
  /** Latitude/longitude with conventional precision (within 1 mile). */
  CONVENTIONAL_PRECISION = 1,
  /** Latitude/longitude with reduced precision (within 10 miles). */
  REDUCED_PRECISION      = 2,
}

export const INTERMEDIATE_LOG_SUB_TYPE_DESCRIPTIONS: Record<IntermediateLogSubType, string> = {
  [IntermediateLogSubType.CONVENTIONAL_PRECISION]: 'Intermediate log – conventional location precision',
  [IntermediateLogSubType.REDUCED_PRECISION]:      'Intermediate log – reduced location precision',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.4  PERSONAL-USE / YARD-MOVES SUB-TYPE CODES  (EventType = 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a carrier authorizes it, a driver may mark periods as Personal Use
 * (§395.1(e)(1)) or Yard Moves (§395.1(k)), which relaxes certain ELD logging
 * requirements. These sub-types record the start/end of those indications.
 */
export enum PersonalUseYardMovesSubType {
  /** Driver clears the "Authorized Personal Use of CMV" indication (begins). */
  PERSONAL_USE_CLEAR  = 1,
  /** Driver cancels the "Authorized Personal Use of CMV" indication (ends). */
  PERSONAL_USE_CANCEL = 2,
  /** Driver clears the "Yard Moves" indication (begins). */
  YARD_MOVES_CLEAR    = 3,
  /** Driver cancels the "Yard Moves" indication (ends). */
  YARD_MOVES_CANCEL   = 4,
}

export const PERSONAL_USE_YARD_MOVES_DESCRIPTIONS: Record<PersonalUseYardMovesSubType, string> = {
  [PersonalUseYardMovesSubType.PERSONAL_USE_CLEAR]:  'Authorized personal use of CMV — indication set',
  [PersonalUseYardMovesSubType.PERSONAL_USE_CANCEL]: 'Authorized personal use of CMV — indication cleared',
  [PersonalUseYardMovesSubType.YARD_MOVES_CLEAR]:    'Yard moves — indication set',
  [PersonalUseYardMovesSubType.YARD_MOVES_CANCEL]:   'Yard moves — indication cleared',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.5  CERTIFICATION SUB-TYPE CODES  (EventType = 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A driver must certify their records at the end of each 24-hour period.
 * A team driver may also certify on behalf of a co-driver.
 */
export enum CertificationSubType {
  /** Driver certifies their own records. */
  OWN_RECORDS      = 1,
  /** Driver certifies the records for a co-driver. */
  CO_DRIVER_RECORDS = 2,
}

export const CERTIFICATION_SUB_TYPE_DESCRIPTIONS: Record<CertificationSubType, string> = {
  [CertificationSubType.OWN_RECORDS]:       'Certification of own records',
  [CertificationSubType.CO_DRIVER_RECORDS]: 'Certification of co-driver\'s records',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.6  LOGIN / LOGOUT SUB-TYPE CODES  (EventType = 5)
// ─────────────────────────────────────────────────────────────────────────────

export enum LoginLogoutSubType {
  /** Driver successfully authenticated to the ELD. */
  DRIVER_LOGIN  = 1,
  /** Driver logged out of the ELD. */
  DRIVER_LOGOUT = 2,
}

export const LOGIN_LOGOUT_SUB_TYPE_DESCRIPTIONS: Record<LoginLogoutSubType, string> = {
  [LoginLogoutSubType.DRIVER_LOGIN]:  'Driver login (authentication)',
  [LoginLogoutSubType.DRIVER_LOGOUT]: 'Driver logout',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.7  ENGINE POWER SUB-TYPE CODES  (EventType = 6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distinguishes between power-up and shut-down, and whether the ELD had a
 * valid GPS fix (conventional) or not (reduced precision).
 */
export enum EnginePowerSubType {
  /** Engine power-up; coordinates within 1 mile (conventional precision). */
  POWER_UP_CONVENTIONAL       = 1,
  /** Engine power-up; coordinates within 10 miles (reduced precision / no GPS fix). */
  POWER_UP_REDUCED_PRECISION  = 2,
  /** Engine shut-down; coordinates within 1 mile (conventional precision). */
  SHUT_DOWN_CONVENTIONAL      = 3,
  /** Engine shut-down; coordinates within 10 miles (reduced precision / no GPS fix). */
  SHUT_DOWN_REDUCED_PRECISION = 4,
}

export const ENGINE_POWER_SUB_TYPE_DESCRIPTIONS: Record<EnginePowerSubType, string> = {
  [EnginePowerSubType.POWER_UP_CONVENTIONAL]:       'Engine power-up – conventional location precision',
  [EnginePowerSubType.POWER_UP_REDUCED_PRECISION]:  'Engine power-up – reduced location precision',
  [EnginePowerSubType.SHUT_DOWN_CONVENTIONAL]:      'Engine shut-down – conventional location precision',
  [EnginePowerSubType.SHUT_DOWN_REDUCED_PRECISION]: 'Engine shut-down – reduced location precision',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.5.1.8  MALFUNCTION & DIAGNOSTIC SUB-TYPE CODES  (EventType = 7)
// ─────────────────────────────────────────────────────────────────────────────

export enum MalfunctionDiagnosticSubType {
  /** A malfunction condition was detected and is now active. */
  MALFUNCTION_LOGGED   = 1,
  /** A previously active malfunction condition has been resolved. */
  MALFUNCTION_CLEARED  = 2,
  /** A data-diagnostic condition was detected and is now active. */
  DIAGNOSTIC_LOGGED    = 3,
  /** A previously active data-diagnostic condition has been resolved. */
  DIAGNOSTIC_CLEARED   = 4,
}

export const MALFUNCTION_DIAGNOSTIC_SUB_TYPE_DESCRIPTIONS: Record<MalfunctionDiagnosticSubType, string> = {
  [MalfunctionDiagnosticSubType.MALFUNCTION_LOGGED]:  'Malfunction logged (active)',
  [MalfunctionDiagnosticSubType.MALFUNCTION_CLEARED]: 'Malfunction cleared (resolved)',
  [MalfunctionDiagnosticSubType.DIAGNOSTIC_LOGGED]:   'Data-diagnostic logged (active)',
  [MalfunctionDiagnosticSubType.DIAGNOSTIC_CLEARED]:  'Data-diagnostic cleared (resolved)',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.6.1  EVENT RECORD STATUS CODES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every ELD event carries a record-status that tracks whether it is the
 * current authoritative record or has been superseded by an edit.
 */
export enum ELDEventRecordStatus {
  /** The record is the current, accepted entry. */
  ACTIVE                           = 1,
  /** The record was edited; this entry is no longer active. */
  INACTIVE_CHANGED                 = 2,
  /** A change to this record has been proposed but not yet accepted. */
  INACTIVE_CHANGE_REQUESTED        = 3,
  /** The record was assumed from the unidentified driver profile. */
  INACTIVE_ASSUMED_FROM_UNIDENTIFIED = 4,
}

export const EVENT_RECORD_STATUS_DESCRIPTIONS: Record<ELDEventRecordStatus, string> = {
  [ELDEventRecordStatus.ACTIVE]:                           'Active',
  [ELDEventRecordStatus.INACTIVE_CHANGED]:                 'Inactive – changed',
  [ELDEventRecordStatus.INACTIVE_CHANGE_REQUESTED]:        'Inactive – change requested',
  [ELDEventRecordStatus.INACTIVE_ASSUMED_FROM_UNIDENTIFIED]:'Inactive – assumed from unidentified driver',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.6.2  EVENT RECORD ORIGIN CODES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifies who or what created the event record, supporting auditing and
 * falsification detection.
 */
export enum ELDEventOrigin {
  /** Automatically recorded by the ELD (no human input). */
  AUTO_RECORDED          = 1,
  /** Entered or edited by the authenticated driver. */
  DRIVER_EDIT            = 2,
  /** Edited by another authenticated user (e.g. fleet manager, co-driver). */
  OTHER_USER_EDIT        = 3,
  /** Assumed from the unidentified driver profile (no driver logged in). */
  UNIDENTIFIED_DRIVER    = 4,
}

export const EVENT_ORIGIN_DESCRIPTIONS: Record<ELDEventOrigin, string> = {
  [ELDEventOrigin.AUTO_RECORDED]:       'Automatically recorded by ELD',
  [ELDEventOrigin.DRIVER_EDIT]:         'Edited or entered by the driver',
  [ELDEventOrigin.OTHER_USER_EDIT]:     'Edited by another authenticated user',
  [ELDEventOrigin.UNIDENTIFIED_DRIVER]: 'Assumed from unidentified driver profile',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.6.3  MALFUNCTION CODES  (used with EventType = 7, sub-type 1 or 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eight FMCSA-defined malfunction conditions that an ELD must detect and report.
 * When any of these is active the driver must revert to paper logs within
 * 8 days (49 CFR §395.34).
 */
export enum ELDMalfunctionCode {
  /** Power data — ELD failed to monitor or record engine power state. */
  POWER             = 'P',
  /** Engine synchronization — ELD lost synchronization with the ECM. */
  ENGINE_SYNC       = 'E',
  /** Timing — internal clock deviates more than 10 minutes from UTC. */
  TIMING            = 'T',
  /** Positioning (GPS) — ELD cannot acquire a valid position for > 60 min. */
  POSITIONING       = 'L',
  /** Data recording — internal storage failure prevents recording events. */
  DATA_RECORDING    = 'R',
  /** Data transfer — all required transfer methods (BT, USB, web) are unavailable. */
  DATA_TRANSFER     = 'S',
  /** Other ELD-detected malfunction not covered by P, E, T, L, R, or S. */
  OTHER             = 'O',
}

export const MALFUNCTION_CODE_DESCRIPTIONS: Record<ELDMalfunctionCode, string> = {
  [ELDMalfunctionCode.POWER]:          'Power compliance malfunction',
  [ELDMalfunctionCode.ENGINE_SYNC]:    'Engine synchronization compliance malfunction',
  [ELDMalfunctionCode.TIMING]:         'Timing compliance malfunction (clock > 10 min off UTC)',
  [ELDMalfunctionCode.POSITIONING]:    'Positioning compliance malfunction (GPS unavailable > 60 min)',
  [ELDMalfunctionCode.DATA_RECORDING]: 'Data recording compliance malfunction',
  [ELDMalfunctionCode.DATA_TRANSFER]:  'Data transfer compliance malfunction',
  [ELDMalfunctionCode.OTHER]:          'Other ELD-detected malfunction',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4.6.4  DATA-DIAGNOSTIC CODES  (used with EventType = 7, sub-type 3 or 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Six data-diagnostic conditions the ELD must detect.  Unlike malfunctions,
 * diagnostics do not immediately require paper logs, but must be resolved
 * and are included in transferred records.
 */
export enum ELDDiagnosticCode {
  /** Power — unexpected power loss detected (possible tampering). */
  POWER_DATA                 = '1',
  /** Engine synchronization — ECM parameter data unavailable for > 30 min. */
  ENGINE_SYNC_DATA           = '2',
  /** Missing required data elements — a required field is absent in event record. */
  MISSING_REQUIRED_DATA      = '3',
  /** Data transfer — test transfer failed within the required monitoring window. */
  DATA_TRANSFER              = '4',
  /** Unidentified driving — accumulated unidentified driving > 30 min in 24 h. */
  UNIDENTIFIED_DRIVING       = '5',
  /** Other ELD-identified diagnostic condition. */
  OTHER                      = '6',
}

export const DIAGNOSTIC_CODE_DESCRIPTIONS: Record<ELDDiagnosticCode, string> = {
  [ELDDiagnosticCode.POWER_DATA]:            'Power data diagnostic',
  [ELDDiagnosticCode.ENGINE_SYNC_DATA]:      'Engine synchronization data diagnostic',
  [ELDDiagnosticCode.MISSING_REQUIRED_DATA]: 'Missing required data elements diagnostic',
  [ELDDiagnosticCode.DATA_TRANSFER]:         'Data transfer data diagnostic',
  [ELDDiagnosticCode.UNIDENTIFIED_DRIVING]:  'Unidentified driving records diagnostic (> 30 min/24 h)',
  [ELDDiagnosticCode.OTHER]:                 'Other ELD-identified diagnostic',
};

// ─────────────────────────────────────────────────────────────────────────────
// § 7.3  REQUIRED FIELDS — Common + Per Event-Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fields that MUST appear on every ELD event record regardless of type,
 * per the Appendix A field-encoding table.
 */
export interface ELDEventCommonFields {
  /** Sequential number within the current 24-hour log period (1-based, resets at midnight). */
  eventSequenceId: number;
  /** @see ELDEventRecordStatus */
  eventRecordStatus: ELDEventRecordStatus;
  /** @see ELDEventOrigin */
  eventRecordOrigin: ELDEventOrigin;
  /** @see ELDEventType */
  eventType: ELDEventType;
  /** Sub-type code; interpretation depends on eventType. */
  eventSubType: number;
  /** Event date in MMDDYY format (driver's home-terminal timezone). */
  eventDate: string;
  /** Event time in HHMMSS format (UTC). */
  eventTime: string;
  /**
   * Driver's home-terminal UTC offset in ±HHMM format (e.g. "-0600" for CST).
   * Required by Appendix A; determines the log period boundary.
   */
  timezoneOffset: string;
  /** Accumulated vehicle miles at time of event (1-tenth-mile resolution). */
  accumulatedVehicleMiles: number;
  /** Elapsed engine hours at time of event (1-tenth-hour resolution). */
  elapsedEngineHours: number;
  /** WGS-84 latitude, decimal degrees, 6 decimal places. Null when GPS unavailable. */
  latitude: number | null;
  /** WGS-84 longitude, decimal degrees, 6 decimal places. Null when GPS unavailable. */
  longitude: number | null;
  /** Nearest city/state or coordinate-derived location description (≤60 chars). */
  locationDescription: string;
  /**
   * Distance (tenths of a mile) since the last valid GPS coordinates were available.
   * Required (non-null) when latitude/longitude are null (reduced-precision fallback).
   */
  distanceSinceLastValidCoordinates: number | null;
  /**
   * FMCSA-assigned ELD Registration ID (e.g. "PACTRKV1").
   * Appears in every event record and the .erod file header.
   */
  eldRegistrationId: string;
  /** True when the CMV's J1939/OBD malfunction indicator lamp is active. */
  malfunctionIndicatorStatus: boolean;
  /** True when any ELD malfunction (code P–O) is currently active. */
  eldMalfunctionStatus: boolean;
  /** True when any ELD data-diagnostic event (code 1–6) is currently active. */
  dataDiagnosticIndicatorStatus: boolean;
  /**
   * Two-character hex checksum computed over all encoded fields in this record.
   * The algorithm is defined in Appendix A §7.3.2.
   */
  eventDataCheckValue: string;
}

// ── Per-type additional required fields ──────────────────────────────────────

/** Additional fields required when eventType = DUTY_STATUS_CHANGE (1). */
export interface DutyStatusChangeFields {
  /** Overrides base sub-type; must be a valid DutyStatus value. */
  eventSubType: DutyStatus;
  /** City/state description of event location (≤60 chars or lat/lng-derived). */
  locationDescription: string;
  /** Driver's ELD account identifier (username or UUID). */
  driverEldAccountId: string;
  /** Optional free-text annotation supplied by the driver (≤60 chars). */
  annotation?: string;
}

/** Additional fields required when eventType = INTERMEDIATE_LOG (2). */
export interface IntermediateLogFields {
  /** Overrides base sub-type; must be a valid IntermediateLogSubType value. */
  eventSubType: IntermediateLogSubType;
  /** City/state description of current vehicle location. */
  locationDescription: string;
}

/** Additional fields required when eventType = PERSONAL_USE_YARD_MOVES (3). */
export interface PersonalUseYardMovesFields {
  /** Overrides base sub-type; must be a valid PersonalUseYardMovesSubType value. */
  eventSubType: PersonalUseYardMovesSubType;
  /** Location description at time of indication change. */
  locationDescription: string;
  /** Optional driver annotation explaining the indication. */
  annotation?: string;
}

/** Additional fields required when eventType = CERTIFICATION (4). */
export interface CertificationFields {
  /** Overrides base sub-type; must be a valid CertificationSubType value. */
  eventSubType: CertificationSubType;
  /** The 24-hour period being certified, in MMDDYY format. */
  certifiedDate: string;
  /**
   * ELD account ID of the driver whose records are being certified.
   * Matches the certifying driver's own ID for self-certification (sub-type 1),
   * or the co-driver's ID when certifying on their behalf (sub-type 2).
   */
  certifiedDriverEldAccountId: string;
  /**
   * Total number of ELD records (all event types) in the certified period,
   * used as an anti-tampering count.
   */
  totalRecordsCertified: number;
  /**
   * True for the first certification of this period. False when this is a
   * re-certification following a subsequent edit to an already-certified period.
   */
  isCertification: boolean;
  /**
   * Sequence IDs of events that changed since the last certification, which
   * triggered this re-certification. Empty array for initial certifications.
   */
  editedEventSequenceIds?: number[];
}

/** Additional fields required when eventType = LOGIN_LOGOUT (5). */
export interface LoginLogoutFields {
  /** Overrides base sub-type; must be a valid LoginLogoutSubType value. */
  eventSubType: LoginLogoutSubType;
  /** Driver's ELD account identifier. */
  driverEldAccountId: string;
  /** Co-driver's ELD account identifier, if applicable. */
  coDriverEldAccountId?: string;
  /** Motor carrier's USDOT number. */
  carrierDotNumber: string;
}

/** Additional fields required when eventType = ENGINE_POWER (6). */
export interface EnginePowerFields {
  /** Overrides base sub-type; must be a valid EnginePowerSubType value. */
  eventSubType: EnginePowerSubType;
  /** CMV power unit number (identifier displayed on the vehicle). */
  cmvPowerUnitNumber: string;
  /** Last 17 characters of the Vehicle Identification Number. */
  vin: string;
  /**
   * Convenience flag. True for power-up events (sub-type 1 or 2);
   * false for shut-down events (sub-type 3 or 4).
   */
  isPowerUp: boolean;
  /**
   * True when the ELD successfully established ECM synchronisation via
   * J1939 or J1708 at power-up. False triggers the Engine Synchronisation
   * diagnostic code (E) per Appendix A §4.6.4.
   */
  canBusConnected: boolean;
  /** Optional driver annotation (e.g. "pre-trip inspection done"). */
  annotation?: string;
}

/** Additional fields required when eventType = MALFUNCTION_DIAGNOSTIC (7). */
export interface MalfunctionDiagnosticFields {
  /** Overrides base sub-type; must be a valid MalfunctionDiagnosticSubType value. */
  eventSubType: MalfunctionDiagnosticSubType;
  /**
   * True when this event records a malfunction condition (sub-type 1 or 2);
   * false when it records a data-diagnostic condition (sub-type 3 or 4).
   * Determines which code field is populated.
   */
  isMalfunction: boolean;
  /**
   * True when the condition is being logged (active); false when it is being
   * cleared (resolved). Sub-types 1 and 3 = logged; 2 and 4 = cleared.
   */
  isActive: boolean;
  /**
   * One of the 7 FMCSA malfunction codes (P, E, T, L, R, S, O).
   * Required when isMalfunction === true. Must be null for diagnostic events.
   * @see ELDMalfunctionCode
   */
  malfunctionCode: ELDMalfunctionCode | null;
  /**
   * One of the 6 FMCSA data-diagnostic codes (1–6).
   * Required when isMalfunction === false. Must be null for malfunction events.
   * @see ELDDiagnosticCode
   */
  diagnosticCode: ELDDiagnosticCode | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCRIMINATED UNION — Fully-typed ELD event records
// ─────────────────────────────────────────────────────────────────────────────

export type DutyStatusChangeEvent       = ELDEventCommonFields & DutyStatusChangeFields       & { eventType: ELDEventType.DUTY_STATUS_CHANGE };
export type IntermediateLogEvent        = ELDEventCommonFields & IntermediateLogFields        & { eventType: ELDEventType.INTERMEDIATE_LOG };
export type PersonalUseYardMovesEvent   = ELDEventCommonFields & PersonalUseYardMovesFields   & { eventType: ELDEventType.PERSONAL_USE_YARD_MOVES };
export type CertificationEvent          = ELDEventCommonFields & CertificationFields          & { eventType: ELDEventType.CERTIFICATION };
export type LoginLogoutEvent            = ELDEventCommonFields & LoginLogoutFields            & { eventType: ELDEventType.LOGIN_LOGOUT };
export type EnginePowerEvent            = ELDEventCommonFields & EnginePowerFields            & { eventType: ELDEventType.ENGINE_POWER };
export type MalfunctionDiagnosticEvent  = ELDEventCommonFields & MalfunctionDiagnosticFields  & { eventType: ELDEventType.MALFUNCTION_DIAGNOSTIC };

/** Union of all fully-typed ELD event records. Use the `eventType` discriminant to narrow. */
export type ELDEvent =
  | DutyStatusChangeEvent
  | IntermediateLogEvent
  | PersonalUseYardMovesEvent
  | CertificationEvent
  | LoginLogoutEvent
  | EnginePowerEvent
  | MalfunctionDiagnosticEvent;

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the human-readable description for any ELD event type code.
 * Safe to use in UI labels and log output.
 */
export function describeEventType(type: ELDEventType): string {
  return ELD_EVENT_TYPE_DESCRIPTIONS[type] ?? `Unknown event type (${type})`;
}

/**
 * Returns the human-readable description for a duty status code.
 */
export function describeDutyStatus(status: DutyStatus): string {
  return DUTY_STATUS_DESCRIPTIONS[status] ?? `Unknown duty status (${status})`;
}

/**
 * Returns the abbreviated duty-status label (OFF, SB, D, ON) used on log grids.
 */
export function abbreviateDutyStatus(status: DutyStatus): string {
  return DUTY_STATUS_ABBREVIATIONS[status] ?? '??';
}

/**
 * Returns the human-readable description for a malfunction or diagnostic code.
 * Accepts both ELDMalfunctionCode (letters) and ELDDiagnosticCode (digits).
 */
export function describeMalfunctionOrDiagnostic(
  code: ELDMalfunctionCode | ELDDiagnosticCode,
): string {
  if (code in MALFUNCTION_CODE_DESCRIPTIONS) {
    return MALFUNCTION_CODE_DESCRIPTIONS[code as ELDMalfunctionCode];
  }
  if (code in DIAGNOSTIC_CODE_DESCRIPTIONS) {
    return DIAGNOSTIC_CODE_DESCRIPTIONS[code as ELDDiagnosticCode];
  }
  return `Unknown malfunction/diagnostic code (${code})`;
}

/**
 * Returns true when an engine power sub-type represents a power-up event.
 */
export function isEnginePowerUp(subType: EnginePowerSubType): boolean {
  return subType === EnginePowerSubType.POWER_UP_CONVENTIONAL ||
         subType === EnginePowerSubType.POWER_UP_REDUCED_PRECISION;
}

/**
 * Returns true when a malfunction/diagnostic sub-type represents a logged
 * (active) condition rather than a cleared one.
 */
export function isMalfunctionOrDiagnosticActive(
  subType: MalfunctionDiagnosticSubType,
): boolean {
  return subType === MalfunctionDiagnosticSubType.MALFUNCTION_LOGGED ||
         subType === MalfunctionDiagnosticSubType.DIAGNOSTIC_LOGGED;
}
