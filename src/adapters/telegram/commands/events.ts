import { Context } from "grammy";
import { listActiveEvents } from "../../../services/eventService";
import { formatEventsList } from "../formatters";

export async function eventsCommand(ctx: Context) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
    return;
  }

  const result = await listActiveEvents(String(ctx.chat!.id));
  await ctx.reply(formatEventsList(result.events), { parse_mode: "HTML" });
}
