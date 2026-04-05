import { NextFunction } from "grammy";
import prisma from "../../db/prisma";
import { enablePaidEvent } from "../../services/eventService";
import { formatEventCard, rsvpKeyboard } from "./formatters";
import { MyContext } from "./index";

export async function priceReplyHandler(ctx: MyContext, next: NextFunction): Promise<void> {
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId || !ctx.message?.text || ctx.chat?.type === "private") {
    return next();
  }

  // Find event by priceRequestMessageId
  const event = await prisma.event.findFirst({
    where: { priceRequestMessageId: replyToId },
  });

  if (!event) {
    return next();
  }

  // Only organizer can set price
  if (String(ctx.from?.id) !== event.createdBy) {
    await ctx.reply("Стоимость может указать только организатор тренировки.");
    return;
  }

  const text = ctx.message.text.trim();

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

    // Ask for payment info
    const msg = await ctx.reply(
      "💳 Принял! Куда переводить?\nНапиши реквизиты (Сбер 1234... / Тинькофф @nickname):"
    );

    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: msg.message_id },
    });
  } else if (event.paymentInfo === null) {
    // === Waiting for payment info ===
    if (text.length < 3) {
      await ctx.reply("Напиши реквизиты, например: Сбер 1234 5678 9012 3456");
      return;
    }

    await prisma.event.update({
      where: { id: event.id },
      data: {
        paymentInfo: text,
        priceRequestMessageId: null,
      },
    });

    // Enable paid event logic
    await enablePaidEvent(event.id);

    // Update group card
    await updateEventCard(ctx, event.id);

    await ctx.reply(
      `💰 Обновлено! Стоимость: ${event.price} ₽ с человека\n💳 Реквизиты: ${text}`
    );
  } else {
    // Both set — clear and pass through
    await prisma.event.update({
      where: { id: event.id },
      data: { priceRequestMessageId: null },
    });
    return next();
  }
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
