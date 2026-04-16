import { Bot, Context, session, SessionFlavor } from "grammy";
import prisma from "../../db/prisma";
import { conversations, createConversation, ConversationFlavor } from "@grammyjs/conversations";
import { registerGroup } from "../../services/groupService";
import { createSeries, formatDaysOfWeek } from "../../services/seriesService";
import { createEvent, saveMessageId } from "../../services/eventService";
import { extractWeekdayFromDate } from "../../nlu/recurrenceCheck";
import { formatSeriesCard, formatEventCard, rsvpKeyboard } from "./formatters";
import { newEventConversation } from "./commands/newevent";
import { startCommand } from "./commands/start";
import { eventsCommand } from "./commands/events";
import { cancelCommand } from "./commands/cancel";
import { rescheduleCommand } from "./commands/reschedule";
import { registerRsvp } from "./callbacks/rsvp";
import { registerPaymentCallbacks } from "./callbacks/payment";
import { paymentsCommand } from "./commands/payments";
import { dashboardCommand } from "./commands/dashboard";
import { priceRequestHandler } from "./priceRequestHandler";
import { priceReplyHandler } from "./priceReplyHandler";
import { plusHandler } from "./plusHandler";
import { createNluHandler } from "./nluHandler";
import { createScoreHandler } from "./scoreHandler";
import { statsCommand } from "./commands/stats";
import { getHelpResponse } from "./helpResponses";

export interface SessionData {
  nluData?: any;
  pendingEvent?: any;
  pendingSeries?: any;
  pendingSeriesConfirm?: any;
  pendingRecurrenceCheck?: any;
  pendingReschedule?: any;
}

export type MyContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context & SessionFlavor<SessionData>>;

async function safeAnswer(ctx: MyContext, opts: { text: string; show_alert?: boolean }) {
  try { await ctx.answerCallbackQuery(opts); } catch (_) {}
}

