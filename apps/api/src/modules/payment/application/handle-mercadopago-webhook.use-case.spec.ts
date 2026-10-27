import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { PaymentIntentEntity, type PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { MercadoPagoPaymentAdapter } from "../infrastructure/mercadopago-payment.adapter.js";
import { HandleMercadoPagoWebhookUseCase, UnauthorizedWebhookError } from "./handle-mercadopago-webhook.use-case.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { approvedChargebackPayment, ChargebackTestRepository, readOnlyChargebackProvider, RecordingMarketplaceChargeback } from "../__tests__/chargeback-test-fixtures.js";

const WEBHOOK_SECRET = "test-mercadopago-webhook-secret";
const REQUEST_ID = "request_1";
const PAYMENT_ID = "mp_payment_1";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  readonly approved: CheckoutPaymentApprovedInput[] = [];
  readonly statuses: Array<Parameters<CheckoutPaymentPort["recordPaymentStatusChanged"]>[0]> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }

  async recordPaymentFailure(_input: { merchantId: string; sessionId: string; reason: string }): Promise<void> {}

  async recordPaymentStatusChanged(input: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
  }): Promise<void> { this.statuses.push(input); }
}

function signedPaymentUpdatedWebhook(): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify({ action: "payment.updated", data: { id: PAYMENT_ID } });
  const timestamp = "1720000000";
  const template = `id:${PAYMENT_ID};request-id:${REQUEST_ID};ts:${timestamp};`;
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(template).digest("hex");
  return { rawBody, signature: `ts=${timestamp},v1=${signature}` };
}

function signedChargebackWebhook(paymentId = PAYMENT_ID, chargebackId = "mp_chargeback_1"): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify({ type: "topic_chargebacks_wh", data: { id: chargebackId, payment_id: paymentId } });
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
  const states: Array<"chargeback_pending" | "chargeback_lost"> = ["chargeback_pending", "chargeback_lost", "chargeback_pending", "chargeback_lost"];
  const providerReads: Array<Parameters<NonNullable<PaymentProviderPort["fetchPaymentStatus"]>>[0]> = [];
  const provider = readOnlyChargebackProvider(async (input) => {
    providerReads.push(input);
    return { state: states.shift() ?? "chargeback_lost" };
  });
  const marketplaceChargeback = new RecordingMarketplaceChargeback();
  const useCase = new HandleMercadoPagoWebhookUseCase(payments, dispatch, undefined, provider, marketplaceChargeback as never);
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
  // The funding journal is keyed by the provider payment, not the ERP order.
  assert.deepEqual(marketplaceChargeback.calls, [{ orderId: PAYMENT_ID, hostMerchantId: "merchant_chargeback" }]);
  assert.deepEqual(checkout.statuses.map((entry) => entry.status), ["chargeback_pending", "chargeback_lost"]);
  assert.ok(checkout.statuses.every((entry) => entry.merchantId === "merchant_chargeback" && entry.sessionId === "checkout_chargeback" && entry.paymentIntentId === intent.id));
  const beforeReplay = (await payments.getIntentById("merchant_chargeback", intent.id))!.snapshot();
  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "duplicate" });
  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "duplicate" });
  assert.deepEqual((await payments.getIntentById("merchant_chargeback", intent.id))!.snapshot(), beforeReplay);
  assert.equal(marketplaceChargeback.calls.length, 1);
  assert.equal(checkout.statuses.length, 2);
  assert.equal(checkout.approved.length, 0);
  assert.deepEqual(providerReads, Array.from({ length: 4 }, () => ({ merchantId: "merchant_chargeback", provider: "mercadopago", providerPaymentId: PAYMENT_ID })));
  for (const state of ["chargeback_pending", "chargeback_lost"]) {
    assert.equal(await payments.hasProcessedProviderEvent({ provider: "mercadopago", merchantId: "merchant_chargeback", eventId: `mp_chargeback_1:${state}` }), true);
    assert.equal(await payments.hasProcessedProviderEvent({ provider: "mercadopago", merchantId: "other_merchant", eventId: `mp_chargeback_1:${state}` }), false);
  }
});

