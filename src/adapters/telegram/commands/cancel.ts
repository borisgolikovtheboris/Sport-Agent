import { listActiveEvents } from "../../../services/eventService";
import { cancelConfirmKeyboard, cancelSeriesKeyboard } from "../formatters";
import { MyContext } from "../index";

export async function cancelCommand(ctx: MyContext) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
    return;
  }

  const userId = String(ctx.from!.id);
  const groupId = String(ctx.chat!.id);

  const session = ctx.session as any;
  const hadPending = !!(
    session.pendingEvent ||
    session.pendingSeries ||
    session.pendingSeriesConfirm ||
    session.pendingRecurrenceCheck ||
    session.pendingReschedule
  );
  delete session.pendingEvent;
  delete session.pendingSeries;
  delete session.pendingSeriesConfirm;
  delete session.pendingRecurrenceCheck;
  delete session.pendingReschedule;

  const result = await listActiveEvents(groupId);
  const myEvents = result.events.filter((e) => e.createdBy === userId);

  if (myEvents.length === 0) {
    await ctx.reply(
      hadPending
        ? "Создание отменено ❌"
        : "У тебя нет активных тренировок для отмены."
    );
    return;
  }

  for (const event of myEvents) {
    const dateStr = event.datetime.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });

    if ((event as any).seriesId) {
      await ctx.reply(
        `Это тренировка из серии. Отменить «${event.title}» (${dateStr})?`,
        { reply_markup: cancelSeriesKeyboard(event.id, (event as any).seriesId) }
      );
    } else {
      await ctx.reply(`Отменить «${event.title}» (${dateStr})?`, {
        reply_markup: cancelConfirmKeyboard(event.id),
      });
    }
  }
}
