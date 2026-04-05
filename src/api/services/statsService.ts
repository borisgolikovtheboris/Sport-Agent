import prisma from "../../db/prisma";

export async function getOverview() {
  const [
    groupsTotal,
    eventsTotal,
    eventsActive,
    eventsCancelled,
    uniqueUsers,
    totalSignups,
    seriesTotalCount,
    seriesActiveCount,
    paymentsByStatus,
    nluTotal,
    nluSuccess,
    nluAvgConf,
  ] = await Promise.all([
    prisma.group.count(),
    prisma.event.count(),
    prisma.event.count({ where: { status: "ACTIVE" } }),
    prisma.event.count({ where: { status: "CANCELLED" } }),
    prisma.participant.findMany({ distinct: ["userId"], select: { userId: true } }),
    prisma.participant.count({ where: { status: "GOING" } }),
    prisma.eventSeries.count(),
    prisma.eventSeries.count({ where: { isActive: true } }),
    prisma.payment.groupBy({ by: ["status"], _count: true }),
    prisma.nLULog.count(),
    prisma.nLULog.count({ where: { success: true } }),
    prisma.nLULog.aggregate({ _avg: { confidence: true } }),
  ]);

  return {
    groups: { total: groupsTotal },
    events: {
      total: eventsTotal,
      active: eventsActive,
      completed: eventsTotal - eventsActive - eventsCancelled,
      cancelled: eventsCancelled,
    },
    participants: {
      uniqueUsers: uniqueUsers.length,
      totalSignups,
    },
    series: {
      total: seriesTotalCount,
      active: seriesActiveCount,
    },
    payments: {
      totalRecords: paymentsByStatus.reduce((s, p) => s + p._count, 0),
      byStatus: paymentsByStatus.map((p) => ({
        status: p.status,
        count: p._count,
      })),
    },
    nlu: {
      totalRequests: nluTotal,
      successfulParses: nluSuccess,
      averageConfidence: nluAvgConf._avg.confidence ?? 0,
    },
  };
}

export async function getEventsByPeriod(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const events = (await prisma.$queryRaw`
    SELECT
      DATE("datetime") as date,
      COUNT(*)::int as created
    FROM "Event"
    WHERE "datetime" >= ${since}
    GROUP BY DATE("datetime")
    ORDER BY date
  `) as { date: string; created: number }[];

  return { period: `${days}d`, daily: events };
}

export async function getGroups() {
  const groups = await prisma.group.findMany({
    include: { _count: { select: { events: true } } },
    orderBy: { addedAt: "desc" },
  });
  return groups.map((g) => ({
    chatId: g.chatId,
    title: g.title,
    addedAt: g.addedAt,
    eventsCount: g._count.events,
  }));
}

export async function getNLUStats() {
  const byIntent = await prisma.nLULog.groupBy({
    by: ["intent"],
    _count: true,
  });
  const avgLatency = await prisma.nLULog.aggregate({
    _avg: { latencyMs: true },
  });
  const recentErrors = await prisma.nLULog.findMany({
    where: { success: false },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return {
    byIntent: byIntent.map((b) => ({ intent: b.intent, count: b._count })),
    avgLatencyMs: avgLatency._avg.latencyMs ?? 0,
    recentErrors,
  };
}
