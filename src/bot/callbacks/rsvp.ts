import { Bot, Context } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import prisma from '../../db/prisma';
import { formatEventCard } from '../../utils/formatEvent';

type MyContext = Context & ConversationFlavor;

export function registerRsvp(bot: Bot<MyContext>) {
  // ── ✅ GOING ──
  bot.callbackQuery(/^go:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);
    const username = ctx.from.username ?? null;
    const firstName = ctx.from.first_name;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });

    if (!event || event.status !== 'ACTIVE') {
      await ctx.answerCallbackQuery('Эта тренировка уже неактивна.');
      return;
    }

    // Check if already registered
    const existing = event.participants.find(p => p.userId === userId);
    if (existing?.status === 'GOING') {
      await ctx.answerCallbackQuery('Ты уже в списке 😊');
      return;
    }

    // Check spots limit
    const goingCount = event.participants.filter(p => p.status === 'GOING').length;
    if (event.maxParticipants && goingCount >= event.maxParticipants) {
      await ctx.answerCallbackQuery(
        `Мест нет 😔 Все ${event.maxParticipants} мест заняты.`
      );
      return;
    }

    // Upsert participant
    await prisma.participant.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, username, firstName, status: 'GOING' },
      update: { status: 'GOING', username, firstName },
    });

    // Reload event and update card
    const updatedEvent = await prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });

    const keyboard = new InlineKeyboard()
      .text('✅ Иду', `go:${eventId}`)
      .text('❌ Не иду', `notgo:${eventId}`);

    try {
      await ctx.editMessageText(formatEventCard(updatedEvent!), {
        reply_markup: keyboard,
      });
    } catch (_) {
      // Message unchanged — that's fine
    }

    await ctx.answerCallbackQuery('Записал! Увидимся на тренировке 🎉');
  });

  // ── ❌ NOT GOING ──
  bot.callbackQuery(/^notgo:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });

    if (!event || event.status !== 'ACTIVE') {
      await ctx.answerCallbackQuery('Эта тренировка уже неактивна.');
      return;
    }

    const existing = event.participants.find(p => p.userId === userId);
    if (!existing || existing.status === 'NOT_GOING') {
      await ctx.answerCallbackQuery('Ты и так не в списке.');
      return;
    }

    // Remove from list
    await prisma.participant.update({
      where: { eventId_userId: { eventId, userId } },
      data: { status: 'NOT_GOING' },
    });

    // Reload and update card
    const updatedEvent = await prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });

    const keyboard = new InlineKeyboard()
      .text('✅ Иду', `go:${eventId}`)
      .text('❌ Не иду', `notgo:${eventId}`);

    try {
      await ctx.editMessageText(formatEventCard(updatedEvent!), {
        reply_markup: keyboard,
      });
    } catch (_) {
      // fine
    }

    await ctx.answerCallbackQuery('Понял, убрал тебя из списка.');
  });
}
