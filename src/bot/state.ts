// Состояние диалога хранится в PostgreSQL — переживает рестарты бота
import prisma from '../db/prisma';

export type Step = 'TITLE' | 'DATE' | 'LIMIT';

export function getKey(userId: string, chatId: string) {
  return `${userId}_${chatId}`;
}

export async function getState(userId: string, chatId: string) {
  return prisma.botState.findUnique({ where: { id: getKey(userId, chatId) } });
}

export async function setState(userId: string, chatId: string, data: {
  step: Step;
  title?: string;
  datetime?: Date;
}) {
  await prisma.botState.upsert({
    where: { id: getKey(userId, chatId) },
    create: { id: getKey(userId, chatId), ...data },
    update: data,
  });
}

export async function clearState(userId: string, chatId: string) {
  await prisma.botState.deleteMany({ where: { id: getKey(userId, chatId) } });
}
