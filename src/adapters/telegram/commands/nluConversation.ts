import { Conversation } from "@grammyjs/conversations";
import { createEvent, saveMessageId } from "../../../services/eventService";
import { parseDate } from "../../../utils/parseDate";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { MyContext } from "../index";
import { ParsedIntent } from "../../../nlu/intentParser";

type MyConversation = Conversation<MyContext, MyContext>;

/**
 * Shortened conversation — only asks for missing fields from NLU.
 * Receives partial entities via session.nluData.
 */
export async function nluConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  const nluData = (ctx.session as any).nluData as ParsedIntent | undefined;
  if (!nluData) return;

  const entities = { ...nluData.entities };
  const missing = [...nluData.missingFields];

  // ── Ask for missing title ──
  if (!entities.title || missing.includes("title")) {
    await ctx.reply("📝 Как назовём тренировку?");
    const msg = await conversation.waitFor("message:text");
    if (msg.message.text.trim() === "/cancel") {
      await ctx.reply("❌ Создание отменено.");
      return;
    }
    entities.title = msg.message.text.trim();
  }

  // ── Ask for missing date/time ──
  let datetime: Date | null = null;

  if (entities.date && entities.time) {
    // Both provided by NLU — construct Date
    datetime = new Date(`${entities.date}T${entities.time}:00`);
    if (isNaN(datetime.getTime()) || datetime < new Date()) {
      datetime = null;
    }
  }

  if (!datetime) {
    const hint = entities.title ? `⚽ ${entities.title} — ` : "";
    await ctx.reply(
      `${hint}📅 Когда? (формат: <code>ДД.ММ ЧЧ:ММ</code>)`,
      { parse_mode: "HTML" }
    );

    while (!datetime) {
      const msg = await conversation.waitFor("message:text");
      if (msg.message.text.trim() === "/cancel") {
        await ctx.reply("❌ Создание отменено.");
        return;
      }
      datetime = parseDate(msg.message.text.trim());
      if (!datetime) {
        await ctx.reply("⚠️ Не понял формат. Пример: <code>15.04 19:00</code>", {
          parse_mode: "HTML",
        });
      } else if (datetime < new Date()) {
        await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую:");
        datetime = null;
      }
    }
  }

  // ── Ask for max participants if missing ──
  let maxParticipants: number | null = entities.maxParticipants ?? null;
  if (!maxParticipants && missing.includes("maxParticipants")) {
    await ctx.reply("👥 Сколько мест? (число или /skip)");
    const msg = await conversation.waitFor("message:text");
    const t = msg.message.text.trim();
    if (t !== "/skip" && t !== "/cancel") {
      const parsed = parseInt(t, 10);
      if (!isNaN(parsed) && parsed > 0) maxParticipants = parsed;
    }
    if (t === "/cancel") {
      await ctx.reply("❌ Создание отменено.");
      return;
    }
  }

  // ── Price (from NLU or skip) ──
  let price: number | null = entities.price ?? null;

  // ── Payment info if price is set ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply(
      "💳 Куда переводить? (реквизиты или /skip)",
    );
    const msg = await conversation.waitFor("message:text");
    const t = msg.message.text.trim();
    if (t !== "/skip" && t !== "/cancel") {
      paymentInfo = t;
    }
    if (t === "/cancel") {
      await ctx.reply("❌ Создание отменено.");
      return;
    }
  }

  // ── Create event ──
  const event = await createEvent({
    groupId: chatId,
    title: entities.title!,
    datetime,
    maxParticipants,
    price,
    paymentInfo,
    createdBy: userId,
  });

  const sent = await ctx.reply(formatEventCard(event), {
    reply_markup: rsvpKeyboard(event.id),
    parse_mode: "HTML",
  });

  await saveMessageId(event.id, sent.message_id);
}
