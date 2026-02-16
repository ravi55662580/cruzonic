/**
 * Formats an ISO date string to a human-readable local date/time.
 * e.g. "2024-06-12T09:00:00Z" → "Jun 12, 2024, 9:00 AM"
 */
export function formatDateTime(iso: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * Returns the duration in minutes between two ISO date strings.
 */
export function durationMinutes(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}
