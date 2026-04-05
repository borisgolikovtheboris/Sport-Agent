import { Conversation } from "@grammyjs/conversations";
import { createEvent, saveMessageId } from "../../../services/eventService";
import { parseDate } from "../../../utils/parseDate";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { detectMetaCommand } from "../../../nlu/metaCommands";
import { MyContext } from "../index";

type MyConversation = Conversation<MyContext, MyContext>;

export async function newEventConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Step 1: Title (required) ──
  await ctx.reply("Создаём тренировку 🏃\nНапиши название:");

  let title: string | null = null;
  while (!title) {
    const titleMsg = await conversation.waitFor("message:text");
    const text = titleMsg.message.text.trim();
    const meta = detectMetaCommand(text);

    if (text === "/cancel" || meta === "cancel") {
      await ctx.reply("Создание отменено ❌");
      return;
    }
    if (meta === "skip") {
      await ctx.reply("Название — обязательное поле. Напиши название тренировки:");
      continue;
    }
    if (meta === "help") {
      await ctx.reply("Напиши название тренировки, например: Футбол в парке, Йога, Бадминтон");
      continue;
    }
    title = text;
  }

  // ── Step 2: Date & Time (required) ──
  await ctx.reply(
    "📅 Когда? (формат: <code>ДД.ММ ЧЧ:ММ</code>)\nПример: <code>15.04 19:00</code>",
    { parse_mode: "HTML" }
  );

  let datetime: Date | null = null;
  while (!datetime) {
    const dateMsg = await conversation.waitFor("message:text");
    const text = dateMsg.message.text.trim();
    const meta = detectMetaCommand(text);

    if (text === "/cancel" || meta === "cancel") {
      await ctx.reply("Создание отменено ❌");
      return;
    }
    if (meta === "skip") {
      await ctx.reply("Дата — обязательное поле. Укажи дату и время:");
      continue;
    }
    if (meta === "help") {
      await ctx.reply("Напиши дату и время в формате ДД.ММ ЧЧ:ММ, например: 15.04 19:00");
      continue;
    }

    datetime = parseDate(text);
    if (!datetime) {
      await ctx.reply("⚠️ Не понял формат. Пример: <code>15.04 19:00</code>", {
        parse_mode: "HTML",
      });
    } else if (datetime < new Date()) {
      await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую:");
      datetime = null;
    }
  }

  // ── Step 3: Max participants (optional) ──
  await ctx.reply("👥 Максимум участников? (число или «без лимита»)");

  let maxParticipants: number | null = null;
  let step3done = false;
  while (!step3done) {
    const limitMsg = await conversation.waitFor("message:text");
    const text = limitMsg.message.text.trim();
    const meta = detectMetaCommand(text);

    if (text === "/cancel" || meta === "cancel") {
      await ctx.reply("Создание отменено ❌");
      return;
    }
    if (meta === "skip") {
      step3done = true;
      break;
    }
    if (meta === "help") {
      await ctx.reply("Напиши число (например 12) или «без лимита» если без ограничений");
      continue;
    }
    if (text === "без лимита" || text === "/skip") {
      step3done = true;
      break;
    }
    const parsed = parseInt(text, 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxParticipants = parsed;
      step3done = true;
    } else {
      await ctx.reply("⚠️ Напиши число или «без лимита»");
    }
  }

  // ── Step 4: Price (optional) ──
  await ctx.reply("💰 Цена? (число в рублях или «бесплатно»)");

  let price: number | null = null;
  let step4done = false;
  while (!step4done) {
    const priceMsg = await conversation.waitFor("message:text");
    const text = priceMsg.message.text.trim();
    const meta = detectMetaCommand(text);

    if (text === "/cancel" || meta === "cancel") {
      await ctx.reply("Создание отменено ❌");
      return;
    }
    if (meta === "skip") {
      step4done = true;
      break;
    }
    if (meta === "help") {
      await ctx.reply("Напиши стоимость в рублях (например 500) или «бесплатно»");
      continue;
    }
    if (text === "бесплатно" || text === "/skip") {
      step4done = true;
      break;
    }
    const parsed = parseInt(text, 10);
    if (!isNaN(parsed) && parsed > 0) {
      price = parsed;
      step4done = true;
    } else {
      await ctx.reply("⚠️ Напиши число или «бесплатно»");
    }
  }

  // ── Step 5: Payment info (optional, only if price set) ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply("💳 Реквизиты для оплаты? (или «пропустить»)");

    let step5done = false;
    while (!step5done) {
      const payMsg = await conversation.waitFor("message:text");
      const text = payMsg.message.text.trim();
      const meta = detectMetaCommand(text);

      if (text === "/cancel" || meta === "cancel") {
        await ctx.reply("Создание отменено ❌");
        return;
      }
      if (meta === "skip") {
        step5done = true;
        break;
      }
      if (meta === "help") {
        await ctx.reply("Напиши реквизиты, например: Сбер 1234 5678 9012 3456 или «пропустить»");
        continue;
      }
      if (text === "пропустить" || text === "/skip") {
        step5done = true;
        break;
      }
      paymentInfo = text;
      step5done = true;
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
