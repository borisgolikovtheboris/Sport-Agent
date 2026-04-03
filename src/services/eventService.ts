import prisma from "../db/prisma";

export interface CreateEventInput {
  groupId: string;
  title: string;
  datetime: Date;
  maxParticipants: number | null;
  createdBy: string;
}

export async function createEvent(input: CreateEventInput) {
  return prisma.event.create({
    data: {
      groupId: input.groupId,
      title: input.title,
      datetime: input.datetime,
      maxParticipants: input.maxParticipants,
      createdBy: input.createdBy,
      status: "ACTIVE",
    },
    include: { participants: true },
  });
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

  return { ok: true as const, event };
}
