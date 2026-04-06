import { Prisma } from "@prisma/client";
import { NLU_CONFIG } from "./nluConfig";
import prisma from "../db/prisma";

export interface ParsedIntent {
  intent: "create_event" | "cancel_event" | "list_events" | "join_event" | "update_event" | "unknown";
  confidence: number;
  entities: {
    title?: string;
    date?: string;
    time?: string;
    maxParticipants?: number;
    price?: number;
    recurrence?: {
      days: string[];    // ["tuesday", "thursday"]
      time?: string;     // "20:00"
    } | null;
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
- update_event: пользователь хочет изменить параметры существующего события (цену, время, число мест). Примеры: «500 руб за тренировку», «перенеси на 8 вечера». НЕ путать с create_event.
- unknown: не относится к управлению событиями

Для create_event извлеки:
- title: название активности (футбол, бадминтон, бег и т.д.). Если не указано явно — сгенерируй из контекста.
- date: дата в ISO формате (YYYY-MM-DD). Интерпретируй «в среду», «завтра», «в пятницу» относительно сегодняшней даты: {today}.
- time: время в формате HH:MM. Интерпретируй «на 7 вечера» как 19:00, «в 10 утра» как 10:00.
- maxParticipants: число, если упомянуто.
- price: стоимость в рублях (число). «500 рублей», «по 300», «по пятьсот», «цена 5000₽», «5000р», «стоимость 1000» → число. «бесплатно» → 0.
- recurrence: если пользователь ЯВНО говорит про повторение («каждый вт», «по средам», «еженедельно»). Формат:
  { "days": ["monday", "wednesday"], "time": "20:00" }
  «по вторникам» → { "days": ["tuesday"] }
  «по вт и чт» → { "days": ["tuesday", "thursday"] }
  «каждую среду» → { "days": ["wednesday"] }
  «каждый вторник в 8 вечера» → { "days": ["tuesday"], "time": "20:00" }
  Если нет ЯВНОГО указания на повторение — null (бот дозапросит, если есть день недели).

Отвечай ТОЛЬКО валидным JSON, без markdown-обёртки:
{
  "intent": "...",
  "confidence": 0.0,
  "entities": { "title": "...", "date": "...", "time": "...", "maxParticipants": null, "price": null, "recurrence": null },
  "missingFields": ["..."]
}`;

export async function parseIntent(text: string, groupId?: string, userId?: string): Promise<ParsedIntent> {
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
  const startTime = Date.now();

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
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`NLU API error: ${response.status}`, errBody);

      // Log error (fire-and-forget)
      prisma.nLULog.create({
        data: {
          groupId: groupId ?? "unknown",
          userId: userId ?? "unknown",
          inputText: text.substring(0, 500),
          intent: "error",
          confidence: 0,
          entities: Prisma.JsonNull,
          latencyMs,
          success: false,
          errorMessage: `${response.status}: ${errBody}`.substring(0, 500),
        },
      }).catch((err) => console.error("NLU log error:", err));

      return unknownIntent(text);
    }

    const data: any = await response.json();
    let content = data.content?.[0]?.text;
    if (!content) {
      // Log empty response
      prisma.nLULog.create({
        data: {
          groupId: groupId ?? "unknown",
          userId: userId ?? "unknown",
          inputText: text.substring(0, 500),
          intent: "error",
          confidence: 0,
          entities: Prisma.JsonNull,
          latencyMs,
          success: false,
          errorMessage: "Empty response content",
        },
      }).catch((err) => console.error("NLU log error:", err));

      return unknownIntent(text);
    }

    // Strip markdown code fences if present
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    const parsed = JSON.parse(content);

    const result: ParsedIntent = {
      intent: parsed.intent ?? "unknown",
      confidence: parsed.confidence ?? 0,
      entities: parsed.entities ?? {},
      missingFields: parsed.missingFields ?? [],
      rawText: text,
    };

    // Validate date is not in the past
    if (result.entities?.date) {
      const eventDate = new Date(result.entities.date);
      const todayDate = new Date(today);
      if (eventDate < todayDate) {
        result.missingFields = result.missingFields || [];
        if (!result.missingFields.includes("date")) {
          result.missingFields.push("date");
        }
        delete result.entities.date;
      }
    }

    // Log success (fire-and-forget)
    prisma.nLULog.create({
      data: {
        groupId: groupId ?? "unknown",
        userId: userId ?? "unknown",
        inputText: text.substring(0, 500),
        intent: result.intent,
        confidence: result.confidence,
        entities: result.entities as any,
        latencyMs,
        success: true,
        errorMessage: null,
      },
    }).catch((err) => console.error("NLU log error:", err));

    return result;
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    const errMsg = (err as Error).name === "AbortError"
      ? "Timeout exceeded"
      : (err as Error).message;

    if ((err as Error).name === "AbortError") {
      console.error("NLU timeout exceeded");
    } else {
      console.error("NLU error:", err);
    }

    // Log error (fire-and-forget)
    prisma.nLULog.create({
      data: {
        groupId: groupId ?? "unknown",
        userId: userId ?? "unknown",
        inputText: text.substring(0, 500),
        intent: "error",
        confidence: 0,
        entities: Prisma.JsonNull,
        latencyMs,
        success: false,
        errorMessage: errMsg?.substring(0, 500) ?? "Unknown error",
      },
    }).catch((logErr) => console.error("NLU log error:", logErr));

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
