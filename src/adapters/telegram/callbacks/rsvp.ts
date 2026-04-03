import { Bot } from "grammy";
import { joinEvent, leaveEvent } from "../../../services/participantService";
import { cancelEvent } from "../../../services/eventService";
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

export function registerRsvp(bot: Bot<MyContext>) {
  // ── ✅ GOING ──
  bot.callbackQuery(/^go:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const result = await joinEvent(eventId, {
      userId: String(ctx.from.id),
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name,
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
    try {
      await ctx.editMessageText(cardText, {
        reply_markup: rsvpKeyboard(eventId),
        parse_mode: "HTML",
      });
    } catch (_) {}

    await updateReminderMessages(bot, eventId, result.event.groupId, cardText);
    await ctx.answerCallbackQuery("Записал! Увидимся на тренировке 🎉");
  });

  // ── ❌ NOT GOING ──
  bot.callbackQuery(/^notgo:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const result = await leaveEvent(eventId, String(ctx.from.id));

    if (!result.ok) {
      const messages: Record<string, string> = {
        inactive: "Эта тренировка уже неактивна.",
        not_going: "Ты и так не в списке.",
      };
      await ctx.answerCallbackQuery(messages[result.reason] ?? "Ошибка");
      return;
    }

    const cardText = formatEventCard(result.event);
    try {
      await ctx.editMessageText(cardText, {
        reply_markup: rsvpKeyboard(eventId),
        parse_mode: "HTML",
      });
    } catch (_) {}

    await updateReminderMessages(bot, eventId, result.event.groupId, cardText);
    await ctx.answerCallbackQuery("Понял, убрал тебя из списка.");
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

  // ── Cancel abort ──
  bot.callbackQuery(/^cancel_abort:(.+)$/, async (ctx) => {
    await ctx.editMessageText("👍 Хорошо, тренировка остаётся.");
    await ctx.answerCallbackQuery();
  });
}
