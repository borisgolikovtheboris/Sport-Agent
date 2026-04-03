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
 * Организатор подтверждает оплату участника.
 */
export async function verifyPayment(
  eventId: string,
  userId: string,
  organizerId: string
): Promise<{ success: boolean; message: string }> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { success: false, message: "Событие не найдено." };
  if (event.createdBy !== organizerId) return { success: false, message: "Только организатор может подтвердить оплату." };

  const payment = await prisma.payment.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (!payment) return { success: false, message: "Запись оплаты не найдена." };
  if (payment.status === "VERIFIED") return { success: false, message: "Оплата уже подтверждена." };
  if (payment.status !== "SELF_CONFIRMED") return { success: false, message: "Участник ещё не отметил оплату." };

  await prisma.payment.update({
    where: { eventId_userId: { eventId, userId } },
    data: { status: "VERIFIED", verifiedAt: new Date() },
  });

  return { success: true, message: "Оплата подтверждена ✅" };
}

/**
 * Организатор отклоняет оплату участника.
 */
export async function rejectPayment(
  eventId: string,
  userId: string,
  organizerId: string
): Promise<{ success: boolean; message: string }> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { success: false, message: "Событие не найдено." };
  if (event.createdBy !== organizerId) return { success: false, message: "Только организатор может отклонить оплату." };

  const payment = await prisma.payment.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (!payment) return { success: false, message: "Запись оплаты не найдена." };
  if (payment.status === "REJECTED") return { success: false, message: "Оплата уже отклонена." };

  await prisma.payment.update({
    where: { eventId_userId: { eventId, userId } },
    data: { status: "REJECTED" },
  });

  return { success: true, message: "Оплата отклонена ❌" };
}

/**
 * Сводка оплат для организатора — три статуса.
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

  const verifiedPayments = event.payments.filter((p) => p.status === "VERIFIED");
  const pendingPayments = event.payments.filter((p) => p.status === "SELF_CONFIRMED");
  const paidUserIds = new Set([
    ...verifiedPayments.map((p) => p.userId),
    ...pendingPayments.map((p) => p.userId),
  ]);

  const verifiedList = verifiedPayments.map((p) => ({
    userId: p.userId,
    firstName: p.firstName,
    username: p.username ?? undefined,
  }));

  const pendingList = pendingPayments.map((p) => ({
    userId: p.userId,
    firstName: p.firstName,
    username: p.username ?? undefined,
  }));

  const unpaidList = goingParticipants
    .filter((p) => !paidUserIds.has(p.userId))
    .map((p) => ({
      userId: p.userId,
      firstName: p.firstName,
      username: p.username ?? undefined,
    }));

  return {
    event,
    total: goingParticipants.length,
    verified: verifiedList.length,
    pending: pendingList.length,
    unpaid: unpaidList.length,
    verifiedList,
    pendingList,
    unpaidList,
  };
}
