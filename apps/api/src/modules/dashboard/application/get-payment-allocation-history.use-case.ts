import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_SETTLEMENT_LEDGER,
  type PaymentSettlementLedgerPort,
  type PaymentSettlementSnapshot,
} from "../../payment/domain/ports/payment-settlement-ledger.port.js";

export type GetPaymentAllocationHistoryInput = {
  merchantId: string;
  paymentIntentId: string;
};

export type PaymentAllocationHistoryResponse = {
  payment_intent_id: string;
  /**
   * This text is part of the contract: consuming screens must not present the
   * history as a balance, a completed payout, or a reconciliation result.
   */
  scope_note: string;
  snapshots: PaymentAllocationSnapshotResponse[];
};

export type PaymentAllocationSnapshotResponse = {
  sequence: number;
  kind: "planned_allocation" | "provider_observation";
  observation_status?: "confirmed" | "blocked";
  provider: string;
  currency: string;
  occurred_at: string;
  confirmed_at?: string;
  provider_payment_id?: string;
  provider_observation_id?: string;
  provider_reference?: string;
  planned: {
    gross_cents: number;
    platform_fee_cents: number;
    merchant_net_cents: number;
    provider_fee_cents: number;
  };
  provider_observed?: {
    gross_cents?: number;
    platform_fee_cents?: number;
    merchant_net_cents?: number;
    provider_fee_cents?: number;
  };
  allocations: Array<{
    key: "platform_fee" | "merchant_payout";
    type: "platform_fee" | "merchant_payout";
    recipient_type: "platform" | "merchant";
    planned_amount_cents: number;
    provider_observed_amount_cents?: number;
    provider_transfer_id?: string;
    provider_reference?: string;
  }>;
};

const SCOPE_NOTE = "Histórico imutável de alocações planejadas e observações recebidas do provedor. Não representa saldo disponível, valor liquidado, repasse concluído ou conciliação completa.";

/**
 * Administrative trace for one payment intent. The ledger port requires the
 * authenticated merchant id, so an identifier from another tenant returns no
 * snapshots instead of exposing an existence or financial detail.
 */
@Injectable()
export class GetPaymentAllocationHistoryUseCase {
  constructor(
    @Inject(PAYMENT_SETTLEMENT_LEDGER)
    private readonly ledger: PaymentSettlementLedgerPort,
  ) {}

  async execute(input: GetPaymentAllocationHistoryInput): Promise<PaymentAllocationHistoryResponse> {
    const merchantId = input.merchantId.trim();
    const paymentIntentId = input.paymentIntentId.trim();
    if (!merchantId || !paymentIntentId) {
      throw new BadRequestException("payment_allocation_history_fields_required");
    }

    const snapshots = await this.ledger.listForPaymentIntent(merchantId, paymentIntentId);
    return {
      payment_intent_id: paymentIntentId,
      scope_note: SCOPE_NOTE,
      snapshots: snapshots.map(toResponse),
    };
  }
}

function toResponse(snapshot: PaymentSettlementSnapshot): PaymentAllocationSnapshotResponse {
  const providerObserved = snapshot.status === "planned" ? undefined : {
    gross_cents: snapshot.confirmedGrossCents,
    platform_fee_cents: snapshot.confirmedPlatformFeeCents,
    merchant_net_cents: snapshot.confirmedMerchantNetCents,
    provider_fee_cents: snapshot.confirmedProviderFeeCents,
  };
  return {
    sequence: snapshot.sequence,
    kind: snapshot.status === "planned" ? "planned_allocation" : "provider_observation",
    observation_status: snapshot.status === "planned" ? undefined : snapshot.status,
    provider: snapshot.provider,
    currency: snapshot.currency,
    occurred_at: snapshot.occurredAt.toISOString(),
    confirmed_at: snapshot.confirmedAt?.toISOString(),
    provider_payment_id: snapshot.providerPaymentId,
    provider_observation_id: snapshot.providerSettlementId,
    provider_reference: snapshot.providerReference,
    planned: {
      gross_cents: snapshot.plannedGrossCents,
      platform_fee_cents: snapshot.plannedPlatformFeeCents,
      merchant_net_cents: snapshot.plannedMerchantNetCents,
      provider_fee_cents: snapshot.plannedProviderFeeCents,
    },
    provider_observed: providerObserved,
    allocations: snapshot.entries.map(entry => ({
      key: entry.entryKey,
      type: entry.entryType,
      recipient_type: entry.recipientType,
      planned_amount_cents: entry.plannedAmountCents,
      provider_observed_amount_cents: entry.confirmedAmountCents,
      provider_transfer_id: entry.providerTransferId,
      provider_reference: entry.providerReference,
    })),
  };
}
