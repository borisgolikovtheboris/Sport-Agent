import { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { formatEventCard } from '../../utils/formatEvent';
import { ParticipantData } from '../../types';

export function registerRsvp(bot: Bot<Context>) {
  bot.callbackQuery(/^go:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);
    const username = ctx.from.username ?? null;
    const firstName = ctx.from.first_name;
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { participants: true } });
    if (!event || event.status !== 'ACTIVE') { await ctx.answerCallbackQuery('Тренировка неактивна.'); return; }
    const existing = event.participants.find((p: ParticipantData) => p.userId === userId);
    if (existing?.status === 'GOING') { await ctx.answerCallbackQuery('Ты уже в списке 😊'); return; }
    const goingCount = event.participants.filter((p: ParticipantData) => p.status === 'GOING').length;
    if (event.maxParticipants && goingCount >= event.maxParticipants) {
      await ctx.answerCallbackQuery(`Мест нет 😔 Все ${event.maxParticipants} мест заняты.`); return;
    }
    await prisma.participant.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, username, firstName, status: 'GOING' },
      update: { status: 'GOING', username, firstName },
    });
    const updated = await prisma.event.findUnique({ where: { id: eventId }, include: { participants: true } });
    const keyboard = new InlineKeyboard().text('✅ Иду', `go:${eventId}`).text('❌ Не иду', `notgo:${eventId}`);
    try { await ctx.editMessageText(formatEventCard(updated!), { reply_markup: keyboard }); } catch (_) {}
    await ctx.answerCallbackQuery('Записал! 🎉');
  });

  bot.callbackQuery(/^notgo:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { participants: true } });
    if (!event || event.status !== 'ACTIVE') { await ctx.answerCallbackQuery('Тренировка неактивна.'); return; }
    const existing = event.participants.find((p: ParticipantData) => p.userId === userId);
    if (!existing || existing.status === 'NOT_GOING') { await ctx.answerCallbackQuery('Ты и так не в списке.'); return; }
    await prisma.participant.update({ where: { eventId_userId: { eventId, userId } }, data: { status: 'NOT_GOING' } });
    const updated = await prisma.event.findUnique({ where: { id: eventId }, include: { participants: true } });
    const keyboard = new InlineKeyboard().text('✅ Иду', `go:${eventId}`).text('❌ Не иду', `notgo:${eventId}`);
    try { await ctx.editMessageText(formatEventCard(updated!), { reply_markup: keyboard }); } catch (_) {}
    await ctx.answerCallbackQuery('Убрал из списка.');
  });
}
