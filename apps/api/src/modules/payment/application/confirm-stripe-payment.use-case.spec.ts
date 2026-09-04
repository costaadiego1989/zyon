import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { ConfirmStripePaymentUseCase } from "./confirm-stripe-payment.use-case.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public statuses: Array<{ paymentIntentId: string; status: PaymentIntentStatus }> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }
  async recordPaymentFailure(): Promise<void> {}
  async recordPaymentStatusChanged(params: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
  }): Promise<void> {
    this.statuses.push({ paymentIntentId: params.paymentIntentId, status: params.status });
  }
}

/**
 * Creates a ConfirmStripePaymentUseCase with a stubbed Stripe client.
 * The stub returns a controlled PaymentIntent instead of calling the real API.
 */
function createTestUseCase(stripeStatus: string = "succeeded", amountReceived: number = 5000) {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const outbox = { appendOutbox: async () => {} };

  const uc = Object.create(ConfirmStripePaymentUseCase.prototype) as ConfirmStripePaymentUseCase;
  const fakeStripe = {
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        status: stripeStatus,
        amount_received: amountReceived
      })
    }
  };
  Object.assign(uc, {
    payments,
    checkoutPayment: checkoutPort,
    outbox,
    stripe: fakeStripe,
    markCommerceOrderPaid: undefined
  });
  return { payments, checkoutPort, uc };
}

test("ConfirmStripePayment: rejects when fields are empty", async () => {
  const { uc } = createTestUseCase();
  await assert.rejects(
    () => uc.execute({ merchant_id: "", session_id: "s", intent_id: "i" }),
    (e: unknown) => e instanceof BadRequestException
  );
  await assert.rejects(
    () => uc.execute({ merchant_id: "m", session_id: "", intent_id: "i" }),
    (e: unknown) => e instanceof BadRequestException
  );
  await assert.rejects(
    () => uc.execute({ merchant_id: "m", session_id: "s", intent_id: "" }),
    (e: unknown) => e instanceof BadRequestException
  );
});

test("ConfirmStripePayment: throws NotFoundException when intent does not exist", async () => {
  const { uc } = createTestUseCase();
  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: "pay_int_missing" }),
    (e: unknown) => e instanceof NotFoundException
  );
});

test("ConfirmStripePayment: enforces merchant boundary (cross-tenant)", async () => {
  const { payments, uc } = createTestUseCase();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_owner",
    sessionId: "chk_1",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_1" });
  await payments.saveIntent({ intent });

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_attacker", session_id: "chk_1", intent_id: intent.id }),
    (e: unknown) => e instanceof NotFoundException
  );
});

test("ConfirmStripePayment: enforces session boundary", async () => {
  const { payments, uc } = createTestUseCase();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_owner",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_1" });
  await payments.saveIntent({ intent });

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_other", intent_id: intent.id }),
    (e: unknown) => e instanceof NotFoundException
  );
});

test("ConfirmStripePayment: rejects non-card method", async () => {
  const { payments, uc } = createTestUseCase();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_1" });
  await payments.saveIntent({ intent });

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id }),
    (e: unknown) => e instanceof BadRequestException && e.message.includes("payment_intent_not_card")
  );
});

test("ConfirmStripePayment: returns early if already approved (idempotent)", async () => {
  const { payments, uc } = createTestUseCase();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_1" });
  intent.markApproved({ providerPaymentId: "pi_1", approvedAmountCents: 5000 });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id });
  assert.equal(result.status, "approved");
});

test("ConfirmStripePayment: rejects when intent is not confirmable (pending status)", async () => {
  const { payments, uc } = createTestUseCase();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "card"
  });
  // stays pending — not requires_action
  await payments.saveIntent({ intent });

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id }),
    (e: unknown) => e instanceof BadRequestException && e.message.includes("payment_intent_not_confirmable")
  );
});

test("ConfirmStripePayment: rejects when Stripe payment has not succeeded", async () => {
  const { payments, uc } = createTestUseCase("requires_payment_method");
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "card"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_1" });
  await payments.saveIntent({ intent });

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id }),
    (e: unknown) => e instanceof BadRequestException && e.message.includes("stripe_payment_not_succeeded")
  );
});

test("ConfirmStripePayment: happy path approves and triggers checkout completion", async () => {
  const { payments, checkoutPort, uc } = createTestUseCase("succeeded", 5000);
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik",
    amountCents: 5000,
    currency: "BRL",
    method: "card",
    acceptedOfferId: "off_1"
  });
  intent.markRequiresAction({ providerPaymentId: "pi_confirmed" });
  await payments.saveIntent({ intent });

  const result = await uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id });
  assert.equal(result.status, "approved");
  assert.equal(result.intent_id, intent.id);

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "approved");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(checkoutPort.approved[0]?.orderTotalMajorUnits, 48.01);
  assert.equal(checkoutPort.approved[0]?.acceptedOfferId, "off_1");
  assert.ok(checkoutPort.statuses.some(s => s.status === "approved"));
});
