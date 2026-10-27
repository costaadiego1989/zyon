import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type {
  PlatformBillingReceivable,
  PlatformBillingReceivablePage,
  PlatformBillingReceivableQuery,
  PlatformBillingReceivableRepository,
  PlatformBillingReceivableStatus,
  PlatformBillingReceivablesReadAudit,
} from "../domain/ports/platform-billing-receivable-repository.port.js";

const ACTIVE_RECEIVABLE_STATUSES: PlatformBillingReceivableStatus[] = ["open", "overdue"];
const SUPPORTED_BILLING_PROVIDERS = ["asaas", "stripe", "mercadopago"] as const;
const FINANCIAL_METRICS_CURRENCY = "BRL";

@Injectable()
export class PrismaPlatformBillingReceivableRepository implements PlatformBillingReceivableRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(input: PlatformBillingReceivableQuery, asOf: Date): Promise<PlatformBillingReceivablePage> {
    const where = listWhere(input);
    if (input.cursor) await this.assertCursorMatches(input.cursor, where);

    const [rows, summary] = await Promise.all([
      this.prisma.billingReceivable.findMany({
        where,
        include: { merchant: { select: { id: true, name: true } } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        take: input.limit + 1,
      }),
      this.summary(asOf),
    ]);

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: page.map(toReceivable),
      summary,
      ...(hasMore ? { nextCursor: page.at(-1)?.id } : {}),
    };
  }

  async summary(asOf: Date): Promise<PlatformBillingReceivablePage["summary"]> {
    const dayStart = utcDayStart(asOf);
    const tomorrow = addUtcDays(dayStart, 1);
    const afterSevenDays = addUtcDays(tomorrow, 7);
    const activeWhere: Prisma.BillingReceivableWhereInput = {
      provider: { in: [...SUPPORTED_BILLING_PROVIDERS] },
      currency: FINANCIAL_METRICS_CURRENCY,
      status: { in: ACTIVE_RECEIVABLE_STATUSES },
    };
    const overdueWhere: Prisma.BillingReceivableWhereInput = {
      ...activeWhere,
      dueAt: { lt: dayStart },
    };
    const dueTodayWhere: Prisma.BillingReceivableWhereInput = {
      ...activeWhere,
      dueAt: { gte: dayStart, lt: tomorrow },
    };
    const dueNextSevenDaysWhere: Prisma.BillingReceivableWhereInput = {
      ...activeWhere,
      dueAt: { gte: tomorrow, lt: afterSevenDays },
    };

    const [observed, firstObserved, open, overdue, overdueMerchants, dueToday, dueNextSevenDays,
      paymentConfirmed, incompleteAmountCount, incompleteDueDateCount, nextDue] = await Promise.all([
      this.prisma.billingReceivable.count({ where: { provider: { in: [...SUPPORTED_BILLING_PROVIDERS] }, currency: FINANCIAL_METRICS_CURRENCY } }),
      this.prisma.billingReceivable.aggregate({
        where: { provider: { in: [...SUPPORTED_BILLING_PROVIDERS] }, currency: FINANCIAL_METRICS_CURRENCY },
        _min: { firstObservedAt: true },
      }),
      aggregateAmount(this.prisma, activeWhere),
      aggregateAmount(this.prisma, overdueWhere),
      this.prisma.billingReceivable.groupBy({
        by: ["merchantId"],
        where: overdueWhere,
      }),
      aggregateAmount(this.prisma, dueTodayWhere),
      aggregateAmount(this.prisma, dueNextSevenDaysWhere),
      aggregateAmount(this.prisma, { provider: { in: [...SUPPORTED_BILLING_PROVIDERS] }, currency: FINANCIAL_METRICS_CURRENCY, status: "paid" }),
      this.prisma.billingReceivable.count({
        where: { provider: { in: [...SUPPORTED_BILLING_PROVIDERS] }, currency: FINANCIAL_METRICS_CURRENCY, amountCents: null },
      }),
      this.prisma.billingReceivable.count({
        where: { ...activeWhere, dueAt: null },
      }),
      this.prisma.billingReceivable.findFirst({
        where: { ...activeWhere, dueAt: { gte: dayStart } },
        select: { dueAt: true },
        orderBy: { dueAt: "asc" },
      }),
    ]);

    return {
      observedReceivableCount: observed,
      ...(firstObserved._min.firstObservedAt ? { observedSince: firstObserved._min.firstObservedAt } : {}),
      openCount: open.count,
      ...(observed > 0 ? { openBalanceCents: open.amountCents } : {}),
      overdueCount: overdue.count,
      overdueMerchantCount: overdueMerchants.length,
      ...(observed > 0 ? { overdueBalanceCents: overdue.amountCents } : {}),
      dueTodayCount: dueToday.count,
      ...(observed > 0 ? { dueTodayBalanceCents: dueToday.amountCents } : {}),
      dueNext7DaysCount: dueNextSevenDays.count,
      ...(observed > 0 ? { dueNext7DaysBalanceCents: dueNextSevenDays.amountCents } : {}),
      ...(nextDue?.dueAt ? { nextDueAt: nextDue.dueAt } : {}),
      paymentConfirmedCount: paymentConfirmed.count,
      ...(observed > 0 ? { paymentConfirmedAmountCents: paymentConfirmed.amountCents } : {}),
      incompleteAmountCount,
      incompleteDueDateCount,
    };
  }

  async recordRead(input: PlatformBillingReceivablesReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.billing.receivables.read",
        permission: "platform:billing:read",
        environment: input.environment,
        targetType: "platform_billing_receivables",
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          source: "authenticated_subscription_billing_webhooks",
          returnedItems: input.returnedItems,
          totalObservedReceivables: input.totalObservedReceivables,
          ...(input.status ? { status: input.status } : {}),
        },
      },
    });
  }

  private async assertCursorMatches(cursor: string, where: Prisma.BillingReceivableWhereInput): Promise<void> {
    const row = await this.prisma.billingReceivable.findFirst({
      where: { ...where, id: cursor },
      select: { id: true },
    });
    if (!row) throw new Error("platform_billing_receivables_invalid_cursor");
  }
}

