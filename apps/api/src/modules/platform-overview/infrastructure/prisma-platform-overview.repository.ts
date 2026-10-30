import type { PrismaClient } from "@prisma/client";
import type {
  PlatformOverviewAuditInput,
  PlatformOverviewRepository,
  PlatformOverviewSnapshot,
} from "../domain/ports/platform-overview-repository.port.js";

export class PrismaPlatformOverviewRepository implements PlatformOverviewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async snapshot(now: Date): Promise<PlatformOverviewSnapshot> {
    const periodStartedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [
      registered,
      activeUsers,
      subscriptionStatuses,
      activeRecords,
      activeTrials,
      feedbackReceived,
      aiChatAggregate,
      pricedUsageEvents,
      unpricedUsageEvents,
    ] = await Promise.all([
      this.prisma.merchant.count(),
      this.prisma.merchantUser.count({ where: { disabledAt: null } }),
      this.prisma.merchantBillingSubscription.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.merchantBillingSubscription.count({ where: { status: "active" } }),
      this.prisma.merchantBillingSubscription.count({
        where: { status: "trialing", trialEndsAt: { gt: now } },
      }),
      this.prisma.merchantPlatformFeedback.count(),
      this.prisma.aiUsageEvent.aggregate({
        where: { costCenter: { not: "voice" }, measurementOrigin: { in: ["server_http", "server_sideband"] }, payer: "platform", OR: [{ currency: "USD" }, { currency: null }], startedAt: { gte: periodStartedAt } },
        _count: { _all: true },
        _sum: { totalTokens: true, costMicros: true },
      }),
      this.prisma.aiUsageEvent.count({
        where: {
          costCenter: { not: "voice" }, measurementOrigin: { in: ["server_http", "server_sideband"] }, payer: "platform", OR: [{ currency: "USD" }, { currency: null }],
          startedAt: { gte: periodStartedAt },
          costMicros: { not: null },
        },
      }),
      this.prisma.aiUsageEvent.count({
        where: {
          costCenter: { not: "voice" }, measurementOrigin: { in: ["server_http", "server_sideband"] }, payer: "platform", OR: [{ currency: "USD" }, { currency: null }],
          startedAt: { gte: periodStartedAt },
          costMicros: null,
        },
      }),
    ]);

    return {
      generatedAt: now,
      merchants: { registered, activeUsers },
      subscriptions: {
        byStatus: Object.fromEntries(
          subscriptionStatuses.map((entry) => [entry.status, entry._count._all]),
        ),
        activeRecords,
        activeTrials,
      },
      feedback: { received: feedbackReceived },
      aiChat: {
        periodStartedAt,
        usageEvents: aiChatAggregate._count._all,
        totalTokens: aiChatAggregate._sum.totalTokens ?? 0,
        pricedUsageEvents,
        unpricedUsageEvents,
        knownCostMicros: aiChatAggregate._sum.costMicros ?? 0n,
      },
    };
  }

  async recordRead(input: PlatformOverviewAuditInput): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.overview.read",
        permission: "platform:overview:read",
        environment: input.environment,
        targetType: "platform_overview",
        correlationId: input.correlationId,
        outcome: "success",
        details: { source: "platform_control" },
      },
    });
  }
}
