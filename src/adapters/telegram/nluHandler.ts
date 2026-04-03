import { Composer } from "grammy";
import { NLU_CONFIG } from "../../nlu/nluConfig";
import { parseIntent } from "../../nlu/intentParser";
import { createEvent, saveMessageId, listActiveEvents } from "../../services/eventService";
import { formatEventCard, formatEventsList, rsvpKeyboard } from "./formatters";
import { MyContext } from "./index";

export function createNluHandler(): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  composer.on("message:text", async (ctx, next) => {
    // Only handle group messages
    if (ctx.chat.type === "private") return next();

    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith("/")) return next();

    // Check trigger words
    const lower = text.toLowerCase();
    const triggered = NLU_CONFIG.triggerWords.some((w) => lower.includes(w));
    if (!triggered) return next();

    // Parse intent via LLM
    const result = await parseIntent(text);

    if (result.intent === "unknown") return next();

    if (result.intent === "list_events") {
      const { events } = await listActiveEvents(String(ctx.chat.id));
      await ctx.reply(formatEventsList(events), { parse_mode: "HTML" });
      return;
    }

    if (result.intent === "create_event") {
      const { entities, missingFields } = result;

      // If all required fields present — create immediately
      if (entities.title && entities.date && entities.time && missingFields.length === 0) {
        const datetime = new Date(`${entities.date}T${entities.time}:00`);

        if (isNaN(datetime.getTime()) || datetime < new Date()) {
          // Bad date — fall into conversation
          (ctx.session as any).nluData = result;
          await ctx.conversation.enter("nluConversation");
          return;
        }

        const event = await createEvent({
          groupId: String(ctx.chat.id),
          title: entities.title,
          datetime,
          maxParticipants: entities.maxParticipants ?? null,
          price: entities.price ?? null,
          paymentInfo: null,
          createdBy: String(ctx.from!.id),
        });

        const sent = await ctx.reply(formatEventCard(event), {
          reply_markup: rsvpKeyboard(event.id),
          parse_mode: "HTML",
        });

        await saveMessageId(event.id, sent.message_id);

        // If price was extracted, ask for payment info
        if (entities.price) {
          await ctx.reply("💳 Куда переводить? Напиши реквизиты или /skip");
        }

        return;
      }

      // Missing fields — enter shortened conversation
      (ctx.session as any).nluData = result;
      await ctx.conversation.enter("nluConversation");
      return;
    }

    // For other intents, pass through
    return next();
  });

  return composer;
}
