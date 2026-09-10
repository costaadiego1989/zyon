import type {
  PaymentSettlementLedgerPort,
  PaymentSettlementSnapshot,
  PlannedPaymentSettlement,
} from "../domain/ports/payment-settlement-ledger.port.js";
import { normalizePlannedSettlement } from "../domain/ports/payment-settlement-ledger.port.js";

function key(merchantId: string, paymentIntentId: string): string {
  return `${merchantId}::${paymentIntentId}`;
}

function samePlan(existing: PaymentSettlementSnapshot, plan: PlannedPaymentSettlement): boolean {
  return existing.provider === plan.provider &&
    existing.currency === plan.currency &&
    existing.providerReference === plan.providerReference &&
    existing.plannedGrossCents === plan.plannedGrossCents &&
    existing.plannedPlatformFeeCents === plan.plannedPlatformFeeCents &&
    existing.plannedMerchantNetCents === plan.plannedMerchantNetCents &&
    existing.plannedProviderFeeCents === plan.plannedProviderFeeCents;
}

export class InMemoryPaymentSettlementLedgerRepository implements PaymentSettlementLedgerPort {
  private readonly rows = new Map<string, PaymentSettlementSnapshot>();

  async appendPlanned(rawPlan: PlannedPaymentSettlement): Promise<void> {
    const plan = normalizePlannedSettlement(rawPlan);
    const rowKey = key(plan.merchantId, plan.paymentIntentId);
    const existing = this.rows.get(rowKey);
    if (existing) {
      if (!samePlan(existing, plan)) throw new Error("payment_settlement_plan_conflict");
      return;
    }
    this.rows.set(rowKey, {
      merchantId: plan.merchantId,
      paymentIntentId: plan.paymentIntentId,
      sequence: 1,
      provider: plan.provider,
      status: "planned",
      currency: plan.currency,
      providerReference: plan.providerReference,
      plannedGrossCents: plan.plannedGrossCents,
      plannedPlatformFeeCents: plan.plannedPlatformFeeCents,
      plannedMerchantNetCents: plan.plannedMerchantNetCents,
      plannedProviderFeeCents: plan.plannedProviderFeeCents,
      occurredAt: new Date(plan.occurredAt),
      entries: plan.entries.map((entry, index) => ({
        sequence: index + 1,
        entryKey: entry.entryKey,
        entryType: entry.entryType,
        direction: entry.direction,
        recipientType: entry.recipientType,
        recipientReference: entry.recipientReference,
        status: "planned",
        currency: plan.currency,
        provider: plan.provider,
        plannedAmountCents: entry.plannedAmountCents,
        occurredAt: new Date(plan.occurredAt),
      })),
    });
  }

  async listForPaymentIntent(merchantId: string, paymentIntentId: string): Promise<PaymentSettlementSnapshot[]> {
    const row = this.rows.get(key(merchantId.trim(), paymentIntentId.trim()));
    return row ? [structuredClone(row)] : [];
  }
}
