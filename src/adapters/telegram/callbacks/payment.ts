import { Bot } from "grammy";
import { confirmPayment, getPaymentSummary } from "../../../services/paymentService";
import { getEvent } from "../../../services/eventService";
import { paymentKeyboard, paymentSummaryKeyboard } from "../formatters";
import { MyContext } from "../index";
import prisma from "../../../db/prisma";

export function registerPaymentCallbacks(bot: Bot<MyContext>) {
  // ── 💳 Оплатил ──
  bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const result = await confirmPayment(eventId, userId);
    await ctx.answerCallbackQuery(result.message);

    if (result.success) {
      // Notify organizer in private
      const event = await getEvent(eventId);
      if (event) {
        try {
          await ctx.api.sendMessage(
            event.createdBy,
            `💰 ${ctx.from.first_name} отметил(а) оплату за «${event.title}»`
          );
        } catch (_) {
          // Can't send to organizer's DM — send to group
          await ctx.api.sendMessage(
            event.groupId,
            `💰 ${ctx.from.first_name} отметил(а) оплату за «${event.title}»`
          );
        }
      }
    }
  });

  // ── 🔔 Напомнить неоплатившим ──
  bot.callbackQuery(/^remind_pay:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const event = await getEvent(eventId);
    if (!event) {
      await ctx.answerCallbackQuery("Тренировка не найдена.");
      return;
    }

    if (event.createdBy !== userId) {
      await ctx.answerCallbackQuery("⚠️ Только организатор может отправить напоминание.");
      return;
    }

    // Rate limit: 1 reminder per 4 hours
    if (event.lastPaymentReminder) {
      const hoursSince = (Date.now() - event.lastPaymentReminder.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 4) {
        const hoursLeft = Math.ceil(4 - hoursSince);
        await ctx.answerCallbackQuery(`Напоминание уже отправлено. Следующее через ${hoursLeft} ч.`);
        return;
      }
    }

    const summary = await getPaymentSummary(eventId);
    if (!summary || summary.unpaid === 0) {
      await ctx.answerCallbackQuery("Все уже оплатили! 🎉");
      return;
    }

    const mentions = summary.unpaidList
      .map((p) => (p.username ? `@${p.username}` : p.firstName))
      .join(" ");

    const payInfoLine = event.paymentInfo ? `\n💳 Реквизиты: ${event.paymentInfo}` : "";

    await ctx.api.sendMessage(
      event.groupId,
      `💰 Напоминание об оплате!\n\n` +
        `🏃 ${event.title} — ${event.price} ₽\n\n` +
        `Не забудьте оплатить:\n${mentions}` +
        payInfoLine,
      { reply_markup: paymentKeyboard(eventId) }
    );

    await prisma.event.update({
      where: { id: eventId },
      data: { lastPaymentReminder: new Date() },
    });

    await ctx.answerCallbackQuery("Напоминание отправлено!");
  });

  // ── Payment summary for specific event ──
  bot.callbackQuery(/^payments_detail:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];

    const summary = await getPaymentSummary(eventId);
    if (!summary) {
      await ctx.answerCallbackQuery("Тренировка не найдена.");
      return;
    }

    const { event } = summary;
    const dateStr = event.datetime.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });

    const totalAmount = (event.price ?? 0) * summary.total;

    const paidNames =
      summary.paid > 0
        ? summary.paidList.map((p, i) => `${i + 1}. ${p.username ? `@${p.username}` : p.firstName}`).join("\n")
        : "(никто)";

    const unpaidNames =
      summary.unpaid > 0
        ? summary.unpaidList
            .map((p, i) => `${summary.paid + i + 1}. ${p.username ? `@${p.username}` : p.firstName}`)
            .join("\n")
        : "(все оплатили)";

    const text =
      `💰 Оплата: ${event.title} (${dateStr})\n` +
      `Стоимость: ${event.price} ₽ × ${summary.total} человек = ${totalAmount} ₽\n\n` +
      `✅ Оплатили (${summary.paid}):\n${paidNames}\n\n` +
      `❌ Не оплатили (${summary.unpaid}):\n${unpaidNames}`;

    await ctx.editMessageText(text, {
      reply_markup: summary.unpaid > 0 ? paymentSummaryKeyboard(eventId) : undefined,
    });
    await ctx.answerCallbackQuery();
  });
}
