import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { ReconcilePaymentIntentsUseCase } from "./reconcile-payment-intents.use-case.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import type {
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

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
    this.statuses.push({ paymentIntentId: params.paymentIntentId, status: params.status, reason: params.reason });
  }
}

function makeProvider(responses: Map<string, FetchPaymentStatusOutput>): PaymentProviderPort {
  return {
    async createPayment() {
      throw new Error("not_expected");
    },
    async fetchPaymentStatus(input) {
      const resp = responses.get(input.providerPaymentId);
      return resp ?? { state: "unknown" };
    }
  };
}

function makeProviderWithout(): PaymentProviderPort {
  return {
    async createPayment() {
      throw new Error("not_expected");
    }
    // No fetchPaymentStatus — should short-circuit
  };
}

test("Reconcile: short-circuits when provider lacks fetchPaymentStatus", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const provider = makeProviderWithout();
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const result = await uc.execute();
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.reconciled, []);
});

test("Reconcile: skips intents without providerPaymentId", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const provider = makeProvider(new Map());
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik_1",
    amountCents: 1000,
    currency: "BRL",
    method: "pix"
  });
  // No markRequiresAction — stays pending without providerPaymentId
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.reconciled[0]?.outcome, "skipped");
});

test("Reconcile: approves intent when provider says approved", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  responses.set("asaas_pay_1", { state: "approved", approvedAmountCents: 2500 });
  const provider = makeProvider(responses);
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik_reconcile_ok",
    amountCents: 2500,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "asaas_pay_1" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.reconciled[0]?.outcome, "approved");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.ok(checkoutPort.statuses.some(s => s.status === "approved" && s.reason === "reconciliation"));
});

test("Reconcile: marks failed when provider says failed", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  responses.set("asaas_pay_2", { state: "failed" });
  const provider = makeProvider(responses);
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_2",
    idempotencyKey: "ik_reconcile_fail",
    amountCents: 3000,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "asaas_pay_2" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.reconciled[0]?.outcome, "failed");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "failed");
  assert.equal(checkoutPort.failures.length, 1);
  assert.ok(checkoutPort.statuses.some(s => s.status === "failed"));
});

test("Reconcile: returns still_pending when provider says pending", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  responses.set("asaas_pay_3", { state: "pending" });
  const provider = makeProvider(responses);
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_3",
    idempotencyKey: "ik_reconcile_pending",
    amountCents: 1500,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "asaas_pay_3" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.reconciled[0]?.outcome, "still_pending");

  // Intent should remain unchanged
  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "requires_action");
  assert.equal(checkoutPort.approved.length, 0);
  assert.equal(checkoutPort.failures.length, 0);
});

test("Reconcile: returns unknown when provider returns unknown state", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  responses.set("asaas_pay_4", { state: "unknown" });
  const provider = makeProvider(responses);
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_4",
    idempotencyKey: "ik_reconcile_unk",
    amountCents: 2000,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "asaas_pay_4" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.reconciled[0]?.outcome, "unknown");
});

test("Reconcile: value mismatch on approval triggers fail", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  // Provider reports approved with different amount
  responses.set("asaas_pay_5", { state: "approved", approvedAmountCents: 9999 });
  const provider = makeProvider(responses);
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_5",
    idempotencyKey: "ik_reconcile_mismatch",
    amountCents: 2500,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "asaas_pay_5" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.reconciled[0]?.outcome, "failed");

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "failed");
  assert.ok(checkoutPort.statuses.some(s => s.reason === "reconcile_value_mismatch"));
});

test("Reconcile: respects limit parameter", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  responses.set("p1", { state: "pending" });
  responses.set("p2", { state: "pending" });
  responses.set("p3", { state: "pending" });
  const provider = makeProvider(responses);
  const uc = new ReconcilePaymentIntentsUseCase(payments, provider, checkoutPort);

  for (let i = 1; i <= 3; i++) {
    const intent = PaymentIntentEntity.create({
      merchantId: "mrc_1",
      sessionId: `chk_${i}`,
      idempotencyKey: `ik_limit_${i}`,
      amountCents: 1000,
      currency: "BRL",
      method: "pix"
    });
    intent.markRequiresAction({ providerPaymentId: `p${i}` });
    await payments.saveIntent({ intent });
  }

  const result = await uc.execute({ staleAfterMs: 0, limit: 2 });
  assert.equal(result.scanned, 2);
  assert.equal(result.reconciled.length, 2);
});

test("Reconcile: marks linked commerce order paid on approval", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const responses = new Map<string, FetchPaymentStatusOutput>();
  responses.set("asaas_pay_commerce", { state: "approved", approvedAmountCents: 5000 });
  const provider = makeProvider(responses);

  let commercePaidCalled = false;
  const markCommerceOrderPaid = {
    async execute(input: { merchantId: string; commerceOrderId: string; paymentReference: string }) {
      commercePaidCalled = true;
      assert.equal(input.merchantId, "mrc_1");
      assert.equal(input.commerceOrderId, "order_123");
      assert.equal(input.paymentReference, "asaas_pay_commerce");
      return { invokedCommerceSync: true };
    }
  };

  const uc = new ReconcilePaymentIntentsUseCase(
    payments,
    provider,
    checkoutPort,
    undefined,
    markCommerceOrderPaid as any
  );

  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_commerce",
    idempotencyKey: "ik_commerce_reconcile",
    amountCents: 5000,
    currency: "BRL",
    method: "pix",
    commerceOrderId: "order_123"
  });
  intent.markRequiresAction({ providerPaymentId: "asaas_pay_commerce" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ staleAfterMs: 0 });
  assert.equal(result.reconciled[0]?.outcome, "approved");
  assert.equal(commercePaidCalled, true);
});
