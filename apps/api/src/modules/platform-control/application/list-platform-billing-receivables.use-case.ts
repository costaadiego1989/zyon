import { Inject, Injectable } from "@nestjs/common";
import {
  PLATFORM_BILLING_RECEIVABLE_REPOSITORY,
  type PlatformBillingReceivableRepository,
  type PlatformBillingReceivablesReadAudit,
  type PlatformBillingReceivableStatus,
} from "../domain/ports/platform-billing-receivable-repository.port.js";

const RECEIVABLE_STATUSES: ReadonlySet<PlatformBillingReceivableStatus> = new Set([
  "open",
  "overdue",
  "paid",
  "cancelled",
  "refunded",
]);

type ListPlatformBillingReceivablesInput = {
  cursor?: unknown;
  limit?: unknown;
  status?: unknown;
};

type ReceivablesReadContext = Omit<
  PlatformBillingReceivablesReadAudit,
  "returnedItems" | "totalObservedReceivables" | "status"
>;

@Injectable()
export class ListPlatformBillingReceivablesUseCase {
  constructor(
    @Inject(PLATFORM_BILLING_RECEIVABLE_REPOSITORY)
    private readonly receivables: PlatformBillingReceivableRepository,
  ) {}

  async execute(input: ListPlatformBillingReceivablesInput, audit: ReceivablesReadContext) {
    const query = normalizeQuery(input);
    const asOf = new Date();
    const page = await this.receivables.list(query, asOf);
    await this.receivables.recordRead({
      ...audit,
      returnedItems: page.items.length,
      totalObservedReceivables: page.summary.observedReceivableCount,
      ...(query.status ? { status: query.status } : {}),
    });
    return present(page, asOf);
  }
}

function normalizeQuery(input: ListPlatformBillingReceivablesInput) {
  const status = optionalStatus(input.status);
  return {
    cursor: cursor(input.cursor),
    limit: pageSize(input.limit),
    ...(status ? { status } : {}),
  };
}

function pageSize(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]\d?|100)$/.test(value)) {
    throw new Error("platform_billing_receivables_invalid_limit");
  }
  return Number(value);
}

function cursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error("platform_billing_receivables_invalid_cursor");
  }
  return value;
}

function optionalStatus(value: unknown): PlatformBillingReceivableStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !RECEIVABLE_STATUSES.has(value as PlatformBillingReceivableStatus)) {
    throw new Error("platform_billing_receivables_invalid_status");
  }
  return value as PlatformBillingReceivableStatus;
}

function present(
  page: Awaited<ReturnType<PlatformBillingReceivableRepository["list"]>>,
  asOf: Date,
) {
  const hasObservedData = page.summary.observedReceivableCount > 0;
  const dayStart = utcDayStart(asOf);
  return {
    generated_at: asOf.toISOString(),
    as_of: dayStart.toISOString(),
    sources: {
      asaas_subscription_charges: {
        status: "partial" as const,
        description: "DiÃ¡rio iniciado por webhooks autenticados do Asaas; eventos anteriores Ã  implantaÃ§Ã£o nÃ£o sÃ£o retropreenchidos.",
      },
      stripe_subscription_charges: {
        status: "partial" as const,
        description: "Journal Stripe iniciado por eventos de fatura assinados; eventos anteriores a implantacao nao sao retropreenchidos.",
      },
      mercadopago_subscription_charges: {
        status: "partial" as const,
        description: "Diario Mercado Pago iniciado por recursos de assinatura buscados no servidor apos notificacao protegida; eventos anteriores a implantacao nao sao retropreenchidos.",
      },
      reconciliation: {
        status: "unavailable" as const,
        description: "Eventos autenticados registram confirmaÃ§Ã£o do provedor, mas nÃ£o substituem conciliaÃ§Ã£o de extrato, crÃ©ditos, liquidaÃ§Ã£o ou estornos parciais.",
      },
    },
    coverage: {
      observed_receivables: page.summary.observedReceivableCount,
      observed_since: page.summary.observedSince?.toISOString() ?? null,
      financial_metrics_available: hasObservedData,
      currency: "BRL",
    },
    summary: {
      open_count: hasObservedData ? page.summary.openCount : null,
      open_balance_cents: page.summary.openBalanceCents ?? null,
      overdue_count: hasObservedData ? page.summary.overdueCount : null,
      overdue_merchant_count: hasObservedData ? page.summary.overdueMerchantCount : null,
      overdue_balance_cents: page.summary.overdueBalanceCents ?? null,
      due_today_count: hasObservedData ? page.summary.dueTodayCount : null,
      due_today_balance_cents: page.summary.dueTodayBalanceCents ?? null,
      due_next_7_days_count: hasObservedData ? page.summary.dueNext7DaysCount : null,
      due_next_7_days_balance_cents: page.summary.dueNext7DaysBalanceCents ?? null,
      next_due_at: page.summary.nextDueAt?.toISOString() ?? null,
      confirmed_payment_count_since_capture: hasObservedData ? page.summary.paymentConfirmedCount : null,
      confirmed_payment_amount_cents_since_capture: page.summary.paymentConfirmedAmountCents ?? null,
      incomplete_amount_count: hasObservedData ? page.summary.incompleteAmountCount : null,
      incomplete_due_date_count: hasObservedData ? page.summary.incompleteDueDateCount : null,
    },
    items: page.items.map(item => ({
      id: item.id,
      merchant_id: item.merchantId,
      merchant_name: item.merchantName,
      provider: item.provider,
      provider_payment_id: item.providerPaymentId,
      provider_subscription_id: item.providerSubscriptionId,
      provider_status: item.status,
      is_overdue_as_of: isOverdue(item.status, item.dueAt, dayStart),
      currency: item.currency,
      amount_cents: item.amountCents ?? null,
      due_at: item.dueAt?.toISOString() ?? null,
      paid_at: item.paidAt?.toISOString() ?? null,
      first_observed_at: item.firstObservedAt.toISOString(),
      last_provider_event_at: item.lastProviderEventAt.toISOString(),
    })),
    next_cursor: page.nextCursor ?? null,
  };
}

function isOverdue(status: PlatformBillingReceivableStatus, dueAt: Date | undefined, dayStart: Date): boolean {
  return (status === "open" || status === "overdue") && Boolean(dueAt && dueAt.getTime() < dayStart.getTime());
}

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
