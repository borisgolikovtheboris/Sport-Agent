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
import { registerRsvp } from "./callbacks/rsvp";
import { registerPaymentCallbacks } from "./callbacks/payment";
import { paymentsCommand } from "./commands/payments";
import { dashboardCommand } from "./commands/dashboard";
import { priceRequestHandler } from "./priceRequestHandler";
import { priceReplyHandler } from "./priceReplyHandler";
import { createNluHandler } from "./nluHandler";
import { getHelpResponse } from "./helpResponses";

export interface SessionData {
  nluData?: any;
  pendingEvent?: any;
  pendingSeries?: any;
  pendingSeriesConfirm?: any;
  pendingRecurrenceCheck?: any;
}

export type MyContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context & SessionFlavor<SessionData>>;

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
  bot.command("payments", paymentsCommand);
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
      await ctx.answerCallbackQuery({ text: "Данные серии не найдены", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Создаю серию..." });
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
    }
  });

  // ── Callback: price_confirm_free ──
  bot.callbackQuery(/^price_confirm_free:(.+)$/, async (ctx) => {
    const eventId = ctx.match![1];
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      await ctx.answerCallbackQuery({ text: "Событие не найдено.", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== event.createdBy) {
      await ctx.answerCallbackQuery({ text: "Только организатор может это сделать.", show_alert: true });
      return;
    }
    await prisma.event.update({
      where: { id: eventId },
      data: { priceRequested: false, priceRequestMessageId: null },
    });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (_) {}
    await ctx.answerCallbackQuery({ text: "Тренировка бесплатная ✅" });
  });

  bot.callbackQuery("cancel_series", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Серия отменена" });
    delete (ctx.session as any).pendingSeriesConfirm;
    await ctx.editMessageText("❌ Создание серии отменено.");
  });

  // ── Callback: recurrence check — one-time ──
  bot.callbackQuery("recur_once", async (ctx) => {
    const data = (ctx.session as any).pendingRecurrenceCheck;
    if (!data) {
      await ctx.answerCallbackQuery({ text: "Данные не найдены", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== data.createdBy) {
      await ctx.answerCallbackQuery({ text: "Только автор может выбрать", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Создаю разовую тренировку..." });
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
  });

  // ── Callback: recurrence check — weekly ──
  bot.callbackQuery("recur_weekly", async (ctx) => {
    const data = (ctx.session as any).pendingRecurrenceCheck;
    if (!data) {
      await ctx.answerCallbackQuery({ text: "Данные не найдены", show_alert: true });
      return;
    }
    if (String(ctx.from.id) !== data.createdBy) {
      await ctx.answerCallbackQuery({ text: "Только автор может выбрать", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Создаю серию..." });
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

  // ── Price handlers (before NLU) ──
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
    { command: "payments", description: "Сводка оплат" },
    { command: "help", description: "Помощь" },
  ]);

  return bot;
}
