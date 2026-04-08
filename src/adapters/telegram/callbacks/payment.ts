import { Bot, InlineKeyboard } from "grammy";
import { confirmPayment, verifyPayment, rejectPayment, getPaymentSummary } from "../../../services/paymentService";
import { getEvent } from "../../../services/eventService";
import { paymentKeyboard, paymentSummaryKeyboard } from "../formatters";
import { MyContext } from "../index";
import prisma from "../../../db/prisma";

async function safeAnswer(ctx: MyContext, opts: { text: string; show_alert?: boolean }) {
  try { await ctx.answerCallbackQuery(opts); } catch (_) {}
}

export function registerPaymentCallbacks(bot: Bot<MyContext>) {
  // ── 💳 Оплатил ──
  bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const result = await confirmPayment(eventId, userId);
    if (!result.success) {
      await safeAnswer(ctx, { text: result.message, show_alert: result.message.includes("не записан") });
      return;
    }
    await safeAnswer(ctx, { text: "Отмечено! Организатор увидит 💰" });

    const event = await getEvent(eventId);
    if (event) {
      const verifyKb = new InlineKeyboard()
        .text("✅ Подтвердить", `verify_pay:${eventId}:${userId}`)
        .text("❌ Отклонить", `reject_pay:${eventId}:${userId}`);

      const text = `💳 <b>Оплата</b>: ${ctx.from.first_name} отметил(а) оплату за «${event.title}» (${event.price} ₽)`;

      try {
        await ctx.api.sendMessage(event.createdBy, text, {
          parse_mode: "HTML",
          reply_markup: verifyKb,
        });
      } catch (_) {
        await ctx.api.sendMessage(
          event.groupId,
          `💰 ${ctx.from.first_name} отметил(а) оплату за «${event.title}»`
        );
      }
    }
  });

  // ── ✅ Организатор подтверждает оплату ──
  bot.callbackQuery(/^verify_pay:(.+):(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = ctx.match[2];
    const organizerId = String(ctx.from.id);

    const result = await verifyPayment(eventId, userId, organizerId);
    if (!result.success) {
      await safeAnswer(ctx, { text: result.message, show_alert: true });
      return;
    }
    await safeAnswer(ctx, { text: "Оплата подтверждена ✅" });

    await ctx.editMessageText(ctx.msg?.text + "\n\n✅ Подтверждено");

    const event = await getEvent(eventId);
    if (event) {
      try {
        await ctx.api.sendMessage(
          userId,
          `✅ Организатор подтвердил твою оплату за «${event.title}»`
        );
      } catch (_) {
        const payment = await prisma.payment.findUnique({
          where: { eventId_userId: { eventId, userId } },
        });
        const name = payment?.username ? `@${payment.username}` : payment?.firstName ?? "Участник";
        await ctx.api.sendMessage(
          event.groupId,
          `✅ ${name}, оплата за «${event.title}» подтверждена`
        );
      }
    }
  });

  // ── ❌ Организатор отклоняет оплату ──
  bot.callbackQuery(/^reject_pay:(.+):(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = ctx.match[2];
    const organizerId = String(ctx.from.id);

    const result = await rejectPayment(eventId, userId, organizerId);
    if (!result.success) {
      await safeAnswer(ctx, { text: result.message, show_alert: true });
      return;
    }
    await safeAnswer(ctx, { text: "Оплата отклонена" });

    await ctx.editMessageText(ctx.msg?.text + "\n\n❌ Отклонено");

    const event = await getEvent(eventId);
    if (event) {
      try {
        await ctx.api.sendMessage(
          userId,
          `❌ Организатор не подтвердил оплату за «${event.title}». Свяжись с ним для уточнения.`
        );
      } catch (_) {
        const payment = await prisma.payment.findUnique({
          where: { eventId_userId: { eventId, userId } },
        });
        const name = payment?.username ? `@${payment.username}` : payment?.firstName ?? "Участник";
        await ctx.api.sendMessage(
          event.groupId,
          `❌ ${name}, оплата за «${event.title}» не подтверждена. Свяжись с организатором.`
        );
      }
    }
  });

  // ── 🔔 Напомнить неоплатившим ──
  bot.callbackQuery(/^remind_pay:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const userId = String(ctx.from.id);

    const event = await getEvent(eventId);
    if (!event) {
      await safeAnswer(ctx, { text: "Тренировка не найдена.", show_alert: true });
      return;
    }

    if (event.createdBy !== userId) {
      await safeAnswer(ctx, { text: "Только организатор может отправить напоминание", show_alert: true });
      return;
    }

    // Rate limit: 1 reminder per 4 hours
    if (event.lastPaymentReminder) {
      const hoursSince = (Date.now() - event.lastPaymentReminder.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 4) {
        const hoursLeft = Math.ceil(4 - hoursSince);
        await safeAnswer(ctx, { text: `Напоминание уже отправлено. Следующее через ${hoursLeft} ч.`, show_alert: true });
        return;
      }
    }

    const summary = await getPaymentSummary(eventId);
    if (!summary || summary.unpaid === 0) {
      await safeAnswer(ctx, { text: "Все уже оплатили! 🎉" });
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

    await safeAnswer(ctx, { text: "Напоминание отправлено 🔔" });
  });

  // ── Payment summary for specific event ──
  bot.callbackQuery(/^payments_detail:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];

    const summary = await getPaymentSummary(eventId);
    if (!summary) {
      await safeAnswer(ctx, { text: "Тренировка не найдена.", show_alert: true });
      return;
    }

    const { event } = summary;
    const dateStr = event.datetime.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });

    const totalAmount = (event.price ?? 0) * summary.total;

    const verifiedNames =
      summary.verified > 0
        ? summary.verifiedList.map((p, i) => `${i + 1}. ${p.username ? `@${p.username}` : p.firstName}`).join("\n")
        : "(никто)";

    const pendingNames =
      summary.pending > 0
        ? summary.pendingList.map((p, i) => `${summary.verified + i + 1}. ${p.username ? `@${p.username}` : p.firstName}`).join("\n")
        : "(нет)";

    const unpaidNames =
      summary.unpaid > 0
        ? summary.unpaidList
            .map((p, i) => `${summary.verified + summary.pending + i + 1}. ${p.username ? `@${p.username}` : p.firstName}`)
            .join("\n")
        : "(все оплатили)";

    let text =
      `💰 Оплата: ${event.title} (${dateStr})\n` +
      `Стоимость: ${event.price} ₽ × ${summary.total} человек = ${totalAmount} ₽\n\n` +
      `✅ Подтверждено (${summary.verified}):\n${verifiedNames}\n\n`;

    if (summary.pending > 0) {
      text += `⏳ Ожидает подтверждения (${summary.pending}):\n${pendingNames}\n\n`;
    }

    text += `❌ Не оплатили (${summary.unpaid}):\n${unpaidNames}`;

    // Build keyboard with verify/reject for pending + remind button
    const kb = new InlineKeyboard();
    for (const p of summary.pendingList) {
      const name = p.username ? `@${p.username}` : p.firstName;
      kb.text(`✅ ${name}`, `verify_pay:${eventId}:${p.userId}`)
        .text(`❌ ${name}`, `reject_pay:${eventId}:${p.userId}`)
        .row();
    }
    if (summary.unpaid > 0) {
      kb.text("🔔 Напомнить неоплатившим", `remind_pay:${eventId}`).row();
    }

    await safeAnswer(ctx, { text: "💰" });
    await ctx.editMessageText(text, {
      reply_markup: kb.inline_keyboard.length > 0 ? kb : undefined,
    });
  });
}
