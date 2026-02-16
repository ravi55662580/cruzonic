import { supabase } from '../config/supabase';

/**
 * Allocates the next sequence ID for a given ELD device and log date.
 * Implements FMCSA sequence ID rules: 1-65535, monotonically increasing per device per day.
 */
export async function allocateSequenceId(
  eldDeviceId: string,
  logDate: string
): Promise<number> {
  // Use Supabase RPC to atomically allocate next sequence ID
  const { data, error } = await supabase.rpc('allocate_next_sequence_id', {
    p_eld_device_id: eldDeviceId,
    p_log_date: logDate,
  });

  if (error) {
    throw new Error(`Failed to allocate sequence ID: ${error.message}`);
  }

  if (!data || data < 1 || data > 65535) {
    throw new Error(`Invalid sequence ID allocated: ${data}`);
  }

  return data;
}

/**
 * Validates that a sequence ID is within FMCSA range and not already used.
 */
export async function validateSequenceId(
  eldDeviceId: string,
  logDate: string,
  sequenceId: number
): Promise<{ valid: boolean; reason?: string }> {
  // Check range
  if (sequenceId < 1 || sequenceId > 65535) {
    return {
      valid: false,
      reason: `Sequence ID ${sequenceId} out of FMCSA range (1-65535)`,
    };
  }

  // Check for duplicates
  const { data: existingEvent, error } = await supabase
    .from('eld_events')
    .select('id')
    .eq('eld_device_id', eldDeviceId)
    .eq('log_date', logDate)
    .eq('event_sequence_id', sequenceId)
    .eq('event_record_status', 1) // Active events only
    .maybeSingle();

  if (error) {
    throw new Error(`Sequence validation query failed: ${error.message}`);
  }

  if (existingEvent) {
    return {
      valid: false,
      reason: `Sequence ID ${sequenceId} already exists for device ${eldDeviceId} on ${logDate}`,
    };
  }

  return { valid: true };
}

/**
 * Detects gaps in sequence IDs for a given device and log date.
 * Returns array of missing sequence IDs.
 */
export async function detectSequenceGaps(
  eldDeviceId: string,
  logDate: string
): Promise<number[]> {
  const { data: events, error } = await supabase
    .from('eld_events')
    .select('event_sequence_id')
    .eq('eld_device_id', eldDeviceId)
    .eq('log_date', logDate)
    .eq('event_record_status', 1)
    .order('event_sequence_id', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch events for gap detection: ${error.message}`);
  }

  if (!events || events.length === 0) {
    return [];
  }

  const sequenceIds = events.map((e) => e.event_sequence_id).sort((a, b) => a - b);
  const gaps: number[] = [];
  const maxSeq = sequenceIds[sequenceIds.length - 1];

  for (let i = 1; i <= maxSeq; i++) {
    if (!sequenceIds.includes(i)) {
      gaps.push(i);
    }
  }

  return gaps;
}
