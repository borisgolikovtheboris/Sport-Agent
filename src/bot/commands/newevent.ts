import { Bot, Context } from 'grammy';
import { Conversation, ConversationFlavor, createConversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { parseDate } from '../../utils/parseDate';
import { formatEventCard } from '../../utils/formatEvent';

type MyContext = Context & ConversationFlavor;
type MyConversation = Conversation<MyContext>;

// Ждёт текстовое сообщение. Если пришла команда — выходит из диалога
async function waitForText(conversation: MyConversation, ctx: MyContext): Promise<string | null> {
  const msg = await conversation.waitFor('message:text');
  const text = msg.message.text.trim();
  if (text.startsWith('/')) {
    await ctx.reply('❌ Создание тренировки отменено.');
    return null;
  }
  return text;
}

export async function newEventConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Шаг 1: Название ──
  await ctx.reply(
    '📝 Создаём тренировку\n\nНапиши название, например:\nФутбол в Лужниках или Йога на крыше\n\n(любая команда отменит создание)'
  );

  const title = await waitForText(conversation, ctx);
  if (!title) return;

  // ── Шаг 2: Дата и время ──
  await ctx.reply('📅 Дата и время?\n\nФормат: ДД.ММ ЧЧ:ММ\nПример: 15.04 19:00');

  let datetime: Date | null = null;
  while (!datetime) {
    const dateText = await waitForText(conversation, ctx);
    if (!dateText) return;

    datetime = parseDate(dateText);
    if (!datetime) {
      await ctx.reply('⚠️ Не понял формат. Пример: 15.04 19:00');
    } else if (datetime < new Date()) {
      await ctx.reply('⚠️ Эта дата уже прошла. Укажи будущую дату:');
      datetime = null;
    }
  }

  // ── Шаг 3: Максимум участников ──
  await ctx.reply('👥 Максимум участников?\n\nНапиши число или /skip чтобы без ограничений');

  let maxParticipants: number | null = null;
  const limitMsg = await conversation.waitFor('message:text');
  const limitText = limitMsg.message.text.trim();
  if (limitText !== '/skip') {
    const parsed = parseInt(limitText, 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxParticipants = parsed;
    }
  }

  // ── Сохранить в БД ──
  const event = await prisma.event.create({
    data: { groupId: chatId, title, datetime, maxParticipants, createdBy: userId, status: 'ACTIVE' },
    include: { participants: true },
  });

  const keyboard = new InlineKeyboard()
    .text('✅ Иду', `go:${event.id}`)
    .text('❌ Не иду', `notgo:${event.id}`);

  const sent = await ctx.reply(formatEventCard(event), { reply_markup: keyboard });

  await prisma.event.update({
    where: { id: event.id },
    data: { messageId: sent.message_id },
  });
}

export function registerNewEvent(bot: Bot<MyContext>) {
  bot.command('newevent', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('⚠️ Эта команда работает только в групповых чатах.');
      return;
    }
    await ctx.conversation.enter('newEvent');
  });
}
