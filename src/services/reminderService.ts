import prisma from "../db/prisma";
import { createPaymentRecords } from "./paymentService";

export interface PendingReminder {
  id: string;
  eventId: string;
  type: "SIGNUP_24H" | "PAYMENT_AFTER" | "SERIES_PUBLISH_48H" | "RSVP_NUDGE" | "SCORE_COLLECT";
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
