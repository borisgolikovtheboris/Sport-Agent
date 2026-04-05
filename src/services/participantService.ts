import prisma from "../db/prisma";
import { getEvent } from "./eventService";

export interface RsvpUser {
  userId: string;
  username: string | null;
  firstName: string;
}

export async function joinEvent(eventId: string, user: RsvpUser) {
  const event = await getEvent(eventId);
  if (!event || event.status !== "ACTIVE") {
    return { ok: false as const, reason: "inactive" as const };
  }

  const existing = event.participants.find((p) => p.userId === user.userId);

  if (existing?.status === "GOING") {
    return { ok: false as const, reason: "already_going" as const };
  }

  // Check capacity (only GOING count towards limit)
  const goingCount = event.participants.filter((p) => p.status === "GOING").length;
  if (event.maxParticipants && goingCount >= event.maxParticipants) {
    return {
      ok: false as const,
      reason: "full" as const,
      max: event.maxParticipants,
    };
  }

  // Was NOT_GOING → switching back to GOING
  const rejoined = existing?.status === "NOT_GOING";

  await prisma.participant.upsert({
    where: { eventId_userId: { eventId, userId: user.userId } },
    create: {
      eventId,
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      status: "GOING",
    },
    update: {
      status: "GOING",
      username: user.username,
      firstName: user.firstName,
    },
  });

  const updated = await getEvent(eventId);
  return { ok: true as const, event: updated!, rejoined };
}

export async function leaveEvent(eventId: string, userId: string) {
  const event = await getEvent(eventId);
  if (!event || event.status !== "ACTIVE") {
    return { ok: false as const, reason: "inactive" as const };
  }

  const existing = event.participants.find((p) => p.userId === userId);
  if (!existing || existing.status === "NOT_GOING") {
    return { ok: false as const, reason: "not_going" as const };
  }

  await prisma.participant.update({
    where: { eventId_userId: { eventId, userId } },
    data: { status: "NOT_GOING" },
  });

  const updated = await getEvent(eventId);
  return { ok: true as const, event: updated! };
}

export async function declineParticipant(
  eventId: string,
  userId: string,
  username: string | null,
  firstName: string
): Promise<{ action: "declined" | "already_declined" | "created_declined" }> {
  const existing = await prisma.participant.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });

  if (existing) {
    if (existing.status === "NOT_GOING") {
      return { action: "already_declined" };
    }
    // Was GOING → decline
    await prisma.participant.update({
      where: { eventId_userId: { eventId, userId } },
      data: { status: "NOT_GOING" },
    });
    return { action: "declined" };
  }

  // Not found → create as NOT_GOING
  await prisma.participant.create({
    data: {
      eventId,
      userId,
      username,
      firstName,
      status: "NOT_GOING",
    },
  });
  return { action: "created_declined" };
}
