import { Bot, Context, session, SessionFlavor } from "grammy";
import { conversations, createConversation, ConversationFlavor } from "@grammyjs/conversations";
import { registerGroup } from "../../services/groupService";
import {
  newEventConversation,
  newEventDMConversation,
  neweventCommand,
} from "./commands/newevent";
import { startCommand } from "./commands/start";
import { eventsCommand } from "./commands/events";
import { cancelCommand } from "./commands/cancel";
import { registerRsvp } from "./callbacks/rsvp";
import { registerPaymentCallbacks } from "./callbacks/payment";
import { paymentsCommand } from "./commands/payments";
import { createNluHandler } from "./nluHandler";

export interface SessionData {
  nluData?: any;
  dmGroupChatId?: string;
  dmPendingNewEvent?: boolean;
  pendingEvent?: any;
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
  bot.use(createConversation(newEventDMConversation, "newEventDM"));

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
  bot.command("newevent", neweventCommand);
  bot.command("events", eventsCommand);
  bot.command("cancel", cancelCommand);
  bot.command("payments", paymentsCommand);

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

  // ── Callback: "💬 Здесь" — start group conversation ──
  bot.callbackQuery(/^newevent_here:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("newEvent");
  });

  // ── Callback: group selection from DM ──
  bot.callbackQuery(/^selectgroup:(.+)$/, async (ctx) => {
    const groupChatId = ctx.match![1];
    await ctx.answerCallbackQuery();
    (ctx.session as any).dmGroupChatId = groupChatId;
    await ctx.conversation.enter("newEventDM");
  });

  // ── Handle DM messages when pending new event from group ──
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();
    const session = ctx.session as any;
    if (session.dmPendingNewEvent && session.dmGroupChatId) {
      delete session.dmPendingNewEvent;
      await ctx.conversation.enter("newEventDM");
      return;
    }
    return next();
  });

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
