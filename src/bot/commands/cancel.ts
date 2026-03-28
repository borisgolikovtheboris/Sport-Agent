import { Bot, Context } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { formatEventCard } from '../../utils/formatEvent';

type MyContext = Context & ConversationFlavor;

export function registerCancel(bot: Bot<MyContext>) {
  // /cancel — show list of own active events with cancel buttons
  bot.command('cancel', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('⚠️ Эта команда работает только в групповых чатах.');
      return;
    }

    const chatId = String(ctx.chat!.id);
    const userId = String(ctx.from!.id);

    const events = await prisma.event.findMany({
      where: {
        groupId: chatId,
        createdBy: userId,
        status: 'ACTIVE',
      },
      include: { participants: true },
      orderBy: { datetime: 'asc' },
    });

    if (events.length === 0) {
      await ctx.reply('У тебя нет активных тренировок для отмены.');
      return;
    }

    for (const event of events) {
      const keyboard = new InlineKeyboard()
        .text('🗑 Отменить тренировку', `cancel_confirm:${event.id}`)
        .row()
        .text('← Оставить', `cancel_abort:${event.id}`);

      await ctx.reply(
        `Отменить эту тренировку?\n\n${formatEventCard(event)}`,
        { reply_markup: keyboard }
      );
    }
  });

  // Confirm cancel
  bot.callbackQuery(/^cancel_confirm:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });

    if (!event) {
      await ctx.answerCallbackQuery('Тренировка не найдена.');
      return;
    }

    if (event.createdBy !== userId) {
      await ctx.answerCallbackQuery('⚠️ Только организатор может отменить тренировку.');
      return;
    }

    // Update status
    await prisma.event.update({
      where: { id: eventId },
      data: { status: 'CANCELLED' },
    });

    // Edit original event card if we have messageId
    if (event.messageId) {
      try {
        await ctx.api.editMessageText(
          event.groupId,
          event.messageId,
          `❌ ОТМЕНЕНО\n\n🏃 ${event.title}\n📅 Тренировка отменена организатором.`
        );
      } catch (_) {
        // Message might be too old to edit — that's ok
      }
    }

    await ctx.editMessageText(`✅ Тренировка «${event.title}» отменена.`);
    await ctx.answerCallbackQuery('Тренировка отменена.');

    // Notify the group
    await ctx.api.sendMessage(
      event.groupId,
      `❌ Тренировка «${event.title}» отменена организатором.`
    );
  });

  // Abort cancel
  bot.callbackQuery(/^cancel_abort:(.+)$/, async (ctx) => {
    await ctx.editMessageText('👍 Хорошо, тренировка остаётся.');
    await ctx.answerCallbackQuery();
  });
}
