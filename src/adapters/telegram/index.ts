import { Bot, Context, session } from "grammy";
import { conversations, createConversation, ConversationFlavor } from "@grammyjs/conversations";
import { registerGroup } from "../../services/groupService";
import { newEventConversation } from "./commands/newevent";
import { eventsCommand } from "./commands/events";
import { cancelCommand } from "./commands/cancel";
import { registerRsvp } from "./callbacks/rsvp";

type MyContext = Context & ConversationFlavor;

export function createTelegramBot(token: string) {
  const bot = new Bot<MyContext>(token);

  // ── Middleware ──
  bot.use(session({ initial: () => ({}) }));
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
  bot.command("newevent", async (ctx) => {
    if (ctx.chat?.type === "private") {
      await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
      return;
    }
    await ctx.conversation.enter("newEvent");
  });

  bot.command("events", eventsCommand);
  bot.command("cancel", cancelCommand);

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📖 <b>SportBot — помощь</b>\n\n` +
        `/newevent — создать новую тренировку\n` +
        `/events — список ближайших тренировок\n` +
        `/cancel — отменить свою тренировку\n` +
        `/help — эта справка\n\n` +
        `<i>Кнопки ✅ Иду и ❌ Не иду появляются под карточкой тренировки</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── RSVP & cancel callbacks ──
  registerRsvp(bot);

  // ── Error handler ──
  bot.catch((err) => {
    console.error("Bot error:", err.message);
  });

  // ── Set bot commands in Telegram menu ──
  bot.api.setMyCommands([
    { command: "newevent", description: "Создать тренировку" },
    { command: "events", description: "Список тренировок" },
    { command: "cancel", description: "Отменить тренировку" },
    { command: "help", description: "Помощь" },
  ]);

  return bot;
}
