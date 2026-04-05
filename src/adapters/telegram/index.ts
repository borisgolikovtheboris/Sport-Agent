import { Bot, Context, session, SessionFlavor } from "grammy";
import prisma from "../../db/prisma";
import { conversations, createConversation, ConversationFlavor } from "@grammyjs/conversations";
import { registerGroup } from "../../services/groupService";
import { createSeries, formatDaysOfWeek } from "../../services/seriesService";
import { saveMessageId } from "../../services/eventService";
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

export interface SessionData {
  nluData?: any;
  pendingEvent?: any;
  pendingSeries?: any;
  pendingSeriesConfirm?: any;
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
        `👋 Привет! Я SportBot — помогаю организовывать групповые тренировки.\n\n` +
          `Что умею:\n` +
          `✅ /newevent — создать тренировку\n` +
          `📋 /events — список ближайших тренировок\n` +
          `🗑 /cancel — отменить тренировку\n` +
          `❓ /help — помощь\n\n` +
          `Создай первую тренировку командой /newevent 🚀`
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
    await ctx.reply(
      `📖 <b>SportBot — помощь</b>\n\n` +
        `/newevent — создать новую тренировку\n` +
        `/events — список ближайших тренировок\n` +
        `/cancel — отменить свою тренировку\n` +
        `/payments — сводка оплат (для организатора)\n` +
        `/help — эта справка\n\n` +
        `<i>Или просто напиши в чат, например: «забей футбол в среду на 7 вечера, 12 чел»</i>\n\n` +
        `<i>Кнопки ✅ Иду и ❌ Не иду появляются под карточкой тренировки</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Callbacks ──
  registerRsvp(bot);
  registerPaymentCallbacks(bot);

  // ── Callback: confirm series creation from NLU ──
  bot.callbackQuery("confirm_series", async (ctx) => {
    await ctx.answerCallbackQuery();
    const data = (ctx.session as any).pendingSeriesConfirm;
    if (!data) {
      await ctx.editMessageText("⚠️ Данные серии не найдены. Попробуй ещё раз.");
      return;
    }
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
      await ctx.answerCallbackQuery("Событие не найдено.");
      return;
    }
    if (String(ctx.from.id) !== event.createdBy) {
      await ctx.answerCallbackQuery("Только организатор может это сделать.");
      return;
    }
    await prisma.event.update({
      where: { id: eventId },
      data: { priceRequested: false, priceRequestMessageId: null },
    });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (_) {}
    await ctx.answerCallbackQuery("✅ Тренировка бесплатная!");
  });

  bot.callbackQuery("cancel_series", async (ctx) => {
    await ctx.answerCallbackQuery();
    delete (ctx.session as any).pendingSeriesConfirm;
    await ctx.editMessageText("❌ Создание серии отменено.");
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
