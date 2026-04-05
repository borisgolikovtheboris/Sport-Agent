import { NextFunction } from "grammy";
import prisma from "../../db/prisma";
import { enablePaidEvent } from "../../services/eventService";
import { formatEventCard, rsvpKeyboard } from "./formatters";
import { MyContext } from "./index";

const BANK_ALIASES: Record<string, string> = {
  "тбанк": "Т-Банк", "тинькофф": "Т-Банк", "tinkoff": "Т-Банк", "т-банк": "Т-Банк",
  "тинек": "Т-Банк", "тиньк": "Т-Банк",
  "сбер": "Сбер", "сбербанк": "Сбер", "sber": "Сбер",
  "альфа": "Альфа-Банк", "альфабанк": "Альфа-Банк", "alfa": "Альфа-Банк",
  "втб": "ВТБ", "vtb": "ВТБ",
  "райф": "Райффайзен", "райффайзен": "Райффайзен", "raif": "Райффайзен",
  "газпром": "Газпромбанк", "газпромбанк": "Газпромбанк",
  "совком": "Совкомбанк", "совкомбанк": "Совкомбанк",
  "рсхб": "Россельхозбанк", "россельхоз": "Россельхозбанк",
  "открытие": "Открытие",
  "псб": "ПСБ", "промсвязь": "ПСБ",
  "сбп": "СБП", "sbp": "СБП",
};

const HAS_DETAILS_PATTERN = /(\d{4}\s?\d{4}\s?\d{4}\s?\d{4}|\+?[78]\d{10}|@\w+)/;

function parsePaymentInfo(text: string): { bank: string | null; hasDetails: boolean } {
  const lower = text.toLowerCase().replace(/^(на|в|через)\s+/, "").trim();

  let bank: string | null = null;
  for (const [alias, name] of Object.entries(BANK_ALIASES)) {
    if (lower.includes(alias)) {
      bank = name;
      break;
    }
  }

  const hasDetails = HAS_DETAILS_PATTERN.test(text);
  return { bank, hasDetails };
}

export async function priceReplyHandler(ctx: MyContext, next: NextFunction): Promise<void> {
  if (!ctx.message?.text || ctx.chat?.type === "private") {
    return next();
  }

  const text = ctx.message.text.trim();
  const groupId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Method 1: reply to bot's message ──
  const replyToId = ctx.message.reply_to_message?.message_id;
  let event = replyToId
    ? await prisma.event.findFirst({ where: { priceRequestMessageId: replyToId } })
    : null;

  // ── Method 2: fallback — organizer's next message when waiting for payment info ──
  if (!event) {
    event = await prisma.event.findFirst({
      where: {
        groupId,
        createdBy: userId,
        price: { not: null },
        paymentInfo: null,
        priceRequestMessageId: { not: null },
      },
    });
  }

  if (!event) {
    return next();
  }

  // Only organizer can set payment info
  if (userId !== event.createdBy) {
    return next();
  }

  if (event.price === null) {
    // === Waiting for price ===
    const price = parseInt(text, 10);
    if (isNaN(price) || price <= 0) {
      await ctx.reply("Напиши число, например: 500", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    await prisma.event.update({
      where: { id: event.id },
      data: { price },
    });

    const msg = await ctx.reply(
      "💳 Принял! Куда переводить?\nНапиши реквизиты (Сбер 1234... / Т-Банк @nickname):"
    );

    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: msg.message_id },
    });
    return;
  }

  if (event.paymentInfo !== null) {
    // Both set — clear and pass through
    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: null },
    });
    return next();
  }

  // === Waiting for payment info ===
  const payInfo = parsePaymentInfo(text);

  if (payInfo.bank && !payInfo.hasDetails) {
    // Bank recognized but no card/phone/nick — ask for details
    const msg = await ctx.reply(
      `${payInfo.bank} — принял! Теперь напиши номер карты, телефон или @никнейм для перевода:`
    );
    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: msg.message_id },
    });
    return;
  }

  let paymentInfo: string;

  if (payInfo.bank && payInfo.hasDetails) {
    // Bank + details — save full info
    const cleanText = text.replace(/^(на|в|через)\s+/i, "").trim();
    paymentInfo = `${payInfo.bank} ${cleanText}`;
  } else if (!payInfo.bank && payInfo.hasDetails) {
    // No bank but has number/nick — save as-is
    paymentInfo = text;
  } else {
    // Nothing recognized
    await ctx.reply(
      "🤔 Не понял реквизиты. Напиши, например:\n" +
        "• Сбер 1234 5678 9012 3456\n" +
        "• Т-Банк +79001234567\n" +
        "• Т-Банк @nickname\n" +
        "• СБП +79001234567"
    );
    return;
  }

  // Save payment info
  await prisma.event.update({
    where: { id: event.id },
    data: {
      paymentInfo,
      priceRequestMessageId: null,
    },
  });

  await enablePaidEvent(event.id);
  await updateEventCard(ctx, event.id);

  await ctx.reply(
    `💰 Обновлено! Стоимость: ${event.price} ₽ с человека\n💳 Реквизиты: ${paymentInfo}`
  );
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
  } catch (err) {
    console.error("Failed to update event card after price set:", err);
  }
}
