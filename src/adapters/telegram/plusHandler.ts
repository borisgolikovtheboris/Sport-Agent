import { NextFunction } from "grammy";
import prisma from "../../db/prisma";
import { getEvent, saveMessageId } from "../../services/eventService";
import { formatEventCard, rsvpKeyboard } from "./formatters";
import { MyContext } from "./index";

// Patterns:
// +1, +2, +3       → anonymous spots
// +Иван, +Петя     → named spot
// +@username        → named spot with username
// + Иван Петров    → named spot with full name
interface PlusRequest {
  count: number;
  names: string[];
}

function parsePlus(text: string): PlusRequest | null {
  const t = text.trim().toLowerCase();

  // "+1", "+2", "+Иван" — starts with +
  const directMatch = text.trim().match(/^\+\s*(.+)$/);
  if (directMatch) {
    const after = directMatch[1].trim();
    const num = parseInt(after, 10);
    if (!isNaN(num) && num > 0 && num <= 10 && after === String(num)) {
      return { count: num, names: [] };
    }
    // Named: "+Иван", "+@user"
    const names = after.split(/[,иi&]\s*/i).map((n) => n.trim()).filter((n) => n.length > 0);
    if (names.length > 0) return { count: names.length, names };
  }

  // "еще +2", "и еще +2 со мной", "+2 со мной", "со мной +2"
  const plusInText = t.match(/\+\s*(\d+)/);
  if (plusInText) {
    const num = parseInt(plusInText[1], 10);
    if (num > 0 && num <= 10) return { count: num, names: [] };
  }

  // "еще 2", "еще двое", "со мной еще 2", "и я +2"
  const eshcheMatch = t.match(/(?:еще|ещё)\s*(\d+)/);
  if (eshcheMatch) {
    const num = parseInt(eshcheMatch[1], 10);
    if (num > 0 && num <= 10) return { count: num, names: [] };
  }

  return null;
}

export async function plusHandler(ctx: MyContext, next: NextFunction): Promise<void> {
  if (!ctx.message?.text || ctx.chat?.type === "private") {
    return next();
  }

  const text = ctx.message.text.trim();
  const parsed = parsePlus(text);
  if (!parsed) return next();

  const groupId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);
  const senderName = [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ");
  const senderUsername = ctx.from!.username ?? null;

  // Find nearest active event
  const event = await prisma.event.findFirst({
    where: {
      groupId,
      status: "ACTIVE",
      datetime: { gt: new Date() },
    },
    include: { participants: true },
    orderBy: { datetime: "asc" },
  });

  if (!event) return next();

  // Check capacity
  const goingCount = event.participants.filter((p) => p.status === "GOING").length;
  if (event.maxParticipants && goingCount + parsed.count > event.maxParticipants) {
    const left = event.maxParticipants - goingCount;
    await ctx.reply(
      left > 0
        ? `Мест осталось: ${left}. Ты пытаешься добавить ${parsed.count}.`
        : `Мест нет 😔`
    );
    return;
  }

  // First, ensure the sender is signed up
  await prisma.participant.upsert({
    where: { eventId_userId: { eventId: event.id, userId } },
    create: {
      eventId: event.id,
      userId,
      username: senderUsername,
      firstName: senderName,
      status: "GOING",
    },
    update: { status: "GOING", username: senderUsername, firstName: senderName },
  });

  // Add guests
  const addedNames: string[] = [];

  for (let i = 0; i < parsed.count; i++) {
    const guestName = parsed.names[i] || `Гость ${senderName}`;
    const isUsername = guestName.startsWith("@");
    // Use a synthetic unique ID for guests: sender_id + guest index
    const guestId = `guest_${userId}_${Date.now()}_${i}`;

    await prisma.participant.create({
      data: {
        eventId: event.id,
        userId: guestId,
        username: isUsername ? guestName.slice(1) : null,
        firstName: isUsername ? guestName : guestName,
        status: "GOING",
      },
    });

    addedNames.push(guestName);
  }

  // Update event card
  const updated = await getEvent(event.id);
  if (updated?.messageId) {
    try {
      await ctx.api.editMessageText(
        event.groupId,
        updated.messageId,
        formatEventCard(updated),
        { parse_mode: "HTML", reply_markup: rsvpKeyboard(event.id) }
      );
    } catch (_) {}
  }

  // Confirm
  const namesStr = addedNames.length > 0
    ? addedNames.join(", ")
    : `${parsed.count} чел.`;

  const totalGoing = (updated?.participants.filter((p) => p.status === "GOING").length) ?? 0;
  const maxStr = event.maxParticipants ? ` / ${event.maxParticipants}` : "";

  await ctx.reply(
    `✅ ${senderName} + ${namesStr} на ${event.title} (👥 ${totalGoing}${maxStr})`
  );
}
