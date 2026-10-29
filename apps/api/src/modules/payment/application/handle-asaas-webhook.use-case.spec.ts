import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, Logger } from "@nestjs/common";
import type { CommerceOrderPort } from "@zyon/commerce-adapters";
import { PaymentIntentEntity, type PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import { HandleAsaasWebhookUseCase, UnauthorizedWebhookError, assertWebhookToken } from "./handle-asaas-webhook.use-case.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";
import { InMemoryCommercePaidWebhookDedup } from "../../commerce/infrastructure/in-memory-commerce-paid-webhook-dedup.js";
import { approvedChargebackPayment, ChargebackTestRepository, RecordingMarketplaceChargeback } from "../__tests__/chargeback-test-fixtures.js";

const TEST_ASAAS_TOKEN = "test-asaas-webhook-token";
const WEBHOOK_HEADER = TEST_ASAAS_TOKEN;

// Configure webhook token at module load so the use case's process.env lookup
// succeeds before the first test executes (fail-closed requires a configured token).
process.env.ASAAS_WEBHOOK_TOKEN = TEST_ASAAS_TOKEN;

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public failures: Array<{ merchantId: string; sessionId: string }> = [];
  public statuses: Array<{ merchantId: string; sessionId: string; paymentIntentId: string; status: PaymentIntentStatus; reason?: string }> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }

  async recordPaymentFailure(params: { merchantId: string; sessionId: string; reason: string }): Promise<void> {
    void params.reason;
    this.failures.push({ merchantId: params.merchantId, sessionId: params.sessionId });
  }

  async recordPaymentStatusChanged(params: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
  }): Promise<void> {
    this.statuses.push({
      merchantId: params.merchantId,
      sessionId: params.sessionId,
      paymentIntentId: params.paymentIntentId,
      status: params.status,
      reason: params.reason
    });
  }
}

test("assertWebhookToken rejects wrong asaas-access-token", () => {
  assert.throws(() => assertWebhookToken("secret", "wrong"), UnauthorizedWebhookError);
});

test("duplicate provider event id short-circuits", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);
  await payments.recordProcessedProviderEvent({ provider: "asaas", merchantId: null, eventId: "evt_dup_1" });

  const r = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_dup_1",
    event: "PAYMENT_RECEIVED",
    payment: {
      id: "pay_1",
      value: 3,
      externalReference: "pay_int_x"
    }
  }, TEST_ASAAS_TOKEN);
  assert.deepEqual(r, { outcome: "duplicate" });
});

test("PAYMENT_RECEIVED approves intent and completes checkout once", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "idem_1",
    amountCents: 30000,
    currency: "BRL",
    method: "pix",
    acceptedOfferId: "off_a"
  });
  intent.markRequiresAction({ providerPaymentId: "pay_asaas_1" });
  intent.setBuyerFacingPayload({ invoiceUrl: "https://x.test" });
  await payments.saveIntent({ intent });
  const ext = intent.snapshot().id;

  const first = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_1",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  }, TEST_ASAAS_TOKEN);
  const second = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_2",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  }, TEST_ASAAS_TOKEN);

  assert.equal(first.outcome, "processed");
  assert.equal(second.outcome, "processed");
  if (second.outcome === "processed") assert.equal(second.effect, "already_approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(checkoutPort.approved[0]?.externalOrderId, "pay_asaas_1");
  assert.equal(checkoutPort.approved[0]?.orderTotalMajorUnits, 300);
  assert.equal(checkoutPort.approved[0]?.acceptedOfferId, "off_a");
  assert.ok(payments.capturedEvents.map(event => event.payload as { status: string; reason?: string }).some((entry) => entry.status === "approved"));
});

