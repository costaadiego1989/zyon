import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type {
  LocalBillingProvider,
  PlatformBillingSubscription,
  PlatformBillingSubscriptionPage,
  PlatformBillingSubscriptionQuery,
  PlatformBillingSubscriptionRepository,
  PlatformBillingSubscriptionsReadAudit,
} from "../domain/ports/platform-billing-subscription-repository.port.js";

@Injectable()
export class PrismaPlatformBillingSubscriptionRepository implements PlatformBillingSubscriptionRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(input: PlatformBillingSubscriptionQuery): Promise<PlatformBillingSubscriptionPage> {
    const where = subscriptionsWhere(input);
    if (input.cursor) await this.assertCursorMatches(input.cursor, where);

    const [rows, statuses, totalRecords, activeLocalRecords, activeTrials, pastDueLocalStateRecords,
      cancellationAtPeriodEndRecords, missingTermEndRecords] = await Promise.all([
      this.prisma.merchantBillingSubscription.findMany({
        where,
        include: { merchant: { select: { id: true, name: true } } },
        orderBy: { merchantId: "asc" },
        ...(input.cursor ? { cursor: { merchantId: input.cursor }, skip: 1 } : {}),
        take: input.limit + 1,
      }),
      this.prisma.merchantBillingSubscription.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      this.prisma.merchantBillingSubscription.count({ where }),
      this.prisma.merchantBillingSubscription.count({ where: { ...where, status: "active" } }),
      this.prisma.merchantBillingSubscription.count({
        where: { ...where, status: "trialing", trialEndsAt: { gt: input.asOf } },
      }),
      this.prisma.merchantBillingSubscription.count({ where: { ...where, status: "past_due" } }),
      this.prisma.merchantBillingSubscription.count({ where: { ...where, cancelAtPeriodEnd: true } }),
      this.prisma.merchantBillingSubscription.count({
        where: { ...where, currentPeriodEnd: null, trialEndsAt: null },
      }),
    ]);

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: page.map(toSubscription),
      summary: {
        totalRecords,
        recordsByStatus: Object.fromEntries(statuses.map(entry => [entry.status, entry._count._all])),
        activeLocalRecords,
        activeTrials,
        pastDueLocalStateRecords,
        cancellationAtPeriodEndRecords,
        missingTermEndRecords,
      },
      ...(hasMore ? { nextCursor: page.at(-1)?.merchantId } : {}),
    };
  }

  async recordRead(input: PlatformBillingSubscriptionsReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.billing.subscriptions.read",
        permission: "platform:billing:read",
        environment: input.environment,
        targetType: "platform_billing_subscriptions",
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          source: "local_subscription_snapshots",
          returnedItems: input.returnedItems,
          totalRecords: input.totalRecords,
          ...(input.status ? { status: input.status } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
        },
      },
    });
  }

  private async assertCursorMatches(
    cursor: string,
    where: Prisma.MerchantBillingSubscriptionWhereInput,
  ): Promise<void> {
    const row = await this.prisma.merchantBillingSubscription.findFirst({
      where: { ...where, merchantId: cursor },
      select: { merchantId: true },
    });
    if (!row) throw new Error("platform_billing_invalid_cursor");
  }
}

type BillingSubscriptionRow = Prisma.MerchantBillingSubscriptionGetPayload<{
  include: { merchant: { select: { id: true; name: true } } };
}>;

function subscriptionsWhere(input: PlatformBillingSubscriptionQuery): Prisma.MerchantBillingSubscriptionWhereInput {
  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.provider ? input.provider === "unknown" ? { provider: null } : { provider: input.provider } : {}),
  };
}

function toSubscription(row: BillingSubscriptionRow): PlatformBillingSubscription {
  const isTrial = row.status === "trialing" && row.trialEndsAt !== null;
  const normalizedPlanKey = planKey(row.planKey);
  return {
    merchantId: row.merchant.id,
    merchantName: row.merchant.name,
    provider: provider(row.provider),
    status: status(row.status),
    ...(normalizedPlanKey ? { planKey: normalizedPlanKey } : {}),
    billingCycle: row.billingCycle === "annual" ? "annual" : "monthly",
    ...(row.billingAmountCents !== null ? { billingAmountCents: row.billingAmountCents } : {}),
    ...(isTrial ? { termEndsAt: row.trialEndsAt!, termEndKind: "trial" as const } : row.currentPeriodEnd
      ? { termEndsAt: row.currentPeriodEnd, termEndKind: "billing_period" as const } : {}),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    ...(row.providerCancellationScheduledAt ? { providerCancellationScheduledAt: row.providerCancellationScheduledAt } : {}),
    ...(row.lastBillingEventAt ? { lastBillingEventAt: row.lastBillingEventAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function provider(value: string | null): LocalBillingProvider {
  return value === "asaas" || value === "stripe" || value === "mercadopago" ? value : "unknown";
}

function status(value: string): PlatformBillingSubscription["status"] {
  if (["trialing", "starter", "active", "past_due", "unpaid", "paused", "cancelled", "incomplete"].includes(value)) {
    return value as PlatformBillingSubscription["status"];
  }
  throw new Error("platform_billing_subscription_status_invalid");
}

function planKey(value: string | null): PlatformBillingSubscription["planKey"] | undefined {
  return value === "starter" || value === "growth" || value === "scale" ? value : undefined;
}
