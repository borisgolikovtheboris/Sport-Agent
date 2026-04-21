import prisma from "../db/prisma";
import { createPaymentRecords } from "./paymentService";

export interface PendingReminder {
  id: string;
  eventId: string;
  type: "SIGNUP_24H" | "SIGNUP_48H" | "PAYMENT_AFTER" | "SERIES_PUBLISH_48H" | "RSVP_NUDGE" | "SCORE_COLLECT";
  event: {
    id: string;
    groupId: string;
    title: string;
    datetime: Date;
    price: number | null;
    paymentInfo: string | null;
    status: string;
    maxParticipants: number | null;
    participants: {
      userId: string;
      username: string | null;
      firstName: string;
      status: string;
    }[];
  };
}

/**
 * Find and process all due reminders.
 * Returns reminders ready to send (caller handles actual Telegram delivery).
 */
export async function getDueReminders(): Promise<PendingReminder[]> {
  const reminders = await prisma.reminder.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: new Date() },
    },
    include: {
      event: {
        include: { participants: true },
      },
    },
  });

  const toSend: PendingReminder[] = [];

  for (const r of reminders) {
    if (r.event.status === "CANCELLED") {
      await prisma.reminder.update({
        where: { id: r.id },
        data: { status: "SKIPPED" },
      });
      continue;
    }

    // For PAYMENT_AFTER, create payment records first
    if (r.type === "PAYMENT_AFTER" && r.event.price) {
      await createPaymentRecords(r.event.id);
    }

    toSend.push(r as PendingReminder);
  }

  return toSend;
}

/**
 * Mark reminder as sent and save the message ID.
 */
export async function markReminderSent(reminderId: string, messageId?: number) {
  await prisma.reminder.update({
    where: { id: reminderId },
    data: {
      status: "SENT",
      sentAt: new Date(),
      reminderMessageId: messageId ?? null,
    },
  });
}

/**
 * Backfill SIGNUP_48H reminders for ACTIVE events that predate the 48h feature.
 * If the 48h mark has already passed, schedule a catch-up for ~now so the user still gets it.
 * Idempotent: skips events that already have a SIGNUP_48H reminder. Also collapses any
 * duplicate PENDING SIGNUP_48H rows left from previous racing backfills.
 */
export async function backfill48hReminders(): Promise<{ created: number; dedupedRows: number }> {
  const now = new Date();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TWO_DAYS_MS = 2 * DAY_MS;
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const TWO_H_MS = 2 * 60 * 60 * 1000;

  // Collapse pre-existing duplicate PENDING SIGNUP_48H rows per event — keep the earliest id.
  const dupes = await prisma.reminder.groupBy({
    by: ["eventId"],
    where: { type: "SIGNUP_48H", status: "PENDING" },
    _count: { _all: true },
    having: { _all: { _count: { gt: 1 } } },
  } as any);
  let dedupedRows = 0;
  for (const d of dupes as Array<{ eventId: string }>) {
    const rows = await prisma.reminder.findMany({
      where: { eventId: d.eventId, type: "SIGNUP_48H", status: "PENDING" },
      orderBy: { id: "asc" },
    });
    const extras = rows.slice(1).map((r) => r.id);
    if (extras.length) {
      const res = await prisma.reminder.deleteMany({ where: { id: { in: extras } } });
      dedupedRows += res.count;
    }
  }

  const events = await prisma.event.findMany({
    where: {
      status: "ACTIVE",
      datetime: { gt: new Date(now.getTime() + TWO_H_MS) },
    },
    include: { reminders: true },
  });

  let created = 0;
  for (const ev of events) {
    const has48h = ev.reminders.some((r) => r.type === "SIGNUP_48H");
    if (has48h) continue;

    const eventMs = ev.datetime.getTime();
    const targetMs = eventMs - TWO_DAYS_MS;
    const scheduledFor = new Date(Math.max(targetMs, now.getTime() + FIVE_MIN_MS));
    // Don't schedule inside the last 2h — 24h/short-notice reminders cover that.
    if (eventMs - scheduledFor.getTime() < TWO_H_MS) continue;

    await prisma.reminder.create({
      data: { eventId: ev.id, type: "SIGNUP_48H", scheduledFor },
    });
    created++;
  }

  return { created, dedupedRows };
}

/**
 * Get all reminder message IDs for an event (for updating cards on RSVP).
 */
export async function getReminderMessageIds(eventId: string): Promise<number[]> {
  const reminders = await prisma.reminder.findMany({
    where: {
      eventId,
      status: "SENT",
      reminderMessageId: { not: null },
    },
    select: { reminderMessageId: true },
  });

  return reminders
    .map((r) => r.reminderMessageId)
    .filter((id): id is number => id !== null);
}
