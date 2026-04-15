import prisma from "../db/prisma";

export interface CreateEventInput {
  groupId: string;
  title: string;
  datetime: Date;
  maxParticipants: number | null;
  price: number | null;
  paymentInfo: string | null;
  createdBy: string;
}

export async function createEvent(input: CreateEventInput) {
  const event = await prisma.event.create({
    data: {
      groupId: input.groupId,
      title: input.title,
      datetime: input.datetime,
      maxParticipants: input.maxParticipants,
      price: input.price,
      paymentInfo: input.paymentInfo,
      createdBy: input.createdBy,
      status: "ACTIVE",
    },
    include: { participants: true },
  });

  // Pre-event reminder (SIGNUP_24H type is reused for the short-notice variant)
  const now = Date.now();
  const eventMs = input.datetime.getTime();
  const msUntilEvent = eventMs - now;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TWO_H_MS = 2 * 60 * 60 * 1000;
  const FIVE_MIN_MS = 5 * 60 * 1000;

  let preEventReminderAt: Date | null = null;
  if (msUntilEvent > DAY_MS) {
    preEventReminderAt = new Date(eventMs - DAY_MS);
  } else if (msUntilEvent > TWO_H_MS + FIVE_MIN_MS) {
    preEventReminderAt = new Date(eventMs - TWO_H_MS);
  }
  if (preEventReminderAt) {
    await prisma.reminder.create({
      data: {
        eventId: event.id,
        type: "SIGNUP_24H",
        scheduledFor: preEventReminderAt,
      },
    });
  }

  // RSVP_NUDGE — 20:00 previous day, or catch-up shortly after creation if that moment already passed
  const NUDGE_MIN_LEAD_MS = 3 * 60 * 60 * 1000;
  const nudgeTargetAt = new Date(input.datetime);
  nudgeTargetAt.setDate(nudgeTargetAt.getDate() - 1);
  nudgeTargetAt.setHours(20, 0, 0, 0);

  let nudgeAt = nudgeTargetAt.getTime();
  if (nudgeAt < now + FIVE_MIN_MS) {
    nudgeAt = now + FIVE_MIN_MS;
  }
  if (nudgeAt <= eventMs - NUDGE_MIN_LEAD_MS) {
    await prisma.reminder.create({
      data: {
        eventId: event.id,
        type: "RSVP_NUDGE",
        scheduledFor: new Date(nudgeAt),
      },
    });
  }

  // Create PAYMENT_AFTER reminder if event has a price
  if (input.price) {
    await prisma.reminder.create({
      data: {
        eventId: event.id,
        type: "PAYMENT_AFTER",
        scheduledFor: new Date(input.datetime.getTime() + 60 * 60 * 1000),
      },
    });
  }

  return event;
}

export async function saveMessageId(eventId: string, messageId: number) {
  return prisma.event.update({
    where: { id: eventId },
    data: { messageId },
  });
}

export async function getEvent(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
  });
}

export async function listActiveEvents(groupId: string) {
  const events = await prisma.event.findMany({
    where: {
      groupId,
      status: "ACTIVE",
      datetime: { gt: new Date() },
    },
    include: { participants: true },
    orderBy: { datetime: "asc" },
  });
  return { events };
}

export async function getEventWithSeries(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
    // seriesId is available on the result directly
  });
}

export async function cancelEvent(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
  });

  if (!event) return { ok: false as const, reason: "not_found" as const };
  if (event.createdBy !== userId)
    return { ok: false as const, reason: "not_owner" as const };

  await prisma.event.update({
    where: { id: eventId },
    data: { status: "CANCELLED" },
  });

  // Skip all pending reminders for this event
  await prisma.reminder.updateMany({
    where: { eventId, status: "PENDING" },
    data: { status: "SKIPPED" },
  });

  return { ok: true as const, event };
}

/**
 * Enable paid event: create Payment records for GOING participants
 * and schedule PAYMENT_AFTER reminder if missing.
 */
export async function enablePaidEvent(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
  });
  if (!event || !event.price) return;

  // Create Payment records for all GOING participants
  const going = event.participants.filter((p) => p.status === "GOING");
  for (const p of going) {
    await prisma.payment.upsert({
      where: { eventId_userId: { eventId, userId: p.userId } },
      create: {
        eventId,
        userId: p.userId,
        username: p.username,
        firstName: p.firstName,
        status: "PENDING",
      },
      update: {},
    });
  }

  // Create PAYMENT_AFTER reminder if none exists
  const existing = await prisma.reminder.findFirst({
    where: { eventId, type: "PAYMENT_AFTER" },
  });
  if (!existing) {
    const reminderTime = new Date(event.datetime.getTime() + 60 * 60 * 1000);
    if (reminderTime > new Date()) {
      await prisma.reminder.create({
        data: {
          eventId,
          type: "PAYMENT_AFTER",
          scheduledFor: reminderTime,
          status: "PENDING",
        },
      });
    }
  }
}
