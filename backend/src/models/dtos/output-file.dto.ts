/**
 * Output File DTOs
 *
 * Request/response types for FMCSA output file (EROD) endpoints.
 */

import { z } from 'zod';

/**
 * Route params validation for GET /output-file/:recordId
 */
export const OutputFileParamsSchema = z.object({
  recordId: z.string().uuid('Invalid record ID'),
});

export type OutputFileParams = z.infer<typeof OutputFileParamsSchema>;

/**
 * Request schema for POST /output-file/generate
 */
export const GenerateOutputFileRequestSchema = z.object({
  driver_id: z.string().uuid('Invalid driver ID'),
  log_date: z.string().regex(/^\d{6}$/, 'Invalid date format (MMDDYY)'),
  format: z.enum(['json', 'pdf', 'both']).default('json'),
  include_metadata: z.boolean().default(true),
});

export type GenerateOutputFileRequest = z.infer<typeof GenerateOutputFileRequestSchema>;

/**
 * Output File Response
 */
export interface OutputFileResponse {
  record_id: string;
  file_version: string;
  erod_storage_path: string | null;
  pdf_storage_path: string | null;
  file_size_bytes: number;
  total_event_count: number;
  content_sha256: string;
  generated_at: string;
  download_url?: string;
}

/**
 * FMCSA Output File Structure (JSON format)
 */
export interface FMCSAOutputFile {
  ELDRegistrationId: string;
  FileVersionNumber: string; // "1.1.0"
  GeneratedDateTime: string;
  CarrierInformation: {
    DOTNumber: string;
    LegalName: string;
    Address: string;
  };
  DriverInformation: {
    DriverEldAccountId: string;
    LicenseNumber: string;
    LicenseState: string;
  };
  EventRecords: Array<{
    EventSequenceIdNumber: number;
    EventRecordStatus: number;
    EventRecordOrigin: number;
    EventType: number;
    EventCode: number;
    EventDate: string;
    EventTime: string;
    AccumulatedVehicleMiles: string;
    ElapsedEngineHours: string;
    EventLatitude: string | null;
    EventLongitude: string | null;
    LocationDescription: string | null;
  }>;
  CertificationRecords?: Array<{
    CertificationDate: string;
    CertifiedLogDate: string;
    TotalRecordsCertified: number;
    IsRecertification: boolean;
  }>;
}
