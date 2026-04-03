import { Context, InlineKeyboard } from "grammy";
import { listActiveEvents } from "../../../services/eventService";

export async function paymentsCommand(ctx: Context) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
    return;
  }

  const userId = String(ctx.from!.id);
  const groupId = String(ctx.chat!.id);

  const result = await listActiveEvents(groupId);
  const myPaidEvents = result.events.filter(
    (e) => e.createdBy === userId && e.price
  );

  if (myPaidEvents.length === 0) {
    await ctx.reply("У тебя нет тренировок с оплатой.");
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const event of myPaidEvents) {
    const dateStr = event.datetime.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
    keyboard.text(`${event.title} (${dateStr})`, `payments_detail:${event.id}`).row();
  }

  await ctx.reply("💰 Выбери тренировку для просмотра оплат:", {
    reply_markup: keyboard,
  });
}
