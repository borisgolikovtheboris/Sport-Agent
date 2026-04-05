import { Conversation } from "@grammyjs/conversations";
import { createEvent, saveMessageId } from "../../../services/eventService";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { detectMetaCommand } from "../../../nlu/metaCommands";
import { smartParseDate, formatDateForUser } from "../../../nlu/dateParser";
import { MyContext } from "../index";

type MyConversation = Conversation<MyContext, MyContext>;

const MAX_RETRIES = 5;

/** Wait for text from the initiator only. Returns null after MAX_RETRIES non-initiator messages. */
async function waitFromUser(
  conversation: MyConversation,
  initiatorId: number
): Promise<{ text: string; ctx: MyContext } | null> {
  let skipped = 0;
  while (skipped < 20) {
    const msg = await conversation.waitFor("message:text");
    if (msg.from?.id !== initiatorId) {
      skipped++;
      continue; // silently ignore other users
    }
    return { text: msg.message.text.trim(), ctx: msg };
  }
  return null;
}

export async function newEventConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);
  const initiatorId = ctx.from!.id;

  // ── Step 1: Title (required) ──
  await ctx.reply("Создаём тренировку 🏃\nНапиши название:");

  let title: string | null = null;
  let retries = 0;
  while (!title) {
    const input = await waitFromUser(conversation, initiatorId);
    if (!input) { await ctx.reply("Создание отменено (таймаут) ❌"); return; }
    const { text } = input;
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
    "📅 Когда?\nНапример: <code>15.04 19:00</code>, «в пятницу в 19», «завтра в 7 вечера»",
    { parse_mode: "HTML" }
  );

  let datetime: Date | null = null;
  retries = 0;

  while (!datetime) {
    const input = await waitFromUser(conversation, initiatorId);
    if (!input) { await ctx.reply("Создание отменено (таймаут) ❌"); return; }
    const { text } = input;
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
      await ctx.reply(
        "Напиши дату и время:\n• <code>15.04 19:00</code>\n• в пятницу в 19\n• завтра в 7 вечера",
        { parse_mode: "HTML" }
      );
      continue;
    }

    const parsed = await smartParseDate(text);

    if (!parsed || !parsed.success || !parsed.date) {
      retries++;
      if (retries >= MAX_RETRIES) {
        await ctx.reply("Создание отменено. Попробуй /newevent заново ❌");
        return;
      }
      await ctx.reply(
        "⚠️ Не понял. Напиши дату и время:\n• <code>15.04 19:00</code>\n• в пятницу в 19\n• завтра в 7 вечера",
        { parse_mode: "HTML" }
      );
      continue;
    }

    // Date parsed but no time — ask for time
    if (!parsed.time) {
      await ctx.reply(
        `📅 ${formatDateForUser(parsed.date)}. Во сколько? (например: <code>19:00</code>)`,
        { parse_mode: "HTML" }
      );

      let timeRetries = 0;
      let timeResolved = false;
      while (!timeResolved) {
        const timeInput = await waitFromUser(conversation, initiatorId);
        if (!timeInput) { await ctx.reply("Создание отменено (таймаут) ❌"); return; }
        const timeText = timeInput.text;
        const timeMeta = detectMetaCommand(timeText);

        if (timeText === "/cancel" || timeMeta === "cancel") {
          await ctx.reply("Создание отменено ❌");
          return;
        }

        const timeMatch = timeText.match(/^(\d{1,2})[.:](\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            datetime = new Date(`${parsed.date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
            timeResolved = true;
            break;
          }
        }

        const timeParsed = await smartParseDate(`сегодня в ${timeText}`);
        if (timeParsed?.time) {
          datetime = new Date(`${parsed.date}T${timeParsed.time}:00`);
          timeResolved = true;
          break;
        }

        timeRetries++;
        if (timeRetries >= MAX_RETRIES) {
          await ctx.reply("Создание отменено. Попробуй /newevent заново ❌");
          return;
        }
        await ctx.reply("⚠️ Не понял время. Пример: <code>19:00</code>", { parse_mode: "HTML" });
      }
    } else {
      datetime = new Date(`${parsed.date}T${parsed.time}:00`);
    }

    if (datetime && isNaN(datetime.getTime())) {
      datetime = null;
      await ctx.reply("⚠️ Некорректная дата. Попробуй ещё раз:");
      continue;
    }

    if (datetime && datetime < new Date()) {
      await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую:");
      datetime = null;
    }
  }

  // ── Step 3: Max participants (optional) ──
  await ctx.reply("👥 Максимум участников? (число или «без лимита»)");

  let maxParticipants: number | null = null;
  let step3done = false;
  retries = 0;
  while (!step3done) {
    const input = await waitFromUser(conversation, initiatorId);
    if (!input) { await ctx.reply("Создание отменено (таймаут) ❌"); return; }
    const { text } = input;
    const meta = detectMetaCommand(text);

    if (text === "/cancel" || meta === "cancel") { await ctx.reply("Создание отменено ❌"); return; }
    if (meta === "skip" || text === "без лимита" || text === "/skip") { step3done = true; break; }
    if (meta === "help") { await ctx.reply("Напиши число (например 12) или «без лимита»"); continue; }

    const parsed = parseInt(text, 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxParticipants = parsed;
      step3done = true;
    } else {
      retries++;
      if (retries >= MAX_RETRIES) { await ctx.reply("Создание отменено ❌"); return; }
      await ctx.reply("⚠️ Напиши число или «без лимита»");
    }
  }

  // ── Step 4: Price (optional) ──
  await ctx.reply("💰 Цена? (число в рублях или «бесплатно»)");

  let price: number | null = null;
  let step4done = false;
  retries = 0;
  while (!step4done) {
    const input = await waitFromUser(conversation, initiatorId);
    if (!input) { await ctx.reply("Создание отменено (таймаут) ❌"); return; }
    const { text } = input;
    const meta = detectMetaCommand(text);

    if (text === "/cancel" || meta === "cancel") { await ctx.reply("Создание отменено ❌"); return; }
    if (meta === "skip" || text === "бесплатно" || text === "/skip") { step4done = true; break; }
    if (meta === "help") { await ctx.reply("Напиши стоимость в рублях (например 500) или «бесплатно»"); continue; }

    const parsed = parseInt(text, 10);
    if (!isNaN(parsed) && parsed > 0) {
      price = parsed;
      step4done = true;
    } else {
      retries++;
      if (retries >= MAX_RETRIES) { await ctx.reply("Создание отменено ❌"); return; }
      await ctx.reply("⚠️ Напиши число или «бесплатно»");
    }
  }

  // ── Step 5: Payment info (optional, only if price set) ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply("💳 Реквизиты для оплаты? (или «пропустить»)");

    let step5done = false;
    while (!step5done) {
      const input = await waitFromUser(conversation, initiatorId);
      if (!input) { await ctx.reply("Создание отменено (таймаут) ❌"); return; }
      const { text } = input;
      const meta = detectMetaCommand(text);

      if (text === "/cancel" || meta === "cancel") { await ctx.reply("Создание отменено ❌"); return; }
      if (meta === "skip" || text === "пропустить" || text === "/skip") { step5done = true; break; }
      if (meta === "help") { await ctx.reply("Напиши реквизиты или «пропустить»"); continue; }

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
