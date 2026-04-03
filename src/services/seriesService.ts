import prisma from "../db/prisma";

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

export interface CreateSeriesInput {
  groupId: string;
  createdBy: string;
  title: string;
  time: string;           // "20:00"
  daysOfWeek: number[];   // [2, 4] = вт, чт
  maxParticipants?: number | null;
  price?: number | null;
  paymentInfo?: string | null;
  endsAt?: Date;          // default +3 months
}

export function dayNamesToNumbers(names: string[]): number[] {
  return names.map((n) => DAY_NAMES[n.toLowerCase()]).filter((n) => n !== undefined);
}

function generateDates(daysOfWeek: number[], time: string, startsFrom: Date, endsAt: Date): Date[] {
  const [hours, minutes] = time.split(":").map(Number);
  const dates: Date[] = [];
  const current = new Date(startsFrom);
  current.setHours(hours, minutes, 0, 0);

  // Align to start of day
  if (current <= startsFrom) {
    current.setDate(current.getDate() + 1);
    current.setHours(hours, minutes, 0, 0);
  }

  while (current <= endsAt && dates.length < 52) {
    if (daysOfWeek.includes(current.getDay())) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export async function createSeries(input: CreateSeriesInput) {
  const now = new Date();
  const startsFrom = now;
  const endsAt = input.endsAt ?? new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // +3 months

  const series = await prisma.eventSeries.create({
    data: {
      groupId: input.groupId,
      createdBy: input.createdBy,
      title: input.title,
      time: input.time,
      daysOfWeek: input.daysOfWeek,
      maxParticipants: input.maxParticipants ?? null,
      price: input.price ?? null,
      paymentInfo: input.paymentInfo ?? null,
      startsFrom,
      endsAt,
    },
  });

  const dates = generateDates(input.daysOfWeek, input.time, startsFrom, endsAt);

  const events = [];
  for (let i = 0; i < dates.length; i++) {
    const dt = dates[i];
    const event = await prisma.event.create({
      data: {
        groupId: input.groupId,
        title: input.title,
        datetime: dt,
        maxParticipants: input.maxParticipants ?? null,
        price: input.price ?? null,
        paymentInfo: input.paymentInfo ?? null,
        createdBy: input.createdBy,
        seriesId: series.id,
        status: "ACTIVE",
      },
      include: { participants: true },
    });

    // SIGNUP_24H reminder
    const msUntil = dt.getTime() - Date.now();
    if (msUntil > 24 * 60 * 60 * 1000) {
      await prisma.reminder.create({
        data: {
          eventId: event.id,
          type: "SIGNUP_24H",
          scheduledFor: new Date(dt.getTime() - 24 * 60 * 60 * 1000),
        },
      });
    }

    // PAYMENT_AFTER reminder
    if (input.price) {
      await prisma.reminder.create({
        data: {
          eventId: event.id,
          type: "PAYMENT_AFTER",
          scheduledFor: new Date(dt.getTime() + 60 * 60 * 1000),
        },
      });
    }

    // SERIES_PUBLISH_48H reminder (for all events except the first)
    if (i > 0) {
      const publish48h = new Date(dt.getTime() - 48 * 60 * 60 * 1000);
      if (publish48h > now) {
        await prisma.reminder.create({
          data: {
            eventId: event.id,
            type: "SERIES_PUBLISH_48H",
            scheduledFor: publish48h,
          },
        });
      }
    }

    events.push(event);
  }

  return { series, events };
}

export async function cancelSeries(seriesId: string, userId: string) {
  const series = await prisma.eventSeries.findUnique({ where: { id: seriesId } });
  if (!series) return { success: false, cancelledCount: 0 };
  if (series.createdBy !== userId) return { success: false, cancelledCount: 0 };

  // Cancel all future events in the series
  const now = new Date();
  const result = await prisma.event.updateMany({
    where: {
      seriesId,
      status: "ACTIVE",
      datetime: { gt: now },
    },
    data: { status: "CANCELLED" },
  });

  // Skip all pending reminders for cancelled events
  const futureEvents = await prisma.event.findMany({
    where: { seriesId, status: "CANCELLED", datetime: { gt: now } },
    select: { id: true },
  });
  const eventIds = futureEvents.map((e) => e.id);
  if (eventIds.length > 0) {
    await prisma.reminder.updateMany({
      where: { eventId: { in: eventIds }, status: "PENDING" },
      data: { status: "SKIPPED" },
    });
  }

  // Mark series inactive
  await prisma.eventSeries.update({
    where: { id: seriesId },
    data: { isActive: false },
  });

  return { success: true, cancelledCount: result.count };
}

export async function listUserSeries(groupId: string, userId: string) {
  return prisma.eventSeries.findMany({
    where: { groupId, createdBy: userId, isActive: true },
  });
}

const DAYS_RU_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function formatDaysOfWeek(days: number[]): string {
  return days.sort().map((d) => DAYS_RU_SHORT[d]).join("/");
}