test("PAYMENT_RECEIVED marks linked commerce order paid idempotently", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  let markPaidCalls = 0;
  const commerceOrders: CommerceOrderPort = {
    async createPendingOrder() {
      return { commerceOrderId: "unexpected" };
    },
    async markOrderPaid(input) {
      markPaidCalls += 1;
      assert.equal(input.merchantId, "mrc_1");
      assert.equal(input.commerceOrderId, "draft_123");
      assert.equal(input.paymentReference, "pay_asaas_1");
    }
  };
  const commercePaid = new MarkCommerceOrderPaidUseCase(
    commerceOrders,
    new InMemoryCommercePaidWebhookDedup()
  );
  const dispatch = new PaymentDispatchService(payments, checkoutPort, undefined, commercePaid);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "idem_1",
    amountCents: 30000,
    currency: "BRL",
    method: "pix",
    commerceOrderId: "draft_123"
  });
  intent.markRequiresAction({ providerPaymentId: "pay_asaas_1" });
  await payments.saveIntent({ intent });
  const ext = intent.snapshot().id;

  const first = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_1",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  }, TEST_ASAAS_TOKEN);
  const second = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_2",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  }, TEST_ASAAS_TOKEN);

  assert.equal(first.outcome, "processed");
  if (first.outcome === "processed") {
    assert.equal(first.effect, "checkout_completed_after_payment_and_commerce_paid");
  }
  assert.equal(second.outcome, "processed");
  if (second.outcome === "processed") assert.equal(second.effect, "already_approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(markPaidCalls, 1);
});

test("PAYMENT_RECEIVED retries commerce paid sync after post-approval failure", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  let commercePaidCalls = 0;
  const commercePaid = {
    async execute() {
      commercePaidCalls += 1;
      if (commercePaidCalls === 1) throw new Error("commerce_paid_sync_failed");
      return { invokedCommerceSync: true };
    }
  };
  const dispatch = new PaymentDispatchService(
    payments,
    checkoutPort,
    undefined,
    commercePaid as unknown as MarkCommerceOrderPaidUseCase
  );
  const uc = new HandleAsaasWebhookUseCase(
    payments,
    dispatch
  );

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_retry",
    idempotencyKey: "idem_retry",
    amountCents: 50000,
    currency: "BRL",
    method: "pix",
    commerceOrderId: "draft_retry"
  });
  intent.markRequiresAction({ providerPaymentId: "pay_retry" });
  await payments.saveIntent({ intent });
  const ext = intent.snapshot().id;

  const webhookBody = {
    id: "evt_retry",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_retry", value: 500, externalReference: ext }
  };

  await assert.rejects(() => uc.execute(WEBHOOK_HEADER, webhookBody, TEST_ASAAS_TOKEN), /commerce_paid_sync_failed/);

  assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: "mrc_1", eventId: "evt_retry" }), false);
  assert.equal(checkoutPort.approved.length, 1);

  const retried = await uc.execute(WEBHOOK_HEADER, webhookBody, TEST_ASAAS_TOKEN);

  assert.equal(retried.outcome, "processed");
  if (retried.outcome === "processed") assert.equal(retried.effect, "already_approved");
  assert.equal(commercePaidCalls, 2);
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: "mrc_1", eventId: "evt_retry" }), true);
});

test("PAYMENT_DELETED marks failed and records payment_failed event", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_9",
    idempotencyKey: "idem_9",
    amountCents: 100,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "pay_del" });
  await payments.saveIntent({ intent });
  const ext = intent.snapshot().id;

  const r = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_del_1",
    event: "PAYMENT_DELETED",
    payment: { id: "pay_del", value: 1, externalReference: ext }
  }, TEST_ASAAS_TOKEN);
  assert.equal(r.outcome, "processed");
  assert.equal(checkoutPort.failures.length, 1);

  const reload = await payments.getIntentById("mrc_1", ext);
  assert.equal(reload?.snapshot().status, "failed");
  assert.ok(reload?.snapshot().statusHistory.some((entry) => entry.status === "failed"));
  assert.ok(payments.capturedEvents.map(event => event.payload as { status: string; reason?: string }).some((entry) => entry.status === "failed" && entry.reason === "PAYMENT_DELETED"));
});

