import { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { parseDate } from '../../utils/parseDate';
import { formatEventCard } from '../../utils/formatEvent';
import { getState, setState, clearState } from '../state';

export function registerNewEvent(bot: Bot<Context>) {
  bot.command('newevent', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('⚠️ Эта команда работает только в групповых чатах.');
      return;
    }
    const userId = String(ctx.from!.id);
    const chatId = String(ctx.chat!.id);
    try {
      await setState(userId, chatId, { step: 'TITLE' });
      await ctx.reply('📝 Создаём тренировку\n\nНапиши название:');
    } catch (e) {
      console.error('[ERROR] setState:', e);
      await ctx.reply('❌ Ошибка БД. Проверь логи Railway.');
    }
  });
}

export async function handleText(ctx: Context) {
  if (!ctx.message || !ctx.from || !ctx.chat) return;
  if (ctx.chat.type === 'private') return;
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith('/')) return;

  const userId = String(ctx.from.id);
  const chatId = String(ctx.chat.id);

  let state;
  try {
    state = await getState(userId, chatId);
  } catch (e) {
    console.error('[ERROR] getState:', e);
    return;
  }
  if (!state) return;

  if (state.step === 'TITLE') {
    try {
      await setState(userId, chatId, { step: 'DATE', title: text });
      await ctx.reply('📅 Дата и время?\n\nФормат: ДД.ММ ЧЧ:ММ\nПример: 20.04 19:00');
    } catch (e) {
      console.error('[ERROR] TITLE step:', e);
      await ctx.reply('❌ Ошибка. Попробуй /newevent заново.');
    }
    return;
  }

  if (state.step === 'DATE') {
    const datetime = parseDate(text);
    if (!datetime) { await ctx.reply('⚠️ Не понял формат. Пример: 20.04 19:00'); return; }
    if (datetime < new Date()) { await ctx.reply('⚠️ Эта дата уже прошла. Укажи будущую:'); return; }
    try {
      await setState(userId, chatId, { step: 'LIMIT', title: state.title ?? '', datetime });
      await ctx.reply('👥 Максимум участников?\n\nНапиши число или 0 — без ограничений');
    } catch (e) {
      console.error('[ERROR] DATE step:', e);
      await ctx.reply('❌ Ошибка. Попробуй /newevent заново.');
    }
    return;
  }

  if (state.step === 'LIMIT') {
    const num = parseInt(text, 10);
    const maxParticipants = (!isNaN(num) && num > 0) ? num : null;
    try {
      await clearState(userId, chatId);
      const event = await prisma.event.create({
        data: {
          groupId: chatId,
          title: state.title ?? 'Тренировка',
          datetime: state.datetime ?? new Date(),
          maxParticipants,
          createdBy: userId,
          status: 'ACTIVE',
        },
        include: { participants: true },
      });
      const keyboard = new InlineKeyboard()
        .text('✅ Иду', `go:${event.id}`)
        .text('❌ Не иду', `notgo:${event.id}`);
      const sent = await ctx.reply(formatEventCard(event), { reply_markup: keyboard });
      await prisma.event.update({ where: { id: event.id }, data: { messageId: sent.message_id } });
      console.log(`[EVENT CREATED] id=${event.id}`);
    } catch (e) {
      console.error('[ERROR] create event:', e);
      await ctx.reply('❌ Ошибка при создании. Попробуй /newevent заново.\n\nДетали: ' + String(e).slice(0, 100));
    }
  }
}
