import { Composer } from "grammy";
import { InlineKeyboard } from "grammy";
import { NLU_CONFIG, shouldTriggerNLU } from "../../nlu/nluConfig";
import { shouldRunNLU } from "../../nlu/contextFilter";
import { parseIntent } from "../../nlu/intentParser";
import { createEvent, saveMessageId, listActiveEvents } from "../../services/eventService";
import { createSeries, dayNamesToNumbers, formatDaysOfWeek } from "../../services/seriesService";
import { formatEventCard, formatEventsList, formatSeriesCard, rsvpKeyboard } from "./formatters";
import { parseDate } from "../../utils/parseDate";
import { shouldAskRecurrence, extractWeekdayFromDate } from "../../nlu/recurrenceCheck";
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

    // ── Check if we're waiting for series time ──
    const pendingSeries = (ctx.session as any).pendingSeries;
    if (pendingSeries && pendingSeries.chatId === chatId) {
      const timeMatch = text.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!timeMatch) {
        await ctx.reply("⚠️ Укажи время в формате <code>ЧЧ:ММ</code>, например: <code>19:00</code>", {
          parse_mode: "HTML",
        });
        return;
      }
      const time = text.trim();
      const daysStr = formatDaysOfWeek(pendingSeries.daysOfWeek);

      (ctx.session as any).pendingSeriesConfirm = { ...pendingSeries, time };
      delete (ctx.session as any).pendingSeries;

      const kb = new InlineKeyboard()
        .text("Создать", `confirm_series`)
        .text("Отме��а", `cancel_series`);

      await ctx.reply(
        `📅 <b>${pendingSeries.title}</b> — каждый ${daysStr} в ${time}\nСоздаю на 3 месяца вперёд?`,
        { parse_mode: "HTML", reply_markup: kb }
      );
      return;
    }

    // ── Check if we're waiting for a date/time reply ──
    const pending = (ctx.session as any).pendingEvent;
    if (pending && pending.chatId === chatId) {
      // Try strict format first, then fall back to LLM
      let datetime = parseDate(text.trim());

      if (!datetime) {
        // Ask LLM to interpret the date/time
        const nluResult = await parseIntent(text, chatId, userId);
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

    // ── 1. Context filter ──
    if (!shouldRunNLU(text, {
      hasActiveConversation: false, // conversation plugin handles its own messages
      isReplyToBot: ctx.message.reply_to_message?.from?.id === ctx.me.id,
    })) return next();

    // ── 2. Trigger filter ──
    if (!shouldTriggerNLU(text)) return next();

    console.log("NLU: triggered on:", text.slice(0, 80));

    // ── 3. Parse intent via LLM ──
    const result = await parseIntent(text, chatId, userId);
    console.log("NLU result:", JSON.stringify(result));

    // ── 4. Dynamic confidence threshold ──
    const words = text.trim().split(/\s+/).length;
    const minConf = words <= 3 ? NLU_CONFIG.minConfidenceShortText : NLU_CONFIG.minConfidence;
    if (result.confidence < minConf) return next();

    if (result.intent === "unknown") return next();

    // ── 5. Handle intents ──

    if (result.intent === "update_event") {
      await ctx.reply(
        "Пока не умею менять события. Отмени текущее (/cancel) и создай новое."
      );
      return;
    }

    if (result.intent === "list_events") {
      const { events } = await listActiveEvents(chatId);
      await ctx.reply(formatEventsList(events), { parse_mode: "HTML" });
      return;
    }

    if (result.intent === "create_event") {
      const { entities } = result;
      const title = entities.title ?? "Тренировка";

      // ── Recurrence detected → create series ──
      if (entities.recurrence && entities.recurrence.days?.length > 0) {
        const daysOfWeek = dayNamesToNumbers(entities.recurrence.days);
        const time = entities.recurrence.time || entities.time || null;

        if (!time) {
          // Need time
          (ctx.session as any).pendingSeries = {
            chatId, title, daysOfWeek,
            maxParticipants: entities.maxParticipants ?? null,
            price: entities.price ?? null,
            createdBy: userId,
          };
          await ctx.reply(
            `📅 <b>${title}</b> (${formatDaysOfWeek(daysOfWeek)})\n⏰ Во сколько? (например: <code>19:00</code>)`,
            { parse_mode: "HTML" }
          );
          return;
        }

        // Confirm series creation
        const daysStr = formatDaysOfWeek(daysOfWeek);
        (ctx.session as any).pendingSeriesConfirm = {
          chatId, title, daysOfWeek, time,
          maxParticipants: entities.maxParticipants ?? null,
          price: entities.price ?? null,
          createdBy: userId,
        };

        const kb = new InlineKeyboard()
          .text("Создать", `confirm_series`)
          .text("О��мена", `cancel_series`);

        await ctx.reply(
          `📅 <b>${title}</b> — каждый ${daysStr} в ${time}\nСоздаю на 3 месяца вперёд?`,
          { parse_mode: "HTML", reply_markup: kb }
        );
        return;
      }

      // ── Single event ──
      let datetime: Date | null = null;
      if (entities.date && entities.time) {
        datetime = new Date(`${entities.date}T${entities.time}:00`);
        if (isNaN(datetime.getTime()) || datetime < new Date()) {
          datetime = null;
        }
      }

      if (datetime) {
        // Check if we should ask about recurrence
        if (shouldAskRecurrence(text, entities)) {
          (ctx.session as any).pendingRecurrenceCheck = {
            chatId, title, datetime: datetime.toISOString(),
            maxParticipants: entities.maxParticipants ?? null,
            price: entities.price ?? null,
            createdBy: userId,
          };

          const kb = new InlineKeyboard()
            .text("Разовая", "recur_once")
            .text("Каждую неделю", "recur_weekly");

          await ctx.reply(
            `🔁 <b>${title}</b> — это разовая тренировка или повторяющаяся?`,
            { parse_mode: "HTML", reply_markup: kb }
          );
          return;
        }

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
