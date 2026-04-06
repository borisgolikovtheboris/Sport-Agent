import { InlineKeyboard } from "grammy";
import { MyContext } from "../index";

export async function startCommand(ctx: MyContext) {
  const kb = new InlineKeyboard().url(
    "➕ Добавить в группу",
    `https://t.me/${ctx.me.username}?startgroup=true`
  );

  await ctx.reply(
    `Привет! 👋 Я <b>SportBot</b>.\n\n` +
      `Добавь меня в групповой чат, и я помогу организовать тренировки.\n\n` +
      `Как это работает:\n` +
      `1. Добавь меня в группу\n` +
      `2. Напиши «Футбол в среду в 19:00»\n` +
      `3. Я создам карточку — участники запишутся кнопками`,
    { parse_mode: "HTML", reply_markup: kb }
  );
}
