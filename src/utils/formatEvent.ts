import { Event, Participant } from "@prisma/client";

type EventWithParticipants = Event & { participants: Participant[] };

/**
 * Платформо-независимое форматирование события в plain text.
 * Используется будущими адаптерами (REST, WhatsApp) и для логов.
 */
export function formatEventPlain(event: EventWithParticipants): string {
  const going = event.participants.filter((p) => p.status === "GOING");

  const dateStr = event.datetime.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
  });
  const timeStr = event.datetime.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const spotsLine = event.maxParticipants
    ? `Мест: ${going.length} / ${event.maxParticipants}`
    : `Участников: ${going.length}`;

  const participants =
    going.length === 0
      ? "(пока никого)"
      : going.map((p, i) => `${i + 1}. ${p.firstName}`).join("\n");

  return [
    event.title,
    `${dateStr} · ${timeStr}`,
    spotsLine,
    "",
    `Идут:\n${participants}`,
  ].join("\n");
}
