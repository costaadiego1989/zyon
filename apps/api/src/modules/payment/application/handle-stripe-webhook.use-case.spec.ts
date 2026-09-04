import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { HandleStripeWebhookUseCase } from "./handle-stripe-webhook.use-case.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public failures: Array<{ merchantId: string; sessionId: string; reason: string }> = [];
  public statuses: Array<{ paymentIntentId: string; status: PaymentIntentStatus; reason?: string }> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }

  async recordPaymentFailure(params: { merchantId: string; sessionId: string; reason: string }): Promise<void> {
    this.failures.push(params);
  }

  async recordPaymentStatusChanged(params: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
  }): Promise<void> {
    this.statuses.push({
      paymentIntentId: params.paymentIntentId,
      status: params.status,
      reason: params.reason
    });
  }
}

function makeStripeEvent(overrides: { id?: string; type: string; data: { object: unknown } }): any {
  return {
    id: overrides.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    ...overrides
  };
}

function createTestContext() {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);
  // We test via dispatchEvent which bypasses signature verification
  const uc = Object.create(HandleStripeWebhookUseCase.prototype) as HandleStripeWebhookUseCase;
  // Wire private fields for testing dispatchEvent directly
  Object.assign(uc, { payments, paymentDispatch: dispatch, metrics: undefined, platformEvents: undefined });
  return { payments, checkoutPort, dispatch, uc };
}

test("dispatchEvent: duplicate event id short-circuits", async () => {
  const { payments, uc } = createTestContext();
  await payments.recordProcessedProviderEvent({ provider: "stripe", merchantId: null, eventId: "evt_dup" });

  const event = makeStripeEvent({
    id: "evt_dup",
    type: "payment_intent.succeeded",
    data: { object: { metadata: {} } }
  });

  const result = await uc.dispatchEvent(event);
  assert.deepEqual(result, { outcome: "duplicate" });
});

test("dispatchEvent: payment_intent.succeeded approves intent and completes checkout", async () => {
  const { payments, checkoutPort, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s1",
    idempotencyKey: "idem_s1",
    amountCents: 5000,
    currency: "BRL",
    method: "card",
    acceptedOfferId: "off_x"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_1" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const event = makeStripeEvent({
    id: "evt_succ_1",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_stripe_1",
        amount_received: 5000,
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.match(result.effect, /checkout_completed/);
  }

  const reloaded = await payments.getIntentById("mrc_stripe", intentId);
  assert.equal(reloaded?.snapshot().status, "approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(checkoutPort.approved[0]?.acceptedOfferId, "off_x");
});

test("dispatchEvent: payment_intent.succeeded with value mismatch marks failed", async () => {
  const { payments, checkoutPort, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s2",
    idempotencyKey: "idem_s2",
    amountCents: 5000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_2" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const event = makeStripeEvent({
    id: "evt_mismatch",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_stripe_2",
        amount_received: 9999,
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "stripe_value_mismatch");
  }

  const reloaded = await payments.getIntentById("mrc_stripe", intentId);
  assert.equal(reloaded?.snapshot().status, "failed");
  assert.ok(checkoutPort.failures.length > 0);
});

