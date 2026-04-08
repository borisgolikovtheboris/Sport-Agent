import { NextFunction } from "grammy";
import prisma from "../../db/prisma";
import { formatEventCard, rsvpKeyboard } from "./formatters";
import { MyContext } from "./index";

// Pattern 1: Questions about price (from any participant)
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

// Pattern 2: Price statements (only from organizer)
const PRICE_STATEMENT_PATTERNS = [
  /^по\s*(\d+)\s*(руб|₽|р)/i,
  /^(\d+)\s*(руб|₽|р)\s*(с\s*(человека|чел|носа))?/i,
  /^цена\s*(\d+)/i,
  /^стоимость\s*(\d+)/i,
  /^(\d+)\s*(руб|₽|р)$/i,
];

function extractPrice(text: string): number | null {
  for (const pattern of PRICE_STATEMENT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const price = parseInt(match[1], 10);
      if (!isNaN(price) && price > 0) return price;
    }
  }
  return null;
}

export async function priceRequestHandler(ctx: MyContext, next: NextFunction): Promise<void> {
  if (!ctx.message?.text || ctx.chat?.type === "private") {
    return next();
  }

  const text = ctx.message.text.trim();
  const lower = text.toLowerCase();
  const groupId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Pattern 0: Change collector — "деньги собирает @vasya", "переводить мне", "платить @ivan" ──
  const collectorPatterns = [
    /(?:деньги|оплат[уа]?)\s+(?:собирает|принимает|на|к|у)\s+(.+)/,
    /(?:платить|переводить|кидать|скидывать)\s+(.+)/,
  ];
  let collectorMatch: RegExpMatchArray | null = null;
  for (const p of collectorPatterns) {
    collectorMatch = lower.match(p);
    if (collectorMatch) break;
  }
  if (collectorMatch) {
    const event = await prisma.event.findFirst({
      where: { groupId, status: "ACTIVE", datetime: { gt: new Date() }, price: { not: null } },
      orderBy: { datetime: "asc" },
    });

    if (event && event.createdBy === userId) {
      const raw = collectorMatch[1].trim();
      let collectorName: string;
      if (raw === "мне" || raw === "мне!" || raw === "я" || raw === "сам") {
        const fullName = [ctx.from!.first_name, (ctx.from as any).last_name].filter(Boolean).join(" ");
        collectorName = ctx.from!.username ? `@${ctx.from!.username}` : fullName;
      } else {
        collectorName = raw;
      }

      await prisma.event.update({
        where: { id: event.id },
        data: { collectorId: userId, collectorName },
      });

      await updateEventCard(ctx, event.id);
      await ctx.reply(`👤 Деньги собирает: ${collectorName}`);
      return;
    }
  }

  // ── Pattern 2: Organizer states price directly ──
  const extractedPrice = extractPrice(text);
  if (extractedPrice) {
    const event = await prisma.event.findFirst({
      where: {
        groupId,
        status: "ACTIVE",
        datetime: { gt: new Date() },
        price: null,
      },
      orderBy: { datetime: "asc" },
    });

    if (event && event.createdBy === userId) {
      // Organizer stated price → set it immediately
      await prisma.event.update({
        where: { id: event.id },
        data: { price: extractedPrice, priceRequested: true },
      });

      const msg = await ctx.reply(
        `💰 Принял! Стоимость: ${extractedPrice} ₽ с человека.\n💳 Куда переводить? Ответь на это сообщение реквизитами.`
      );

      await prisma.event.update({
        where: { id: event.id },
        data: { priceRequestMessageId: msg.message_id },
      });

      // Update event card to show price
      await updateEventCard(ctx, event.id);
      return;
    }
    // Not organizer → fall through to question detection or next()
  }

  // ── Pattern 1: Participant asks about price ──
  const hasPriceQuestion = PRICE_KEYWORDS.some((kw) => lower.includes(kw));
  if (!hasPriceQuestion) {
    return next();
  }

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

  await prisma.event.update({
    where: { id: event.id },
    data: { priceRequestMessageId: msg.message_id },
  });
}

async function updateEventCard(ctx: MyContext, eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
  });
  if (!event?.messageId) return;

  try {
    await ctx.api.editMessageText(
      event.groupId,
      event.messageId,
      formatEventCard(event),
      { parse_mode: "HTML", reply_markup: rsvpKeyboard(event.id) }
    );
  } catch (err) {
    // "message is not modified" is expected
  }
}
