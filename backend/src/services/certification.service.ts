/**
 * Certification Service
 *
 * Business logic for driver log certification (EventType 4).
 */

import { supabase } from '../config/supabase';
import { NotFoundError, ValidationError } from '../models/errors/api-error';
import { ingestEvent } from './event-ingestion.service';
import type { CertifyLogRequest, CertifyLogResponse } from '../models/dtos/certification.dto';
import { logger } from '../utils/logger';

/**
 * Certify a driver's log for a specific date
 * Creates EventType 4 and updates log_periods status
 */
export async function certifyDriverLog(
  request: CertifyLogRequest,
  actorUserId: string
): Promise<CertifyLogResponse> {
  const { driver_id, certified_log_date, certification_type, certified_driver_id, annotation } =
    request;

  // 1. Validate certification constraints
  const certDate = parseDateMMDDYY(certified_log_date);
  const today = new Date();

  // Rule: Cannot certify future dates
  if (certDate > today) {
    logger.warn('Attempt to certify future date', { certified_log_date });
    throw new ValidationError('Cannot certify future log dates');
  }

  // Rule: Cannot certify dates older than 13 days (FMCSA requirement)
  const daysDiff = Math.floor((today.getTime() - certDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff > 13) {
    logger.warn('Attempt to certify log older than 13 days', { certified_log_date, daysDiff });
    throw new ValidationError('Cannot certify logs older than 13 days');
  }

  // 2. Get driver info
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, carrier_id, driver_eld_account_id, full_name')
    .eq('id', driver_id)
    .single();

  if (driverError || !driver) {
    logger.warn('Driver not found for certification', { driver_id });
    throw new NotFoundError('Driver');
  }

  // 3. Get log period to certify
  const targetDriverId =
    certification_type === 'own_records' ? driver_id : certified_driver_id || driver_id;

  const { data: logPeriod, error: periodError } = await supabase
    .from('log_periods')
    .select('id, status, total_event_count, certified_at')
    .eq('driver_id', targetDriverId)
    .eq('log_date_mmddyy', certified_log_date)
    .single();

  if (periodError || !logPeriod) {
    logger.warn('Log period not found for certification', {
      driver_id: targetDriverId,
      certified_log_date,
    });
    throw new NotFoundError('Log period for specified date');
  }

  // Determine if this is a re-certification
  const isRecertification =
    logPeriod.status === 'certified' || logPeriod.status === 'recertified';

  // 4. Get edited events if re-certification
  let editedEventSequenceIds: number[] = [];
  if (isRecertification && logPeriod.certified_at) {
    const { data: editedEvents } = await supabase
      .from('eld_events')
      .select('event_sequence_id')
      .eq('log_period_id', logPeriod.id)
      .gt('created_at', logPeriod.certified_at)
      .order('event_sequence_id', { ascending: true });

    editedEventSequenceIds = editedEvents?.map((e) => e.event_sequence_id) || [];
    logger.debug('Found edited events for re-certification', {
      count: editedEventSequenceIds.length,
    });
  }

  // 5. Get ELD device for event creation
  const { data: recentEvent } = await supabase
    .from('eld_events')
    .select('eld_device_id')
    .eq('log_period_id', logPeriod.id)
    .order('event_sequence_id', { ascending: false })
    .limit(1)
    .single();

  if (!recentEvent) {
    logger.warn('No events found in log period to certify', { logPeriodId: logPeriod.id });
    throw new ValidationError('No events found in log period to certify');
  }

  // 6. Create EventType 4 (Certification) event
  const now = new Date();
  const eventDate = formatDateMMDDYY(now);
  const eventTime = formatTimeHHMMSS(now);
  const timezoneOffset = getTimezoneOffset(now);

  logger.info('Creating certification event', {
    driverId: driver_id,
    certifiedLogDate: certified_log_date,
    isRecertification,
  });

  const eventResult = await ingestEvent({
    eventType: 4,
    eventSubType: certification_type === 'own_records' ? 1 : 2,
    eventRecordStatus: 1,
    eventRecordOrigin: 2, // Driver action
    eventDate,
    eventTime,
    timezoneOffset,
    eldDeviceId: recentEvent.eld_device_id,
    driverEldAccountId: driver.driver_eld_account_id,
    carrierDotNumber: driver.carrier_id,
    metadata: {
      certifiedDate: certified_log_date,
      certifiedDriverEldAccountId: driver.driver_eld_account_id,
      totalRecordsCertified: logPeriod.total_event_count,
      isCertification: !isRecertification,
      editedEventSequenceIds: editedEventSequenceIds,
      annotation: annotation || null,
    },
    actor: {
      userId: actorUserId,
      deviceId: recentEvent.eld_device_id,
      source: 'api' as const,
    } as any, // Type cast - event-ingestion.service has type mismatches
  });

  logger.info('Certification event created', {
    eventId: eventResult.eventId,
    sequenceId: eventResult.sequenceId,
  });

  // 7. Create certification record
  const { data: certification, error: certError } = await supabase
    .from('certifications')
    .insert({
      carrier_id: driver.carrier_id,
      source_eld_event_id: eventResult.eventId,
      log_period_id: logPeriod.id,
      certifying_driver_id: driver_id,
      certified_driver_id: targetDriverId,
      certification_type,
      certified_log_date,
      total_records_certified: logPeriod.total_event_count,
      is_recertification: isRecertification,
      performed_at: now.toISOString(),
    })
    .select()
    .single();

  if (certError) {
    logger.error('Failed to create certification record', { error: certError });
    throw new ValidationError('Failed to create certification record');
  }

  // 8. Update log_period status
  const newStatus = isRecertification ? 'recertified' : 'certified';
  const { data: updatedPeriod, error: updateError } = await supabase
    .from('log_periods')
    .update({
      status: newStatus,
      certified_at: now.toISOString(),
      ...(isRecertification && { recertified_at: now.toISOString() }),
    })
    .eq('id', logPeriod.id)
    .select()
    .single();

  if (updateError) {
    logger.error('Failed to update log period status', { error: updateError });
    throw new ValidationError('Failed to update log period status');
  }

  logger.info('Log period certified successfully', {
    logPeriodId: logPeriod.id,
    status: newStatus,
  });

  // 9. Return response
  return {
    certification: {
      id: certification.id,
      certification_type: certification.certification_type,
      certified_log_date: certification.certified_log_date,
      is_recertification: certification.is_recertification,
      total_records_certified: certification.total_records_certified,
      performed_at: certification.performed_at,
    },
    eld_event: {
      id: eventResult.eventId,
      event_sequence_id: eventResult.sequenceId,
      event_timestamp: now.toISOString(),
    },
    log_period: {
      id: updatedPeriod.id,
      status: updatedPeriod.status,
      certified_at: updatedPeriod.certified_at,
    },
  };
}

// Helper functions

function parseDateMMDDYY(dateStr: string): Date {
  const month = parseInt(dateStr.substring(0, 2), 10) - 1;
  const day = parseInt(dateStr.substring(2, 4), 10);
  const year = 2000 + parseInt(dateStr.substring(4, 6), 10);
  return new Date(year, month, day);
}

function formatDateMMDDYY(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).substring(2);
  return `${month}${day}${year}`;
}

function formatTimeHHMMSS(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

function getTimezoneOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${sign}${hours}${minutes}`;
}