test("Asaas registra o ciclo de chargeback e atualiza o repasse de Marketplace uma vez", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);
  const marketplaceChargeback = new RecordingMarketplaceChargeback();
  const uc = new HandleAsaasWebhookUseCase(
    payments,
    dispatch,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    marketplaceChargeback as never,
  );
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_chargeback",
    sessionId: "chk_chargeback",
    idempotencyKey: "idem_chargeback",
    amountCents: 12_000,
    currency: "BRL",
    method: "card",
    commerceOrderId: "market_order_asaas",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_chargeback" });
  intent.markApproved({ providerPaymentId: "pay_chargeback", approvedAmountCents: 12_000 });
  await payments.saveIntent({ intent });
  const externalReference = intent.snapshot().id;

  const requested = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_chargeback_requested",
    event: "PAYMENT_CHARGEBACK_REQUESTED",
    payment: { id: "pay_chargeback", externalReference },
  }, TEST_ASAAS_TOKEN);
  const disputed = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_chargeback_disputed",
    event: "PAYMENT_CHARGEBACK_DISPUTE",
    payment: { id: "pay_chargeback", externalReference },
  }, TEST_ASAAS_TOKEN);
  const lost = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_chargeback_lost",
    event: "PAYMENT_REFUNDED",
    payment: { id: "pay_chargeback", externalReference },
  }, TEST_ASAAS_TOKEN);

  assert.deepEqual(requested, { outcome: "processed", effect: "chargeback_pending" });
  assert.deepEqual(disputed, { outcome: "processed", effect: "chargeback_disputed" });
  assert.deepEqual(lost, { outcome: "processed", effect: "chargeback_lost" });
  assert.equal((await payments.getIntentById("mrc_chargeback", externalReference))?.snapshot().status, "chargeback_lost");
  assert.deepEqual(checkoutPort.statuses.map(entry => entry.status), ["chargeback_pending", "chargeback_disputed", "chargeback_lost"]);
  // The funding journal is keyed by the provider payment, not the ERP order.
  assert.deepEqual(marketplaceChargeback.calls, [{ orderId: "pay_chargeback", hostMerchantId: "mrc_chargeback" }]);
  assert.ok(checkoutPort.statuses.every((entry) => entry.merchantId === "mrc_chargeback" && entry.sessionId === "chk_chargeback" && entry.paymentIntentId === externalReference));
  const beforeReplay = (await payments.getIntentById("mrc_chargeback", externalReference))!.snapshot();
  for (const [id, event] of [["evt_chargeback_requested", "PAYMENT_CHARGEBACK_REQUESTED"],
    ["evt_chargeback_disputed", "PAYMENT_CHARGEBACK_DISPUTE"], ["evt_chargeback_lost", "PAYMENT_REFUNDED"]]) {
    assert.deepEqual(await uc.execute(WEBHOOK_HEADER, { id, event, payment: { id: "pay_chargeback", externalReference } }, TEST_ASAAS_TOKEN), { outcome: "duplicate" });
    assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: "mrc_chargeback", eventId: id }), true);
    assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: "other_merchant", eventId: id }), false);
  }
  assert.deepEqual((await payments.getIntentById("mrc_chargeback", externalReference))!.snapshot(), beforeReplay);
  assert.equal(marketplaceChargeback.calls.length, 1);
  assert.equal(checkoutPort.statuses.length, 3);
  assert.equal(checkoutPort.approved.length, 0);
});

function asaasChargebackFixture() {
  const payments = new ChargebackTestRepository();
  const checkout = new RecordingCheckoutPayment();
  const marketplace = new RecordingMarketplaceChargeback();
  const holds: Array<{ kind: "refund" | "chargeback"; intentId: string }> = [];
  const anomalies: Array<{ provider: string; kind: string }> = [];
  const useCase = new HandleAsaasWebhookUseCase(payments, new PaymentDispatchService(payments, checkout),
    { paymentWebhookAnomaly: { inc: (labels: { provider: string; kind: string }) => anomalies.push(labels) } } as never,
    undefined, undefined,
    { execute: async (intentId: string) => { holds.push({ kind: "refund", intentId }); } } as never,
    { execute: async (intentId: string) => { holds.push({ kind: "chargeback", intentId }); } } as never,
    marketplace as never);
  return { payments, checkout, marketplace, holds, anomalies, useCase };
}

for (const token of [undefined, "synthetic-wrong-token"]) {
  test(`Asaas chargeback rejects ${token === undefined ? "missing" : "wrong"} token before reservation or financial effects`, async () => {
    const { payments, checkout, marketplace, useCase } = asaasChargebackFixture();
    const intent = await approvedChargebackPayment(payments, "merchant_auth", "pay_auth");
    const before = intent.snapshot();
    await assert.rejects(() => useCase.execute(token, { id: "event_auth", event: "PAYMENT_CHARGEBACK_REQUESTED",
      payment: { id: "pay_auth", externalReference: intent.id } }, TEST_ASAAS_TOKEN), UnauthorizedWebhookError);
    assert.equal(payments.scopedReads.length, 0);
    assert.equal(payments.reservations.length, 0);
    assert.deepEqual((await payments.getIntentById(before.merchantId, intent.id))!.snapshot(), before);
    assert.equal(marketplace.calls.length, 0);
    assert.equal(checkout.statuses.length, 0);
    assert.equal(checkout.approved.length, 0);
  });
}