async function aggregateAmount(
  prisma: PrismaClient,
  where: Prisma.BillingReceivableWhereInput,
): Promise<{ count: number; amountCents: string }> {
  const result = await prisma.billingReceivable.aggregate({
    where,
    _count: { _all: true },
    _sum: { amountCents: true },
  });
  return {
    count: result._count._all,
    amountCents: String(result._sum.amountCents ?? 0),
  };
}

function listWhere(input: PlatformBillingReceivableQuery): Prisma.BillingReceivableWhereInput {
  return {
    provider: { in: [...SUPPORTED_BILLING_PROVIDERS] },
    // The current platform billing catalog is priced in BRL. Keep the list and
    // its aggregate metrics in the same currency until a per-currency API is
    // introduced; journal rows in other currencies remain durable in storage.
    currency: FINANCIAL_METRICS_CURRENCY,
    ...(input.status ? { status: input.status } : {}),
  };
}

function toReceivable(row: Prisma.BillingReceivableGetPayload<{
  include: { merchant: { select: { id: true; name: true } } };
}>): PlatformBillingReceivable {
  return {
    id: row.id,
    merchantId: row.merchant.id,
    merchantName: row.merchant.name,
    provider: provider(row.provider),
    providerPaymentId: row.providerPaymentId,
    providerSubscriptionId: row.providerSubscriptionId,
    status: receivableStatus(row.status),
    currency: row.currency,
    ...(row.amountCents !== null ? { amountCents: row.amountCents } : {}),
    ...(row.dueAt ? { dueAt: row.dueAt } : {}),
    ...(row.paidAt ? { paidAt: row.paidAt } : {}),
    firstObservedAt: row.firstObservedAt,
    lastProviderEventAt: row.lastProviderEventAt,
  };
}

function receivableStatus(value: string): PlatformBillingReceivableStatus {
  if (["open", "overdue", "paid", "cancelled", "refunded"].includes(value)) {
    return value as PlatformBillingReceivableStatus;
  }
  throw new Error("platform_billing_receivable_status_invalid");
}

function provider(value: string): "asaas" | "stripe" | "mercadopago" {
  if (value === "asaas" || value === "stripe" || value === "mercadopago") return value;
  throw new Error("platform_billing_receivable_provider_invalid");
}

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}
