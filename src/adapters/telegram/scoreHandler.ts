import { Composer } from "grammy";
import prisma from "../../db/prisma";
import { MyContext } from "./index";

export function createScoreHandler(): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  composer.callbackQuery(/^score_skip:(.+)$/, async (ctx) => {
    const eventId = ctx.match![1];
    try {
      await ctx.answerCallbackQuery({ text: "Пропущено 👌" });
    } catch (_) {}
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (_) {}

    await prisma.participant.updateMany({
      where: { eventId, userId: String(ctx.from.id) },
      data: { score: -1 },
    });
  });

  composer.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();

    const userId = String(ctx.from.id);
    const text = ctx.message.text.trim();

    const scoreNum = parseInt(text, 10);
    if (isNaN(scoreNum) || scoreNum < 0) return next();

    const recentEvent = await prisma.participant.findFirst({
      where: {
        userId,
        status: "GOING",
        score: null,
        event: {
          status: "ACTIVE",
          datetime: { lt: new Date() },
        },
      },
      include: { event: true },
      orderBy: { event: { datetime: "desc" } },
    });

    if (!recentEvent) return next();

    await prisma.participant.update({
      where: { id: recentEvent.id },
      data: { score: scoreNum },
    });

    await ctx.reply(
      `✅ Записал: <b>${scoreNum}</b> очков за «${recentEvent.event.title}»!`,
      { parse_mode: "HTML" }
    );
  });

  return composer;
}
