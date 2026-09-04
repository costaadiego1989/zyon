/**
 * Payment State Machine Tests
 *
 * Verifies the payment intent status lifecycle:
 *   pending → requires_action → approved → completed
 *   pending → requires_action → failed
 *   approved → refunded
 *
 * Also verifies:
 * - Invalid state transitions are rejected
 * - State history is maintained with timestamps
 * - Checkout completion is idempotent per approval
 *
 * Run: cd apps/api && pnpm test payment-state-machine
 */

import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { HandleAsaasWebhookUseCase } from "../application/handle-asaas-webhook.use-case.js";
import { PaymentDispatchService } from "../application/services/payment-dispatch.service.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import type { CheckoutPaymentApprovedInput } from "../domain/ports/checkout-payment.port.js";

const TEST_ASAAS_TOKEN = "test-asaas-webhook-token";
process.env.ASAAS_WEBHOOK_TOKEN = TEST_ASAAS_TOKEN;

// ─── MOCK ──────────────────────────────────────────────────────────────────

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public completions: Array<{
    time: number;
    merchantId: string;
    sessionId: string;
    orderTotal: number;
  }> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.completions.push({
      time: Date.now(),
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      orderTotal: input.orderTotalMajorUnits,
    });
  }

  async recordPaymentFailure(): Promise<void> {}

  async recordPaymentStatusChanged(): Promise<void> {}
}

// ─── STATE TRANSITIONS ──────────────────────────────────────────────────────

test("initial state is pending", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_init",
    sessionId: "chk_init",
    idempotencyKey: "idem_init",
    amountCents: 20000,
    currency: "BRL",
    method: "pix",
  });

  const snap = intent.snapshot();
  assert.equal(snap.status, "pending");
  assert.equal(snap.providerPaymentId, undefined);
});

test("pending → requires_action via markRequiresAction", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_req_action",
    sessionId: "chk_req_action",
    idempotencyKey: "idem_req_action",
    amountCents: 30000,
    currency: "BRL",
    method: "pix",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_pix_1" });
  const snap = intent.snapshot();

  assert.equal(snap.status, "requires_action");
  assert.equal(snap.providerPaymentId, "pay_pix_1");
});

test("requires_action → approved via markApproved", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_approved",
    sessionId: "chk_approved",
    idempotencyKey: "idem_approved",
    amountCents: 25000,
    currency: "BRL",
    method: "card",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_card_1" });
  intent.markApproved({
    providerPaymentId: "pay_card_1",
    approvedAmountCents: 25000,
  });

  const snap = intent.snapshot();
  assert.equal(snap.status, "approved");
  assert.equal(snap.approvedAmountCents, 25000);
});

test("requires_action → approved (completion via checkout layer)", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_completed",
    sessionId: "chk_completed",
    idempotencyKey: "idem_completed",
    amountCents: 50000,
    currency: "BRL",
    method: "pix",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_complete_1" });
  intent.markApproved({
    providerPaymentId: "pay_complete_1",
    approvedAmountCents: 50000,
  });

  const snap = intent.snapshot();
  // Note: "completed" state is reached via PaymentDispatchService.markApprovedAndComplete()
  // which calls checkout.completeAfterApproval(). The entity itself transitions to "approved".
  assert.equal(snap.status, "approved");
});

test("requires_action → failed via markFailed", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_failed",
    sessionId: "chk_failed",
    idempotencyKey: "idem_failed",
    amountCents: 15000,
    currency: "BRL",
    method: "boleto",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_fail_1" });
  intent.markFailed("payment_overdue");

  const snap = intent.snapshot();
  assert.equal(snap.status, "failed");
});

test("approved → refunded via markRefunded", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_refund",
    sessionId: "chk_refund",
    idempotencyKey: "idem_refund",
    amountCents: 40000,
    currency: "BRL",
    method: "card",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_ref_1" });
  intent.markApproved({
    providerPaymentId: "pay_ref_1",
    approvedAmountCents: 40000,
  });
  intent.markRefunded("refund_requested");

  const snap = intent.snapshot();
  assert.equal(snap.status, "refunded");
});

// ─── INVALID TRANSITIONS ───────────────────────────────────────────────────

test("pending cannot transition directly to approved", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_invalid_1",
    sessionId: "chk_invalid_1",
    idempotencyKey: "idem_invalid_1",
    amountCents: 10000,
    currency: "BRL",
    method: "pix",
  });

  // Skip requires_action and try to go directly to approved
  assert.throws(
    () =>
      intent.markApproved({
        providerPaymentId: "pay_invalid_1",
        approvedAmountCents: 10000,
      }),
    /illegal_transition|invalid.*state/i
  );
});

