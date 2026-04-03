import { MyContext } from "../index";

export async function startCommand(ctx: MyContext) {
  const payload = ctx.match; // deep link payload after /start

  if (typeof payload === "string" && payload.startsWith("newevent_")) {
    const groupChatId = payload.replace("newevent_", "");
    if (!groupChatId) {
      await ctx.reply("⚠️ Некорректная ссылка. Попробуй /newevent в группе.");
      return;
    }

    // Store groupChatId in session and enter DM conversation
    (ctx.session as any).dmGroupChatId = groupChatId;
    await ctx.conversation.enter("newEventDM");
    return;
  }

  // Default /start
  await ctx.reply(
    `👋 Привет! Я <b>SportBot</b> — помогаю организовывать групповые тренировки.\n\n` +
      `Добавь меня в группу и используй /newevent для создания тренировок.\n\n` +
      `Или напиши /newevent прямо здесь, если я уже есть в твоих группах.`,
    { parse_mode: "HTML" }
  );
}
