import { InlineKeyboard } from "grammy";
import { listActiveEvents } from "../../../services/eventService";
import { MyContext } from "../index";

function formatShortDateTime(d: Date): string {
  const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек"];
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${h}:${m}`;
}

export async function rescheduleCommand(ctx: MyContext) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
    return;
  }

  const userId = String(ctx.from!.id);
  const groupId = String(ctx.chat!.id);

  const { events } = await listActiveEvents(groupId);
  const myEvents = events.filter((e) => e.createdBy === userId);

  if (myEvents.length === 0) {
    await ctx.reply("У тебя нет активных тренировок для переноса.");
    return;
  }

  if (myEvents.length === 1) {
    const event = myEvents[0];
    (ctx.session as any).pendingReschedule = {
      eventId: event.id,
      chatId: groupId,
      userId,
    };
    await ctx.reply(
      `⏰ Перенос «${event.title}» (сейчас ${formatShortDateTime(event.datetime)}).\n` +
        `На когда? (например: <code>20:00</code>, <code>завтра в 20</code>, <code>16.04 19:00</code>)`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const e of myEvents) {
    kb.text(`${e.title} · ${formatShortDateTime(e.datetime)}`, `resched_pick:${e.id}`).row();
  }
  await ctx.reply("Какую тренировку перенести?", { reply_markup: kb });
}
