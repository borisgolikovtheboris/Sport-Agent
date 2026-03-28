import { Bot, Context } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';
import prisma from '../../db/prisma';
import { formatEventShort } from '../../utils/formatEvent';
import { EventData } from '../../types';

type MyContext = Context & ConversationFlavor;

export function registerEvents(bot: Bot<MyContext>) {
  bot.command('events', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('⚠️ Эта команда работает только в групповых чатах.');
      return;
    }

    const chatId = String(ctx.chat!.id);
    const now = new Date();

    const events = await prisma.event.findMany({
      where: { groupId: chatId, status: 'ACTIVE', datetime: { gt: now } },
      include: { participants: true },
      orderBy: { datetime: 'asc' },
    });

    if (events.length === 0) {
      await ctx.reply('📋 Нет запланированных тренировок.\n\nСоздай первую командой /newevent');
      return;
    }

    const list = events.map((e: EventData, i: number) => formatEventShort(e, i + 1)).join('\n\n');
    await ctx.reply(`📋 *Ближайшие тренировки:*\n\n${list}`, { parse_mode: 'Markdown' });
  });
}
