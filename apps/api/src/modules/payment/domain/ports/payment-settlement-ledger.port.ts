export const PAYMENT_SETTLEMENT_LEDGER = Symbol("PAYMENT_SETTLEMENT_LEDGER");

export type PlannedSettlementEntry = {
  entryKey: "platform_fee" | "merchant_payout";
  entryType: "platform_fee" | "merchant_payout";
  direction: "credit";
  recipientType: "platform" | "merchant";
  recipientReference?: string;
  plannedAmountCents: number;
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
  status: "planned";
  currency: string;
  provider: string;
  occurredAt: Date;
  confirmedAmountCents?: never;
  confirmedAt?: never;
};

export type PaymentSettlementSnapshot = Omit<PlannedPaymentSettlement, "entries"> & {
  sequence: number;
  status: "planned";
  confirmedGrossCents?: never;
  confirmedPlatformFeeCents?: never;
  confirmedMerchantNetCents?: never;
  confirmedProviderFeeCents?: never;
  confirmedAt?: never;
  entries: PaymentSettlementEntrySnapshot[];
};

export interface PaymentSettlementLedgerPort {
  /** Appends the first, planned snapshot. Repeating the exact plan is idempotent. */
  appendPlanned(plan: PlannedPaymentSettlement): Promise<void>;

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
