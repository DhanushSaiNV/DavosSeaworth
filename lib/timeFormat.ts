// lib/timeFormat.ts
// Single canonical 24-hour time formatter used everywhere (PRD Step 0, A.2, AU43).
// Guarantees consistent 24-hour HH:MM format across messages, system lines, panel, ledger, Oath.

/**
 * Formats a Date, ISO timestamp string, epoch milliseconds, or "HH:MM" string into strict 24-hour "HH:MM".
 * Defaults to current time when invoked without arguments.
 */
export function format24Hour(value: Date | string | number = new Date()): string {
  if (typeof value === 'string') {
    const match12 = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = match12[2];
      const meridiem = match12[3].toUpperCase();
      if (meridiem === 'PM' && h < 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${m}`;
    }

    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) {
      const h = match[1].padStart(2, '0');
      const m = match[2];
      return `${h}:${m}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) {
    return '00:00';
  }

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
