import { Bot } from "grammy";
import prisma from "../../../db/prisma";
import { joinEvent, declineParticipant } from "../../../services/participantService";
import { cancelEvent, getEvent } from "../../../services/eventService";
import { cancelSeries } from "../../../services/seriesService";
import { getReminderMessageIds } from "../../../services/reminderService";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { MyContext } from "../index";

async function updateReminderMessages(bot: Bot<MyContext>, eventId: string, groupId: string, cardText: string) {
  const reminderMsgIds = await getReminderMessageIds(eventId);
  for (const msgId of reminderMsgIds) {
    try {
      const reminderText = `⏰ Напоминание!\n\n${cardText}\n\nЕщё не записался? Жми кнопку ниже 👇`;
      await bot.api.editMessageText(groupId, msgId, reminderText, {
        reply_markup: rsvpKeyboard(eventId),
        parse_mode: "HTML",
      });
    } catch (_) {}
  }
}

async function updateGroupCard(
  ctx: MyContext,
  eventId: string,
  groupId: string,
  messageId: number | null,
  cardText: string
) {
  if (!messageId) return;
  try {
    await ctx.api.editMessageText(groupId, messageId, cardText, {
      reply_markup: rsvpKeyboard(eventId),
      parse_mode: "HTML",
    });
  } catch (_) {}
}

export function registerRsvp(bot: Bot<MyContext>) {
  // ── ✅ GOING ──
  bot.callbackQuery(/^go:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const result = await joinEvent(eventId, {
      userId: String(ctx.from.id),
      username: ctx.from.username ?? null,
      firstName: fullName,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        inactive: "Эта тренировка уже неактивна.",
        already_going: "Ты уже в списке 😊",
        full: `Мест нет 😔`,
      };
      await ctx.answerCallbackQuery(messages[result.reason] ?? "Ошибка");
      return;
    }

    const cardText = formatEventCard(result.event);
    const isPrivate = ctx.chat?.type === "private";
    const msg = result.rejoined
      ? "Передумал(а)? Отлично! Записал 🎉"
      : "Записал! Увидимся на тренировке 🎉";

    if (isPrivate) {
      // Update group card explicitly
      await updateGroupCard(ctx, eventId, result.event.groupId, result.event.messageId, cardText);
      // Remove buttons from DM message
      try { await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }); } catch (_) {}
    } else {
      // Update card in place (group)
      try {
        await ctx.editMessageText(cardText, {
          reply_markup: rsvpKeyboard(eventId),
          parse_mode: "HTML",
        });
      } catch (_) {}
    }

    await updateReminderMessages(bot, eventId, result.event.groupId, cardText);

    // Send short notification so it appears at bottom of chat
    if (!isPrivate) {
      const name = ctx.from.username ? `@${ctx.from.username}` : fullName;
      const goingCount = result.event.participants.filter((p) => p.status === "GOING").length;
      const maxStr = result.event.maxParticipants ? ` / ${result.event.maxParticipants}` : "";
      try {
        await bot.api.sendMessage(
          result.event.groupId,
          `${name} записался на ${result.event.title} (👥 ${goingCount}${maxStr})`
        );
      } catch (_) {}
    }

    await ctx.answerCallbackQuery(msg);
  });

  // ── ❌ NOT GOING ──
  bot.callbackQuery(/^notgo:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const event = await getEvent(eventId);
    if (!event || event.status !== "ACTIVE") {
      await ctx.answerCallbackQuery("Эта тренировка уже неактивна.");
      return;
    }

    const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const result = await declineParticipant(
      eventId,
      userId,
      ctx.from.username ?? null,
      fullName
    );

    if (result.action === "already_declined") {
      await ctx.answerCallbackQuery("Ты уже отметил(а), что не идёшь");
      return;
    }

    // Delete payment if existed (was GOING → NOT_GOING)
    if (result.action === "declined") {
      try {
        await prisma.payment.delete({
          where: { eventId_userId: { eventId, userId } },
        });
      } catch (_) {} // No payment record — fine
    }

    // Reload event with updated participants
    const updated = await getEvent(eventId);
    if (!updated) return;

    const cardText = formatEventCard(updated);
    const isPrivate = ctx.chat?.type === "private";

    if (isPrivate) {
      await updateGroupCard(ctx, eventId, updated.groupId, updated.messageId, cardText);
      try { await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }); } catch (_) {}
    } else {
      try {
        await ctx.editMessageText(cardText, {
          reply_markup: rsvpKeyboard(eventId),
          parse_mode: "HTML",
        });
      } catch (_) {}
    }

    await updateReminderMessages(bot, eventId, updated.groupId, cardText);

    // Send short notification so it appears at bottom of chat
    if (!isPrivate && result.action === "declined") {
      const name = ctx.from.username ? `@${ctx.from.username}` : fullName;
      const goingCount = updated.participants.filter((p) => p.status === "GOING").length;
      const maxStr = updated.maxParticipants ? ` / ${updated.maxParticipants}` : "";
      try {
        await bot.api.sendMessage(
          updated.groupId,
          `${name} не идёт на ${updated.title} (👥 ${goingCount}${maxStr})`
        );
      } catch (_) {}
    }

    await ctx.answerCallbackQuery("Понял, отметил что не идёшь 👋");
  });

  // ── Cancel confirm ──
  bot.callbackQuery(/^cancel_confirm:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);
    const result = await cancelEvent(eventId, userId);

    if (!result.ok) {
      const messages: Record<string, string> = {
        not_found: "Тренировка не найдена.",
        not_owner: "⚠️ Только организатор может отменить тренировку.",
      };
      await ctx.answerCallbackQuery(messages[result.reason] ?? "Ошибка");
      return;
    }

    // Edit original event card
    if (result.event.messageId) {
      try {
        await ctx.api.editMessageText(
          result.event.groupId,
          result.event.messageId,
          `❌ ОТМЕНЕНО\n\n🏃 ${result.event.title}\n📅 Тренировка отменена организатором.`
        );
      } catch (_) {}
    }

    await ctx.editMessageText(`✅ Тренировка «${result.event.title}» отменена.`);
    await ctx.answerCallbackQuery("Тренировка отменена.");

    await ctx.api.sendMessage(
      result.event.groupId,
      `❌ Тренировка «${result.event.title}» отменена организатором.`
    );
  });

  // ── Cancel all future in series ──
  bot.callbackQuery(/^cancel_series_all:(.+)$/, async (ctx) => {
    const seriesId = ctx.match[1];
    const userId = String(ctx.from.id);
    const result = await cancelSeries(seriesId, userId);

    if (!result.success) {
      await ctx.answerCallbackQuery("⚠️ Не удалось отменить серию.");
      return;
    }

    await ctx.editMessageText(
      `✅ Серия отменена. Отменено тренировок: ${result.cancelledCount}`
    );
    await ctx.answerCallbackQuery("Серия отменена.");
  });

  // ── Cancel abort ──
  bot.callbackQuery(/^cancel_abort:(.+)$/, async (ctx) => {
    await ctx.editMessageText("👍 Хорошо, тренировка остаётся.");
    await ctx.answerCallbackQuery();
  });
}
