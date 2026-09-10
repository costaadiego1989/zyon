export const PAYMENT_SETTLEMENT_LEDGER = Symbol("PAYMENT_SETTLEMENT_LEDGER");

export type PlannedSettlementEntry = {
  entryKey: "platform_fee" | "merchant_payout";
  entryType: "platform_fee" | "merchant_payout";
  direction: "credit";
  recipientType: "platform" | "merchant";
  recipientReference?: string;
  plannedAmountCents: number;
};

export type SettlementObservationStatus = "confirmed" | "blocked";

/**
 * A provider fact observed after the payment intent was created. The original
 * plan is deliberately absent here: repositories copy it from sequence 1
 * rather than accepting a webhook-supplied replacement for planned amounts.
 */
export type ObservedSettlementEntry = {
  entryKey: PlannedSettlementEntry["entryKey"];
  confirmedAmountCents?: number;
  providerTransferId?: string;
  providerReference?: string;
};

export type ObservedPaymentSettlement = {
  merchantId: string;
  paymentIntentId: string;
  provider: string;
  status: SettlementObservationStatus;
  currency: string;
  /** Stable provider-side observation id. Required for append idempotency. */
  providerSettlementId: string;
  providerPaymentId?: string;
  providerReference?: string;
  confirmedGrossCents?: number;
  confirmedPlatformFeeCents?: number;
  confirmedMerchantNetCents?: number;
  confirmedProviderFeeCents?: number;
  occurredAt: Date;
  confirmedAt?: Date;
  entries: ObservedSettlementEntry[];
};

/**
 * An intended allocation captured before the provider charge exists. It is an
 * auditable plan only: provider fees, payment capture, transfer and payout
 * remain unknown until a later provider observation appends another snapshot.
 */
export type PlannedPaymentSettlement = {
  merchantId: string;
  paymentIntentId: string;
  provider: string;
  currency: string;
  providerReference?: string;
  plannedGrossCents: number;
  plannedPlatformFeeCents: number;
  plannedMerchantNetCents: number;
  plannedProviderFeeCents: number;
  occurredAt: Date;
  entries: PlannedSettlementEntry[];
};

export type PaymentSettlementEntrySnapshot = PlannedSettlementEntry & {
  sequence: number;
  status: "planned" | SettlementObservationStatus;
  currency: string;
  provider: string;
  occurredAt: Date;
  confirmedAmountCents?: number;
  providerTransferId?: string;
  providerReference?: string;
  confirmedAt?: Date;
};

export type PaymentSettlementSnapshot = Omit<PlannedPaymentSettlement, "entries"> & {
  sequence: number;
  status: "planned" | SettlementObservationStatus;
  providerPaymentId?: string;
  providerSettlementId?: string;
  confirmedGrossCents?: number;
  confirmedPlatformFeeCents?: number;
  confirmedMerchantNetCents?: number;
  confirmedProviderFeeCents?: number;
  confirmedAt?: Date;
  entries: PaymentSettlementEntrySnapshot[];
};

export interface PaymentSettlementLedgerPort {
  /** Appends the first, planned snapshot. Repeating the exact plan is idempotent. */
  appendPlanned(plan: PlannedPaymentSettlement): Promise<void>;

  /**
   * Appends an immutable provider observation derived from the initial plan.
   * It must never update sequence 1 or accept planned amounts from a webhook.
   */
  appendObservation(observation: ObservedPaymentSettlement): Promise<void>;

  /** Always tenant-scoped; callers cannot read another merchant's ledger. */
  listForPaymentIntent(merchantId: string, paymentIntentId: string): Promise<PaymentSettlementSnapshot[]>;
}

function nonNegativeCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Shared domain validation before an append-only financial write. */
export function normalizePlannedSettlement(plan: PlannedPaymentSettlement): PlannedPaymentSettlement {
  const merchantId = plan.merchantId.trim();
  const paymentIntentId = plan.paymentIntentId.trim();
  const provider = plan.provider.trim();
  const currency = plan.currency.trim().toUpperCase();
  const providerReference = plan.providerReference?.trim() || undefined;
  const values = [
    plan.plannedGrossCents,
    plan.plannedPlatformFeeCents,
    plan.plannedMerchantNetCents,
    plan.plannedProviderFeeCents,
  ];
  if (!merchantId || !paymentIntentId || !provider || !currency ||
    !(plan.occurredAt instanceof Date) || Number.isNaN(plan.occurredAt.getTime()) ||
    values.some(value => !nonNegativeCents(value)) ||
    plan.plannedGrossCents !== plan.plannedPlatformFeeCents + plan.plannedMerchantNetCents + plan.plannedProviderFeeCents) {
    throw new Error("payment_settlement_plan_invalid");
  }

  const seen = new Set<string>();
  const normalizedEntries = plan.entries.map(entry => {
      const entryKey = entry.entryKey.trim();
      const entryType = entry.entryType.trim();
      const recipientType = entry.recipientType.trim();
      const recipientReference = entry.recipientReference?.trim() || undefined;
      if ((entryKey !== "platform_fee" && entryKey !== "merchant_payout") ||
        (entryType !== "platform_fee" && entryType !== "merchant_payout") ||
        (recipientType !== "platform" && recipientType !== "merchant") ||
        entry.direction !== "credit" ||
        !nonNegativeCents(entry.plannedAmountCents) || seen.has(entryKey)) {
        throw new Error("payment_settlement_plan_invalid");
      }
      seen.add(entryKey);
      return {
        ...entry,
        entryKey: entryKey as PlannedSettlementEntry["entryKey"],
        entryType: entryType as PlannedSettlementEntry["entryType"],
        recipientType: recipientType as PlannedSettlementEntry["recipientType"],
        recipientReference,
      };
    });
  const entries = normalizedEntries.filter(entry => entry.plannedAmountCents > 0);
  if (entries.reduce((total, entry) => total + entry.plannedAmountCents, 0) !== plan.plannedGrossCents - plan.plannedProviderFeeCents) {
    throw new Error("payment_settlement_plan_invalid");
  }

  return {
    merchantId,
    paymentIntentId,
    provider,
    currency,
    providerReference,
    plannedGrossCents: plan.plannedGrossCents,
    plannedPlatformFeeCents: plan.plannedPlatformFeeCents,
    plannedMerchantNetCents: plan.plannedMerchantNetCents,
    plannedProviderFeeCents: plan.plannedProviderFeeCents,
    occurredAt: new Date(plan.occurredAt),
    entries,
  };
}

function optionalCents(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!nonNegativeCents(value)) throw new Error("payment_settlement_observation_invalid");
  return value;
}

function optionalId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new Error("payment_settlement_observation_invalid");
  return normalized;
}

/** Shared validation before recording a signed provider observation. */
export function normalizeSettlementObservation(raw: ObservedPaymentSettlement): ObservedPaymentSettlement {
  const merchantId = raw.merchantId.trim();
  const paymentIntentId = raw.paymentIntentId.trim();
  const provider = raw.provider.trim();
  const currency = raw.currency.trim().toUpperCase();
  const providerSettlementId = raw.providerSettlementId.trim();
  if (!merchantId || !paymentIntentId || !provider || !currency || !providerSettlementId ||
    !(raw.occurredAt instanceof Date) || Number.isNaN(raw.occurredAt.getTime()) ||
    (raw.confirmedAt !== undefined && (!(raw.confirmedAt instanceof Date) || Number.isNaN(raw.confirmedAt.getTime())))) {
    throw new Error("payment_settlement_observation_invalid");
  }
  const confirmedGrossCents = optionalCents(raw.confirmedGrossCents);
  const confirmedPlatformFeeCents = optionalCents(raw.confirmedPlatformFeeCents);
  const confirmedMerchantNetCents = optionalCents(raw.confirmedMerchantNetCents);
  const confirmedProviderFeeCents = optionalCents(raw.confirmedProviderFeeCents);
  const seen = new Set<string>();
  const entries = raw.entries.map(entry => {
    if ((entry.entryKey !== "platform_fee" && entry.entryKey !== "merchant_payout") || seen.has(entry.entryKey)) {
      throw new Error("payment_settlement_observation_invalid");
    }
    seen.add(entry.entryKey);
    return {
      entryKey: entry.entryKey,
      confirmedAmountCents: optionalCents(entry.confirmedAmountCents),
      providerTransferId: optionalId(entry.providerTransferId),
      providerReference: optionalId(entry.providerReference),
    };
  });
  if (raw.status === "blocked" && (
    entries.length > 0 || confirmedGrossCents !== undefined || confirmedPlatformFeeCents !== undefined ||
    confirmedMerchantNetCents !== undefined || confirmedProviderFeeCents !== undefined || raw.confirmedAt !== undefined
  )) throw new Error("payment_settlement_observation_invalid");
  return {
    merchantId,
    paymentIntentId,
    provider,
    status: raw.status,
    currency,
    providerSettlementId,
    providerPaymentId: optionalId(raw.providerPaymentId),
    providerReference: optionalId(raw.providerReference),
    confirmedGrossCents,
    confirmedPlatformFeeCents,
    confirmedMerchantNetCents,
    confirmedProviderFeeCents,
    occurredAt: new Date(raw.occurredAt),
    confirmedAt: raw.confirmedAt ? new Date(raw.confirmedAt) : undefined,
    entries,
  };
}
