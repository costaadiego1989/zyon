import assert from "node:assert/strict";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type { ProviderEventKey } from "../domain/ports/payment-repository.port.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import type { HandleMarketplaceChargebackUseCase } from "../../marketplace/application/use-cases/handle-marketplace-chargeback.use-case.js";

export class ChargebackTestRepository extends InMemoryPaymentRepository {
  readonly scopedReads: Array<{ merchantId: string; intentId: string }> = [];
  readonly reservations: ProviderEventKey[] = [];

  override async getIntentById(merchantId: string, intentId: string) {
    this.scopedReads.push({ merchantId, intentId });
    return super.getIntentById(merchantId, intentId);
  }

  override async recordProcessedProviderEvent(key: ProviderEventKey) {
    this.reservations.push({ ...key });
    return super.recordProcessedProviderEvent(key);
  }
}

export class RecordingMarketplaceChargeback implements Pick<HandleMarketplaceChargebackUseCase, "executeForOrder"> {
  readonly calls: Array<{ orderId: string; hostMerchantId: string }> = [];
  async executeForOrder(orderId: string, hostMerchantId: string): Promise<[]> {
    this.calls.push({ orderId, hostMerchantId });
    return [];
  }
}

export async function approvedChargebackPayment(payments: InMemoryPaymentRepository, merchantId: string, providerPaymentId: string) {
  const intent = PaymentIntentEntity.create({ merchantId, sessionId: `checkout_${merchantId}`, idempotencyKey: `approved_${merchantId}`,
    amountCents: 10_000, currency: "BRL", method: "card", commerceOrderId: `commerce_${merchantId}` });
  intent.markRequiresAction({ providerPaymentId });
  intent.markApproved({ providerPaymentId, approvedAmountCents: 10_000 });
  await payments.saveIntent({ intent });
  return intent;
}

export function readOnlyChargebackProvider(read: NonNullable<PaymentProviderPort["fetchPaymentStatus"]>): PaymentProviderPort {
  return { fetchPaymentStatus: read, createPayment: async () => { assert.fail("Webhook reconciliation must not create a payment"); } };
}

