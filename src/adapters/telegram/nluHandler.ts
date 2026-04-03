import { Composer } from "grammy";
import { NLU_CONFIG } from "../../nlu/nluConfig";
import { parseIntent } from "../../nlu/intentParser";
import { createEvent, saveMessageId, listActiveEvents } from "../../services/eventService";
import { formatEventCard, formatEventsList, rsvpKeyboard } from "./formatters";
import { parseDate } from "../../utils/parseDate";
import { MyContext } from "./index";

export function createNluHandler(): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  composer.on("message:text", async (ctx, next) => {
    // Only handle group messages
    if (ctx.chat.type === "private") return next();

    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith("/")) return next();

    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from!.id);

    // ── Check if we're waiting for a date/time reply ──
    const pending = (ctx.session as any).pendingEvent;
    if (pending && pending.chatId === chatId) {
      // Try strict format first, then fall back to LLM
      let datetime = parseDate(text.trim());

      if (!datetime) {
        // Ask LLM to interpret the date/time
        const nluResult = await parseIntent(text);
        if (nluResult.entities.date && nluResult.entities.time) {
          datetime = new Date(`${nluResult.entities.date}T${nluResult.entities.time}:00`);
          if (isNaN(datetime.getTime())) datetime = null;
        } else if (nluResult.entities.date) {
          // Date without time — ask for time
          await ctx.reply("⏰ А во сколько? (например: <code>19:00</code>)", {
            parse_mode: "HTML",
          });
          return;
        }
      }

      if (!datetime) {
        await ctx.reply("⚠️ Не понял. Напиши дату и время, например: <code>15.04 19:00</code> или «в пятницу в 19»", {
          parse_mode: "HTML",
        });
        return;
      }
      if (datetime < new Date()) {
        await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую:");
        return;
      }

      const event = await createEvent({
        groupId: chatId,
        title: pending.title,
        datetime,
        maxParticipants: pending.maxParticipants ?? null,
        price: pending.price ?? null,
        paymentInfo: null,
        createdBy: pending.createdBy,
      });

      const sent = await ctx.reply(formatEventCard(event), {
        reply_markup: rsvpKeyboard(event.id),
        parse_mode: "HTML",
      });

      await saveMessageId(event.id, sent.message_id);
      delete (ctx.session as any).pendingEvent;
      return;
    }

    // ── Check trigger words ──
    const lower = text.toLowerCase();
    const triggered = NLU_CONFIG.triggerWords.some((w) => lower.includes(w));
    if (!triggered) return next();

    console.log("NLU: triggered on:", text.slice(0, 80));

    // Parse intent via LLM
    const result = await parseIntent(text);
    console.log("NLU result:", JSON.stringify(result));

    if (result.intent === "unknown") return next();

    if (result.intent === "list_events") {
      const { events } = await listActiveEvents(chatId);
      await ctx.reply(formatEventsList(events), { parse_mode: "HTML" });
      return;
    }

    if (result.intent === "create_event") {
      const { entities } = result;
      const title = entities.title ?? "Тренировка";

      // Try to build datetime
      let datetime: Date | null = null;
      if (entities.date && entities.time) {
        datetime = new Date(`${entities.date}T${entities.time}:00`);
        if (isNaN(datetime.getTime()) || datetime < new Date()) {
          datetime = null;
        }
      }

      if (datetime) {
        // All good — create immediately
        const event = await createEvent({
          groupId: chatId,
          title,
          datetime,
          maxParticipants: entities.maxParticipants ?? null,
          price: entities.price ?? null,
          paymentInfo: null,
          createdBy: userId,
        });

        const sent = await ctx.reply(formatEventCard(event), {
          reply_markup: rsvpKeyboard(event.id),
          parse_mode: "HTML",
        });

        await saveMessageId(event.id, sent.message_id);
        return;
      }

      // Missing date/time — save to session and ask
      (ctx.session as any).pendingEvent = {
        chatId,
        title,
        maxParticipants: entities.maxParticipants ?? null,
        price: entities.price ?? null,
        createdBy: userId,
      };

      await ctx.reply(
        `⚽ <b>${title}</b>\n📅 Когда? (формат: <code>ДД.ММ ЧЧ:ММ</code>)`,
        { parse_mode: "HTML" }
      );
      return;
    }

    return next();
  });

  return composer;
}