test("Asaas chargeback without a known external reference never selects another intent by payment id", async () => {
  const { payments, checkout, marketplace, useCase } = asaasChargebackFixture();
  const intent = await approvedChargebackPayment(payments, "merchant_known", "pay_known");
  const before = intent.snapshot();
  await assert.rejects(() => useCase.execute(WEBHOOK_HEADER, { id: "event_unknown_ref", event: "PAYMENT_CHARGEBACK_REQUESTED",
    payment: { id: "pay_known", externalReference: "pay_int_unknown_reference" } }, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
  assert.equal(payments.scopedReads.length, 0);
  assert.deepEqual(payments.reservations, []);
  assert.deepEqual((await payments.getIntentById(before.merchantId, intent.id))!.snapshot(), before);
  assert.equal(marketplace.calls.length, 0);
  assert.equal(checkout.statuses.length, 0);
});

test("concurrent Asaas chargeback deliveries reserve one transition and one marketplace propagation", async () => {
  const { payments, checkout, marketplace, useCase } = asaasChargebackFixture();
  const intent = await approvedChargebackPayment(payments, "merchant_concurrent", "pay_concurrent");
  const body = { id: "event_concurrent", event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_concurrent", externalReference: intent.id } };
  const results = await Promise.all(Array.from({ length: 5 }, () => useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN)));
  assert.equal(results.filter((row) => row.outcome === "processed").length, 1);
  assert.equal(results.filter((row) => row.outcome === "duplicate").length, 4);
  assert.deepEqual(marketplace.calls, [{ orderId: "pay_concurrent", hostMerchantId: "merchant_concurrent" }]);
  assert.equal(checkout.statuses.length, 1);
  assert.equal((await payments.getIntentById("merchant_concurrent", intent.id))!.status, "chargeback_pending");
});

test("Asaas chargeback event ids are deduplicated per merchant, not globally", async () => {
  const { payments, checkout, marketplace, useCase } = asaasChargebackFixture();
  for (const merchantId of ["merchant_a", "merchant_b"]) {
    const intent = await approvedChargebackPayment(payments, merchantId, `pay_${merchantId}`);
    const body = { id: "event_same_id", event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: `pay_${merchantId}`, externalReference: intent.id } };
    assert.deepEqual(await useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "processed", effect: "chargeback_pending" });
    assert.deepEqual(await useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "duplicate" });
    assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId, eventId: "event_same_id" }), true);
    assert.equal((await payments.getIntentById(merchantId, intent.id))!.status, "chargeback_pending");
  }
  assert.deepEqual(marketplace.calls, ["merchant_a", "merchant_b"].map((hostMerchantId) => ({ orderId: `pay_${hostMerchantId}`, hostMerchantId })));
  assert.equal(checkout.statuses.length, 2);
  assert.equal(checkout.approved.length, 0);
});

test("Asaas chargeback must reject a known payment bound to a different merchant's external reference", async () => {
  const { payments, checkout, marketplace, useCase } = asaasChargebackFixture();
  const original = await approvedChargebackPayment(payments, "merchant_original", "pay_original");
  const foreign = await approvedChargebackPayment(payments, "merchant_foreign", "pay_foreign");
  const beforeOriginal = original.snapshot();
  const beforeForeign = foreign.snapshot();
  let rejected: unknown;
  try {
    await useCase.execute(WEBHOOK_HEADER, { id: "event_conflicting_reference", event: "PAYMENT_CHARGEBACK_REQUESTED",
      payment: { id: "pay_original", externalReference: foreign.id } }, TEST_ASAAS_TOKEN);
  } catch (error) { rejected = error; }
  // Authentication alone is not proof of a consistent persisted binding.
  assert.deepEqual({
    originalStatus: (await payments.getIntentById(beforeOriginal.merchantId, original.id))!.snapshot().status,
    foreignStatus: (await payments.getIntentById(beforeForeign.merchantId, foreign.id))!.snapshot().status,
    marketplaceCalls: marketplace.calls.length,
    statusChanges: checkout.statuses.length,
    reservations: payments.reservations.length,
  }, { originalStatus: "approved", foreignStatus: "approved", marketplaceCalls: 0, statusChanges: 0, reservations: 0 });
  assert.ok(rejected instanceof Error, "Contradictory chargeback identities must be rejected");
  assert.deepEqual((await payments.getIntentById(beforeOriginal.merchantId, original.id))!.snapshot(), beforeOriginal);
  assert.deepEqual((await payments.getIntentById(beforeForeign.merchantId, foreign.id))!.snapshot(), beforeForeign);
});

