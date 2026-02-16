/**
 * JSON Schema Draft 7 definitions for all FMCSA ELD event types.
 *
 * Each schema can be used with any Draft-7-compatible validator
 * (Ajv, jsonschema, etc.) for runtime validation of ELD event payloads.
 *
 * Usage:
 *   import { schemas, ELDEventSchemas } from '@cruzonic/shared/eld/json-schemas';
 *   import Ajv from 'ajv';
 *   const ajv = new Ajv();
 *   const validate = ajv.compile(schemas.dutyStatusChange);
 *   const valid = validate(myEvent);
 */

// Import all schema JSON files as plain objects.
// TypeScript resolves these when "resolveJsonModule": true is set in tsconfig.
import commonSchema              from './_common.schema.json';
import dutyStatusChangeSchema    from './duty-status-change.schema.json';
import intermediateLogSchema     from './intermediate-log.schema.json';
import personalUseYardMovesSchema from './personal-use-yard-moves.schema.json';
import certificationSchema       from './certification.schema.json';
import loginLogoutSchema         from './login-logout.schema.json';
import enginePowerSchema         from './engine-power.schema.json';
import malfunctionDiagnosticSchema from './malfunction-diagnostic.schema.json';

export {
  commonSchema,
  dutyStatusChangeSchema,
  intermediateLogSchema,
  personalUseYardMovesSchema,
  certificationSchema,
  loginLogoutSchema,
  enginePowerSchema,
  malfunctionDiagnosticSchema,
};

/**
 * Convenience map: keyed by ELDEventType numeric code (1–7).
 * Pass any eventType integer to retrieve the corresponding JSON Schema object.
 *
 * @example
 *   const schema = ELD_EVENT_SCHEMAS_BY_TYPE[event.eventType];
 *   const valid = ajv.validate(schema, event);
 */
export const ELD_EVENT_SCHEMAS_BY_TYPE: Record<number, object> = {
  1: dutyStatusChangeSchema,
  2: intermediateLogSchema,
  3: personalUseYardMovesSchema,
  4: certificationSchema,
  5: loginLogoutSchema,
  6: enginePowerSchema,
  7: malfunctionDiagnosticSchema,
};

/** Tuple of all event-type schema objects, suitable for bulk Ajv.addSchema() calls. */
export const ELD_EVENT_SCHEMA_LIST = [
  dutyStatusChangeSchema,
  intermediateLogSchema,
  personalUseYardMovesSchema,
  certificationSchema,
  loginLogoutSchema,
  enginePowerSchema,
  malfunctionDiagnosticSchema,
] as const;
