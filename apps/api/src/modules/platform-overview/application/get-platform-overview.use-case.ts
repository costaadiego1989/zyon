import { Inject, Injectable } from "@nestjs/common";
import { HealthService, type ReadinessResult } from "../../../shared/health/health.service.js";
import {
  PLATFORM_OVERVIEW_REPOSITORY,
  type PlatformOverviewRepository,
} from "../domain/ports/platform-overview-repository.port.js";
import {
  PLATFORM_BILLING_RECEIVABLE_REPOSITORY,
  type PlatformBillingReceivableRepository,
} from "../../platform-control/domain/ports/platform-billing-receivable-repository.port.js";

export type GetPlatformOverviewInput = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
};

@Injectable()
export class GetPlatformOverviewUseCase {
  constructor(
    @Inject(PLATFORM_OVERVIEW_REPOSITORY)
    private readonly repository: PlatformOverviewRepository,
    private readonly health: HealthService,
    @Inject(PLATFORM_BILLING_RECEIVABLE_REPOSITORY)
    private readonly receivables: PlatformBillingReceivableRepository,
  ) {}

  async execute(input: GetPlatformOverviewInput) {
    const now = new Date();
    const [snapshot, readiness, receivables] = await Promise.all([
      this.repository.snapshot(now),
      this.health.readiness(),
      this.receivables.summary(now),
    ]);

    await this.repository.recordRead(input);

    return presentOverview(snapshot, readiness, receivables);
  }
}

function presentOverview(
  snapshot: Awaited<ReturnType<PlatformOverviewRepository["snapshot"]>>,
  readiness: ReadinessResult,
  receivables: Awaited<ReturnType<PlatformBillingReceivableRepository["summary"]>>,
) {
  const financialMetricsAvailable = receivables.observedReceivableCount > 0;
  return {
    generated_at: snapshot.generatedAt.toISOString(),
    scope: {
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      data_freshness: "read_through_database",
    },
    sources: {
      merchant_registry: {
        status: "available",
        description: "Cadastros de empresas e usuários no banco operacional.",
      },
      subscriptions: {
        status: "partial",
        description: "Estados locais de assinatura; ainda sem reconciliação financeira consolidada entre provedores.",
      },
      receivables: {
        status: "partial",
        description: "Cobranças Asaas, Stripe e Mercado Pago recebidas por fontes autenticadas desde o início da captura; sem conciliação financeira entre provedores.",
      },
      delinquency: {
        status: "partial",
        description: "O diário Asaas, Stripe e Mercado Pago calcula atraso por vencimento e saldo conhecido; créditos, liquidação e conciliação completa seguem pendentes.",
      },
      due_dates: {
        status: "partial",
        description: "A consulta financeira expõe vencimentos Asaas, Stripe e Mercado Pago capturados por fonte autenticada; não há fonte única e conciliada entre provedores.",
      },
      ai_chat: {
        status: "partial",
        description: "Chamadas de texto medidas no servidor. Uso ou tarifa ausentes permanecem pendentes de apuração.",
      },
      ai_voice: {
        status: "partial",
        description: "Uso de voz recebido diretamente do provedor pelo servidor. Os custos aparecem nas métricas por período e em Uso de IA; valores estimados ainda precisam de conciliação com a fatura.",
      },
      infrastructure: {
        status: "partial",
        description: "Readiness atual de banco e Redis, filas e estados de integração; alertas e histórico são snapshots locais, não monitoramento externo.",
      },
    },
    merchants: {
      registered: snapshot.merchants.registered,
      active_users: snapshot.merchants.activeUsers,
    },
    subscriptions: {
      records_by_status: snapshot.subscriptions.byStatus,
      active_records: snapshot.subscriptions.activeRecords,
      active_trials: snapshot.subscriptions.activeTrials,
    },
    receivables: {
      as_of: snapshot.generatedAt.toISOString(),
      currency: "BRL",
      observed_receivables: receivables.observedReceivableCount,
      observed_since: receivables.observedSince?.toISOString() ?? null,
      financial_metrics_available: financialMetricsAvailable,
      open_count: financialMetricsAvailable ? receivables.openCount : null,
      open_known_balance_cents: financialMetricsAvailable ? receivables.openBalanceCents ?? null : null,
      overdue_count: financialMetricsAvailable ? receivables.overdueCount : null,
      overdue_merchant_count: financialMetricsAvailable ? receivables.overdueMerchantCount : null,
      overdue_known_balance_cents: financialMetricsAvailable ? receivables.overdueBalanceCents ?? null : null,
      due_today_count: financialMetricsAvailable ? receivables.dueTodayCount : null,
      due_next_7_days_count: financialMetricsAvailable ? receivables.dueNext7DaysCount : null,
      next_due_at: receivables.nextDueAt?.toISOString() ?? null,
      confirmed_payment_count_since_capture: financialMetricsAvailable ? receivables.paymentConfirmedCount : null,
      confirmed_payment_known_amount_cents_since_capture: financialMetricsAvailable
        ? receivables.paymentConfirmedAmountCents ?? null
        : null,
      incomplete_amount_count: financialMetricsAvailable ? receivables.incompleteAmountCount : null,
      incomplete_due_date_count: financialMetricsAvailable ? receivables.incompleteDueDateCount : null,
    },
    ai_chat: {
      period_started_at: snapshot.aiChat.periodStartedAt.toISOString(),
      usage_events: snapshot.aiChat.usageEvents,
      total_tokens: snapshot.aiChat.totalTokens,
      priced_usage_events: snapshot.aiChat.pricedUsageEvents,
      unpriced_usage_events: snapshot.aiChat.unpricedUsageEvents,
      known_cost_micros: snapshot.aiChat.knownCostMicros.toString(),
      currency: "USD",
    },
    feedback: {
      received: snapshot.feedback.received,
    },
    infrastructure: {
      readiness: readiness.ready ? "ready" : "unavailable",
      database: readiness.db,
      redis: readiness.redis,
    },
  };
}