function isAsaasIdentityRejection(error: unknown): boolean {
  return error instanceof BadRequestException && error.getStatus() === 400 &&
    ["asaas_webhook_payment_identity_missing", "asaas_webhook_payment_identity_mismatch"].includes(error.message);
}

type AsaasIdentityFixture = ReturnType<typeof asaasChargebackFixture>;

async function assertAsaasFinancialEffectsAbsent(fixture: AsaasIdentityFixture, snapshots: ReturnType<PaymentIntentEntity["snapshot"]>[]) {
  assert.equal(fixture.payments.reservations.length, 0);
  assert.equal(fixture.payments.capturedEvents.length, 0);
  assert.deepEqual(fixture.checkout.statuses, []);
  assert.deepEqual(fixture.checkout.approved, []);
  assert.deepEqual(fixture.checkout.failures, []);
  assert.deepEqual(fixture.marketplace.calls, []);
  assert.deepEqual(fixture.holds, []);
  for (const snapshot of snapshots) {
    assert.deepEqual((await fixture.payments.getIntentById(snapshot.merchantId, snapshot.id))!.snapshot(), snapshot);
  }
}

const identityProtectedEvents = ["PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL", "PAYMENT_REFUNDED"] as const;

for (const event of identityProtectedEvents) {
  for (const sameMerchant of [false, true]) {
    test(`${event} rejects a different ${sameMerchant ? "same-merchant" : "foreign-merchant"} intent before financial effects`, async () => {
      const fixture = asaasChargebackFixture();
      const original = await approvedChargebackPayment(fixture.payments, "merchant_original", "pay_original");
      // Distinct checkout/idempotency keys even when both payments share a tenant.
      const target = PaymentIntentEntity.create({ merchantId: sameMerchant ? "merchant_original" : "merchant_foreign",
        sessionId: "checkout_target", idempotencyKey: "target", amountCents: 10_000, currency: "BRL", method: "card" });
      target.markRequiresAction({ providerPaymentId: "pay_target" });
      target.markApproved({ providerPaymentId: "pay_target", approvedAmountCents: 10_000 });
      if (event !== "PAYMENT_CHARGEBACK_REQUESTED") target.markChargebacked();
      await fixture.payments.saveIntent({ intent: target });
      const snapshots = [original.snapshot(), target.snapshot()];
      await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, { id: "event_conflict", event,
        payment: { id: "pay_original", externalReference: target.id } }, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
      await assertAsaasFinancialEffectsAbsent(fixture, snapshots);
      assert.deepEqual(fixture.anomalies, [{ provider: "asaas", kind: "payment_identity_mismatch" }]);
    });
  }

  for (const invalid of ["missing_payment", "missing_id", "blank_id", "unknown_id", "missing_reference", "blank_reference", "unknown_reference"] as const) {
    test(`${event} rejects ${invalid} before reserving an event`, async () => {
      const fixture = asaasChargebackFixture();
      const intent = await approvedChargebackPayment(fixture.payments, "merchant_input", "pay_input");
      if (event !== "PAYMENT_CHARGEBACK_REQUESTED") { intent.markChargebacked(); await fixture.payments.saveIntent({ intent }); }
      const snapshot = intent.snapshot();
      const payment = invalid === "missing_payment" ? undefined : {
        id: invalid === "missing_id" ? undefined : invalid === "blank_id" ? "   " : invalid === "unknown_id" ? "pay_unknown" : "pay_input",
        externalReference: invalid === "missing_reference" ? undefined : invalid === "blank_reference" ? "   " : invalid === "unknown_reference" ? "pay_int_unknown" : intent.id,
      };
      await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, { id: "event_invalid", event, payment }, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
      await assertAsaasFinancialEffectsAbsent(fixture, [snapshot]);
      assert.equal(fixture.anomalies.length, 1);
    });
  }
}

