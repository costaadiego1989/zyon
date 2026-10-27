import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  PLATFORM_CHAT_USAGE_CAPTURE_SOURCE,
  PLATFORM_CHAT_USAGE_CHANNEL,
  PLATFORM_CHAT_USAGE_COMPONENT,
  PLATFORM_VOICE_USAGE_CAPTURE_SOURCE,
  PLATFORM_VOICE_USAGE_CHANNEL,
  PLATFORM_VOICE_USAGE_PROVIDER,
} from "../../platform-control/domain/platform-ai-usage.js";
import type {
  PlatformMetricsAiCost,
  PlatformMetricsAiSeriesPoint,
  PlatformMetricsAiTotals,
  PlatformMetricsFinancialSeriesPoint,
  PlatformMetricsPeriod,
  PlatformMetricsReadAudit,
  PlatformMetricsRepository,
  PlatformMetricsSnapshot,
} from "../domain/ports/platform-metrics-repository.port.js";

const BILLING_PROVIDERS = ["asaas", "stripe", "mercadopago"] as const;
const FINANCIAL_CURRENCY = "BRL";
const PRESENTATION_TIME_ZONE = "America/Sao_Paulo";

@Injectable()
export class PrismaPlatformMetricsRepository implements PlatformMetricsRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async snapshot(period: PlatformMetricsPeriod): Promise<PlatformMetricsSnapshot> {
    const [financial, subscriptions, ai] = await Promise.all([
      this.financialSnapshot(period),
      this.subscriptionSnapshot(),
      this.aiSnapshot(period),
    ]);
    return { financial, subscriptions, ai };
  }

  async recordRead(input: PlatformMetricsReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.overview.metrics.read",
        permission: "platform:overview:read",
        environment: input.environment,
        targetType: "platform_overview_metrics",
        correlationId: input.correlationId,
        outcome: "success",
        details: {
          from: input.period.from.toISOString(),
          to: input.period.to.toISOString(),
          granularity: input.period.granularity,
          timezone: PRESENTATION_TIME_ZONE,
          endExclusive: true,
          source: "authenticated_subscription_billing_webhooks_and_ai_usage_events",
        },
      },
    });
  }

  private async financialSnapshot(period: PlatformMetricsPeriod): Promise<PlatformMetricsSnapshot["financial"]> {
    const coverageWhere: Prisma.BillingReceivableWhereInput = {
      provider: { in: [...BILLING_PROVIDERS] },
      currency: FINANCIAL_CURRENCY,
    };
    const paidWhere: Prisma.BillingReceivableWhereInput = {
      ...coverageWhere,
      status: "paid",
      paidAt: { gte: period.from, lt: period.to },
    };
    const [coverage, payments, seriesRows] = await Promise.all([
      this.prisma.billingReceivable.aggregate({
        where: coverageWhere,
        _count: { _all: true },
        _min: { firstObservedAt: true },
      }),
      this.prisma.billingReceivable.aggregate({
        where: paidWhere,
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      this.prisma.$queryRaw<FinancialSeriesRow[]>(Prisma.sql`
        SELECT
          TO_CHAR(DATE_TRUNC(${bucketUnit(period)}, paid_at AT TIME ZONE ${PRESENTATION_TIME_ZONE}), ${bucketFormat(period)}) AS bucket,
          COUNT(*)::text AS "confirmedPaymentCount",
          COALESCE(SUM(amount_cents), 0)::text AS "confirmedKnownAmountCents",
          COUNT(*) FILTER (WHERE amount_cents IS NULL)::text AS "incompleteAmountCount"
        FROM billing_receivables
        WHERE provider IN (${Prisma.join(BILLING_PROVIDERS)})
          AND currency = ${FINANCIAL_CURRENCY}
          AND status = 'paid'
          AND paid_at >= ${period.from}
          AND paid_at < ${period.to}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
    ]);
    const incompleteAmountCount = await this.prisma.billingReceivable.count({
      where: { ...paidWhere, amountCents: null },
    });

    return {
      observedReceivableCount: coverage._count._all,
      ...(coverage._min.firstObservedAt ? { observedSince: coverage._min.firstObservedAt } : {}),
      confirmedPaymentCount: BigInt(payments._count._all),
      confirmedKnownAmountCents: BigInt(payments._sum.amountCents ?? 0),
      incompleteAmountCount: BigInt(incompleteAmountCount),
      series: seriesRows.map(financialSeriesPoint),
    };
  }

  private async subscriptionSnapshot(): Promise<PlatformMetricsSnapshot["subscriptions"]> {
    const subscriptions = await this.prisma.merchantBillingSubscription.findMany({
      where: { status: "active" },
      select: { billingAmountCents: true, billingCycle: true },
    });
    const known = subscriptions.filter(subscription => subscription.billingAmountCents !== null && subscription.billingAmountCents > 0);
    const contractedMrrKnownCents = known.reduce((total, subscription) => {
      const amount = BigInt(subscription.billingAmountCents ?? 0);
      return total + (subscription.billingCycle === "annual" ? roundAnnualMonthlyEquivalent(amount) : amount);
    }, 0n);

    return {
      activeContractCount: subscriptions.length,
      activeContractWithKnownAmountCount: known.length,
      activeContractMissingAmountCount: subscriptions.length - known.length,
      contractedMrrKnownCents,
    };
  }

  private async aiSnapshot(period: PlatformMetricsPeriod): Promise<PlatformMetricsSnapshot["ai"]> {
    const filter = aiFilter(period);
    const [totalsRows, costRows, seriesRows, seriesCostRows] = await Promise.all([
      this.prisma.$queryRaw<AiTotalsRow[]>(Prisma.sql`
        SELECT
          usage.source AS source,
          COUNT(*)::text AS "eventCount",
          COALESCE(SUM(usage.total_tokens), 0)::text AS "totalTokens",
          COUNT(*) FILTER (WHERE usage.cost_status = 'unpriced')::text AS "unpricedEventCount"
        FROM ai_usage_events AS usage
        WHERE ${filter}
        GROUP BY usage.source
      `),
      this.prisma.$queryRaw<AiCostRow[]>(Prisma.sql`
        SELECT
          usage.source AS source,
          usage.cost_status AS "costStatus",
          usage.currency AS currency,
          COALESCE(SUM(usage.cost_micros), 0)::text AS "costMicros",
          COUNT(*)::text AS "eventCount"
        FROM ai_usage_events AS usage
        WHERE ${filter}
          AND usage.cost_status IN ('estimated', 'provider_reported', 'reconciled')
          AND usage.cost_micros IS NOT NULL
          AND usage.currency IS NOT NULL
        GROUP BY usage.source, usage.cost_status, usage.currency
        ORDER BY usage.source, usage.cost_status, usage.currency
      `),
      this.prisma.$queryRaw<AiSeriesRow[]>(Prisma.sql`
        SELECT
          TO_CHAR(DATE_TRUNC(${bucketUnit(period)}, usage.started_at AT TIME ZONE ${PRESENTATION_TIME_ZONE}), ${bucketFormat(period)}) AS bucket,
          COUNT(*) FILTER (WHERE usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE})::text AS "chatEventCount",
          COUNT(*) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE})::text AS "voiceEventCount",
          COALESCE(SUM(usage.total_tokens) FILTER (WHERE usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE}), 0)::text AS "chatTotalTokens",
          COALESCE(SUM(usage.total_tokens) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE}), 0)::text AS "voiceTotalTokens"
        FROM ai_usage_events AS usage
        WHERE ${filter}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      this.prisma.$queryRaw<AiSeriesCostRow[]>(Prisma.sql`
        SELECT
          TO_CHAR(DATE_TRUNC(${bucketUnit(period)}, usage.started_at AT TIME ZONE ${PRESENTATION_TIME_ZONE}), ${bucketFormat(period)}) AS bucket,
          usage.source AS source,
          usage.cost_status AS "costStatus",
          usage.currency AS currency,
          COALESCE(SUM(usage.cost_micros), 0)::text AS "costMicros",
          COUNT(*)::text AS "eventCount"
        FROM ai_usage_events AS usage
        WHERE ${filter}
          AND usage.cost_status IN ('estimated', 'provider_reported', 'reconciled')
          AND usage.cost_micros IS NOT NULL
          AND usage.currency IS NOT NULL
        GROUP BY 1, usage.source, usage.cost_status, usage.currency
        ORDER BY 1, usage.source, usage.cost_status, usage.currency
      `),
    ]);

    const chat = totalsFor(PLATFORM_CHAT_USAGE_CAPTURE_SOURCE, totalsRows, costRows);
    const voice = totalsFor(PLATFORM_VOICE_USAGE_CAPTURE_SOURCE, totalsRows, costRows);
    const costsByBucket = new Map<string, PlatformMetricsAiSeriesPoint["costs"]>();
    for (const row of seriesCostRows) {
      const channel = channelForSource(row.source);
      if (!channel) continue;
      const costs = costsByBucket.get(row.bucket) ?? [];
      costs.push({ channel, ...costFromRow(row) });
      costsByBucket.set(row.bucket, costs);
    }

    return {
      chat,
      voice,
      series: seriesRows.map(row => ({
        bucket: row.bucket,
        chatEventCount: bigint(row.chatEventCount),
        voiceEventCount: bigint(row.voiceEventCount),
        chatTotalTokens: bigint(row.chatTotalTokens),
        voiceTotalTokens: bigint(row.voiceTotalTokens),
        costs: costsByBucket.get(row.bucket) ?? [],
      })),
    };
  }
}

