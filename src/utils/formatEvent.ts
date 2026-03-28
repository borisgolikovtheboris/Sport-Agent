import { EventData, ParticipantData } from '../types';

const DAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                   'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDateRu(date: Date): string {
  const day = date.getDate();
  const month = MONTHS_RU[date.getMonth()];
  const weekday = DAYS_RU[date.getDay()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${weekday} · ${hours}:${minutes}`;
}

function formatParticipantName(p: ParticipantData): string {
  return p.username ? `@${p.username}` : p.firstName;
}

export function formatEventCard(event: EventData): string {
  const going = event.participants.filter((p: ParticipantData) => p.status === 'GOING');
  const spotsTotal = event.maxParticipants;
  const spotsUsed = going.length;

  const spotsLine = spotsTotal
    ? `👥 Участников: ${spotsUsed} / ${spotsTotal}`
    : `👥 Участников: ${spotsUsed}`;

  const participantList = going.length > 0
    ? going.map((p: ParticipantData, i: number) => `${i + 1}. ${formatParticipantName(p)}`).join('\n')
    : '(пока никого)';

  const isCancelled = event.status === 'CANCELLED';
  const titleLine = isCancelled
    ? `❌ ${event.title} — ОТМЕНЕНО`
    : `🏃 ${event.title}`;

  return [
    titleLine,
    `📅 ${formatDateRu(event.datetime)}`,
    spotsLine,
    '',
    'Идут:',
    participantList,
  ].join('\n');
}

export function formatEventShort(event: EventData, index: number): string {
  const going = event.participants.filter((p: ParticipantData) => p.status === 'GOING').length;
  const spots = event.maxParticipants ? `${going}/${event.maxParticipants}` : `${going}`;
  const hours = String(event.datetime.getHours()).padStart(2, '0');
  const minutes = String(event.datetime.getMinutes()).padStart(2, '0');
  const day = event.datetime.getDate();
  const month = MONTHS_RU[event.datetime.getMonth()];
  return `${index}. 🏃 ${event.title}\n   📅 ${day} ${month} · ${hours}:${minutes} · ${spots} чел.`;
}
