import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { PaymentIntentEntity, type PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { MercadoPagoPaymentAdapter } from "../infrastructure/mercadopago-payment.adapter.js";
import { HandleMercadoPagoWebhookUseCase } from "./handle-mercadopago-webhook.use-case.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";

const WEBHOOK_SECRET = "test-mercadopago-webhook-secret";
const REQUEST_ID = "request_1";
const PAYMENT_ID = "mp_payment_1";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  readonly approved: CheckoutPaymentApprovedInput[] = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }

  async recordPaymentFailure(_input: { merchantId: string; sessionId: string; reason: string }): Promise<void> {}

  async recordPaymentStatusChanged(_input: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
  }): Promise<void> {}
}

function signedPaymentUpdatedWebhook(): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify({ action: "payment.updated", data: { id: PAYMENT_ID } });
  const timestamp = "1720000000";
  const template = `id:${PAYMENT_ID};request-id:${REQUEST_ID};ts:${timestamp};`;
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(template).digest("hex");
  return { rawBody, signature: `ts=${timestamp},v1=${signature}` };
}

function signedChargebackWebhook(): { rawBody: string; signature: string } {
  const chargebackId = "mp_chargeback_1";
  const rawBody = JSON.stringify({ type: "topic_chargebacks_wh", data: { id: chargebackId, payment_id: PAYMENT_ID } });
  const timestamp = "1720000001";
  const template = `id:${chargebackId};request-id:${REQUEST_ID};ts:${timestamp};`;
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(template).digest("hex");
  return { rawBody, signature: `ts=${timestamp},v1=${signature}` };
}

test("Mercado Pago processes pending then approved once for the same payment", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const states: Array<"pending" | "approved"> = ["pending", "approved", "approved"];
  const provider = {
    async fetchPaymentStatus() {
      return { state: states.shift() ?? "approved" };
    }
  } as unknown as MercadoPagoPaymentAdapter;
  const useCase = new HandleMercadoPagoWebhookUseCase(payments, dispatch, undefined, provider);

  const intent = PaymentIntentEntity.create({
    merchantId: "merchant_1",
    sessionId: "checkout_1",
    idempotencyKey: "idem_1",
    amountCents: 10_000,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: PAYMENT_ID });
  await payments.saveIntent({ intent });

  const { rawBody, signature } = signedPaymentUpdatedWebhook();
  const first = await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET);
  const second = await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET);
  const duplicate = await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET);

  assert.deepEqual(first, { outcome: "processed", effect: "noop_payment_pending_or_unknown" });
  assert.deepEqual(second, { outcome: "processed", effect: "checkout_completed_after_payment" });
  assert.deepEqual(duplicate, { outcome: "duplicate" });
  assert.equal(checkout.approved.length, 1);
  assert.equal((await payments.getIntentById("merchant_1", intent.id))?.status, "approved");
});

test("Mercado Pago Checkout Pro webhook binds the later payment id to its signed intent reference", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const provider = {
    async fetchPaymentStatus() {
      return { state: "approved", externalReference: intent.id };
    },
  } as unknown as MercadoPagoPaymentAdapter;
  const useCase = new HandleMercadoPagoWebhookUseCase(payments, dispatch, undefined, provider);

  const intent = PaymentIntentEntity.create({
    merchantId: "merchant_1",
    sessionId: "checkout_hosted_card",
    idempotencyKey: "idem_hosted_card",
    amountCents: 10_000,
    currency: "BRL",
    method: "card",
  });
  intent.prepareCreation({
    merchantId: "merchant_1",
    sessionId: "checkout_hosted_card",
    intentId: intent.id,
    amountCents: 10_000,
    currency: "BRL",
    method: "card",
    provider: "mercadopago",
  });
  // Checkout Pro returns a preference id first; the notification later carries
  // the actual Mercado Pago payment id that must be used for a future refund.
  intent.markRequiresAction({ providerPaymentId: "pref_checkout_1" });
  await payments.saveIntent({ intent });

  const { rawBody, signature } = signedPaymentUpdatedWebhook();
  const result = await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET, intent.id);

  assert.deepEqual(result, { outcome: "processed", effect: "checkout_completed_after_payment" });
  assert.equal(checkout.approved.length, 1);
  assert.equal(
    (await payments.getIntentById("merchant_1", intent.id))?.snapshot().providerPaymentId,
    PAYMENT_ID,
  );
});

test("Mercado Pago usa o tópico de chargeback e o payment_id original", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const states: Array<"chargeback_pending" | "chargeback_lost"> = ["chargeback_pending", "chargeback_lost"];
  const provider = { async fetchPaymentStatus() { return { state: states.shift() ?? "chargeback_lost" }; } } as unknown as MercadoPagoPaymentAdapter;
  const marketplaceOrders: string[] = [];
  const marketplaceChargeback = {
    async executeForOrder(orderId: string) {
      marketplaceOrders.push(orderId);
      return [];
    },
  };
  const useCase = new HandleMercadoPagoWebhookUseCase(payments, dispatch, undefined, provider, marketplaceChargeback as any);
  const intent = PaymentIntentEntity.create({
    merchantId: "merchant_chargeback",
    sessionId: "checkout_chargeback",
    idempotencyKey: "idem_chargeback",
    amountCents: 10_000,
    currency: "BRL",
    method: "card",
    commerceOrderId: "market_order_mercadopago",
  });
  intent.markRequiresAction({ providerPaymentId: PAYMENT_ID });
  intent.markApproved({ providerPaymentId: PAYMENT_ID, approvedAmountCents: 10_000 });
  await payments.saveIntent({ intent });
  const { rawBody, signature } = signedChargebackWebhook();

  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "processed", effect: "chargeback_pending" });
  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "processed", effect: "chargeback_lost" });
  assert.equal((await payments.getIntentById("merchant_chargeback", intent.id))?.snapshot().status, "chargeback_lost");
  assert.deepEqual(marketplaceOrders, ["market_order_mercadopago"]);
});