function mercadoChargebackFixture(read: NonNullable<PaymentProviderPort["fetchPaymentStatus"]>) {
  const payments = new ChargebackTestRepository();
  const checkout = new RecordingCheckoutPayment();
  const marketplace = new RecordingMarketplaceChargeback();
  const useCase = new HandleMercadoPagoWebhookUseCase(payments, new PaymentDispatchService(payments, checkout),
    undefined, readOnlyChargebackProvider(read), marketplace as never);
  return { payments, checkout, marketplace, useCase };
}

for (const signatureKind of ["missing", "forged"]) {
  test(`Mercado Pago chargeback rejects ${signatureKind} signature before provider lookup, reservation or effects`, async () => {
    let reads = 0;
    const { payments, checkout, marketplace, useCase } = mercadoChargebackFixture(async () => { reads++; assert.fail("Invalid signature must not read the provider"); });
    const intent = await approvedChargebackPayment(payments, "merchant_auth", PAYMENT_ID);
    const before = intent.snapshot();
    const { rawBody } = signedChargebackWebhook();
    await assert.rejects(() => useCase.execute(rawBody, signatureKind === "missing" ? undefined : `ts=1720000001,v1=${"0".repeat(64)}`,
      REQUEST_ID, WEBHOOK_SECRET), UnauthorizedWebhookError);
    assert.equal(reads, 0);
    assert.equal(payments.scopedReads.length, 0);
    assert.equal(payments.reservations.length, 0);
    assert.deepEqual((await payments.getIntentById("merchant_auth", intent.id))!.snapshot(), before);
    assert.equal(marketplace.calls.length, 0);
    assert.equal(checkout.statuses.length, 0);
  });
}

test("Mercado Pago resolves the persisted payment merchant instead of a foreign route intent", async () => {
  const { payments, checkout, marketplace, useCase } = mercadoChargebackFixture(async (input) => {
    assert.deepEqual(input, { merchantId: "merchant_a", provider: "mercadopago", providerPaymentId: PAYMENT_ID });
    return { state: "chargeback_pending", externalReference: target.id };
  });
  const target = await approvedChargebackPayment(payments, "merchant_a", PAYMENT_ID);
  const foreign = await approvedChargebackPayment(payments, "merchant_b", "mp_payment_foreign");
  const foreignBefore = foreign.snapshot();
  const { rawBody, signature } = signedChargebackWebhook();
  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET, foreign.id), { outcome: "processed", effect: "chargeback_pending" });
  assert.deepEqual(payments.scopedReads, [{ merchantId: "merchant_a", intentId: target.id }]);
  assert.deepEqual(marketplace.calls, [{ orderId: PAYMENT_ID, hostMerchantId: "merchant_a" }]);
  assert.equal(checkout.statuses.length, 1);
  assert.equal((await payments.getIntentById("merchant_a", target.id))!.status, "chargeback_pending");
  assert.deepEqual((await payments.getIntentById("merchant_b", foreign.id))!.snapshot(), foreignBefore);
});

test("Mercado Pago rejects a provider-confirmed reference mismatch before any chargeback reservation", async () => {
  const { payments, checkout, marketplace, useCase } = mercadoChargebackFixture(async (input) => {
    assert.equal(input.merchantId, "merchant_a");
    assert.equal(input.providerPaymentId, PAYMENT_ID);
    return { state: "chargeback_pending", externalReference: foreign.id };
  });
  const target = await approvedChargebackPayment(payments, "merchant_a", PAYMENT_ID);
  const foreign = await approvedChargebackPayment(payments, "merchant_b", "mp_payment_foreign");
  const { rawBody, signature } = signedChargebackWebhook();
  await assert.rejects(() => useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), /mercadopago_webhook_intent_mismatch/);
  assert.equal(payments.reservations.length, 0);
  assert.deepEqual((await payments.getIntentById("merchant_a", target.id))!.snapshot(), target.snapshot());
  assert.deepEqual((await payments.getIntentById("merchant_b", foreign.id))!.snapshot(), foreign.snapshot());
  assert.equal(marketplace.calls.length, 0);
  assert.equal(checkout.statuses.length, 0);
});

