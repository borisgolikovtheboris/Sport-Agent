import { NLU_CONFIG } from "./nluConfig";

export interface ParsedIntent {
  intent: "create_event" | "cancel_event" | "list_events" | "join_event" | "unknown";
  confidence: number;
  entities: {
    title?: string;
    date?: string;
    time?: string;
    maxParticipants?: number;
    price?: number;
  };
  missingFields: string[];
  rawText: string;
}

const SYSTEM_PROMPT = `Ты — парсер намерений для спортивного бота. Пользователь пишет в чат группы.
Твоя задача — извлечь intent и сущности из сообщения.

Возможные intents:
- create_event: пользователь хочет создать тренировку/игру/событие
- cancel_event: пользователь хочет отменить событие
- list_events: пользователь хочет посмотреть расписание
- join_event: пользователь хочет записаться
- unknown: не относится к управлению событиями

Для create_event извлеки:
- title: название активности (футбол, бадминтон, бег и т.д.). Если не указано явно — сгенерируй из контекста.
- date: дата в ISO формате (YYYY-MM-DD). Интерпретируй «в среду», «завтра», «в пятницу» относительно сегодняшней даты: {today}.
- time: время в формате HH:MM. Интерпретируй «на 7 вечера» как 19:00, «в 10 утра» как 10:00.
- maxParticipants: число, если упомянуто.
- price: стоимость в рублях (число). «500 рублей», «по 300», «по пятьсот» → число.

Отвечай ТОЛЬКО валидным JSON, без markdown-обёртки:
{
  "intent": "...",
  "confidence": 0.0,
  "entities": { "title": "...", "date": "...", "time": "...", "maxParticipants": null, "price": null },
  "missingFields": ["..."]
}`;

export async function parseIntent(text: string): Promise<ParsedIntent> {
  let apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  // Strip leading '=' that some platforms add
  if (apiKey.startsWith("=")) apiKey = apiKey.slice(1).trim();
  if (!apiKey) {
    console.error("NLU: ANTHROPIC_API_KEY not set");
    return unknownIntent(text);
  }

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = SYSTEM_PROMPT.replace("{today}", today);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NLU_CONFIG.timeoutMs);

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
        max_tokens: NLU_CONFIG.maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: text }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`NLU API error: ${response.status}`);
      return unknownIntent(text);
    }

    const data: any = await response.json();
    const content = data.content?.[0]?.text;
    if (!content) return unknownIntent(text);

    const parsed = JSON.parse(content);

    // Validate confidence
    if (parsed.confidence < NLU_CONFIG.minConfidence) {
      return unknownIntent(text);
    }

    // Validate date is not in the past
    if (parsed.entities?.date) {
      const eventDate = new Date(parsed.entities.date);
      const todayDate = new Date(today);
      if (eventDate < todayDate) {
        parsed.missingFields = parsed.missingFields || [];
        if (!parsed.missingFields.includes("date")) {
          parsed.missingFields.push("date");
        }
        delete parsed.entities.date;
      }
    }

    return {
      intent: parsed.intent ?? "unknown",
      confidence: parsed.confidence ?? 0,
      entities: parsed.entities ?? {},
      missingFields: parsed.missingFields ?? [],
      rawText: text,
    };
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.error("NLU timeout exceeded");
    } else {
      console.error("NLU error:", err);
    }
    return unknownIntent(text);
  }
}

function unknownIntent(text: string): ParsedIntent {
  return {
    intent: "unknown",
    confidence: 0,
    entities: {},
    missingFields: [],
    rawText: text,
  };
}
