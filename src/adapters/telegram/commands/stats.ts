import prisma from "../../../db/prisma";
import { MyContext } from "../index";

export async function statsCommand(ctx: MyContext) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("⚠️ Эта команда работает только в групповых чатах.");
    return;
  }

  const groupId = String(ctx.chat!.id);

  const participants = await prisma.participant.findMany({
    where: {
      event: { groupId },
      status: "GOING",
      score: { not: null, gt: -1 },
    },
    select: {
      userId: true,
      username: true,
      firstName: true,
      score: true,
    },
  });

  if (participants.length === 0) {
    await ctx.reply("📊 Пока нет данных по очкам. После тренировки бот спросит участников — статистика появится здесь.");
    return;
  }

  const stats = new Map<string, {
    username: string | null;
    firstName: string;
    totalScore: number;
    games: number;
  }>();

  for (const p of participants) {
    const existing = stats.get(p.userId);
    if (existing) {
      existing.totalScore += p.score!;
      existing.games++;
      if (p.username) existing.username = p.username;
      existing.firstName = p.firstName;
    } else {
      stats.set(p.userId, {
        username: p.username,
        firstName: p.firstName,
        totalScore: p.score!,
        games: 1,
      });
    }
  }

  const sorted = [...stats.values()].sort((a, b) => b.totalScore - a.totalScore);

  const MEDALS = ["🥇", "🥈", "🥉"];
  const lines = sorted.slice(0, 15).map((s, i) => {
    const medal = MEDALS[i] ?? `${i + 1}.`;
    const name = s.username ? `@${s.username}` : s.firstName;
    const avg = (s.totalScore / s.games).toFixed(1);
    return `${medal} ${name} — <b>${s.totalScore}</b> оч. (${s.games} игр, ⌀ ${avg})`;
  });

  const totalGames = new Set(participants.map(() => 1)).size;
  const header = `📊 <b>Статистика группы</b>\n`;
  await ctx.reply(header + "\n" + lines.join("\n"), { parse_mode: "HTML" });
}
