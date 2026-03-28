import { Bot, Context, session } from 'grammy';
import { conversations, createConversation, ConversationFlavor } from '@grammyjs/conversations';
import prisma from '../db/prisma';
import { newEventConversation, registerNewEvent } from './commands/newevent';
import { registerEvents } from './commands/events';
import { registerCancel } from './commands/cancel';
import { registerRsvp } from './callbacks/rsvp';

type MyContext = Context & ConversationFlavor;

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set in environment variables');

  const bot = new Bot<MyContext>(token);

  // ── Middleware ──
  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(newEventConversation, 'newEvent'));

  // ── Register group on bot join ──
  bot.on('my_chat_member', async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    const chat = ctx.chat;

    if (newStatus === 'member' || newStatus === 'administrator') {
      if (chat.type === 'group' || chat.type === 'supergroup') {
        const chatId = String(chat.id);
        const adminId = String(ctx.from.id);

        await prisma.group.upsert({
          where: { chatId },
          create: { chatId, title: chat.title ?? 'Без названия', adminId },
          update: { title: chat.title ?? 'Без названия' },
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
    }
  });

  // ── Commands ──
  registerNewEvent(bot);
  registerEvents(bot);
  registerCancel(bot);
  registerRsvp(bot);

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 *SportBot — помощь*\n\n` +
      `*/newevent* — создать новую тренировку\n` +
      `*/events* — список ближайших тренировок\n` +
      `*/cancel* — отменить свою тренировку\n` +
      `*/help* — эта справка\n\n` +
      `_Кнопки ✅ Иду и ❌ Не иду появляются под карточкой тренировки_`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Error handler ──
  bot.catch((err) => {
    console.error('Bot error:', err.message);
    if (process.env.NODE_ENV === 'development') {
      console.error(err.error);
    }
  });

  // ── Set bot commands in Telegram menu ──
  await bot.api.setMyCommands([
    { command: 'newevent', description: 'Создать тренировку' },
    { command: 'events',   description: 'Список тренировок' },
    { command: 'cancel',   description: 'Отменить тренировку' },
    { command: 'help',     description: 'Помощь' },
  ]);

  console.log('🤖 SportBot starting...');
  await bot.start({
    onStart: () => console.log('✅ SportBot is running!'),
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
