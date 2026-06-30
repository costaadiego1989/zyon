import test from "node:test";
import assert from "node:assert/strict";
import type { CommerceOrderPort } from "@zyon/commerce-adapters";
import { PaymentIntentEntity, type PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import { HandleAsaasWebhookUseCase, UnauthorizedWebhookError, assertWebhookToken } from "./handle-asaas-webhook.use-case.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";
import { InMemoryCommercePaidWebhookDedup } from "../../commerce/infrastructure/in-memory-commerce-paid-webhook-dedup.js";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public failures: Array<{ merchantId: string; sessionId: string }> = [];
  public statuses: Array<{ paymentIntentId: string; status: PaymentIntentStatus; reason?: string }> = [];

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
    void params.merchantId;
    void params.sessionId;
    this.statuses.push({
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
  const uc = new HandleAsaasWebhookUseCase(payments, checkoutPort);
  await payments.recordProcessedProviderEvent({ provider: "asaas", merchantId: null, eventId: "evt_dup_1" });

  const r = await uc.execute(undefined, {
    id: "evt_dup_1",
    event: "PAYMENT_RECEIVED",
    payment: {
      id: "pay_1",
      value: 3,
      externalReference: "pay_int_x"
    }
  });
  assert.deepEqual(r, { outcome: "duplicate" });
});

test("PAYMENT_RECEIVED approves intent and completes checkout once", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const uc = new HandleAsaasWebhookUseCase(payments, checkoutPort);

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

  const first = await uc.execute(undefined, {
    id: "evt_1",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  });
  const second = await uc.execute(undefined, {
    id: "evt_2",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  });

  assert.equal(first.outcome, "processed");
  assert.equal(second.outcome, "processed");
  if (second.outcome === "processed") assert.equal(second.effect, "already_approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(checkoutPort.approved[0]?.externalOrderId, "pay_asaas_1");
  assert.equal(checkoutPort.approved[0]?.orderTotalMajorUnits, 300);
  assert.equal(checkoutPort.approved[0]?.acceptedOfferId, "off_a");
  assert.ok(checkoutPort.statuses.some((entry) => entry.status === "approved"));
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
  const uc = new HandleAsaasWebhookUseCase(payments, checkoutPort, undefined, commercePaid);

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

  const first = await uc.execute(undefined, {
    id: "evt_1",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  });
  const second = await uc.execute(undefined, {
    id: "evt_2",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_asaas_1", value: 300, externalReference: ext }
  });

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
  const uc = new HandleAsaasWebhookUseCase(
    payments,
    checkoutPort,
    undefined,
    commercePaid as unknown as MarkCommerceOrderPaidUseCase
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

  await assert.rejects(() => uc.execute(undefined, webhookBody), /commerce_paid_sync_failed/);

  assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: "mrc_1", eventId: "evt_retry" }), false);
  assert.equal(checkoutPort.approved.length, 1);

  const retried = await uc.execute(undefined, webhookBody);

  assert.equal(retried.outcome, "processed");
  if (retried.outcome === "processed") assert.equal(retried.effect, "already_approved");
  assert.equal(commercePaidCalls, 2);
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId: "mrc_1", eventId: "evt_retry" }), true);
});

test("PAYMENT_DELETED marks failed and records payment_failed event", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const uc = new HandleAsaasWebhookUseCase(payments, checkoutPort);

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

  const r = await uc.execute(undefined, {
    id: "evt_del_1",
    event: "PAYMENT_DELETED",
    payment: { id: "pay_del", value: 1, externalReference: ext }
  });
  assert.equal(r.outcome, "processed");
  assert.equal(checkoutPort.failures.length, 1);

  const reload = await payments.getIntentById("mrc_1", ext);
  assert.equal(reload?.snapshot().status, "failed");
  assert.ok(reload?.snapshot().statusHistory.some((entry) => entry.status === "failed"));
  assert.ok(checkoutPort.statuses.some((entry) => entry.status === "failed" && entry.reason === "PAYMENT_DELETED"));
});

test("HandleAsaasWebhookUseCase rejects when ASAAS_WEBHOOK_TOKEN mismatches header", async (t) => {
  const prev = process.env.ASAAS_WEBHOOK_TOKEN;
  t.after(() => {
    if (prev === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = prev;
  });

  process.env.ASAAS_WEBHOOK_TOKEN = "webhook-shared-secret-fixed";

  const uc = new HandleAsaasWebhookUseCase(new InMemoryPaymentRepository(), new RecordingCheckoutPayment());
  await assert.rejects(
    () => uc.execute("wrong", { id: "evt_x", event: "PAYMENT_CREATED" }),
    UnauthorizedWebhookError
  );
});
