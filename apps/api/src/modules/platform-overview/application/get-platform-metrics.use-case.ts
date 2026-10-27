import { Inject, Injectable } from "@nestjs/common";
import {
  PLATFORM_BILLING_RECEIVABLE_REPOSITORY,
  type PlatformBillingReceivableRepository,
} from "../../platform-control/domain/ports/platform-billing-receivable-repository.port.js";
import {
  PLATFORM_METRICS_REPOSITORY,
  type PlatformMetricsGranularity,
  type PlatformMetricsPeriod,
  type PlatformMetricsRepository,
} from "../domain/ports/platform-metrics-repository.port.js";

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;
const PRESENTATION_TIME_ZONE = "America/Sao_Paulo";

export type GetPlatformMetricsAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
};

@Injectable()
export class GetPlatformMetricsUseCase {
  constructor(
    @Inject(PLATFORM_METRICS_REPOSITORY)
    private readonly metrics: PlatformMetricsRepository,
    @Inject(PLATFORM_BILLING_RECEIVABLE_REPOSITORY)
    private readonly receivables: PlatformBillingReceivableRepository,
  ) {}

  async execute(query: { from?: string; to?: string; granularity?: string }, audit: GetPlatformMetricsAudit) {
    const period = parsePlatformMetricsPeriod(query);
    const asOf = new Date();
    const [snapshot, position] = await Promise.all([
      this.metrics.snapshot(period),
      this.receivables.summary(asOf),
    ]);
    await this.metrics.recordRead({ ...audit, period });

    const financialAvailable = snapshot.financial.observedReceivableCount > 0;
    return {
      generated_at: asOf.toISOString(),
      period: presentPeriod(period),
      coverage: {
        financial: {
          status: financialAvailable ? "partial" as const : "unavailable" as const,
          observed_receivables: snapshot.financial.observedReceivableCount,
          observed_since: snapshot.financial.observedSince?.toISOString() ?? null,
          description: "Pagamentos de assinatura no estado atual recebidos de eventos autenticados de Asaas, Stripe e Mercado Pago. Nao e uma conciliacao contabil entre provedores.",
        },
        subscriptions: {
          status: snapshot.subscriptions.activeContractMissingAmountCount === 0 ? "partial" as const : "partial" as const,
          description: "MRR contratual normaliza contratos locais ativos; nao confirma liquidacao ou conciliacao de pagamento.",
        },
        ai: {
          status: "partial" as const,
          description: "Chat e capturado no servidor. Voz depende do evento final encaminhado pelo cliente e custos precisam de conciliacao da fatura do provedor.",
        },
        platform_fees: {
          status: "unavailable" as const,
          description: "Taxas da plataforma e resultado apos IA ainda nao possuem diario financeiro conciliado e conversao de moeda para calculo confiavel.",
        },
      },
      financial: {
        currency: "BRL" as const,
        received: financialAvailable ? {
          confirmed_payment_count: snapshot.financial.confirmedPaymentCount.toString(),
          confirmed_known_amount_cents: snapshot.financial.confirmedKnownAmountCents.toString(),
          incomplete_amount_count: snapshot.financial.incompleteAmountCount.toString(),
          series: snapshot.financial.series.map(point => ({
            bucket: point.bucket,
            confirmed_payment_count: point.confirmedPaymentCount.toString(),
            confirmed_known_amount_cents: point.confirmedKnownAmountCents.toString(),
            incomplete_amount_count: point.incompleteAmountCount.toString(),
          })),
        } : null,
        current_position: financialAvailable ? {
          as_of: asOf.toISOString(),
          open_count: position.openCount,
          open_known_balance_cents: position.openBalanceCents ?? null,
          overdue_count: position.overdueCount,
          overdue_merchant_count: position.overdueMerchantCount,
          overdue_known_balance_cents: position.overdueBalanceCents ?? null,
          due_today_count: position.dueTodayCount,
          due_next_7_days_count: position.dueNext7DaysCount,
          next_due_at: position.nextDueAt?.toISOString() ?? null,
        } : null,
        contracted_mrr: {
          active_contract_count: snapshot.subscriptions.activeContractCount,
          active_contract_with_known_amount_count: snapshot.subscriptions.activeContractWithKnownAmountCount,
          active_contract_missing_amount_count: snapshot.subscriptions.activeContractMissingAmountCount,
          known_amount_cents: snapshot.subscriptions.contractedMrrKnownCents.toString(),
          caveat: "active_local_contracts_normalized_to_monthly_and_rounded_to_cent" as const,
        },
      },
      ai: {
        chat: presentAiTotals(snapshot.ai.chat),
        voice: presentAiTotals(snapshot.ai.voice),
        series: snapshot.ai.series.map(point => ({
          bucket: point.bucket,
          chat_event_count: point.chatEventCount.toString(),
          voice_event_count: point.voiceEventCount.toString(),
          chat_total_tokens: point.chatTotalTokens.toString(),
          voice_total_tokens: point.voiceTotalTokens.toString(),
          costs: point.costs.map(cost => presentAiCost(cost)),
        })),
      },
    };
  }
}

export function parsePlatformMetricsPeriod(query: { from?: string; to?: string; granularity?: string }): PlatformMetricsPeriod {
  const to = query.to === undefined ? new Date() : utcInstant(query.to, "platform_metrics_invalid_to");
  const from = query.from === undefined
    ? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 86_400_000)
    : utcInstant(query.from, "platform_metrics_invalid_from");
  if (from >= to || to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 86_400_000) {
    throw new Error("platform_metrics_invalid_period");
  }
  const granularity = parseGranularity(query.granularity);
  return { from, to, granularity };
}

function parseGranularity(value: string | undefined): PlatformMetricsGranularity {
  if (value === undefined || value === "day") return "day";
  if (value === "month") return "month";
  throw new Error("platform_metrics_invalid_granularity");
}

function utcInstant(value: string, code: string): Date {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) throw new Error(code);
  const date = new Date(normalized);
  const canonical = normalized.includes(".")
    ? normalized.replace(/\.(\d{1,3})Z$/, (_value, milliseconds: string) => `.${milliseconds.padEnd(3, "0")}Z`)
    : normalized.replace("Z", ".000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString() !== canonical) throw new Error(code);
  return date;
}

function presentPeriod(period: PlatformMetricsPeriod) {
  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    timezone: PRESENTATION_TIME_ZONE,
    granularity: period.granularity,
    end_exclusive: true as const,
  };
}

function presentAiTotals(totals: Awaited<ReturnType<PlatformMetricsRepository["snapshot"]>>["ai"]["chat"]) {
  return {
    event_count: totals.eventCount.toString(),
    total_tokens: totals.totalTokens.toString(),
    unpriced_event_count: totals.unpricedEventCount.toString(),
    costs: totals.costs.map(cost => presentAiCost(cost)),
  };
}

function presentAiCost(cost: Awaited<ReturnType<PlatformMetricsRepository["snapshot"]>>["ai"]["chat"]["costs"][number]) {
  return {
    status: cost.status,
    currency: cost.currency,
    cost_micros: cost.costMicros.toString(),
    event_count: cost.eventCount.toString(),
  };
}