test("Asaas identity rejection preserves the event id for a corrected redelivery", async () => {
  const fixture = asaasChargebackFixture();
  const original = await approvedChargebackPayment(fixture.payments, "merchant_original", "pay_original");
  const foreign = await approvedChargebackPayment(fixture.payments, "merchant_foreign", "pay_foreign");
  const foreignBefore = foreign.snapshot();
  const invalid = { id: "event_recoverable", event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_original", externalReference: foreign.id } };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, invalid, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
  }
  await assertAsaasFinancialEffectsAbsent(fixture, [original.snapshot(), foreignBefore]);
  const corrected = { ...invalid, payment: { id: "pay_original", externalReference: original.id } };
  assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, corrected, TEST_ASAAS_TOKEN), { outcome: "processed", effect: "chargeback_pending" });
  const after = (await fixture.payments.getIntentById(original.snapshot().merchantId, original.id))!.snapshot();
  assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, corrected, TEST_ASAAS_TOKEN), { outcome: "duplicate" });
  assert.deepEqual((await fixture.payments.getIntentById(original.snapshot().merchantId, original.id))!.snapshot(), after);
  assert.deepEqual((await fixture.payments.getIntentById(foreignBefore.merchantId, foreign.id))!.snapshot(), foreignBefore);
  assert.equal(await fixture.payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: foreignBefore.merchantId, eventId: invalid.id }), false);
  assert.deepEqual(fixture.holds, [{ kind: "chargeback", intentId: original.id }]);
  assert.equal(fixture.marketplace.calls.length, 1);
  assert.equal(fixture.checkout.statuses.length, 1);
});

test("Asaas identity guard accepts historical matching binding through won and replay", async () => {
  const fixture = asaasChargebackFixture();
  const intent = await approvedChargebackPayment(fixture.payments, "merchant_legacy", "pay_legacy");
  assert.equal(intent.snapshot().creation, undefined);
  for (const [index, event] of identityProtectedEvents.slice(0, 3).entries()) {
    const body = { id: `event_legacy_${index}`, event, payment: { id: " pay_legacy ", externalReference: ` ${intent.id} ` } };
    assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "processed", effect: ["chargeback_pending", "chargeback_disputed", "chargeback_won"][index] });
    assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "duplicate" });
  }
  assert.equal((await fixture.payments.getIntentById(intent.snapshot().merchantId, intent.id))!.status, "chargeback_won");
  assert.equal(fixture.marketplace.calls.length, 1);
  assert.deepEqual(fixture.holds, [{ kind: "chargeback", intentId: intent.id }]);
  assert.deepEqual(fixture.anomalies, []);
});

test("Asaas ordinary refund requires consistent identity and preserves one refund hold", async () => {
  const fixture = asaasChargebackFixture();
  const intent = await approvedChargebackPayment(fixture.payments, "merchant_refund", "pay_refund");
  const body = { id: "event_refund", event: "PAYMENT_REFUNDED", payment: { id: "pay_refund", externalReference: intent.id } };
  assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "processed", effect: "payment_refunded" });
  assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "duplicate" });
  assert.deepEqual(fixture.holds, [{ kind: "refund", intentId: intent.id }]);
  assert.deepEqual(fixture.marketplace.calls, []);
  assert.equal((await fixture.payments.getIntentById(intent.snapshot().merchantId, intent.id))!.status, "refunded");
});

test("Asaas validates identity even when the event id already has a success marker", async () => {
  const fixture = asaasChargebackFixture();
  const intent = await approvedChargebackPayment(fixture.payments, "merchant_replay", "pay_replay");
  const body = { id: "event_processed", event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_replay", externalReference: intent.id } };
  await fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN);
  const before = (await fixture.payments.getIntentById("merchant_replay", intent.id))!.snapshot();
  await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, { ...body, payment: { ...body.payment, id: "pay_unknown" } }, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
  assert.equal(fixture.payments.reservations.length, 1);
  assert.equal(fixture.holds.length, 1);
  assert.equal(fixture.marketplace.calls.length, 1);
  assert.equal(fixture.checkout.statuses.length, 1);
  assert.deepEqual((await fixture.payments.getIntentById("merchant_replay", intent.id))!.snapshot(), before);
});