export function createTelegramBot(token: string) {
  const bot = new Bot<MyContext>(token);

  // ── Middleware ──
  bot.use(session({ initial: (): SessionData => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(newEventConversation, "newEvent"));

  // ── Register group on bot join ──
  bot.on("my_chat_member", async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    const chat = ctx.chat;

    if (
      (newStatus === "member" || newStatus === "administrator") &&
      (chat.type === "group" || chat.type === "supergroup")
    ) {
      await registerGroup({
        chatId: String(chat.id),
        title: chat.title ?? "Без названия",
        adminId: String(ctx.from.id),
      });

      await ctx.reply(
        `Привет! 👋 Я <b>SportBot</b> — помогаю организовать групповые тренировки.\n\n` +
          `Просто напиши мне что-нибудь вроде:\n` +
          `💬 «Футбол в среду в 19:00»\n` +
          `💬 «Забей хоккей на понедельник, 12 человек, по 500р»\n\n` +
          `Я создам карточку, а участники смогут записаться кнопкой «Иду».\n\n` +
          `Что ещё умею:\n` +
          `📋 /events — список тренировок\n` +
          `❌ /cancel — отменить тренировку\n` +
          `💰 /payments — кто оплатил\n\n` +
          `❓ Если что-то непонятно — просто спроси!`,
        { parse_mode: "HTML" }
      );
    }
  });

  // ── Commands ──
  bot.command("start", startCommand);

  bot.command("newevent", async (ctx) => {
    if (ctx.chat?.type === "private") {
      await ctx.reply("⚠️ Эта команда работает только в групповых чатах. Добавь меня в группу.");
      return;
    }
    await ctx.conversation.enter("newEvent");
  });

  bot.command("events", eventsCommand);
  bot.command("cancel", cancelCommand);
  bot.command("reschedule", rescheduleCommand);
  bot.command("payments", paymentsCommand);
  bot.command("stats", statsCommand);
  bot.command("dashboard", dashboardCommand);

  bot.command("help", async (ctx) => {
    await ctx.reply(getHelpResponse("general"), { parse_mode: "HTML" });
  });

  // ── Callbacks ──
  registerRsvp(bot);
  registerPaymentCallbacks(bot);

  // ── Callback: confirm series creation from NLU ──
  bot.callbackQuery("confirm_series", async (ctx) => {
    const data = (ctx.session as any).pendingSeriesConfirm;
    if (!data) {
      await safeAnswer(ctx, { text: "Данные серии не найдены", show_alert: true });
      return;
    }
    await safeAnswer(ctx, { text: "Создаю серию..." });
    delete (ctx.session as any).pendingSeriesConfirm;

    const { series, events } = await createSeries({
      groupId: data.chatId,
      createdBy: data.createdBy,
      title: data.title,
      time: data.time,
      daysOfWeek: data.daysOfWeek,
      maxParticipants: data.maxParticipants,
      price: data.price,
    });

    // Post series summary
    await ctx.editMessageText(formatSeriesCard(series, events), { parse_mode: "HTML" });

    // Post first event card with RSVP buttons
    if (events.length > 0) {
      const sent = await ctx.api.sendMessage(
        data.chatId,
        formatEventCard(events[0]),
        { reply_markup: rsvpKeyboard(events[0].id), parse_mode: "HTML" }
      );
      await saveMessageId(events[0].id, sent.message_id);

      // Ask about price if not set
      if (!data.price) {
        const priceMsg = await ctx.api.sendMessage(
          data.chatId,
          `💰 Тренировка платная? Напиши стоимость (например: 500) или «бесплатно»:`
        );
        await prisma.event.update({
          where: { id: events[0].id },
          data: { priceRequestMessageId: priceMsg.message_id },
        });
      }
    }
  });

  // ── Callback: price_confirm_free ──
  bot.callbackQuery(/^price_confirm_free:(.+)$/, async (ctx) => {
    const eventId = ctx.match![1];
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      await safeAnswer(ctx, { text: "Событие не найдено.", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== event.createdBy) {
      await safeAnswer(ctx, { text: "Только организатор может это сделать.", show_alert: true });
      return;
    }
    await prisma.event.update({
      where: { id: eventId },
      data: { priceRequested: false, priceRequestMessageId: null },
    });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (_) {}
    await safeAnswer(ctx, { text: "Тренировка бесплатная ✅" });
  });

  bot.callbackQuery("cancel_series", async (ctx) => {
    await safeAnswer(ctx, { text: "Серия отменена" });
    delete (ctx.session as any).pendingSeriesConfirm;
    await ctx.editMessageText("❌ Создание серии отменено.");
  });

  // ── Callback: pick event to reschedule ──
  bot.callbackQuery(/^resched_pick:(.+)$/, async (ctx) => {
    const eventId = ctx.match![1];
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.status !== "ACTIVE") {
      await safeAnswer(ctx, { text: "Тренировка не найдена", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== event.createdBy) {
      await safeAnswer(ctx, { text: "Только организатор может перенести", show_alert: true });
      return;
    }
    await safeAnswer(ctx, { text: "⏰ Выбрано" });

    (ctx.session as any).pendingReschedule = {
      eventId,
      chatId: event.groupId,
      userId: String(ctx.from.id),
    };

    try { await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }); } catch (_) {}

    const d = event.datetime;
    const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const dateStr = `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    await ctx.reply(
      `⏰ Перенос «${event.title}» (сейчас ${dateStr}).\n` +
        `На когда? (например: <code>20:00</code>, <code>завтра в 20</code>, <code>16.04 19:00</code>)`,
      { parse_mode: "HTML" }
    );
  });

  // ── Callback: recurrence check — one-time ──
  bot.callbackQuery("recur_once", async (ctx) => {
    const data = (ctx.session as any).pendingRecurrenceCheck;
    if (!data) {
      await safeAnswer(ctx, { text: "Данные не найдены", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== data.createdBy) {
      await safeAnswer(ctx, { text: "Только автор может выбрать", show_alert: true });
      return;
    }
    await safeAnswer(ctx, { text: "Создаю разовую тренировку..." });
    delete (ctx.session as any).pendingRecurrenceCheck;

    const event = await createEvent({
      groupId: data.chatId,
      title: data.title,
      datetime: new Date(data.datetime),
      maxParticipants: data.maxParticipants,
      price: data.price,
      paymentInfo: null,
      createdBy: data.createdBy,
    });

    await ctx.editMessageText(formatEventCard(event), {
      reply_markup: rsvpKeyboard(event.id),
      parse_mode: "HTML",
    });

    await saveMessageId(event.id, ctx.msg?.message_id ?? 0);

    // Ask about price if not set
    if (!data.price) {
      const priceMsg = await ctx.api.sendMessage(
        data.chatId,
        `💰 Тренировка платная? Напиши стоимость (например: 500) или «бесплатно»:`
      );
      await prisma.event.update({
        where: { id: event.id },
        data: { priceRequestMessageId: priceMsg.message_id },
      });
    }
  });

  // ── Callback: recurrence check — weekly ──
  bot.callbackQuery("recur_weekly", async (ctx) => {
    const data = (ctx.session as any).pendingRecurrenceCheck;
    if (!data) {
      await safeAnswer(ctx, { text: "Данные не найдены", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== data.createdBy) {
      await safeAnswer(ctx, { text: "Только автор может выбрать", show_alert: true });
      return;
    }
    await safeAnswer(ctx, { text: "Создаю серию..." });
    delete (ctx.session as any).pendingRecurrenceCheck;

    const dt = new Date(data.datetime);
    const dayOfWeek = extractWeekdayFromDate(data.datetime.split("T")[0]);
    const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;

    const { series, events } = await createSeries({
      groupId: data.chatId,
      createdBy: data.createdBy,
      title: data.title,
      time: timeStr,
      daysOfWeek: [dayOfWeek],
      maxParticipants: data.maxParticipants,
      price: data.price,
    });

    await ctx.editMessageText(formatSeriesCard(series, events), { parse_mode: "HTML" });

    if (events.length > 0) {
      const sent = await ctx.api.sendMessage(
        data.chatId,
        formatEventCard(events[0]),
        { reply_markup: rsvpKeyboard(events[0].id), parse_mode: "HTML" }
      );
      await saveMessageId(events[0].id, sent.message_id);
    }
  });

  // ── Callback: delete bot message (organizer or group admin) ──
  bot.callbackQuery("bot_delete", async (ctx) => {
    const chatId = ctx.chat?.id;
    const msgId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !msgId) {
      await safeAnswer(ctx, { text: "Ошибка", show_alert: true });
      return;
    }
    let canDelete = false;
    try {
      const member = await ctx.api.getChatMember(chatId, ctx.from.id);
      canDelete = ["creator", "administrator"].includes(member.status);
    } catch (_) {}
    if (!canDelete) {
      // Check if user is event creator by looking at the event from callback data in same message
      const buttons = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
      for (const row of buttons) {
        for (const btn of row) {
          const m = ("callback_data" in btn) ? btn.callback_data?.match(/^go:(.+)$/) : null;
          if (m) {
            const ev = await prisma.event.findUnique({ where: { id: m[1] }, select: { createdBy: true } });
            if (ev && ev.createdBy === String(ctx.from.id)) canDelete = true;
          }
        }
      }
    }
    if (!canDelete) {
      await safeAnswer(ctx, { text: "Только админ или организатор может удалить", show_alert: true });
      return;
    }
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch (_) {
      await safeAnswer(ctx, { text: "Не удалось удалить — возможно, нет прав", show_alert: true });
    }
  });

  // ── Score handler (private chat — before group-only handlers) ──
  bot.use(createScoreHandler());

  // ── Message handlers (before NLU) ──
  bot.on("message:text", plusHandler);
  bot.on("message:text", priceReplyHandler);
  bot.on("message:text", priceRequestHandler);

  // ── NLU handler (after all commands and callbacks) ──
  bot.use(createNluHandler());

  // ── Error handler ──
  bot.catch((err) => {
    console.error("Bot error:", err.error ?? err.message, err.stack);
  });

  // ── Set bot commands in Telegram menu ──
  bot.api.setMyCommands([
    { command: "newevent", description: "Создать тренировку" },
    { command: "events", description: "Список тренировок" },
    { command: "cancel", description: "Отменить тренировку" },
    { command: "reschedule", description: "Изменить время" },
    { command: "stats", description: "Статистика очков" },
    { command: "payments", description: "Сводка оплат" },
    { command: "help", description: "Помощь" },
  ]);

  return bot;
}
