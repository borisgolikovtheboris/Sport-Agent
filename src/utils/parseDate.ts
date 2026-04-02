/**
 * Парсит дату из формата "ДД.ММ ЧЧ:ММ" (год = текущий или следующий).
 * Возвращает Date или null при невалидном вводе.
 */
export function parseDate(input: string): Date | null {
  const match = input.trim().match(/^(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, dayStr, monthStr, hourStr, minStr] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1; // JS months are 0-based
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);

  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (min < 0 || min > 59) return null;

  let year = new Date().getFullYear();
  const candidate = new Date(year, month, day, hour, min);

  if (candidate < new Date()) {
    candidate.setFullYear(year + 1);
  }

  if (
    candidate.getDate() !== day ||
    candidate.getMonth() !== month
  ) {
    return null;
  }

  return candidate;
}