test("Asaas identity anomaly emits bounded labels and no rejected identifiers or token", async (t) => {
  const warnings: unknown[] = [];
  t.mock.method(Logger.prototype, "warn", (message: unknown) => { warnings.push(message); });
  const fixture = asaasChargebackFixture();
  const intent = await approvedChargebackPayment(fixture.payments, "sensitive_merchant", "sensitive_payment");
  await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, { id: "sensitive_event", event: "PAYMENT_CHARGEBACK_REQUESTED",
    payment: { id: "sensitive_payment_mismatch", externalReference: intent.id } }, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
  assert.deepEqual(fixture.anomalies, [{ provider: "asaas", kind: "payment_identity_mismatch" }]);
  assert.equal(warnings.length, 1);
  const log = String(warnings[0]);
  assert.ok(log.startsWith("asaas.webhook.rejected reason=payment_identity_mismatch correlation="));
  for (const secret of [intent.id, "sensitive_merchant", "sensitive_payment", "sensitive_event", WEBHOOK_HEADER]) {
    assert.equal(log.includes(secret), false);
  }
});

test("Asaas rejects historical intents without a persisted provider payment id", async () => {
  const fixture = asaasChargebackFixture();
  const intent = PaymentIntentEntity.create({ merchantId: "merchant_unbound", sessionId: "checkout_unbound", idempotencyKey: "unbound",
    amountCents: 10_000, currency: "BRL", method: "card" });
  await fixture.payments.saveIntent({ intent });
  const snapshot = intent.snapshot();
  await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, { id: "event_unbound", event: "PAYMENT_CHARGEBACK_REQUESTED",
    payment: { id: "pay_unverified", externalReference: intent.id } }, TEST_ASAAS_TOKEN), isAsaasIdentityRejection);
  await assertAsaasFinancialEffectsAbsent(fixture, [snapshot]);
});

for (const provider of ["asaas", "stripe", "mercadopago"] as const) {
  test(`Asaas identity guard ${provider === "asaas" ? "accepts" : "rejects"} explicit ${provider} creation metadata`, async () => {
    const fixture = asaasChargebackFixture();
    const intent = PaymentIntentEntity.create({ merchantId: "merchant_provider", sessionId: "checkout_provider", idempotencyKey: "provider",
      amountCents: 10_000, currency: "BRL", method: "card" });
    intent.prepareCreation({ merchantId: intent.snapshot().merchantId, sessionId: "checkout_provider", intentId: intent.id,
      amountCents: 10_000, currency: "BRL", method: "card", provider });
    intent.markRequiresAction({ providerPaymentId: "pay_provider" });
    intent.markApproved({ providerPaymentId: "pay_provider", approvedAmountCents: 10_000 });
    await fixture.payments.saveIntent({ intent });
    const snapshot = intent.snapshot();
    const execute = () => fixture.useCase.execute(WEBHOOK_HEADER, { id: "event_provider", event: "PAYMENT_CHARGEBACK_REQUESTED",
      payment: { id: "pay_provider", externalReference: intent.id } }, TEST_ASAAS_TOKEN);
    if (provider === "asaas") assert.deepEqual(await execute(), { outcome: "processed", effect: "chargeback_pending" });
    else { await assert.rejects(execute, isAsaasIdentityRejection); await assertAsaasFinancialEffectsAbsent(fixture, [snapshot]); }
  });
}

for (const lookup of ["missing", "conflicting_merchant", "conflicting_intent", "unavailable", "throwing", "entity_missing"] as const) {
  test(`Asaas persisted reference check handles ${lookup} lookup without unsafe fallback`, async () => {
    const fixture = asaasChargebackFixture();
    const intent = await approvedChargebackPayment(fixture.payments, "merchant_lookup", "pay_lookup");
    const snapshot = intent.snapshot();
    const body = { id: "event_lookup", event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_lookup", externalReference: intent.id } };
    const originalScopedRead = fixture.payments.getIntentById.bind(fixture.payments);
    if (lookup === "missing") fixture.payments.getIntentReferenceByProviderPaymentId = async () => null;
    if (lookup === "conflicting_merchant") fixture.payments.getIntentReferenceByProviderPaymentId = async () => ({ id: intent.id, merchantId: "merchant_other" });
    if (lookup === "conflicting_intent") fixture.payments.getIntentReferenceByProviderPaymentId = async () => ({ id: "pay_int_other", merchantId: intent.snapshot().merchantId });
    if (lookup === "unavailable") Object.defineProperty(fixture.payments, "getIntentReferenceByProviderPaymentId", { value: undefined });
    if (lookup === "throwing") fixture.payments.getIntentReferenceByProviderPaymentId = async () => { throw new Error("synthetic_lookup_unavailable"); };
    if (lookup === "entity_missing") fixture.payments.getIntentById = async () => null;
    if (lookup === "missing" || lookup === "unavailable") {
      // Optional global lookup is not proof; the scoped entity's binding is.
      assert.deepEqual(await fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN), { outcome: "processed", effect: "chargeback_pending" });
    } else {
      await assert.rejects(() => fixture.useCase.execute(WEBHOOK_HEADER, body, TEST_ASAAS_TOKEN),
        lookup === "throwing" ? /synthetic_lookup_unavailable/ : isAsaasIdentityRejection);
      fixture.payments.getIntentById = originalScopedRead;
      await assertAsaasFinancialEffectsAbsent(fixture, [snapshot]);
    }
  });
}

