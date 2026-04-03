import { Event, EventSeries, Participant } from "@prisma/client";
import { InlineKeyboard } from "grammy";

type EventWithParticipants = Event & { participants: Participant[] };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatParticipantName(p: Participant): string {
  return p.username ? `@${p.username}` : escapeHtml(p.firstName);
}

function formatDateRu(date: Date): string {
  const DAYS_RU = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const day = date.getDate();
  const month = MONTHS_RU[date.getMonth()];
  const weekday = DAYS_RU[date.getDay()];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month}, ${weekday} · ${hours}:${minutes}`;
}

export function formatEventCard(event: EventWithParticipants): string {
  const going = event.participants.filter((p) => p.status === "GOING");
  const spotsUsed = going.length;

  const spotsLine = event.maxParticipants
    ? `👥 Участников: ${spotsUsed} / ${event.maxParticipants}`
    : `👥 Участников: ${spotsUsed}`;

  const participantList =
    going.length > 0
      ? going.map((p, i) => `${i + 1}. ${formatParticipantName(p)}`).join("\n")
      : "(пока никого)";

  const titleLine =
    event.status === "CANCELLED"
      ? `❌ <s>${escapeHtml(event.title)}</s> ОТМЕНЕНО`
      : `🏃 <b>${escapeHtml(event.title)}</b>`;

  const lines = [titleLine, `📅 ${formatDateRu(event.datetime)}`, spotsLine];
  if (event.price) {
    lines.push(`💰 ${event.price} ₽ с человека`);
  }
  lines.push("", "Идут:", participantList);
  return lines.join("\n");
}

export function formatEventsList(events: EventWithParticipants[]): string {
  if (events.length === 0) {
    return "📋 Нет запланированных тренировок.\n\nСоздай первую командой /newevent";
  }

  const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  const list = events
    .map((e, i) => {
      const going = e.participants.filter((p) => p.status === "GOING").length;
      const spots = e.maxParticipants ? `${going}/${e.maxParticipants}` : `${going}`;
      const hours = String(e.datetime.getHours()).padStart(2, "0");
      const minutes = String(e.datetime.getMinutes()).padStart(2, "0");
      const day = e.datetime.getDate();
      const month = MONTHS_RU[e.datetime.getMonth()];
      return `${i + 1}. 🏃 ${escapeHtml(e.title)}\n   📅 ${day} ${month} · ${hours}:${minutes} · ${spots} чел.`;
    })
    .join("\n\n");

  return `📋 <b>Ближайшие тренировки:</b>\n\n${list}`;
}

export function rsvpKeyboard(eventId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Иду", `go:${eventId}`)
    .text("❌ Не иду", `notgo:${eventId}`);
}

export function paymentKeyboard(eventId: string): InlineKeyboard {
  return new InlineKeyboard().text("💳 Оплатил", `paid:${eventId}`);
}

export function paymentSummaryKeyboard(eventId: string): InlineKeyboard {
  return new InlineKeyboard().text("🔔 Напомнить неоплатившим", `remind_pay:${eventId}`);
}

const DAYS_RU_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function formatSeriesCard(
  series: EventSeries,
  events: (Event & { participants: Participant[] })[]
): string {
  const daysStr = series.daysOfWeek.sort().map((d) => DAYS_RU_SHORT[d]).join("/");
  const lines = [
    `📅 <b>Создана серия тренировок!</b>`,
    ``,
    `🏃 ${escapeHtml(series.title)} — каждый ${daysStr} в ${series.time}`,
  ];

  if (series.maxParticipants) lines.push(`👥 Мест: ${series.maxParticipants}`);
  if (series.price) lines.push(`💰 ${series.price} ₽`);

  lines.push("", "Ближайшие:");
  const preview = events.slice(0, 3);
  for (const e of preview) {
    lines.push(`• ${formatDateRu(e.datetime)}`);
  }
  if (events.length > 3) {
    lines.push(`... и ещё ${events.length - 3} тренировок`);
  }

  return lines.join("\n");
}

export function cancelSeriesKeyboard(eventId: string, seriesId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Только эту", `cancel_confirm:${eventId}`)
    .row()
    .text("Все будущие", `cancel_series_all:${seriesId}`)
    .row()
    .text("← Оставить", `cancel_abort:${eventId}`);
}

export function cancelConfirmKeyboard(eventId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Отменить тренировку", `cancel_confirm:${eventId}`)
    .row()
    .text("← Оставить", `cancel_abort:${eventId}`);
}
