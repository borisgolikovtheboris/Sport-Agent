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

  // Create SIGNUP_24H reminder if event is more than 24h away
  const msUntilEvent = input.datetime.getTime() - Date.now();
  if (msUntilEvent > 24 * 60 * 60 * 1000) {
    await prisma.reminder.create({
      data: {
        eventId: event.id,
        type: "SIGNUP_24H",
        scheduledFor: new Date(input.datetime.getTime() - 24 * 60 * 60 * 1000),
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