test("dispatchEvent: payment_intent.succeeded ignores missing metadata", async () => {
  const { uc } = createTestContext();

  const event = makeStripeEvent({
    id: "evt_no_meta",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_x", metadata: {} } }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "ignored_missing_intent_id");
  }
});

test("dispatchEvent: payment_intent.payment_failed marks intent failed", async () => {
  const { payments, checkoutPort, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s3",
    idempotencyKey: "idem_s3",
    amountCents: 3000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_3" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const event = makeStripeEvent({
    id: "evt_fail",
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: "pi_stripe_3",
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" },
        last_payment_error: { message: "card_declined", type: "card_error" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "payment_failed");
  }

  const reloaded = await payments.getIntentById("mrc_stripe", intentId);
  assert.equal(reloaded?.snapshot().status, "failed");
  assert.equal(checkoutPort.failures.length, 1);
  assert.equal(checkoutPort.failures[0]?.reason, "card_declined");
});

test("dispatchEvent: payment_intent.payment_failed skips already terminal", async () => {
  const { payments, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s4",
    idempotencyKey: "idem_s4",
    amountCents: 3000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_4" });
  intent.markApproved({ providerPaymentId: "pi_stripe_4", approvedAmountCents: 3000 });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const event = makeStripeEvent({
    id: "evt_fail_terminal",
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: "pi_stripe_4",
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" },
        last_payment_error: { message: "card_declined", type: "card_error" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "already_terminal");
  }
});

test("dispatchEvent: charge.refunded marks intent refunded", async () => {
  const { payments, checkoutPort, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s5",
    idempotencyKey: "idem_s5",
    amountCents: 8000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_5" });
  intent.markApproved({ providerPaymentId: "pi_stripe_5", approvedAmountCents: 8000 });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const event = makeStripeEvent({
    id: "evt_refund",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_1",
        payment_intent: "pi_stripe_5",
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "payment_refunded");
  }

  const reloaded = await payments.getIntentById("mrc_stripe", intentId);
  assert.equal(reloaded?.snapshot().status, "refunded");
  assert.ok(checkoutPort.statuses.some(s => s.status === "refunded"));
});

test("dispatchEvent: payment_intent.canceled marks cancelled", async () => {
  const { payments, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s6",
    idempotencyKey: "idem_s6",
    amountCents: 1000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_6" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const event = makeStripeEvent({
    id: "evt_cancel",
    type: "payment_intent.canceled",
    data: {
      object: {
        id: "pi_stripe_6",
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "payment_canceled");
  }

  const reloaded = await payments.getIntentById("mrc_stripe", intentId);
  assert.equal(reloaded?.snapshot().status, "cancelled");
});

test("dispatchEvent: unknown event type returns ignored", async () => {
  const { uc } = createTestContext();

  const event = makeStripeEvent({
    id: "evt_unk",
    type: "unknown.type",
    data: { object: { metadata: {} } }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "ignored_event_type");
  }
});

test("dispatchEvent: transient error releases idempotency marker for retry", async () => {
  const { payments, uc } = createTestContext();

  // Create intent that will fail mid-dispatch
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s7",
    idempotencyKey: "idem_s7",
    amountCents: 2000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_7" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Monkey-patch saveIntent to throw on next call to simulate transient failure
  let saveCallCount = 0;
  const originalSave = payments.saveIntent.bind(payments);
  payments.saveIntent = async (input) => {
    saveCallCount++;
    if (saveCallCount === 1) throw new Error("transient_db_error");
    return originalSave(input);
  };

  const event = makeStripeEvent({
    id: "evt_transient",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_stripe_7",
        amount_received: 2000,
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" }
      }
    }
  });

  await assert.rejects(() => uc.dispatchEvent(event), /transient_db_error/);

  // Marker should be released so retry can succeed
  const markerExists = await payments.hasProcessedProviderEvent({
    provider: "stripe",
    merchantId: "mrc_stripe",
    eventId: "evt_transient"
  });
  assert.equal(markerExists, false);
});

test("dispatchEvent: illegal_transition is absorbed and marker kept consumed", async () => {
  const { payments, uc } = createTestContext();

  // Create an already-approved intent that will throw illegal_transition
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_stripe",
    sessionId: "chk_s8",
    idempotencyKey: "idem_s8",
    amountCents: 4000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_stripe_8" });
  intent.markFailed("earlier_failure");
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Attempt payment_intent.succeeded on a failed intent — markApproved will throw illegal_transition
  const event = makeStripeEvent({
    id: "evt_illegal",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_stripe_8",
        amount_received: 4000,
        metadata: { intent_id: intentId, merchant_id: "mrc_stripe" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "ignored");
  if (result.outcome === "ignored") {
    assert.equal(result.reason, "illegal_transition_alerted");
  }

  // Marker stays consumed — no poison re-delivery loop
  const markerExists = await payments.hasProcessedProviderEvent({
    provider: "stripe",
    merchantId: "mrc_stripe",
    eventId: "evt_illegal"
  });
  assert.equal(markerExists, true);
});

test("dispatchEvent: merchant boundary enforced on intent lookup", async () => {
  const { payments, uc } = createTestContext();

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_real",
    sessionId: "chk_x",
    idempotencyKey: "idem_x",
    amountCents: 1000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_cross" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Forge event with wrong merchant_id in metadata
  const event = makeStripeEvent({
    id: "evt_cross_tenant",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_cross",
        amount_received: 1000,
        metadata: { intent_id: intentId, merchant_id: "mrc_attacker" }
      }
    }
  });

  const result = await uc.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  if (result.outcome === "processed") {
    assert.equal(result.effect, "intent_not_found");
  }
});
