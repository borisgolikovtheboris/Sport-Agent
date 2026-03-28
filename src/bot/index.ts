import { Bot, Context } from 'grammy';
import prisma from '../db/prisma';
import { registerNewEvent, handleText } from './commands/newevent';
import { registerEvents } from './commands/events';
import { registerCancel } from './commands/cancel';
import { registerRsvp } from './callbacks/rsvp';
import { clearState } from './state';

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set');

  const bot = new Bot<Context>(token);

  bot.command('start_over', async (ctx) => {
    if (ctx.from && ctx.chat) {
      await clearState(String(ctx.from.id), String(ctx.chat.id));
    }
    await ctx.reply('✅ Сброшено! Теперь пиши /newevent');
  });

  bot.on('my_chat_member', async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    const chat = ctx.chat;
    if (newStatus === 'member' || newStatus === 'administrator') {
      if (chat.type === 'group' || chat.type === 'supergroup') {
        await prisma.group.upsert({
          where: { chatId: String(chat.id) },
          create: { chatId: String(chat.id), title: chat.title ?? 'Без названия', adminId: String(ctx.from.id) },
          update: { title: chat.title ?? 'Без названия' },
        });
        await ctx.reply(
          '👋 Привет! Я SportBot.\n\n' +
          '✅ /newevent — создать тренировку\n' +
          '📋 /events — список тренировок\n' +
          '🗑 /cancel — отменить тренировку\n' +
          '🔄 /start_over — если бот завис\n' +
          '❓ /help — помощь'
        );
      }
    }
  });

  registerNewEvent(bot);
  registerEvents(bot);
  registerCancel(bot);
  registerRsvp(bot);

  bot.on('message:text', handleText);

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 SportBot — помощь\n\n' +
      '/newevent — создать тренировку\n' +
      '/events — список тренировок\n' +
      '/cancel — отменить тренировку\n' +
      '/start_over — сброс если бот завис\n' +
      '/help — эта справка'
    );
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  await bot.api.setMyCommands([
    { command: 'newevent',   description: 'Создать тренировку' },
    { command: 'events',     description: 'Список тренировок' },
    { command: 'cancel',     description: 'Отменить тренировку' },
    { command: 'start_over', description: 'Сброс если бот завис' },
    { command: 'help',       description: 'Помощь' },
  ]);

  console.log('🤖 SportBot starting...');
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await bot.start({
    onStart: () => console.log('✅ SportBot is running!'),
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
