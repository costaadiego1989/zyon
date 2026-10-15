import { Inject, Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  PLATFORM_CHAT_USAGE_CAPTURE_SOURCE,
  PLATFORM_CHAT_USAGE_CHANNEL,
  PLATFORM_CHAT_USAGE_COMPONENT,
  PLATFORM_VOICE_USAGE_CAPTURE_SOURCE,
  PLATFORM_VOICE_USAGE_CHANNEL,
  PLATFORM_VOICE_USAGE_PROVIDER,
  type PlatformAiUsageMerchant,
} from "../domain/platform-ai-usage.js";
import type {
  PlatformAiUsageMerchantQuery,
  PlatformAiUsageReadAudit,
  PlatformAiUsageRepository,
} from "../domain/ports/platform-ai-usage-repository.port.js";

@Injectable()
export class PrismaPlatformAiUsageRepository implements PlatformAiUsageRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async listByMerchant(input: PlatformAiUsageMerchantQuery): Promise<PlatformAiUsageMerchant[]> {
    const filters = usageFilters(input);
    const rows = await this.prisma.$queryRaw<MerchantUsageRow[]>(Prisma.sql`
      SELECT
        usage.merchant_id AS "merchantId",
        merchant.name AS "merchantName",
        COUNT(*) FILTER (WHERE usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE})::text AS "chatEventCount",
        COALESCE(SUM(usage.prompt_tokens) FILTER (WHERE usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE}), 0)::text AS "chatPromptTokens",
        COALESCE(SUM(usage.completion_tokens) FILTER (WHERE usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE}), 0)::text AS "chatCompletionTokens",
        COALESCE(SUM(usage.total_tokens) FILTER (WHERE usage.source = ${PLATFORM_CHAT_USAGE_CAPTURE_SOURCE}), 0)::text AS "chatTotalTokens",
        COUNT(*) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE})::text AS "voiceComponentEventCount",
        COUNT(DISTINCT usage.provider_event_id) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE})::text AS "voiceResponseCount",
        COUNT(DISTINCT usage.voice_session_id) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE})::text AS "voiceSessionCount",
        COUNT(DISTINCT usage.provider_event_id) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE} AND usage.execution_status = 'failed')::text AS "voiceFailedResponseCount",
        COALESCE(SUM(usage.prompt_tokens) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE}), 0)::text AS "voicePromptTokens",
        COALESCE(SUM(usage.completion_tokens) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE}), 0)::text AS "voiceCompletionTokens",
        COALESCE(SUM(usage.total_tokens) FILTER (WHERE usage.source = ${PLATFORM_VOICE_USAGE_CAPTURE_SOURCE}), 0)::text AS "voiceTotalTokens",
        COUNT(*) FILTER (WHERE usage.cost_status = 'estimated')::text AS "estimatedEventCount",
        COUNT(*) FILTER (WHERE usage.cost_status = 'provider_reported')::text AS "providerReportedEventCount",
        COUNT(*) FILTER (WHERE usage.cost_status = 'reconciled')::text AS "reconciledEventCount",
        COUNT(*) FILTER (WHERE usage.cost_status = 'unpriced')::text AS "unpricedEventCount",
        COALESCE(SUM(CASE WHEN usage.cost_status = 'unpriced' THEN COALESCE(usage.total_tokens, 0) ELSE 0 END), 0)::text AS "unpricedTokens",
        COUNT(*) FILTER (WHERE usage.cost_status NOT IN ('estimated', 'provider_reported', 'reconciled', 'unpriced'))::text AS "otherCostStatusEventCount"
      FROM ai_usage_events AS usage
      LEFT JOIN merchants AS merchant ON merchant.id = usage.merchant_id
      WHERE ${filters}
      GROUP BY usage.merchant_id, merchant.name
      ORDER BY COALESCE(SUM(usage.total_tokens), 0) DESC, usage.merchant_id ASC
      LIMIT ${input.limit}
    `);
    if (rows.length === 0) return [];

    const merchantIds = rows.map(row => row.merchantId);
    const costs = await this.prisma.$queryRaw<PricedCostRow[]>(Prisma.sql`
      SELECT
        usage.merchant_id AS "merchantId",
        usage.cost_status AS "costStatus",
        usage.currency AS "currency",
        COALESCE(SUM(usage.cost_micros), 0)::text AS "costMicros",
        COUNT(*)::text AS "eventCount"
      FROM ai_usage_events AS usage
      WHERE ${filters}
        AND usage.merchant_id IN (${Prisma.join(merchantIds)})
        AND usage.cost_status IN ('estimated', 'provider_reported', 'reconciled')
        AND usage.cost_micros IS NOT NULL
        AND usage.currency IS NOT NULL
      GROUP BY usage.merchant_id, usage.cost_status, usage.currency
      ORDER BY usage.merchant_id ASC, usage.cost_status ASC, usage.currency ASC
    `);
    const costsByMerchant = new Map<string, PlatformAiUsageMerchantCostBuckets>();
    for (const cost of costs) {
      const current = costsByMerchant.get(cost.merchantId) ?? emptyCostBuckets();
      current[costBucket(cost.costStatus)].push({
        currency: cost.currency,
        costMicros: bigintFromText(cost.costMicros),
        eventCount: bigintFromText(cost.eventCount),
      });
      costsByMerchant.set(cost.merchantId, current);
    }

