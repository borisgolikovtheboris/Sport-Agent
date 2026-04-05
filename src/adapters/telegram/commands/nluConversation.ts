import { Conversation } from "@grammyjs/conversations";
import { createEvent, saveMessageId } from "../../../services/eventService";
import { parseDate } from "../../../utils/parseDate";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { detectMetaCommand } from "../../../nlu/metaCommands";
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

  const nluData = await conversation.external(() => (ctx.session as any).nluData as ParsedIntent | undefined);
  if (!nluData) return;

  const entities = { ...nluData.entities };
  const missing = [...nluData.missingFields];

  // ── Ask for missing title (required) ──
  if (!entities.title || missing.includes("title")) {
    await ctx.reply("📝 Как назовём тренировку?");
    let done = false;
    while (!done) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      const meta = detectMetaCommand(text);

      if (text === "/cancel" || meta === "cancel") {
        await ctx.reply("Создание отменено ❌");
        return;
      }
      if (meta === "skip") {
        await ctx.reply("Название — обязательное поле. Напиши название:");
        continue;
      }
      if (meta === "help") {
        await ctx.reply("Напиши название тренировки, например: Футбол, Йога, Бадминтон");
        continue;
      }
      entities.title = text;
      done = true;
    }
  }

  // ── Ask for missing date/time (required) ──
  let datetime: Date | null = null;

  if (entities.date && entities.time) {
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
      const text = msg.message.text.trim();
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
  }

  // ── Ask for max participants if missing (optional) ──
  let maxParticipants: number | null = entities.maxParticipants ?? null;
  if (!maxParticipants && missing.includes("maxParticipants")) {
    await ctx.reply("👥 Сколько мест? (число или «пропустить»)");
    let done = false;
    while (!done) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      const meta = detectMetaCommand(text);

      if (text === "/cancel" || meta === "cancel") {
        await ctx.reply("Создание отменено ❌");
        return;
      }
      if (meta === "skip" || text === "/skip") {
        done = true;
        break;
      }
      if (meta === "help") {
        await ctx.reply("Напиши число (например 12) или «пропустить»");
        continue;
      }
      const parsed = parseInt(text, 10);
      if (!isNaN(parsed) && parsed > 0) {
        maxParticipants = parsed;
        done = true;
      } else {
        await ctx.reply("⚠️ Напиши число или «пропустить»");
      }
    }
  }

  // ── Price (from NLU or skip) ──
  let price: number | null = entities.price ?? null;

  // ── Payment info if price is set (optional) ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply("💳 Куда переводить? (реквизиты или «пропустить»)");
    let done = false;
    while (!done) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      const meta = detectMetaCommand(text);

      if (text === "/cancel" || meta === "cancel") {
        await ctx.reply("Создание отменено ❌");
        return;
      }
      if (meta === "skip" || text === "/skip") {
        done = true;
        break;
      }
      if (meta === "help") {
        await ctx.reply("Напиши реквизиты, например: Сбер 1234 5678 9012 3456 или «пропустить»");
        continue;
      }
      paymentInfo = text;
      done = true;
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