type FinancialSeriesRow = {
  bucket: string;
  confirmedPaymentCount: string;
  confirmedKnownAmountCents: string;
  incompleteAmountCount: string;
};

type AiTotalsRow = {
  source: string;
  eventCount: string;
  totalTokens: string;
  unpricedEventCount: string;
};

type AiCostRow = {
  source: string;
  costStatus: "estimated" | "provider_reported" | "reconciled";
  currency: string;
  costMicros: string;
  eventCount: string;
};

type AiSeriesRow = {
  bucket: string;
  chatEventCount: string;
  voiceEventCount: string;
  chatTotalTokens: string;
  voiceTotalTokens: string;
};

type AiSeriesCostRow = AiCostRow & { bucket: string };

function bucketUnit(period: PlatformMetricsPeriod) {
  return Prisma.raw(period.granularity === "month" ? "'month'" : "'day'");
}

function bucketFormat(period: PlatformMetricsPeriod) {
  return period.granularity === "month" ? "YYYY-MM" : "YYYY-MM-DD";
}

function financialSeriesPoint(row: FinancialSeriesRow): PlatformMetricsFinancialSeriesPoint {
  return {
    bucket: row.bucket,
    confirmedPaymentCount: bigint(row.confirmedPaymentCount),
    confirmedKnownAmountCents: bigint(row.confirmedKnownAmountCents),
    incompleteAmountCount: bigint(row.incompleteAmountCount),
  };
}

