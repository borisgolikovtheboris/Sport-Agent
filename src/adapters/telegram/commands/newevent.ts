import { Conversation } from "@grammyjs/conversations";
import { InlineKeyboard } from "grammy";
import { createEvent, saveMessageId } from "../../../services/eventService";
import { getUserGroups } from "../../../services/groupService";
import { parseDate } from "../../../utils/parseDate";
import { formatEventCard, rsvpKeyboard } from "../formatters";
import { MyContext } from "../index";

type MyConversation = Conversation<MyContext, MyContext>;

// ══════════════════════════════════════════════
// DM conversation — entered from deep link or /newevent in DM
// groupChatId is stored in session.dmGroupChatId before entering
// ══════════════════════════════════════════════
export async function newEventDMConversation(conversation: MyConversation, ctx: MyContext) {
  const userId = String(ctx.from!.id);
  const groupChatId = await conversation.external(
    () => (ctx.session as any).dmGroupChatId as string | undefined
  );

  if (!groupChatId) {
    await ctx.reply("⚠️ Не удалось определить группу. Попробуй /newevent в группе.");
    return;
  }

  await conversation.external(() => {
    delete (ctx.session as any).dmGroupChatId;
  });

  // ── Step 1: Title ──
  // If we came from deep link, the greeting was already sent by start.ts
  // If we came from /newevent in DM, the greeting is sent by neweventCommand
  // In both cases, we ask for title first
  await ctx.reply("📝 <b>Создаём тренировку</b>\n\nНапиши название:", {
    parse_mode: "HTML",
  });

  const titleText = await waitTextWithTimeout(conversation);
  if (!titleText) { await ctx.reply("⏰ Время вышло. Создание отменено."); return; }
  if (titleText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  const title = titleText;

  // ── Step 2: Date & Time ──
  await ctx.reply(
    "📅 Дата и время.\nФормат: <code>ДД.ММ ЧЧ:ММ</code>\nПример: <code>15.04 19:00</code>",
    { parse_mode: "HTML" }
  );

  let datetime: Date | null = null;
  while (!datetime) {
    const dateText = await waitTextWithTimeout(conversation);
    if (!dateText) { await ctx.reply("⏰ Время вышло. Создание отменено."); return; }
    if (dateText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
    datetime = parseDate(dateText);
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
  await ctx.reply("👥 Ограничить количество мест?\nНапиши число или /skip");

  let maxParticipants: number | null = null;
  const limitText = await waitTextWithTimeout(conversation);
  if (!limitText) { await ctx.reply("⏰ Время вышло. Создание отменено."); return; }
  if (limitText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  if (limitText !== "/skip") {
    const parsed = parseInt(limitText, 10);
    if (!isNaN(parsed) && parsed > 0) maxParticipants = parsed;
  }

  // ── Step 4: Price ──
  await ctx.reply("💰 Стоимость с человека (в рублях) или /skip если бесплатно:");

  let price: number | null = null;
  const priceText = await waitTextWithTimeout(conversation);
  if (!priceText) { await ctx.reply("⏰ Время вышло. Создание отменено."); return; }
  if (priceText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  if (priceText !== "/skip") {
    const parsed = parseInt(priceText, 10);
    if (!isNaN(parsed) && parsed > 0) price = parsed;
  }

  // ── Step 5: Payment info ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply("💳 Куда переводить? Реквизиты или /skip:");
    const payText = await waitTextWithTimeout(conversation);
    if (!payText) { await ctx.reply("⏰ Время вышло. Создание отменено."); return; }
    if (payText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
    if (payText !== "/skip") paymentInfo = payText;
  }

  // ── Create event ──
  const event = await createEvent({
    groupId: groupChatId,
    title,
    datetime,
    maxParticipants,
    price,
    paymentInfo,
    createdBy: userId,
  });

  // ── Publish card in the group ──
  try {
    const sent = await ctx.api.sendMessage(groupChatId, formatEventCard(event), {
      reply_markup: rsvpKeyboard(event.id),
      parse_mode: "HTML",
    });
    await saveMessageId(event.id, sent.message_id);
    await ctx.reply("✅ Тренировка опубликована в группе!");
  } catch (err) {
    console.error("Failed to publish event card to group:", err);
    await ctx.reply(
      "⚠️ Тренировка создана, но не удалось опубликовать в группе. Проверь, что бот ещё в группе."
    );
  }
}

// ══════════════════════════════════════════════
// Group conversation — fallback "💬 Здесь"
// ══════════════════════════════════════════════
export async function newEventConversation(conversation: MyConversation, ctx: MyContext) {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);

  // ── Step 1: Title ──
  await ctx.reply("📝 <b>Создаём тренировку</b>\n\nНапиши название:", {
    parse_mode: "HTML",
  });

  const titleMsg = await conversation.waitFor("message:text");
  if (titleMsg.message.text.trim() === "/cancel") {
    await ctx.reply("❌ Создание отменено.");
    return;
  }
  const title = titleMsg.message.text.trim();

  // ── Step 2: Date & Time ──
  await ctx.reply(
    "📅 Дата и время.\nФормат: <code>ДД.ММ ЧЧ:ММ</code>\nПример: <code>15.04 19:00</code>",
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
  await ctx.reply("👥 Ограничить количество мест?\nНапиши число или /skip");

  let maxParticipants: number | null = null;
  const limitMsg = await conversation.waitFor("message:text");
  const limitText = limitMsg.message.text.trim();
  if (limitText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  if (limitText !== "/skip") {
    const parsed = parseInt(limitText, 10);
    if (!isNaN(parsed) && parsed > 0) maxParticipants = parsed;
  }

  // ── Step 4: Price ──
  await ctx.reply("💰 Стоимость с человека (в рублях) или /skip если бесплатно:");

  let price: number | null = null;
  const priceMsg = await conversation.waitFor("message:text");
  const priceText = priceMsg.message.text.trim();
  if (priceText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
  if (priceText !== "/skip") {
    const parsed = parseInt(priceText, 10);
    if (!isNaN(parsed) && parsed > 0) price = parsed;
  }

  // ── Step 5: Payment info ──
  let paymentInfo: string | null = null;
  if (price) {
    await ctx.reply("💳 Куда переводить? Реквизиты или /skip:");
    const payMsg = await conversation.waitFor("message:text");
    const payText = payMsg.message.text.trim();
    if (payText === "/cancel") { await ctx.reply("❌ Создание отменено."); return; }
    if (payText !== "/skip") paymentInfo = payText;
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

// ══════════════════════════════════════════════
// /newevent command handler
// ══════════════════════════════════════════════
export async function neweventCommand(ctx: MyContext) {
  const userId = String(ctx.from!.id);
  const chatType = ctx.chat?.type;

  // ── In private chat — check user's groups ──
  if (chatType === "private") {
    const groups = await getUserGroups(userId);

    if (groups.length === 0) {
      await ctx.reply(
        "⚠️ Сначала добавь меня в группу, чтобы создавать тренировки."
      );
      return;
    }

    if (groups.length === 1) {
      (ctx.session as any).dmGroupChatId = groups[0].chatId;
      await ctx.conversation.enter("newEventDM");
      return;
    }

    // Multiple groups — show selection
    const kb = new InlineKeyboard();
    for (const g of groups) {
      kb.text(g.title, `selectgroup:${g.chatId}`).row();
    }
    await ctx.reply("📋 Для какой группы создать тренировку?", {
      reply_markup: kb,
    });
    return;
  }

  // ── In group chat — try to DM the user ──
  const groupChatId = String(ctx.chat!.id);

  try {
    await ctx.api.sendMessage(
      userId,
      "📝 Давай создадим тренировку в личке — так мы не засоряем чат группы."
    );

    // DM succeeded — we need the user to interact in DM to trigger conversation
    // Send a follow-up that starts the conversation flow
    (ctx.session as any).dmGroupChatId = groupChatId;
    (ctx.session as any).dmPendingNewEvent = true;

    await ctx.reply("✉️ Написал тебе в личку — продолжим там!", {
      reply_to_message_id: ctx.message?.message_id,
    });
  } catch {
    // 403 Forbidden — user hasn't started the bot
    const botInfo = await ctx.api.getMe();
    const deepLink = `https://t.me/${botInfo.username}?start=newevent_${groupChatId}`;

    const kb = new InlineKeyboard()
      .url("📱 В личку", deepLink)
      .text("💬 Здесь", `newevent_here:${groupChatId}`);

    await ctx.reply("Где создаём тренировку?", {
      reply_markup: kb,
      reply_to_message_id: ctx.message?.message_id,
    });
  }
}

// ── Helper: wait for text with 10min timeout ──
async function waitTextWithTimeout(conversation: MyConversation): Promise<string | null> {
  const timeoutMs = 10 * 60 * 1000;
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = conversation.external(
    () =>
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })
  );

  const msgPromise = conversation.waitFor("message:text").then((msg) => {
    clearTimeout(timer!);
    return msg.message.text.trim();
  });

  const result = await Promise.race([msgPromise, timeoutPromise]);
  return result;
}