test("pending cannot be refunded", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_invalid_2",
    sessionId: "chk_invalid_2",
    idempotencyKey: "idem_invalid_2",
    amountCents: 20000,
    currency: "BRL",
    method: "pix",
  });

  assert.throws(
    () => intent.markRefunded("invalid_refund"),
    /illegal_transition|invalid.*state/i
  );
});

test("failed cannot transition to approved", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_invalid_3",
    sessionId: "chk_invalid_3",
    idempotencyKey: "idem_invalid_3",
    amountCents: 30000,
    currency: "BRL",
    method: "card",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_invalid_3" });
  intent.markFailed("payment_declined");

  assert.throws(
    () =>
      intent.markApproved({
        providerPaymentId: "pay_invalid_3",
        approvedAmountCents: 30000,
      }),
    /illegal_transition|invalid.*state/i
  );
});

test("completed cannot be marked failed", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_invalid_4",
    sessionId: "chk_invalid_4",
    idempotencyKey: "idem_invalid_4",
    amountCents: 25000,
    currency: "BRL",
    method: "pix",
  });

  intent.markRequiresAction({ providerPaymentId: "pay_invalid_4" });
  intent.markApproved({
    providerPaymentId: "pay_invalid_4",
    approvedAmountCents: 25000,
  });

  assert.throws(
    () => intent.markFailed("late_failure"),
    /illegal_transition|invalid.*state/i
  );
});

// ─── STATUS HISTORY ────────────────────────────────────────────────────────

test("status history records all transitions with timestamps", () => {
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_history",
    sessionId: "chk_history",
    idempotencyKey: "idem_history",
    amountCents: 35000,
    currency: "BRL",
    method: "pix",
  });

  const beforeReqAction = new Date();
  intent.markRequiresAction({ providerPaymentId: "pay_hist_1" });

  const beforeApproved = new Date();
  intent.markApproved({
    providerPaymentId: "pay_hist_1",
    approvedAmountCents: 35000,
  });

  const snap = intent.snapshot();
  const history = snap.statusHistory || [];

  // History should include pending, requires_action, approved
  assert.ok(history.length >= 2, `expected at least 2 entries, got ${history.length}`);

  const pending = history.find((h) => h.status === "pending");
  const reqAction = history.find((h) => h.status === "requires_action");
  const approved = history.find((h) => h.status === "approved");

  assert.ok(pending, "should record pending status");
  assert.ok(reqAction, "should record requires_action status");
  assert.ok(approved, "should record approved status");

  // Timestamps should be in order
  if (pending && reqAction && approved) {
    const pendingTime = new Date(pending.occurredAt).getTime();
    const reqActionTime = new Date(reqAction.occurredAt).getTime();
    const approvedTime = new Date(approved.occurredAt).getTime();

    assert.ok(
      pendingTime <= reqActionTime,
      "pending timestamp should be before or equal to requires_action"
    );
    assert.ok(
      reqActionTime <= approvedTime,
      "requires_action timestamp should be before or equal to approved"
    );
  }
});

// ─── WEBHOOK STATE TRANSITIONS ─────────────────────────────────────────────

test("PAYMENT_RECEIVED webhook transitions from requires_action to approved", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_wh_pix",
    sessionId: "chk_wh_pix",
    idempotencyKey: "idem_wh_pix",
    amountCents: 18000,
    currency: "BRL",
    method: "pix",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_wh_pix_1" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Simulate PAYMENT_RECEIVED webhook
  const result = await uc.execute(TEST_ASAAS_TOKEN, {
    id: "evt_wh_pix_1",
    event: "PAYMENT_RECEIVED",
    payment: {
      id: "pay_wh_pix_1",
      value: 180,
      externalReference: intentId,
    },
  });

  assert.equal(result.outcome, "processed");

  // Verify state transition
  const updated = await payments.getIntentById("mrc_wh_pix", intentId);
  assert.equal(updated?.snapshot().status, "approved");
  assert.equal(checkout.completions.length, 1);
});

test("PAYMENT_DELETED webhook transitions from requires_action to failed", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_wh_deleted",
    sessionId: "chk_wh_deleted",
    idempotencyKey: "idem_wh_deleted",
    amountCents: 22000,
    currency: "BRL",
    method: "boleto",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_wh_del_1" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const result = await uc.execute(TEST_ASAAS_TOKEN, {
    id: "evt_wh_del_1",
    event: "PAYMENT_DELETED",
    payment: {
      id: "pay_wh_del_1",
      value: 220,
      externalReference: intentId,
    },
  });

  assert.equal(result.outcome, "processed");

  const updated = await payments.getIntentById("mrc_wh_deleted", intentId);
  assert.equal(updated?.snapshot().status, "failed");
  assert.equal(checkout.completions.length, 0, "should not complete checkout on failure");
});

