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
  await ctx.reply(
    "📝 <b>Создаём тренировку</b>\n\nНапиши название, например:\n<i>Футбол в Лужниках</i> или <i>Йога на крыше</i>",
    { parse_mode: "HTML" }
  );

  const titleMsg = await conversation.waitFor("message:text");
  const titleText = titleMsg.message.text.trim();
  if (titleText === "/cancel") {
    await ctx.reply("❌ Создание отменено.");
    return;
  }
  const title = titleText;

  // ── Step 2: Date & Time ──
  await ctx.reply(
    "📅 Отлично! Теперь дата и время.\n\nФормат: <code>ДД.ММ ЧЧ:ММ</code>\nПример: <code>15.04 19:00</code>\n\n<i>Напиши /cancel чтобы отменить</i>",
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
      await ctx.reply("⚠️ Не понял формат. Попробуй ещё раз:\nПример: <code>15.04 19:00</code>", {
        parse_mode: "HTML",
      });
    } else if (datetime < new Date()) {
      await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую дату:");
      datetime = null;
    }
  }

  // ── Step 3: Max participants ──
  await ctx.reply(
    "👥 Ограничить количество мест?\n\nНапиши число (например <code>12</code>) или /skip чтобы без ограничений",
    { parse_mode: "HTML" }
  );

  let maxParticipants: number | null = null;
  const limitMsg = await conversation.waitFor("message:text");
  const limitText = limitMsg.message.text.trim();
  if (limitText !== "/skip" && limitText !== "/cancel") {
    const parsed = parseInt(limitText, 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxParticipants = parsed;
    } else {
      await ctx.reply("⚠️ Не понял, создаю без ограничения мест.");
    }
  }
  if (limitText === "/cancel") {
    await ctx.reply("❌ Создание отменено.");
    return;
  }

  // ── Step 4: Price ──
  await ctx.reply(
    "💰 Укажи стоимость с человека (в рублях) или /skip если бесплатно:",
    { parse_mode: "HTML" }
  );

  let price: number | null = null;
  const priceMsg = await conversation.waitFor("message:text");
  const priceText = priceMsg.message.text.trim();
  if (priceText === "/cancel") {
    await ctx.reply("❌ Создание отменено.");
    return;
  }
  if (priceText !== "/skip") {
    const parsed = parseInt(priceText, 10);
    if (!isNaN(parsed) && parsed > 0) {
      price = parsed;
    } else {
      await ctx.reply("⚠️ Не понял, создаю бесплатную тренировку.");
    }
  }

  // ── Step 5: Payment info (only if price is set) ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply(
      "💳 Куда переводить? Напиши реквизиты (например: <code>Сбер 1234 5678 9012 3456</code> или <code>Тинькофф @nickname</code>):",
      { parse_mode: "HTML" }
    );

    const payInfoMsg = await conversation.waitFor("message:text");
    const payInfoText = payInfoMsg.message.text.trim();
    if (payInfoText === "/cancel") {
      await ctx.reply("❌ Создание отменено.");
      return;
    }
    if (payInfoText !== "/skip") {
      paymentInfo = payInfoText;
    }
  }

  // ── Save via service ──
  const event = await createEvent({
    groupId: chatId,
    title,
    datetime,
    maxParticipants,
    price,
    paymentInfo,
    createdBy: userId,
  });

  // ── Post event card ──
  const sent = await ctx.reply(formatEventCard(event), {
    reply_markup: rsvpKeyboard(event.id),
    parse_mode: "HTML",
  });

  await saveMessageId(event.id, sent.message_id);
}
