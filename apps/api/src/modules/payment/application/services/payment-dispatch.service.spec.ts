import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../../domain/payment-intent.entity.js";
import { PaymentDispatchService } from "./payment-dispatch.service.js";
import { InMemoryPaymentRepository } from "../../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../../domain/ports/checkout-payment.port.js";
import type { PaymentIntentStatus } from "../../domain/payment-intent.entity.js";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public failures: Array<{ merchantId: string; sessionId: string; reason: string }> = [];
  public statuses: Array<{ paymentIntentId: string; status: string; reason?: string }> = [];

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
    this.statuses.push({ paymentIntentId: params.paymentIntentId, status: params.status, reason: params.reason });
  }
}

function createPendingIntent(overrides?: Partial<{ merchantId: string; amountCents: number; method: string; commerceOrderId: string; acceptedOfferId: string }>) {
  const intent = PaymentIntentEntity.create({
    merchantId: overrides?.merchantId ?? "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: `ik_${Math.random().toString(36).slice(2)}`,
    amountCents: overrides?.amountCents ?? 5000,
    currency: "BRL",
    method: (overrides?.method ?? "pix") as any,
    commerceOrderId: overrides?.commerceOrderId,
    acceptedOfferId: overrides?.acceptedOfferId
  });
  intent.markRequiresAction({ providerPaymentId: "provider_1" });
  return intent;
}

test("PaymentDispatch.markApprovedAndComplete: approves and emits checkout completion", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent({ acceptedOfferId: "off_1" });
  await payments.saveIntent({ intent });

  const result = await dispatch.markApprovedAndComplete(intent, "provider_1");

  assert.equal(result, "checkout_completed_after_payment");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(checkoutPort.approved[0]?.externalOrderId, "provider_1");
  assert.equal(checkoutPort.approved[0]?.acceptedOfferId, "off_1");
  assert.ok(checkoutPort.statuses.some(s => s.status === "approved"));
});

test("PaymentDispatch.markApprovedAndComplete: already approved returns early", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent();
  intent.markApproved({ providerPaymentId: "provider_1", approvedAmountCents: 5000 });
  await payments.saveIntent({ intent });

  const result = await dispatch.markApprovedAndComplete(intent, "provider_1");

  assert.equal(result, "already_approved");
  assert.equal(checkoutPort.approved.length, 0);
});

test("PaymentDispatch.markApprovedAndComplete: syncs linked commerce order", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  let markPaidCalled = false;
  const markCommerceOrderPaid = {
    async execute(input: { merchantId: string; commerceOrderId: string; paymentReference: string }) {
      markPaidCalled = true;
      assert.equal(input.commerceOrderId, "order_abc");
      return { invokedCommerceSync: true };
    }
  };
  const dispatch = new PaymentDispatchService(
    payments,
    checkoutPort,
    undefined,
    markCommerceOrderPaid as any
  );

  const intent = createPendingIntent({ commerceOrderId: "order_abc" });
  await payments.saveIntent({ intent });

  const result = await dispatch.markApprovedAndComplete(intent, "provider_1");

  assert.equal(result, "checkout_completed_after_payment_and_commerce_paid");
  assert.equal(markPaidCalled, true);
});

test("PaymentDispatch.markFailed: marks intent failed and records failure", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent();
  await payments.saveIntent({ intent });

  await dispatch.markFailed(intent, "card_declined");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "failed");
  assert.equal(checkoutPort.failures.length, 1);
  assert.equal(checkoutPort.failures[0]?.reason, "card_declined");
  assert.ok(checkoutPort.statuses.some(s => s.status === "failed" && s.reason === "card_declined"));
});

test("PaymentDispatch.markFailed: no-ops on already terminal status (approved)", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent();
  intent.markApproved({ providerPaymentId: "p1", approvedAmountCents: 5000 });
  await payments.saveIntent({ intent });

  await dispatch.markFailed(intent, "late_failure");

  // Should not change status
  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "approved");
  assert.equal(checkoutPort.failures.length, 0);
});

test("PaymentDispatch.markFailed: no-ops on already failed status", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent();
  intent.markFailed("first_fail");
  await payments.saveIntent({ intent });

  await dispatch.markFailed(intent, "second_fail");

  assert.equal(checkoutPort.failures.length, 0);
});

test("PaymentDispatch.markRefunded: refunds approved intent", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent();
  intent.markApproved({ providerPaymentId: "p1", approvedAmountCents: 5000 });
  await payments.saveIntent({ intent });

  await dispatch.markRefunded(intent, "customer_request");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "refunded");
  assert.ok(checkoutPort.statuses.some(s => s.status === "refunded" && s.reason === "customer_request"));
});

test("PaymentDispatch.markRefunded: no-ops when intent is not approved", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const dispatch = new PaymentDispatchService(payments, checkoutPort);

  const intent = createPendingIntent();
  await payments.saveIntent({ intent });

  await dispatch.markRefunded(intent, "customer_request");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "requires_action");
  assert.equal(checkoutPort.statuses.length, 0);
});
