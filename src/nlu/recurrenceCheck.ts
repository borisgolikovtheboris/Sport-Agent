const WEEKDAY_PATTERN = /понедельник|вторник|сред[уа]|четверг|пятниц[уа]|суббот[уа]|воскресень[е]/i;
const SPECIFIC_DATE_PATTERN = /\d{1,2}[\.\s]?(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря|\d{2})/i;
const RELATIVE_DATE_PATTERN = /завтра|послезавтра|сегодня/i;

export function shouldAskRecurrence(
  rawText: string,
  entities: { recurrence?: { days: string[] } | null }
): boolean {
  // Already has recurrence → no
  if (entities.recurrence && entities.recurrence.days?.length > 0) return false;

  // Has specific date (15.04, 3 мая) → clearly one-time
  if (SPECIFIC_DATE_PATTERN.test(rawText)) return false;

  // Has relative date (завтра, сегодня) → one-time
  if (RELATIVE_DATE_PATTERN.test(rawText)) return false;

  // Has weekday mention → might be recurring, ask
  if (WEEKDAY_PATTERN.test(rawText)) return true;

  return false;
}

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  "воскресенье": 0, "понедельник": 1, "вторник": 2, "среда": 3, "среду": 3,
  "четверг": 4, "пятница": 5, "пятницу": 5, "суббота": 6, "субботу": 6,
};

export function extractWeekdayFromDate(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  return d.getDay();
}
