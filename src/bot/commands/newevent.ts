import { Bot, Context } from 'grammy';
import { Conversation, ConversationFlavor, conversations, createConversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { parseDate } from '../../utils/parseDate';
import { formatEventCard } from '../../utils/formatEvent';

type MyContext = Context & ConversationFlavor;
type MyConversation = Conversation<MyContext>;

export async function newEventConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Step 1: Title ──
  await ctx.reply(
    '📝 *Создаём тренировку*\n\nНапиши название\\, например:\n_Футбол в Лужниках_ или _Йога на крыше_',
    { parse_mode: 'MarkdownV2' }
  );

  const titleMsg = await conversation.waitFor('message:text');
  const cancelCheck = titleMsg.message.text.trim();
  if (cancelCheck === '/cancel') {
    await ctx.reply('❌ Создание отменено.');
    return;
  }
  const title = cancelCheck;

  // ── Step 2: Date & Time ──
  await ctx.reply(
    '📅 Отлично\\! Теперь дата и время\\.\n\nФормат: `ДД\\.ММ ЧЧ:ММ`\nПример: `15\\.04 19:00`\n\n_Напиши /cancel чтобы отменить_',
    { parse_mode: 'MarkdownV2' }
  );

  let datetime: Date | null = null;
  while (!datetime) {
    const dateMsg = await conversation.waitFor('message:text');
    if (dateMsg.message.text.trim() === '/cancel') {
      await ctx.reply('❌ Создание отменено.');
      return;
    }
    datetime = parseDate(dateMsg.message.text.trim());
    if (!datetime) {
      await ctx.reply('⚠️ Не понял формат. Попробуй ещё раз:\nПример: `15.04 19:00`');
    } else if (datetime < new Date()) {
      await ctx.reply('⚠️ Эта дата уже прошла. Укажи будущую дату:');
      datetime = null;
    }
  }

  // ── Step 3: Max participants (optional) ──
  await ctx.reply(
    '👥 Ограничить количество мест?\n\nНапиши число (например `12`) или /skip чтобы без ограничений',
    { parse_mode: 'Markdown' }
  );

  let maxParticipants: number | null = null;
  const limitMsg = await conversation.waitFor('message:text');
  const limitText = limitMsg.message.text.trim();
  if (limitText !== '/skip' && limitText !== '/cancel') {
    const parsed = parseInt(limitText, 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxParticipants = parsed;
    } else {
      await ctx.reply('⚠️ Не понял, создаю без ограничения мест.');
    }
  }

  // ── Save to DB ──
  const event = await prisma.event.create({
    data: {
      groupId: chatId,
      title,
      datetime,
      maxParticipants,
      createdBy: userId,
      status: 'ACTIVE',
    },
    include: { participants: true },
  });

  // ── Post event card ──
  const keyboard = new InlineKeyboard()
    .text('✅ Иду', `go:${event.id}`)
    .text('❌ Не иду', `notgo:${event.id}`);

  const sent = await ctx.reply(formatEventCard(event), {
    reply_markup: keyboard,
    parse_mode: undefined,
  });

  // Save messageId so we can edit the card later
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
