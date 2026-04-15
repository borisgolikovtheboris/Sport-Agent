import { Composer } from "grammy";
import prisma from "../../db/prisma";
import { InlineKeyboard } from "grammy";
import { NLU_CONFIG, shouldTriggerNLU } from "../../nlu/nluConfig";
import { shouldRunNLU } from "../../nlu/contextFilter";
import { parseIntent } from "../../nlu/intentParser";
import { createEvent, saveMessageId, listActiveEvents, rescheduleEvent, getEvent } from "../../services/eventService";
import { createSeries, dayNamesToNumbers, formatDaysOfWeek } from "../../services/seriesService";
import { formatEventCard, formatEventsList, formatSeriesCard, rsvpKeyboard } from "./formatters";
import { parseDate } from "../../utils/parseDate";
import { smartParseDate } from "../../nlu/dateParser";
import { getHelpResponse } from "./helpResponses";
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

    // ── Check if we're waiting for a reschedule time ──
    const pendingResch = (ctx.session as any).pendingReschedule;
    if (pendingResch && pendingResch.chatId === chatId && pendingResch.userId === userId) {
      const existing = await getEvent(pendingResch.eventId);
      if (!existing || existing.status !== "ACTIVE") {
        delete (ctx.session as any).pendingReschedule;
        await ctx.reply("⚠️ Тренировка больше не активна.");
        return;
      }

      let newDatetime: Date | null = null;

      if (pendingResch.partialDate) {
        const timeMatch = text.trim().match(/^(\d{1,2})[.:](\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            newDatetime = new Date(`${pendingResch.partialDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
          }
        }
        if (!newDatetime) {
          const timeParsed = await smartParseDate(`сегодня ${text}`);
          if (timeParsed?.time) {
            newDatetime = new Date(`${pendingResch.partialDate}T${timeParsed.time}:00`);
          }
        }
        if (!newDatetime) {
          await ctx.reply("⚠️ Не понял время. Если нужно, запусти /reschedule снова.", {
            parse_mode: "HTML",
          });
          delete (ctx.session as any).pendingReschedule;
          return;
        }
        delete pendingResch.partialDate;
      } else {
        // Time-only → reuse the original event's date
        const timeMatch = text.trim().match(/^(\d{1,2})[.:](\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const d = new Date(existing.datetime);
            d.setHours(h, m, 0, 0);
            newDatetime = d;
          }
        }
        if (!newDatetime) {
          newDatetime = parseDate(text.trim());
        }
        if (!newDatetime) {
          const parsed = await smartParseDate(text);
          if (parsed?.date && parsed?.time) {
            newDatetime = new Date(`${parsed.date}T${parsed.time}:00`);
            if (isNaN(newDatetime.getTime())) newDatetime = null;
          } else if (parsed?.date) {
            pendingResch.partialDate = parsed.date;
            await ctx.reply("⏰ А во сколько? (например: <code>19:00</code> или «в 7 вечера»)", {
              parse_mode: "HTML",
            });
            return;
          }
        }
        if (!newDatetime) {
          await ctx.reply("⚠️ Не понял. Если нужно, запусти /reschedule снова и напиши время, например: <code>20:00</code>, «завтра в 20», <code>16.04 19:00</code>.", {
            parse_mode: "HTML",
          });
          delete (ctx.session as any).pendingReschedule;
          return;
        }
      }

      if (newDatetime < new Date()) {
        await ctx.reply("⚠️ Эта дата уже прошла. Укажи будущую:");
        return;
      }

      const result = await rescheduleEvent(pendingResch.eventId, newDatetime);
      if (!result.ok) {
        delete (ctx.session as any).pendingReschedule;
        await ctx.reply("⚠️ Не удалось перенести тренировку.");
        return;
      }

      const updated = await getEvent(pendingResch.eventId);
      delete (ctx.session as any).pendingReschedule;
      if (!updated) return;

      const cardText = formatEventCard(updated);
      if (updated.messageId) {
        try {
          await ctx.api.editMessageText(updated.groupId, updated.messageId, cardText, {
            reply_markup: { inline_keyboard: [[
              { text: "✅ Иду", callback_data: `go:${updated.id}` },
              { text: "❌ Не иду", callback_data: `notgo:${updated.id}` },
            ]] },
            parse_mode: "HTML",
          });
        } catch (_) {}
      }

      const mentions = updated.participants
        .filter((p) => p.status === "GOING")
        .map((p) => (p.username ? `@${p.username}` : p.firstName))
        .join(" ");

      const d = newDatetime;
      const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря"];
      const newDateStr = `${d.getDate()} ${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

      const notice = mentions
        ? `🔄 Перенос: «${updated.title}» теперь ${newDateStr}\n${mentions}`
        : `🔄 Перенос: «${updated.title}» теперь ${newDateStr}`;
      await ctx.reply(notice);
      return;
    }

    // ── Check if we're waiting for series time ──
    const pendingSeries = (ctx.session as any).pendingSeries;
    if (pendingSeries && pendingSeries.chatId === chatId) {
      const timeMatch = text.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!timeMatch) {
        await ctx.reply("⚠️ Не понял время. Если нужно, начни заново — например: «Хоккей по четвергам в 19:00».", {
          parse_mode: "HTML",
        });
        delete (ctx.session as any).pendingSeries;
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
      let datetime: Date | null = null;

      // If we already have a saved date and are waiting for time only
      if (pending.partialDate) {
        // Try HH:MM
        const timeMatch = text.trim().match(/^(\d{1,2})[.:](\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            datetime = new Date(`${pending.partialDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
          }
        }
        // Try LLM for "в 7", "7 вечера" etc.
        if (!datetime) {
          const timeParsed = await smartParseDate(`сегодня ${text}`);
          if (timeParsed?.time) {
            datetime = new Date(`${pending.partialDate}T${timeParsed.time}:00`);
          }
        }
        if (!datetime) {
          await ctx.reply("⚠️ Не понял время. Если нужно, начни заново — напиши, например: «Хоккей в четверг в 19:00».", {
            parse_mode: "HTML",
          });
          delete (ctx.session as any).pendingEvent;
          return;
        }
        delete pending.partialDate;
      } else {
        // Try strict format first, then fall back to LLM
        datetime = parseDate(text.trim());

        if (!datetime) {
          const nluResult = await parseIntent(text, chatId, userId);
          if (nluResult.entities.date && nluResult.entities.time) {
            datetime = new Date(`${nluResult.entities.date}T${nluResult.entities.time}:00`);
            if (isNaN(datetime.getTime())) datetime = null;
          } else if (nluResult.entities.date) {
            // Date without time — save date and ask for time
            pending.partialDate = nluResult.entities.date;
            await ctx.reply("⏰ А во сколько? (например: <code>19:00</code> или «в 7 вечера»)", {
              parse_mode: "HTML",
            });
            return;
          }
        }

        if (!datetime) {
          await ctx.reply("⚠️ Не понял. Если нужно, начни заново — напиши, например: «Хоккей в четверг в 19:00».", {
            parse_mode: "HTML",
          });
          delete (ctx.session as any).pendingEvent;
          return;
        }
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

      // Ask about price if not set
      if (!pending.price) {
        const priceMsg = await ctx.reply(
          `💰 Тренировка платная? Напиши стоимость (например: 500) или «бесплатно»:`
        );
        await prisma.event.update({
          where: { id: event.id },
          data: { priceRequestMessageId: priceMsg.message_id },
        });
      }
      return;
    }

    // ── Check if bot was mentioned (@username) ──
    const botMentioned = text.includes(`@${ctx.me.username}`);
    const cleanText = botMentioned
      ? text.replace(`@${ctx.me.username}`, "").trim()
      : text;

    // ── 1. Context filter (skip if bot was mentioned) ──
    if (!botMentioned && !shouldRunNLU(text, {
      hasActiveConversation: false,
      isReplyToBot: ctx.message.reply_to_message?.from?.id === ctx.me.id,
    })) return next();

    // ── 2. Trigger filter (skip if bot was mentioned) ──
    if (!botMentioned && !shouldTriggerNLU(text)) return next();

    console.log("NLU: triggered on:", text.slice(0, 80));

    // ── 3. Parse intent via LLM ──
    const result = await parseIntent(botMentioned ? cleanText : text, chatId, userId);
    console.log("NLU result:", JSON.stringify(result));

    // ── 4. Handle NLU errors ──
    if (result.intent === "unknown" && result.confidence === 0 && botMentioned) {
      // NLU failed (API error/timeout) and bot was tagged — respond
      await ctx.reply(
        "Что-то не понял. Попробуй так:\n💬 «Футбол в среду в 19»\nИли напиши /help",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // ── 5. Dynamic confidence threshold ──
    const words = text.trim().split(/\s+/).length;
    const minConf = words <= 3 ? NLU_CONFIG.minConfidenceShortText : NLU_CONFIG.minConfidence;

    if (result.confidence < minConf) {
      // Low confidence + bot mentioned → clarify
      if (botMentioned) {
        await ctx.reply(
          "Не уверен что понял. Ты про тренировку? Напиши подробнее, например:\n💬 «Футбол в среду в 19, 10 человек»",
          { reply_to_message_id: ctx.message.message_id }
        );
      }
      return next();
    }

    if (result.intent === "unknown") {
      if (botMentioned) {
        await ctx.reply(
          "Не понял. Попробуй:\n💬 «Забей хоккей на понедельник в 20»\n💬 «Что ты умеешь?»",
          { reply_to_message_id: ctx.message.message_id }
        );
      }
      return next();
    }

    // ── 5. Handle intents ──

    if (result.intent === "help" && result.confidence >= 0.5) {
      const topic = result.entities.topic || "general";
      await ctx.reply(getHelpResponse(topic), { parse_mode: "HTML" });
      return;
    }

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
        // Clear stale priceRequestMessageId from previous events
        await prisma.event.updateMany({
          where: { groupId: chatId, createdBy: userId, priceRequestMessageId: { not: null } },
          data: { priceRequestMessageId: null },
        });

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

        // Ask about price if not set
        if (!entities.price) {
          const priceMsg = await ctx.reply(
            `💰 Тренировка платная? Напиши стоимость (например: 500) или «бесплатно»:`
          );
          await prisma.event.update({
            where: { id: event.id },
            data: { priceRequestMessageId: priceMsg.message_id },
          });
        }
        return;
      }

      // Missing date and/or time — save to session and ask
      (ctx.session as any).pendingEvent = {
        chatId,
        title,
        maxParticipants: entities.maxParticipants ?? null,
        price: entities.price ?? null,
        createdBy: userId,
        ...(entities.date ? { partialDate: entities.date } : {}),
      };

      if (entities.date && !entities.time) {
        // Date known, only need time
        await ctx.reply(
          `⚽ <b>${title}</b>\n⏰ Во сколько? (например: <code>19:00</code> или «в 7 вечера»)`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(
          `⚽ <b>${title}</b>\n📅 Когда? (например: <code>15.04 19:00</code> или «в пятницу в 19»)`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    return next();
  });

  return composer;
}
