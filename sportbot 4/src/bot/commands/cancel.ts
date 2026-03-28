import { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { formatEventCard } from '../../utils/formatEvent';
import { EventData } from '../../types';

export function registerCancel(bot: Bot<Context>) {
  bot.command('cancel', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('⚠️ Эта команда работает только в групповых чатах.');
      return;
    }
    const chatId = String(ctx.chat!.id);
    const userId = String(ctx.from!.id);
    const events = await prisma.event.findMany({
      where: { groupId: chatId, createdBy: userId, status: 'ACTIVE' },
      include: { participants: true },
      orderBy: { datetime: 'asc' },
    });
    if (events.length === 0) {
      await ctx.reply('У тебя нет активных тренировок для отмены.');
      return;
    }
    for (const event of events) {
      const keyboard = new InlineKeyboard()
        .text('🗑 Отменить', `cancel_confirm:${event.id}`)
        .row()
        .text('← Оставить', `cancel_abort:${event.id}`);
      await ctx.reply(`Отменить эту тренировку?\n\n${formatEventCard(event as EventData)}`, { reply_markup: keyboard });
    }
  });

  bot.callbackQuery(/^cancel_confirm:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { participants: true } });
    if (!event) { await ctx.answerCallbackQuery('Тренировка не найдена.'); return; }
    if (event.createdBy !== userId) { await ctx.answerCallbackQuery('Только организатор может отменить.'); return; }
    await prisma.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
    if (event.messageId) {
      try {
        await ctx.api.editMessageText(event.groupId, event.messageId, `❌ ОТМЕНЕНО\n\n🏃 ${event.title}`);
      } catch (_) {}
    }
    await ctx.editMessageText(`✅ Тренировка «${event.title}» отменена.`);
    await ctx.answerCallbackQuery('Отменено.');
    await ctx.api.sendMessage(event.groupId, `❌ Тренировка «${event.title}» отменена организатором.`);
  });

  bot.callbackQuery(/^cancel_abort:(.+)$/, async (ctx) => {
    await ctx.editMessageText('👍 Тренировка остаётся.');
    await ctx.answerCallbackQuery();
  });
}