    return rows.map(row => ({
      merchantId: row.merchantId,
      ...(row.merchantName ? { merchantName: row.merchantName } : {}),
      chat: {
        eventCount: bigintFromText(row.chatEventCount),
        promptTokens: bigintFromText(row.chatPromptTokens),
        completionTokens: bigintFromText(row.chatCompletionTokens),
        totalTokens: bigintFromText(row.chatTotalTokens),
      },
      voice: {
        eventCount: bigintFromText(row.voiceComponentEventCount),
        responseCount: bigintFromText(row.voiceResponseCount),
        sessionCount: bigintFromText(row.voiceSessionCount),
        failedResponseCount: bigintFromText(row.voiceFailedResponseCount),
        promptTokens: bigintFromText(row.voicePromptTokens),
        completionTokens: bigintFromText(row.voiceCompletionTokens),
        totalTokens: bigintFromText(row.voiceTotalTokens),
      },
      estimatedEventCount: bigintFromText(row.estimatedEventCount),
      providerReportedEventCount: bigintFromText(row.providerReportedEventCount),
      reconciledEventCount: bigintFromText(row.reconciledEventCount),
      unpricedEventCount: bigintFromText(row.unpricedEventCount),
      unpricedTokens: bigintFromText(row.unpricedTokens),
      otherCostStatusEventCount: bigintFromText(row.otherCostStatusEventCount),
      estimatedCosts: costsByMerchant.get(row.merchantId)?.estimated ?? [],
      providerReportedCosts: costsByMerchant.get(row.merchantId)?.providerReported ?? [],
      reconciledCosts: costsByMerchant.get(row.merchantId)?.reconciled ?? [],
    }));
  }

  async recordRead(input: PlatformAiUsageReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "ai_usage.merchants.read",
        permission: "platform:ai-usage:read",
        environment: input.environment,
        targetType: "platform_ai_usage_merchants",
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          source: "chat_and_voice",
          channel: "chat_and_voice",
          component: "aggregated",
          executionStatus: "mixed",
          from: input.from.toISOString(),
          to: input.to.toISOString(),
          timezone: "UTC",
          limit: input.limit,
          itemCount: input.itemCount,
        },
      },
    });
  }
}

type MerchantUsageRow = {
  merchantId: string;
  merchantName: string | null;
  chatEventCount: string;
  chatPromptTokens: string;
  chatCompletionTokens: string;
  chatTotalTokens: string;
  voiceComponentEventCount: string;
  voiceResponseCount: string;
  voiceSessionCount: string;
  voiceFailedResponseCount: string;
  voicePromptTokens: string;
  voiceCompletionTokens: string;
  voiceTotalTokens: string;
  estimatedEventCount: string;
  providerReportedEventCount: string;
  reconciledEventCount: string;
  unpricedEventCount: string;
  unpricedTokens: string;
  otherCostStatusEventCount: string;
};

type PricedCostRow = {
  merchantId: string;
  costStatus: "estimated" | "provider_reported" | "reconciled";
  currency: string;
  costMicros: string;
  eventCount: string;
};

type PlatformAiUsageMerchantCost = PlatformAiUsageMerchant["estimatedCosts"][number];
type PlatformAiUsageMerchantCostBuckets = {
  estimated: PlatformAiUsageMerchantCost[];
  providerReported: PlatformAiUsageMerchantCost[];
  reconciled: PlatformAiUsageMerchantCost[];
};

function emptyCostBuckets(): PlatformAiUsageMerchantCostBuckets {
  return { estimated: [], providerReported: [], reconciled: [] };
}

function costBucket(status: PricedCostRow["costStatus"]): keyof PlatformAiUsageMerchantCostBuckets {
  if (status === "estimated") return "estimated";
  if (status === "provider_reported") return "providerReported";
  return "reconciled";
}

function usageFilters(input: PlatformAiUsageMerchantQuery) {
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
    AND usage.started_at >= ${input.from}
    AND usage.started_at < ${input.to}
  `;
}

function bigintFromText(value: string): bigint { return BigInt(value); }
