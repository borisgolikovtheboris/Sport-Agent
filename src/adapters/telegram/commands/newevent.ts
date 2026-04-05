import { Conversation } from "@grammyjs/conversations";
import { createEvent, saveMessageId } from "../../../services/eventService";
import { parseDate } from "../../../utils/parseDate";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { MyContext } from "../index";

type MyConversation = Conversation<MyContext, MyContext>;

export async function newEventConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Step 1: Title ──
  await ctx.reply("Создаём тренировку 🏃\nНапиши название:");

  const titleMsg = await conversation.waitFor("message:text");
  if (titleMsg.message.text.trim() === "/cancel") {
    await ctx.reply("❌ Создание отменено.");
    return;
  }
  const title = titleMsg.message.text.trim();

  // ── Step 2: Date & Time ──
  await ctx.reply(
    "📅 Когда? (формат: <code>ДД.ММ ЧЧ:ММ</code>)\nПример: <code>15.04 19:00</code>",
    { parse_mode: "HTML" }
  );

  let datetime: Date | null = null;
  while (!datetime) {
    const dateMsg = await conversation.waitFor("message:text");
    if (dateMsg.message.text.trim() === "/cancel") {
      await ctx.reply("❌ Создание отменено.");
      return;
    }
    datetime = parseDate(dateMsg.message.text.trim());
    if (!datetime) {
      await ctx.reply("⚠️ Не понял формат. Пример: <code>15.04 19:00</code>", {
        parse_mode: "HTML",
      });
    } else if (datetime < new Date()) {
      await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую:");
      datetime = null;
    }
  }

  // ── Step 3: Max participants ──
  await ctx.reply("👥 Максимум участников? (число или «без лимита»)");

  let maxParticipants: number | null = null;
  const limitMsg = await conversation.waitFor("message:text");
  const limitText = limitMsg.message.text.trim();
  if (limitText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  if (limitText !== "без лимита" && limitText !== "/skip") {
    const parsed = parseInt(limitText, 10);
    if (!isNaN(parsed) && parsed > 0) maxParticipants = parsed;
  }

  // ── Step 4: Price ──
  await ctx.reply("💰 Цена? (число в рублях или «бесплатно»)");

  let price: number | null = null;
  const priceMsg = await conversation.waitFor("message:text");
  const priceText = priceMsg.message.text.trim();
  if (priceText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  if (priceText !== "бесплатно" && priceText !== "/skip") {
    const parsed = parseInt(priceText, 10);
    if (!isNaN(parsed) && parsed > 0) price = parsed;
  }

  // ── Step 5: Payment info ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply("💳 Реквизиты для оплаты? (или «пропустить»)");
    const payMsg = await conversation.waitFor("message:text");
    const payText = payMsg.message.text.trim();
    if (payText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
    if (payText !== "пропустить" && payText !== "/skip") {
      paymentInfo = payText;
    }
  }

  // ── Create event ──
  const event = await createEvent({
    groupId: chatId,
    title,
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
