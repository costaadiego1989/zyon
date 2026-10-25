import type {
  PaymentSettlementLedgerPort,
  PaymentSettlementSnapshot,
  ObservedPaymentSettlement,
  PlannedPaymentSettlement,
} from "../domain/ports/payment-settlement-ledger.port.js";
import { normalizePlannedSettlement, normalizeSettlementObservation } from "../domain/ports/payment-settlement-ledger.port.js";

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
  private readonly rows = new Map<string, PaymentSettlementSnapshot[]>();

  async appendPlanned(rawPlan: PlannedPaymentSettlement): Promise<void> {
    const plan = normalizePlannedSettlement(rawPlan);
    const rowKey = key(plan.merchantId, plan.paymentIntentId);
    const existing = this.rows.get(rowKey);
    const planned = existing?.find(row => row.sequence === 1 && row.status === "planned");
    if (planned) {
      if (!samePlan(planned, plan)) throw new Error("payment_settlement_plan_conflict");
      return;
    }
    const snapshot: PaymentSettlementSnapshot = {
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
    };
    this.rows.set(rowKey, [snapshot]);
  }

  async appendObservation(rawObservation: ObservedPaymentSettlement): Promise<void> {
    const observation = normalizeSettlementObservation(rawObservation);
    const rowKey = key(observation.merchantId, observation.paymentIntentId);
    const snapshots = this.rows.get(rowKey);
    const planned = snapshots?.find(row => row.sequence === 1 && row.status === "planned");
    if (!planned) throw new Error("payment_settlement_plan_missing");
    if (planned.provider !== observation.provider || planned.currency !== observation.currency) {
      throw new Error("payment_settlement_observation_scope_invalid");
    }
    if (snapshots!.some(row => row.provider === observation.provider && row.providerSettlementId === observation.providerSettlementId)) {
      return;
    }
    const plannedEntries = new Map(planned.entries.map(entry => [entry.entryKey, entry]));
    const entries = observation.entries.map((entry, index) => {
      const source = plannedEntries.get(entry.entryKey);
      if (!source) throw new Error("payment_settlement_observation_entry_invalid");
      return {
        sequence: index + 1,
        entryKey: source.entryKey,
        entryType: source.entryType,
        direction: source.direction,
        recipientType: source.recipientType,
        recipientReference: source.recipientReference,
        status: observation.status,
        currency: planned.currency,
        provider: observation.provider,
        plannedAmountCents: source.plannedAmountCents,
        confirmedAmountCents: entry.confirmedAmountCents,
        providerTransferId: entry.providerTransferId,
        providerReference: entry.providerReference ?? observation.providerReference,
        occurredAt: new Date(observation.occurredAt),
        confirmedAt: observation.confirmedAt ? new Date(observation.confirmedAt) : undefined,
      };
    });
    snapshots!.push({
      merchantId: planned.merchantId,
      paymentIntentId: planned.paymentIntentId,
      sequence: Math.max(...snapshots!.map(row => row.sequence)) + 1,
      provider: observation.provider,
      status: observation.status,
      currency: planned.currency,
      providerPaymentId: observation.providerPaymentId,
      providerSettlementId: observation.providerSettlementId,
      providerReference: observation.providerReference,
      plannedGrossCents: planned.plannedGrossCents,
      plannedPlatformFeeCents: planned.plannedPlatformFeeCents,
      plannedMerchantNetCents: planned.plannedMerchantNetCents,
      plannedProviderFeeCents: planned.plannedProviderFeeCents,
      confirmedGrossCents: observation.confirmedGrossCents,
      confirmedPlatformFeeCents: observation.confirmedPlatformFeeCents,
      confirmedMerchantNetCents: observation.confirmedMerchantNetCents,
      confirmedProviderFeeCents: observation.confirmedProviderFeeCents,
      occurredAt: new Date(observation.occurredAt),
      confirmedAt: observation.confirmedAt ? new Date(observation.confirmedAt) : undefined,
      entries,
    });
  }

  async listForPaymentIntent(merchantId: string, paymentIntentId: string): Promise<PaymentSettlementSnapshot[]> {
    const rows = this.rows.get(key(merchantId.trim(), paymentIntentId.trim()));
    return rows ? structuredClone(rows) : [];
  }
}
