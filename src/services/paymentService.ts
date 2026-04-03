import prisma from "../db/prisma";

/**
 * Создать записи Payment для всех участников со статусом GOING.
 * Вызывается при отправке PAYMENT_AFTER напоминания.
 */
export async function createPaymentRecords(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { participants: true },
  });

  if (!event || !event.price) return;

  const goingParticipants = event.participants.filter((p) => p.status === "GOING");

  for (const p of goingParticipants) {
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
}

/**
 * Участник подтвердил оплату (нажал «Оплатил»).
 */
export async function confirmPayment(
  eventId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  // Проверяем, что пользователь — участник события
  const participant = await prisma.participant.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });

  if (!participant || participant.status !== "GOING") {
    return { success: false, message: "Ты не записан на эту тренировку." };
  }

  // Проверяем, есть ли уже запись оплаты
  const existing = await prisma.payment.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });

  if (existing?.status === "SELF_CONFIRMED" || existing?.status === "VERIFIED") {
    return { success: false, message: "Ты уже отметил оплату ✅" };
  }

  await prisma.payment.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: {
      eventId,
      userId,
      username: participant.username,
      firstName: participant.firstName,
      status: "SELF_CONFIRMED",
      confirmedAt: new Date(),
    },
    update: {
      status: "SELF_CONFIRMED",
      confirmedAt: new Date(),
    },
  });

  return { success: true, message: "Отмечено! Организатор увидит оплату 💰" };
}

/**
 * Сводка оплат для организатора.
 */
export async function getPaymentSummary(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      participants: true,
      payments: true,
    },
  });

  if (!event) return null;

  const goingParticipants = event.participants.filter((p) => p.status === "GOING");

  const paidPayments = event.payments.filter(
    (p) => p.status === "SELF_CONFIRMED" || p.status === "VERIFIED"
  );
  const paidUserIds = new Set(paidPayments.map((p) => p.userId));

  const paidList = paidPayments.map((p) => ({
    firstName: p.firstName,
    username: p.username ?? undefined,
  }));

  const unpaidList = goingParticipants
    .filter((p) => !paidUserIds.has(p.userId))
    .map((p) => ({
      firstName: p.firstName,
      username: p.username ?? undefined,
    }));

  return {
    event,
    total: goingParticipants.length,
    paid: paidList.length,
    unpaid: unpaidList.length,
    paidList,
    unpaidList,
  };
}
