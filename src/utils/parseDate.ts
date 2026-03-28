/**
 * Parses user input like "15.04 19:00" into a Date object.
 * Assumes current year if day/month hasn't passed yet, otherwise next year.
 */
export function parseDate(input: string): Date | null {
  // Accepts: "15.04 19:00" or "15.04.2026 19:00"
  const match = input.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
  const year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
  const hours = parseInt(match[4], 10);
  const minutes = parseInt(match[5], 10);

  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  const date = new Date(year, month, day, hours, minutes, 0, 0);

  // If date is in the past and no year was explicitly given, try next year
  if (!match[3] && date < new Date()) {
    date.setFullYear(date.getFullYear() + 1);
  }

  return isNaN(date.getTime()) ? null : date;
}
