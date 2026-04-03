import { Api, RawApi } from "grammy";
import { getDueReminders, markReminderSent, PendingReminder } from "./services/reminderService";
import { formatEventCard, rsvpKeyboard, paymentKeyboard } from "./adapters/telegram/formatters";
import { getEvent } from "./services/eventService";

const INTERVAL_MS = 60 * 1000; // 60 seconds

export function startScheduler(api: Api<RawApi>) {
  console.log("⏰ Reminder scheduler started (every 60s)");

  setInterval(async () => {
    try {
      const reminders = await getDueReminders();

      for (const r of reminders) {
        try {
          if (r.type === "SIGNUP_24H") {
            await sendSignupReminder(api, r);
          } else if (r.type === "PAYMENT_AFTER") {
            await sendPaymentReminder(api, r);
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
