import { Context } from "grammy";
import { listActiveEvents } from "../../../services/eventService";
import { cancelConfirmKeyboard } from "../formatters";

export async function cancelCommand(ctx: Context) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
    return;
  }

  const userId = String(ctx.from!.id);
  const groupId = String(ctx.chat!.id);

  const result = await listActiveEvents(groupId);
  const myEvents = result.events.filter((e) => e.createdBy === userId);

  if (myEvents.length === 0) {
    await ctx.reply("У тебя нет активных тренировок для отмены.");
    return;
  }

  for (const event of myEvents) {
    const dateStr = event.datetime.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
    await ctx.reply(`Отменить «${event.title}» (${dateStr})?`, {
      reply_markup: cancelConfirmKeyboard(event.id),
    });
  }
}
