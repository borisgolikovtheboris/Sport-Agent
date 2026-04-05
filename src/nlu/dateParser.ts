import { NLU_CONFIG } from "./nluConfig";

export interface ParsedDate {
  date: string;      // ISO: YYYY-MM-DD
  time: string | null; // HH:MM or null if not specified
  success: boolean;
  source: "regex" | "llm";
}

// ── Regex parser (fast, no API) ──
function regexParseDate(text: string): ParsedDate | null {
  // Formats: "15.04 19:00", "15.04 19.00", "15/04 19:00"
  const match = text.trim().match(
    /^(\d{1,2})[./](\d{1,2})\s+(\d{1,2})[.:](\d{2})$/
  );
  if (!match) return null;

  const [, dayStr, monthStr, hourStr, minStr] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1;
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

  if (candidate.getDate() !== day || candidate.getMonth() !== month) {
    return null;
  }

  const dateStr = `${candidate.getFullYear()}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

  return { date: dateStr, time: timeStr, success: true, source: "regex" };
}

// ── Day of week in Russian ──
const DAYS_RU = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function getDayOfWeek(dateISO: string): string {
  const d = new Date(dateISO + "T12:00:00");
  return DAYS_RU[d.getDay()];
}

// ── LLM parser (slow, understands natural language) ──
async function llmParseDate(text: string, today: string): Promise<ParsedDate | null> {
  let apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (apiKey.startsWith("=")) apiKey = apiKey.slice(1).trim();
  if (!apiKey) return null;

  const dayOfWeek = getDayOfWeek(today);

  const prompt = `Извлеки дату и время из текста пользователя.
Сегодня: ${today} (${dayOfWeek}).
Отвечай ТОЛЬКО JSON без markdown: {"date": "YYYY-MM-DD", "time": "HH:MM"}
Если дату извлечь нельзя: {"date": null, "time": null}
Если время не указано: {"date": "YYYY-MM-DD", "time": null}

Правила:
- "в пятницу в 7" → ближайшая пятница, 19:00 (вечер по умолчанию)
- "завтра в 19" → завтра, 19:00
- "послезавтра утром" → послезавтра, 10:00
- "в среду" → ближайшая среда, time = null
- "15 числа в 20:30" → 15-е текущего/след месяца, 20:30
- "в 11 в понедельник" → ближайший понедельник, 11:00
- "на 7 вечера" → 19:00
- "в 10 утра" → 10:00

Текст: "${text}"`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: NLU_CONFIG.model,
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data: any = await response.json();
    let content = data.content?.[0]?.text;
    if (!content) return null;

    // Strip markdown fences
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    const parsed = JSON.parse(content);

    if (!parsed.date) return null;

    return {
      date: parsed.date,
      time: parsed.time ?? null,
      success: true,
      source: "llm",
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── Main function ──
export async function smartParseDate(text: string): Promise<ParsedDate | null> {
  // 1. Try regex (fast)
  const regexResult = regexParseDate(text);
  if (regexResult) return regexResult;

  // 2. Fallback to LLM
  const llmResult = await llmParseDate(text, new Date().toISOString().split("T")[0]);
  return llmResult;
}

// ── Helper: format date for user display ──
const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function formatDateForUser(dateISO: string): string {
  const d = new Date(dateISO + "T12:00:00");
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]}, ${DAYS_RU[d.getDay()]}`;
}