function totalsFor(source: string, totals: AiTotalsRow[], costs: AiCostRow[]): PlatformMetricsAiTotals {
  const row = totals.find(total => total.source === source);
  return {
    eventCount: bigint(row?.eventCount ?? "0"),
    totalTokens: bigint(row?.totalTokens ?? "0"),
    unpricedEventCount: bigint(row?.unpricedEventCount ?? "0"),
    costs: costs.filter(cost => cost.source === source).map(costFromRow),
  };
}

function costFromRow(row: AiCostRow): PlatformMetricsAiCost {
  return {
    status: row.costStatus,
    currency: row.currency,
    costMicros: bigint(row.costMicros),
    eventCount: bigint(row.eventCount),
  };
}

function channelForSource(source: string): "chat" | "voice" | undefined {
  if (source === PLATFORM_CHAT_USAGE_CAPTURE_SOURCE) return "chat";
  if (source === PLATFORM_VOICE_USAGE_CAPTURE_SOURCE) return "voice";
  return undefined;
}

function aiFilter(period: PlatformMetricsPeriod) {
  return Prisma.sql`
    (
      (
        usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE}
        AND usage.channel = ${PLATFORM_CHAT_USAGE_CHANNEL}
        AND usage.component = ${PLATFORM_CHAT_USAGE_COMPONENT}
        AND usage.execution_status = 'succeeded'
      )
      OR (
        usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE}
        AND usage.channel = ${PLATFORM_VOICE_USAGE_CHANNEL}
        AND usage.provider = ${PLATFORM_VOICE_USAGE_PROVIDER}
      )
    )
    AND usage.started_at >= ${period.from}
    AND usage.started_at < ${period.to}
  `;
}

function roundAnnualMonthlyEquivalent(amountCents: bigint): bigint {
  return (amountCents + 6n) / 12n;
}

function bigint(value: string): bigint { return BigInt(value); }
