/**
 * Common Validators
 *
 * Reusable validation functions for common data types.
 */

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate ISO 8601 date string
 */
export function isValidISODate(date: string): boolean {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:\d{2}|Z)$/;
  return isoDateRegex.test(date) && !isNaN(Date.parse(date));
}

/**
 * Validate date range (end date must be after start date)
 */
export function isValidDateRange(startDate: string, endDate: string): boolean {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return end > start;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number (basic US format)
 */
export function isValidPhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?1?\d{10,14}$/;
  return phoneRegex.test(phone.replace(/[\s()-]/g, ''));
}

/**
 * Sanitize string (remove potential XSS characters)
 */
export function sanitizeString(str: string): string {
  return str.replace(/[<>\"'&]/g, (char) => {
    const entities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '&': '&amp;',
    };
    return entities[char] || char;
  });
}

/**
 * Validate MMDDYY date format (ELD standard)
 */
export function isValidMMDDYY(date: string): boolean {
  if (!/^\d{6}$/.test(date)) return false;

  const month = parseInt(date.substring(0, 2), 10);
  const day = parseInt(date.substring(2, 4), 10);
  const year = parseInt(date.substring(4, 6), 10);

  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 0 && year <= 99;
}

/**
 * Convert MMDDYY to ISO date string
 */
export function mmddyyToISO(mmddyy: string): string {
  const month = mmddyy.substring(0, 2);
  const day = mmddyy.substring(2, 4);
  const year = mmddyy.substring(4, 6);

  // Assume 20xx for years 00-49, 19xx for 50-99
  const fullYear = parseInt(year, 10) < 50 ? `20${year}` : `19${year}`;

  return `${fullYear}-${month}-${day}`;
}
