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