test("Mercado Pago provider read failure leaves no marker or mutation and allows safe redelivery", async () => {
  let reads = 0;
  const unavailable = new Error("synthetic_provider_read_unavailable");
  const { payments, checkout, marketplace, useCase } = mercadoChargebackFixture(async () => {
    if (++reads === 1) throw unavailable;
    return { state: "chargeback_pending" };
  });
  const intent = await approvedChargebackPayment(payments, "merchant_retry", PAYMENT_ID);
  const { rawBody, signature } = signedChargebackWebhook();
  await assert.rejects(() => useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), (error) => error === unavailable);
  assert.equal(payments.reservations.length, 0);
  assert.deepEqual((await payments.getIntentById("merchant_retry", intent.id))!.snapshot(), intent.snapshot());
  assert.equal(marketplace.calls.length, 0);
  assert.equal(checkout.statuses.length, 0);
  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "processed", effect: "chargeback_pending" });
  assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "duplicate" });
  assert.equal(reads, 3); // Each delivery re-reads state, including the duplicate.
  assert.equal(marketplace.calls.length, 1);
  assert.equal(checkout.statuses.length, 1);
});

test("Mercado Pago reserves the same chargeback subject independently for each persisted merchant", async () => {
  const { payments, checkout, marketplace, useCase } = mercadoChargebackFixture(async (input) => {
    assert.equal(input.providerPaymentId, `mp_${input.merchantId}`);
    return { state: "chargeback_pending" };
  });
  for (const merchantId of ["merchant_a", "merchant_b"]) {
    const intent = await approvedChargebackPayment(payments, merchantId, `mp_${merchantId}`);
    const { rawBody, signature } = signedChargebackWebhook(`mp_${merchantId}`);
    assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "processed", effect: "chargeback_pending" });
    assert.deepEqual(await useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET), { outcome: "duplicate" });
    assert.equal(await payments.hasProcessedProviderEvent({ provider: "mercadopago", merchantId, eventId: "mp_chargeback_1:chargeback_pending" }), true);
    assert.equal((await payments.getIntentById(merchantId, intent.id))!.status, "chargeback_pending");
  }
  assert.deepEqual(marketplace.calls, ["merchant_a", "merchant_b"].map((hostMerchantId) => ({ orderId: `mp_${hostMerchantId}`, hostMerchantId })));
  assert.equal(checkout.statuses.length, 2);
  assert.equal(checkout.approved.length, 0);
});

test("concurrent Mercado Pago chargeback deliveries reconcile state but apply one financial transition", async () => {
  let reads = 0;
  const { payments, checkout, marketplace, useCase } = mercadoChargebackFixture(async () => { reads++; return { state: "chargeback_pending" }; });
  await approvedChargebackPayment(payments, "merchant_concurrent", PAYMENT_ID);
  const { rawBody, signature } = signedChargebackWebhook();
  const results = await Promise.all(Array.from({ length: 5 }, () => useCase.execute(rawBody, signature, REQUEST_ID, WEBHOOK_SECRET)));
  assert.equal(results.filter((row) => row.outcome === "processed").length, 1);
  assert.equal(results.filter((row) => row.outcome === "duplicate").length, 4);
  assert.equal(reads, 5);
  assert.deepEqual(marketplace.calls, [{ orderId: PAYMENT_ID, hostMerchantId: "merchant_concurrent" }]);
  assert.equal(checkout.statuses.length, 1);
});
