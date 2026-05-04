import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { HandleAsaasWebhookUseCase, UnauthorizedWebhookError, assertWebhookToken } from "./handle-asaas-webhook.use-case.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public failures: Array<{ merchantId: string; sessionId: string }> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }

  async recordPaymentFailure(params: { merchantId: string; sessionId: string; reason: string }): Promise<void> {
    void params.reason;
    this.failures.push({ merchantId: params.merchantId, sessionId: params.sessionId });
  }
}

test("assertWebhookToken rejects wrong asaas-access-token", () => {
  assert.throws(() => assertWebhookToken("secret", "wrong"), UnauthorizedWebhookError);
});

test("duplicate provider event id short-circuits", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const uc = new HandleAsaasWebhookUseCase(payments, checkoutPort);
  await payments.recordProcessedProviderEvent("evt_dup_1");

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

  const reload = await payments.getIntentById(ext);
  assert.equal(reload?.snapshot().status, "failed");
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
