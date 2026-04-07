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

  // Method 2: fallback — organizer's next message when waiting for payment info
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

  if (userId !== event.createdBy) {
    return next();
  }

  if (event.price === null) {
    // === Waiting for price ===
    const lower = text.toLowerCase();
    if (lower === "бесплатно" || lower === "бесплатная" || lower === "0" || lower === "нет") {
      await prisma.event.update({
        where: { id: event.id },
        data: { price: 0, priceRequestMessageId: null },
      });
      await ctx.reply("👍 Бесплатная тренировка!");
      return;
    }

    const price = parseInt(text, 10);
    if (isNaN(price) || price <= 0) {
      await ctx.reply("Напиши число (например: 500) или «бесплатно»", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    await prisma.event.update({
      where: { id: event.id },
      data: { price },
    });

    const msg = await ctx.reply(
      "💳 Принял! Куда переводить?\nНапиши реквизиты (Сбер, Т-Банк, номер карты...)"
    );

    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: msg.message_id },
    });
    return;
  }

  if (event.paymentInfo !== null) {
    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: null },
    });
    return next();
  }

  // === Waiting for payment info — accept any answer ===
  const bank = recognizeBank(text);
  const paymentInfo = bank || text;

  await prisma.event.update({
    where: { id: event.id },
    data: { paymentInfo, priceRequestMessageId: null },
  });

  await enablePaidEvent(event.id);
  await updateEventCard(ctx, event.id);

  const display = bank ? `${event.price} ₽ на ${bank}` : `${event.price} ₽ — ${text}`;
  await ctx.reply(`💰 Готово! ${display}`);
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