test("Asaas split events record the confirmed platform split and observed issuer balance", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_split",
    sessionId: "chk_split",
    idempotencyKey: "idem_split",
    amountCents: 30_000,
    currency: "BRL",
    method: "pix",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_split" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;
  await payments.settlementLedger.appendPlanned({
    merchantId: "mrc_split",
    paymentIntentId: intentId,
    provider: "asaas",
    currency: "BRL",
    plannedGrossCents: 30_000,
    plannedPlatformFeeCents: 99,
    plannedMerchantNetCents: 29_901,
    plannedProviderFeeCents: 0,
    occurredAt: new Date("2026-09-10T12:00:00.000Z"),
    entries: [
      { entryKey: "platform_fee", entryType: "platform_fee", direction: "credit", recipientType: "platform", plannedAmountCents: 99 },
      { entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", plannedAmountCents: 29_901 },
    ],
  });
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch, undefined, undefined, payments.settlementLedger);

  const splitDone = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_split_done",
    event: "PAYMENT_SPLIT_DONE",
    additionalInfo: { splitId: "split_platform" },
    payment: {
      id: "pay_split",
      value: 300,
      netValue: 294.51,
      externalReference: intentId,
      split: [{ id: "split_platform", fixedValue: 0.99 }],
    },
  }, TEST_ASAAS_TOKEN);
  assert.deepEqual(splitDone, { outcome: "processed", effect: "split_settlement_recorded" });

  const afterSplit = await payments.settlementLedger.listForPaymentIntent("mrc_split", intentId);
  assert.equal(afterSplit.length, 2);
  assert.equal(afterSplit[1]?.status, "confirmed");
  assert.equal(afterSplit[1]?.confirmedPlatformFeeCents, 99);
  assert.equal(afterSplit[1]?.confirmedGrossCents, 30_000);
  assert.equal(afterSplit[1]?.confirmedMerchantNetCents, 29_352);
  assert.equal(afterSplit[1]?.confirmedProviderFeeCents, 549);
  assert.deepEqual(afterSplit[1]?.entries.map(entry => [entry.entryKey, entry.confirmedAmountCents]), [["platform_fee", 99], ["merchant_payout", 29_352]]);

  const blocked = await uc.execute(WEBHOOK_HEADER, {
    id: "evt_split_blocked",
    event: "PAYMENT_SPLIT_DIVERGENCE_BLOCK",
    payment: { id: "pay_split", externalReference: intentId },
  }, TEST_ASAAS_TOKEN);
  assert.deepEqual(blocked, { outcome: "processed", effect: "split_divergence_block_recorded" });
  const afterBlock = await payments.settlementLedger.listForPaymentIntent("mrc_split", intentId);
  assert.equal(afterBlock.length, 3);
  assert.equal(afterBlock[2]?.status, "blocked");
  assert.equal(afterBlock[2]?.entries.length, 0);
  assert.equal(afterBlock[2]?.confirmedPlatformFeeCents, undefined);
});

test("HandleAsaasWebhookUseCase rejects when ASAAS_WEBHOOK_TOKEN mismatches header", async (t) => {
  const prev = process.env.ASAAS_WEBHOOK_TOKEN;
  t.after(() => {
    if (prev === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = prev;
  });

  process.env.ASAAS_WEBHOOK_TOKEN = "webhook-shared-secret-fixed";

  const checkoutPayment = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(new InMemoryPaymentRepository(), checkoutPayment);
  const uc = new HandleAsaasWebhookUseCase(new InMemoryPaymentRepository(), dispatch);
  await assert.rejects(
    () => uc.execute("wrong", { id: "evt_x", event: "PAYMENT_CREATED" }, "webhook-shared-secret-fixed"),
    UnauthorizedWebhookError
  );
});
