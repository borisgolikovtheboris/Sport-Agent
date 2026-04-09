import { NextFunction } from "grammy";
import prisma from "../../db/prisma";
import { enablePaidEvent } from "../../services/eventService";
import { formatEventCard, rsvpKeyboard } from "./formatters";
import { MyContext } from "./index";

const BANK_ALIASES: Record<string, string> = {
  "тбанк": "Т-Банк", "тинькофф": "Т-Банк", "tinkoff": "Т-Банк", "т-банк": "Т-Банк",
  "тинек": "Т-Банк", "тиньк": "Т-Банк", "тинькоф": "Т-Банк",
  "сбер": "Сбер", "сбербанк": "Сбер", "sber": "Сбер",
  "альфа": "Альфа-Банк", "альфабанк": "Альфа-Банк", "alfa": "Альфа-Банк",
  "втб": "ВТБ", "vtb": "ВТБ",
  "райф": "Райффайзен", "райффайзен": "Райффайзен",
  "газпром": "Газпромбанк", "газпромбанк": "Газпромбанк",
  "совком": "Совкомбанк", "совкомбанк": "Совкомбанк",
  "открытие": "Открытие",
  "псб": "ПСБ", "промсвязь": "ПСБ",
  "сбп": "СБП", "sbp": "СБП",
  "озон": "Озон Банк", "ozon": "Озон Банк",
  "яндекс": "Яндекс Пэй", "yandex": "Яндекс Пэй",
};

function recognizeBank(text: string): string | null {
  const lower = text.toLowerCase().replace(/^(на|в|через)\s+/, "").trim();
  for (const [alias, name] of Object.entries(BANK_ALIASES)) {
    if (lower.includes(alias)) return name;
  }
  return null;
}

const CANCEL_WORDS = ["отмена", "отмени", "отменить", "стоп", "cancel", "нет", "не надо", "отбой"];
const FREE_WORDS = ["бесплатно", "бесплатная", "бесплатный", "фри", "free", "0"];

function parseNaturalPrice(text: string): number | null {
  const lower = text.toLowerCase().replace(/^по\s+/i, "").replace(/\s+/g, "").replace(/руб(лей)?|₽|р\b/gi, "");

  // "5тыс" "5 тыс" "5тысяч"
  const tысMatch = lower.match(/^(\d+[.,]?\d*)\s*тыс/);
  if (tысMatch) return Math.round(parseFloat(tысMatch[1].replace(",", ".")) * 1000);

  // "5к" "5k"
  const kMatch = lower.match(/^(\d+[.,]?\d*)\s*[кk]$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1].replace(",", ".")) * 1000);

  // "полторы тысячи" "полтора"
  if (/полтор/.test(lower)) return 1500;

  // Text numbers
  const textNumbers: Record<string, number> = {
    "сто": 100, "двести": 200, "триста": 300, "четыреста": 400, "пятьсот": 500,
    "шестьсот": 600, "семьсот": 700, "восемьсот": 800, "девятьсот": 900,
    "тысяча": 1000, "тысячу": 1000, "две тысячи": 2000, "три тысячи": 3000,
    "пять тысяч": 5000, "десять тысяч": 10000,
  };
  for (const [word, val] of Object.entries(textNumbers)) {
    if (lower.includes(word.replace(/\s+/g, ""))) return val;
  }

  // Plain number: "500", "5000"
  const num = parseInt(text.replace(/[^\d]/g, ""), 10);
  if (!isNaN(num) && num > 0) return num;

  return null;
}

export async function priceReplyHandler(ctx: MyContext, next: NextFunction): Promise<void> {
  if (!ctx.message?.text || ctx.chat?.type === "private") {
    return next();
  }

  const text = ctx.message.text.trim();
  const groupId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // Method 1: reply to bot's message
  const replyToId = ctx.message.reply_to_message?.message_id;
  let event = replyToId
    ? await prisma.event.findFirst({ where: { priceRequestMessageId: replyToId } })
    : null;

  // Method 2: fallback — organizer's message when waiting for price/info
  // Skip if message looks like a new event creation (has time pattern like "в 19:00")
  const looksLikeEvent = /\d{1,2}[.:]\d{2}/.test(text) && text.split(/\s+/).length > 5;
  if (!event && !looksLikeEvent) {
    event = await prisma.event.findFirst({
      where: {
        groupId,
        createdBy: userId,
        priceRequestMessageId: { not: null },
      },
    });
  }

  if (!event) {
    return next();
  }

  if (userId !== event.createdBy) {
    return next();
  }

  if (event.price === null) {
    // === Waiting for price ===
    const lower = text.toLowerCase().trim();

    // Cancel
    if (CANCEL_WORDS.some((w) => lower === w || lower.startsWith(w + " "))) {
      await prisma.event.update({
        where: { id: event.id },
        data: { priceRequestMessageId: null },
      });
      await ctx.reply("👍 Ок, цену можно указать позже.");
      return;
    }

    // Free
    if (FREE_WORDS.some((w) => lower === w)) {
      await prisma.event.update({
        where: { id: event.id },
        data: { price: 0, priceRequestMessageId: null },
      });
      await ctx.reply("👍 Бесплатная тренировка!");
      return;
    }

    const price = parseNaturalPrice(text);
    if (!price) {
      await ctx.reply("Не понял. Напиши число, например: 500, 5тыс, 1.5к или «бесплатно»", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Check if collector is included: "по 5 тыс, мне" or "мне, по 500" or "@ivan 500"
    const collectorFromPrice =
      text.match(/[,;]\s*(мне|я|сам|@\w+)$/) ||
      text.match(/^(мне|я|сам|@\w+)[,;]?\s+/i);
    let collectorName: string | null = null;
    if (collectorFromPrice) {
      const raw = collectorFromPrice[1].trim();
      if (raw === "мне" || raw === "я" || raw === "сам") {
        const fullName = [ctx.from?.first_name, (ctx.from as any)?.last_name].filter(Boolean).join(" ");
        collectorName = ctx.from?.username ? `@${ctx.from.username}` : fullName;
      } else {
        collectorName = raw;
      }
    }

    await prisma.event.update({
      where: { id: event.id },
      data: {
        price,
        priceRequestMessageId: null,
        ...(collectorName ? { collectorId: userId, collectorName } : {}),
      },
    });

    await enablePaidEvent(event.id);
    await updateEventCard(ctx, event.id);

    const reply = collectorName
      ? `💰 ${price} ₽ с человека → ${collectorName}`
      : `💰 ${price} ₽ с человека`;
    await ctx.reply(reply);
    return;
  }

  // Fallback: any other pending state — clear and pass through
  await prisma.event.update({
    where: { id: event.id },
    data: { priceRequestMessageId: null },
  });
  return next();
}

async function updateEventCard(ctx: MyContext, eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
  });
  if (!event?.messageId) return;

  try {
    await ctx.api.editMessageText(
      event.groupId,
      event.messageId,
      formatEventCard(event),
      { parse_mode: "HTML", reply_markup: rsvpKeyboard(event.id) }
    );
  } catch (_) {
    // "message is not modified" is expected if card already has current data
  }
}
