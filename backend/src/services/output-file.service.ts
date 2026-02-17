/**
 * Output File Service
 *
 * Business logic for FMCSA output file (EROD) generation and retrieval.
 */

import { createHash } from 'crypto';
import { supabase } from '../config/supabase';
import { NotFoundError, ValidationError } from '../models/errors/api-error';
import { exportEventsForFMCSA } from '../queries/optimized-queries';
import type {
  GenerateOutputFileRequest,
  OutputFileResponse,
  FMCSAOutputFile,
} from '../models/dtos/output-file.dto';
import { logger } from '../utils/logger';

/**
 * Generate a new FMCSA output file (EROD)
 */
export async function generateOutputFile(
  request: GenerateOutputFileRequest,
  generatedByUserId: string
): Promise<OutputFileResponse> {
  const { driver_id, log_date, include_metadata } = request;

  // 1. Get driver and carrier information
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select(
      `
      id,
      carrier_id,
      driver_eld_account_id,
      license_number,
      license_state,
      full_name,
      carrier:carriers!inner (
        dot_number,
        legal_name,
        address_line1,
        city,
        state,
        zip
      )
    `
    )
    .eq('id', driver_id)
    .single();

  if (driverError || !driver) {
    logger.warn('Driver not found for output file generation', { driver_id });
    throw new NotFoundError('Driver');
  }

  const carrier = Array.isArray(driver.carrier) ? driver.carrier[0] : driver.carrier;

  // 2. Get log period
  const { data: logPeriod, error: periodError } = await supabase
    .from('log_periods')
    .select('id, status, certified_at')
    .eq('driver_id', driver_id)
    .eq('log_date_mmddyy', log_date)
    .single();

  if (periodError || !logPeriod) {
    logger.warn('Log period not found', { driver_id, log_date });
    throw new NotFoundError('Log period');
  }

  // 3. Get ELD device information
  const { data: eldDevice, error: deviceError } = await supabase
    .from('eld_devices')
    .select('id, eld_registration_id, manufacturer, model')
    .eq('carrier_id', driver.carrier_id)
    .limit(1)
    .maybeSingle();

  if (deviceError) {
    logger.error('Failed to get ELD device', { error: deviceError });
  }

  // 4. Export events in FMCSA format (reuse optimized query)
  const { data: events, error: eventsError } = await exportEventsForFMCSA(
    supabase,
    driver_id,
    log_date
  );

  if (eventsError || !events || events.length === 0) {
    logger.warn('No events found for export', { driver_id, log_date });
    throw new ValidationError('No events found for the specified log date');
  }

  // 5. Get certifications if requested
  let certificationRecords = undefined;
  if (include_metadata) {
    const { data: certs } = await supabase
      .from('certifications')
      .select(
        `
        performed_at,
        certified_log_date,
        total_records_certified,
        is_recertification
      `
      )
      .eq('log_period_id', logPeriod.id)
      .order('performed_at', { ascending: true });

    certificationRecords = certs?.map((c) => ({
      CertificationDate: c.performed_at,
      CertifiedLogDate: c.certified_log_date,
      TotalRecordsCertified: c.total_records_certified,
      IsRecertification: c.is_recertification,
    }));
  }

  // 6. Build FMCSA output file structure (EROD JSON format)
  const outputFile: FMCSAOutputFile = {
    ELDRegistrationId: eldDevice?.eld_registration_id || 'UNKNOWN',
    FileVersionNumber: '1.1.0',
    GeneratedDateTime: new Date().toISOString(),
    CarrierInformation: {
      DOTNumber: carrier.dot_number,
      LegalName: carrier.legal_name,
      Address: `${carrier.address_line1}, ${carrier.city}, ${carrier.state} ${carrier.zip}`,
    },
    DriverInformation: {
      DriverEldAccountId: driver.driver_eld_account_id,
      LicenseNumber: driver.license_number,
      LicenseState: driver.license_state,
    },
    EventRecords: events.map((e) => ({
      EventSequenceIdNumber: e.EventSequenceIdNumber,
      EventRecordStatus: e.EventRecordStatus,
      EventRecordOrigin: e.EventRecordOrigin,
      EventType: e.EventType,
      EventCode: e.EventCode,
      EventDate: e.EventDate,
      EventTime: e.EventTime,
      AccumulatedVehicleMiles: e.AccumulatedVehicleMiles,
      ElapsedEngineHours: e.ElapsedEngineHours,
      EventLatitude: e.EventLatitude,
      EventLongitude: e.EventLongitude,
      LocationDescription: null,
    })),
    ...(certificationRecords && { CertificationRecords: certificationRecords }),
  };

  // 7. Convert to JSON string and calculate SHA256 hash
  const fileContent = JSON.stringify(outputFile, null, 2);
  const contentHash = createHash('sha256').update(fileContent).digest('hex');
  const fileSizeBytes = Buffer.byteLength(fileContent, 'utf8');

  logger.info('FMCSA output file generated', {
    driver_id,
    log_date,
    eventCount: events.length,
    fileSizeBytes,
  });

  // 8. Upload file to Supabase Storage
  const fileName = `erod_${driver.driver_eld_account_id}_${log_date}_${Date.now()}.json`;
  const storagePath = `eld-records/${driver.carrier_id}/${driver_id}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('eld-files')
    .upload(storagePath, fileContent, {
      contentType: 'application/json',
      upsert: false,
    });

  if (uploadError) {
    logger.error('Failed to upload file to storage', { error: uploadError });
    throw new ValidationError(`Failed to upload file: ${uploadError.message}`);
  }

  logger.info('File uploaded to storage', { storagePath });

  // 9. Create ELD record in database
  const { data: eldRecord, error: recordError } = await supabase
    .from('eld_records')
    .insert({
      carrier_id: driver.carrier_id,
      driver_id: driver_id,
      log_period_id: logPeriod.id,
      eld_device_id: eldDevice?.id,
      file_version: '1.1.0',
      erod_storage_path: storagePath,
      pdf_storage_path: null,
      file_size_bytes: fileSizeBytes,
      total_event_count: events.length,
      content_sha256: contentHash,
      carrier_signature: '',
      generated_at: new Date().toISOString(),
      generated_by: generatedByUserId,
    })
    .select()
    .single();

  if (recordError) {
    logger.error('Failed to create ELD record', { error: recordError });
    throw new ValidationError(`Failed to create ELD record: ${recordError.message}`);
  }

  // 10. Generate signed download URL (valid for 1 hour)
  const { data: downloadData, error: urlError } = await supabase.storage
    .from('eld-files')
    .createSignedUrl(storagePath, 3600);

  if (urlError) {
    logger.error('Failed to create signed URL', { error: urlError });
  }

  logger.info('ELD record created successfully', { recordId: eldRecord.id });

  return {
    record_id: eldRecord.id,
    file_version: eldRecord.file_version,
    erod_storage_path: eldRecord.erod_storage_path,
    pdf_storage_path: eldRecord.pdf_storage_path,
    file_size_bytes: eldRecord.file_size_bytes,
    total_event_count: eldRecord.total_event_count,
    content_sha256: eldRecord.content_sha256,
    generated_at: eldRecord.generated_at,
    download_url: downloadData?.signedUrl,
  };
}

/**
 * Get an existing output file record
 */
export async function getOutputFile(recordId: string): Promise<OutputFileResponse> {
  // Fetch existing ELD record
  const { data: eldRecord, error } = await supabase
    .from('eld_records')
    .select('*')
    .eq('id', recordId)
    .single();

  if (error || !eldRecord) {
    logger.warn('ELD record not found', { recordId });
    throw new NotFoundError('ELD record');
  }

  // Generate fresh signed download URL (1 hour expiration)
  const { data: downloadData, error: urlError } = await supabase.storage
    .from('eld-files')
    .createSignedUrl(eldRecord.erod_storage_path, 3600);

  if (urlError) {
    logger.error('Failed to create signed URL', { error: urlError });
  }

  return {
    record_id: eldRecord.id,
    file_version: eldRecord.file_version,
    erod_storage_path: eldRecord.erod_storage_path,
    pdf_storage_path: eldRecord.pdf_storage_path,
    file_size_bytes: eldRecord.file_size_bytes,
    total_event_count: eldRecord.total_event_count,
    content_sha256: eldRecord.content_sha256,
    generated_at: eldRecord.generated_at,
    download_url: downloadData?.signedUrl,
  };
}