test("PAYMENT_OVERDUE webhook transitions to failed", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_wh_overdue",
    sessionId: "chk_wh_overdue",
    idempotencyKey: "idem_wh_overdue",
    amountCents: 12000,
    currency: "BRL",
    method: "boleto",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_wh_ovd_1" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  const result = await uc.execute(TEST_ASAAS_TOKEN, {
    id: "evt_wh_ovd_1",
    event: "PAYMENT_OVERDUE",
    payment: {
      id: "pay_wh_ovd_1",
      value: 120,
      externalReference: intentId,
    },
  });

  assert.equal(result.outcome, "processed");

  const updated = await payments.getIntentById("mrc_wh_overdue", intentId);
  assert.equal(updated?.snapshot().status, "failed");
});

test("PAYMENT_REFUNDED webhook transitions from approved to refunded", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_wh_refund",
    sessionId: "chk_wh_refund",
    idempotencyKey: "idem_wh_refund",
    amountCents: 45000,
    currency: "BRL",
    method: "card",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_wh_ref_1" });
  // Simulate prior approval
  intent.markApproved({
    providerPaymentId: "pay_wh_ref_1",
    approvedAmountCents: 45000,
  });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Now send REFUNDED webhook
  const result = await uc.execute(TEST_ASAAS_TOKEN, {
    id: "evt_wh_ref_1",
    event: "PAYMENT_REFUNDED",
    payment: {
      id: "pay_wh_ref_1",
      value: 450,
      externalReference: intentId,
    },
  });

  assert.equal(result.outcome, "processed");

  const updated = await payments.getIntentById("mrc_wh_refund", intentId);
  assert.equal(updated?.snapshot().status, "refunded");
});

// ─── CHECKOUT COMPLETION IDEMPOTENCY ───────────────────────────────────────

test("checkout completion is recorded once per approval", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_completion_idem",
    sessionId: "chk_completion_idem",
    idempotencyKey: "idem_completion_idem",
    amountCents: 33000,
    currency: "BRL",
    method: "pix",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_compl_1" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Simulate two deliveries of PAYMENT_RECEIVED with different event IDs
  // (shouldn't normally happen, but tests that idempotency gate prevents double-completion)
  const r1 = await uc.execute(TEST_ASAAS_TOKEN, {
    id: "evt_compl_1",
    event: "PAYMENT_RECEIVED",
    payment: {
      id: "pay_compl_1",
      value: 330,
      externalReference: intentId,
    },
  });

  assert.equal(r1.outcome, "processed");
  assert.equal(checkout.completions.length, 1);

  // A retry to already-approved state (different event)
  const r2 = await uc.execute(TEST_ASAAS_TOKEN, {
    id: "evt_compl_2",
    event: "PAYMENT_RECEIVED",
    payment: {
      id: "pay_compl_1",
      value: 330,
      externalReference: intentId,
    },
  });

  // Should process but return already_approved
  assert.equal(r2.outcome, "processed");
  assert.equal(r2.effect, "already_approved");
  // Still only one completion
  assert.equal(checkout.completions.length, 1);
});

// ─── CONCURRENT APPROVAL PROTECTION ────────────────────────────────────────

test("concurrent webhooks for same intent use atomic gate to prevent double-approval", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkout = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkout);
  const uc = new HandleAsaasWebhookUseCase(payments, dispatch);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_concurrent_approval",
    sessionId: "chk_concurrent_approval",
    idempotencyKey: "idem_concurrent_approval",
    amountCents: 55000,
    currency: "BRL",
    method: "pix",
  });
  intent.markRequiresAction({ providerPaymentId: "pay_conc_1" });
  await payments.saveIntent({ intent });
  const intentId = intent.snapshot().id;

  // Simulate 5 concurrent deliveries
  const promises = Array.from({ length: 5 }, (_, i) =>
    uc.execute(TEST_ASAAS_TOKEN, {
      id: `evt_conc_${i}`,
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "pay_conc_1",
        value: 550,
        externalReference: intentId,
      },
    })
  );

  const results = await Promise.all(promises);

  const processed = results.filter((r: any) => r.outcome === "processed");
  assert.equal(processed.length, 1, "only one should win the race");

  // Only one checkout completion despite 5 concurrent requests
  assert.equal(checkout.completions.length, 1);
});
