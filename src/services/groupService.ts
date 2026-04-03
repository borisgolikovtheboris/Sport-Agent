import prisma from "../db/prisma";

export interface RegisterGroupInput {
  chatId: string;
  title: string;
  adminId: string;
}

export async function registerGroup(input: RegisterGroupInput) {
  return prisma.group.upsert({
    where: { chatId: input.chatId },
    update: { title: input.title },
    create: {
      chatId: input.chatId,
      title: input.title,
      adminId: input.adminId,
    },
  });
}

export async function markGroupInactive(chatId: string) {
  await prisma.group.delete({ where: { chatId } }).catch(() => {});
}

export async function getUserGroups(userId: string) {
  // Find groups where user created events or is admin
  const groups = await prisma.group.findMany({
    where: {
      OR: [
        { adminId: userId },
        { events: { some: { participants: { some: { userId } } } } },
        { events: { some: { createdBy: userId } } },
      ],
    },
  });
  return groups;
}
