import { Api, RawApi } from "grammy";
import { getDueReminders, markReminderSent, PendingReminder } from "./services/reminderService";
import { formatEventCard, rsvpKeyboard, paymentKeyboard } from "./adapters/telegram/formatters";
import { getEvent, saveMessageId } from "./services/eventService";
import { getKnownGroupMembers } from "./services/participantService";
import prisma from "./db/prisma";

const INTERVAL_MS = 60 * 1000; // 60 seconds
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 8;
const MOSCOW_UTC_OFFSET = 3; // MSK = UTC+3, no DST

function isQuietHours(d: Date = new Date()): boolean {
  const moscowHour = (d.getUTCHours() + MOSCOW_UTC_OFFSET) % 24;
  return moscowHour >= QUIET_START_HOUR || moscowHour < QUIET_END_HOUR;
}

export function startScheduler(api: Api<RawApi>) {
  console.log("⏰ Reminder scheduler started (every 60s, quiet hours 23:00–08:00 MSK)");

  setInterval(async () => {
    try {
      if (isQuietHours()) return;

      const reminders = await getDueReminders();

      for (const r of reminders) {
        try {
          if (r.type === "SIGNUP_24H") {
            await sendSignupReminder(api, r);
          } else if (r.type === "PAYMENT_AFTER") {
            await sendPaymentReminder(api, r);
          } else if (r.type === "SERIES_PUBLISH_48H") {
            await publishSeriesEvent(api, r);
          } else if (r.type === "RSVP_NUDGE") {
            await sendRsvpNudge(api, r);
          }
        } catch (err) {
          console.error(`Failed to send reminder ${r.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Scheduler error:", err);
    }
  }, INTERVAL_MS);
}

async function sendSignupReminder(api: Api<RawApi>, r: PendingReminder) {
  const event = await getEvent(r.eventId);
  if (!event) return;

  const card = formatEventCard(event);
  const text = `⏰ Напоминание!\n\n${card}\n\nЕщё не записался? Жми кнопку ниже 👇`;

  const sent = await api.sendMessage(event.groupId, text, {
    reply_markup: rsvpKeyboard(event.id),
    parse_mode: "HTML",
  });

  await markReminderSent(r.id, sent.message_id);
}

async function publishSeriesEvent(api: Api<RawApi>, r: PendingReminder) {
  const event = await getEvent(r.eventId);
  if (!event || event.status !== "ACTIVE") {
    await markReminderSent(r.id);
    return;
  }

  const card = formatEventCard(event);
  const sent = await api.sendMessage(event.groupId, card, {
    reply_markup: rsvpKeyboard(event.id),
    parse_mode: "HTML",
  });

  await saveMessageId(event.id, sent.message_id);
  await markReminderSent(r.id, sent.message_id);
}

async function sendPaymentReminder(api: Api<RawApi>, r: PendingReminder) {
  const event = await getEvent(r.eventId);
  if (!event || !event.price) return;

  const payInfoLine = event.paymentInfo ? `\n💳 Реквизиты: ${event.paymentInfo}` : "";

  const text =
    `💰 Тренировка завершена!\n\n` +
    `🏃 ${event.title}\n` +
    `Стоимость: ${event.price} ₽ с человека\n\n` +
    `Участники, отправьте оплату организатору и нажмите «Оплатил»:` +
    payInfoLine;

  const sent = await api.sendMessage(event.groupId, text, {
    reply_markup: paymentKeyboard(event.id),
  });

  await markReminderSent(r.id, sent.message_id);
}

// ── RSVP_NUDGE: personal ping to unresponded members ──

async function sendRsvpNudge(api: Api<RawApi>, r: PendingReminder) {
  const event = await getEvent(r.eventId);
  if (!event || event.status !== "ACTIVE") {
    await markReminderSent(r.id);
    return;
  }

  // Get known group members
  const knownMembers = await getKnownGroupMembers(event.groupId);

  // Get who already responded to THIS event
  const responded = await prisma.participant.findMany({
    where: { eventId: event.id },
    select: { userId: true },
  });
  const respondedIds = new Set(responded.map((p) => p.userId));

  // Filter unresponded
  const unresponded = knownMembers.filter((u) => !respondedIds.has(u.userId));

  if (unresponded.length === 0) {
    await prisma.reminder.update({
      where: { id: r.id },
      data: { status: "SENT", sentAt: new Date(), nudgeDmSent: 0, nudgeDmFailed: 0 },
    });
    return;
  }

  // Count going participants
  const goingCount = event.participants.filter((p) => p.status === "GOING").length;

  const dmText = formatNudgeDM(event, goingCount);
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "✅ Иду", callback_data: `go:${event.id}` },
        { text: "❌ Не иду", callback_data: `notgo:${event.id}` },
      ],
    ],
  };

  // Try DM each unresponded member
  const dmFailed: typeof unresponded = [];
  let dmSent = 0;

  for (const user of unresponded) {
    try {
      await api.sendMessage(Number(user.userId), dmText, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      dmSent++;
    } catch {
      dmFailed.push(user);
    }
    // Small delay to avoid rate limits
    if (unresponded.length > 10) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Fallback: one message in group for those DM failed
  if (dmFailed.length > 0) {
    const mentions = dmFailed
      .map((u) => (u.username ? `@${u.username}` : u.firstName))
      .join(" ");

    const groupText = formatNudgeGroup(event, mentions);

    await api.sendMessage(event.groupId, groupText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  // Update reminder
  await prisma.reminder.update({
    where: { id: r.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      nudgeDmSent: dmSent,
      nudgeDmFailed: dmFailed.length,
    },
  });
}

function formatNudgeDM(
  event: { title: string; datetime: Date; maxParticipants: number | null },
  goingCount: number
): string {
  const d = event.datetime;
  const day = d.getDate();
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const month = MONTHS[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  const spots = event.maxParticipants
    ? `${goingCount} / ${event.maxParticipants}`
    : `${goingCount}`;

  return (
    `👋 Привет! Завтра тренировка, ты ещё не отметился(а):\n\n` +
    `🏃 <b>${event.title}</b>\n` +
    `📅 ${day} ${month} · ${hours}:${minutes}\n` +
    `👥 Записались: ${spots}\n\n` +
    `Идёшь?`
  );
}

function formatNudgeGroup(
  event: { title: string; datetime: Date },
  mentions: string
): string {
  const d = event.datetime;
  const day = d.getDate();
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const month = MONTHS[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return (
    `👋 Ребят, завтра тренировка — отметьтесь!\n\n` +
    `🏃 <b>${event.title}</b> · ${day} ${month} · ${hours}:${minutes}\n\n` +
    `Ждём ответа:\n${mentions}`
  );
}
