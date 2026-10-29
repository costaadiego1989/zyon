import { Inject, Injectable } from "@nestjs/common";
import type { BillingSubscriptionStatus } from "../../payment/domain/payment-platform.types.js";
import {
  PLATFORM_BILLING_SUBSCRIPTION_REPOSITORY,
  type LocalBillingProvider,
  type PlatformBillingSubscriptionRepository,
  type PlatformBillingSubscriptionsReadAudit,
} from "../domain/ports/platform-billing-subscription-repository.port.js";

const BILLING_STATUSES: ReadonlySet<BillingSubscriptionStatus> = new Set([
  "trialing",
  "starter",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "cancelled",
  "incomplete",
]);

const BILLING_PROVIDERS: ReadonlySet<LocalBillingProvider> = new Set([
  "asaas",
  "stripe",
  "mercadopago",
  "unknown",
]);

type ListPlatformBillingSubscriptionsInput = {
  cursor?: unknown;
  limit?: unknown;
  status?: unknown;
  provider?: unknown;
};

type BillingReadContext = Omit<
  PlatformBillingSubscriptionsReadAudit,
  "returnedItems" | "totalRecords" | "status" | "provider"
>;

@Injectable()
export class ListPlatformBillingSubscriptionsUseCase {
  constructor(
    @Inject(PLATFORM_BILLING_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: PlatformBillingSubscriptionRepository,
  ) {}

  async execute(input: ListPlatformBillingSubscriptionsInput, audit: BillingReadContext) {
    const query = normalizeQuery(input);
    const asOf = new Date();
    const page = await this.subscriptions.list({ ...query, asOf });
    await this.subscriptions.recordRead({
      ...audit,
      returnedItems: page.items.length,
      totalRecords: page.summary.totalRecords,
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
    });
    return presentPage(page, asOf);
  }
}

function normalizeQuery(input: ListPlatformBillingSubscriptionsInput) {
  const status = optionalEnum(input.status, BILLING_STATUSES, "platform_billing_invalid_status");
  const provider = optionalEnum(input.provider, BILLING_PROVIDERS, "platform_billing_invalid_provider");
  return {
    cursor: cursor(input.cursor),
    limit: pageSize(input.limit),
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
  };
}

function pageSize(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]\d?|100)$/.test(value)) {
    throw new Error("platform_billing_invalid_limit");
  }
  return Number(value);
}

function cursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error("platform_billing_invalid_cursor");
  }
  return value;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  code: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(code);
  return value as T;
}

function presentPage(
  page: Awaited<ReturnType<PlatformBillingSubscriptionRepository["list"]>>,
  asOf: Date,
) {
  return {
    generated_at: asOf.toISOString(),
    sources: {
      subscription_state: {
        status: "partial",
        description: "Estados locais de assinatura atualizados por fluxo de billing; sem reconciliação financeira consolidada.",
      },
      receivables: {
        status: "partial",
        description: "Consulta separada expõe o diário de cobranças Asaas, Stripe e Mercado Pago observadas por webhook; esta lista não replica campos financeiros.",
      },
      delinquency: {
        status: "partial",
        description: "A consulta separada calcula atraso por vencimento e saldo conhecido de cada provedor capturado; estados locais como past_due continuam distintos.",
      },
      next_due_date: {
        status: "partial",
        description: "A consulta separada expõe o próximo vencimento capturado; fim de período local permanece distinto de vencimento financeiro.",
      },
    },
    summary: {
      total_records: page.summary.totalRecords,
      records_by_status: page.summary.recordsByStatus,
      active_local_records: page.summary.activeLocalRecords,
      active_trials: page.summary.activeTrials,
      past_due_local_state_records: page.summary.pastDueLocalStateRecords,
      cancellation_at_period_end_records: page.summary.cancellationAtPeriodEndRecords,
      missing_term_end_records: page.summary.missingTermEndRecords,
    },
    items: page.items.map(item => ({
      merchant_id: item.merchantId,
      merchant_name: item.merchantName,
      provider: item.provider,
      status: item.status,
      plan_key: item.planKey ?? null,
      billing_cycle: item.billingCycle,
      billing_amount_cents: item.billingAmountCents ?? null,
      term_ends_at: item.termEndsAt?.toISOString() ?? null,
      term_end_kind: item.termEndKind ?? null,
      cancel_at_period_end: item.cancelAtPeriodEnd,
      provider_cancellation_scheduled_at: item.providerCancellationScheduledAt?.toISOString() ?? null,
      last_billing_event_at: item.lastBillingEventAt?.toISOString() ?? null,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
    })),
    next_cursor: page.nextCursor ?? null,
  };
}
