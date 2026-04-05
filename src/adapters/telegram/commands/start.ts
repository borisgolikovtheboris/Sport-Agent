import { MyContext } from "../index";

export async function startCommand(ctx: MyContext) {
  await ctx.reply(
    `👋 Привет! Я <b>SportBot</b> — помогаю организовывать групповые тренировки.\n\n` +
      `Добавь меня в группу и используй /newevent для создания тренировок.`,
    { parse_mode: "HTML" }
  );
}
