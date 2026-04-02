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
