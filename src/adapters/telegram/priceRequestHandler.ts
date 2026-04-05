import { NextFunction } from "grammy";
import prisma from "../../db/prisma";
import { MyContext } from "./index";

const PRICE_KEYWORDS = [
  "сколько стоит",
  "какая цена",
  "какая стоимость",
  "по сколько",
  "почём",
  "почем",
  "за сколько",
  "а платно",
  "это платно",
  "скидываемся",
  "сколько скидываться",
  "сколько денег",
  "сколько кидать",
  "какой прайс",
];

export async function priceRequestHandler(ctx: MyContext, next: NextFunction): Promise<void> {
  if (!ctx.message?.text || ctx.chat?.type === "private") {
    return next();
  }

  const text = ctx.message.text.toLowerCase();

  const hasPriceQuestion = PRICE_KEYWORDS.some((kw) => text.includes(kw));
  if (!hasPriceQuestion) {
    return next();
  }

  const groupId = String(ctx.chat!.id);

  // Find nearest ACTIVE event WITHOUT price in this group
  const event = await prisma.event.findFirst({
    where: {
      groupId,
      status: "ACTIVE",
      datetime: { gt: new Date() },
      price: null,
      priceRequested: false,
    },
    orderBy: { datetime: "asc" },
  });

  if (!event) {
    return next();
  }

  // Mark as requested (rate-limit: once per event)
  await prisma.event.update({
    where: { id: event.id },
    data: { priceRequested: true },
  });

  // Get organizer mention
  let organizerMention: string;
  try {
    const member = await ctx.api.getChatMember(ctx.chat!.id, Number(event.createdBy));
    const user = member.user;
    organizerMention = user.username ? `@${user.username}` : user.first_name;
  } catch {
    organizerMention = "Организатор";
  }

  // Send price request to group
  const msg = await ctx.reply(
    `💰 ${organizerMention}, участники интересуются стоимостью:\n` +
      `⚽ ${event.title}\n\n` +
      `Укажи цену с человека (ответь на это сообщение числом):`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Бесплатная", callback_data: `price_confirm_free:${event.id}` }],
        ],
      },
    }
  );

  // Save messageId for reply tracking
  await prisma.event.update({
    where: { id: event.id },
    data: { priceRequestMessageId: msg.message_id },
  });
}
