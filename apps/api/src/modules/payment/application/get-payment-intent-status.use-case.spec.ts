import test from "node:test";
import assert from "node:assert/strict";
import { GetPaymentIntentStatusUseCase } from "./get-payment-intent-status.use-case.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";

function intent(overrides: Partial<PaymentIntentSnapshot> = {}): PaymentIntentEntity {
  return PaymentIntentEntity.rehydrate({
    id: "pay_int_1",
    merchantId: "mrc_1",
    sessionId: "sess_1",
    idempotencyKey: "idem_1",
    amountCents: 15000,
    currency: "BRL",
    method: "pix",
    status: "pending",
    statusHistory: [{ status: "pending", occurredAt: new Date().toISOString() }],
    ...overrides
  });
}

test("GetPaymentIntentStatusUseCase returns persisted status for the owning tenant/session", async () => {
  const repo = new InMemoryPaymentRepository();
  await repo.saveIntent({
    intent: intent({
      status: "approved",
      approvedAmountCents: 15000,
      providerPaymentId: "pay_asaas_99",
      commerceOrderId: "ord_777",
      buyerFacing: { invoiceUrl: "https://pay.example/receipt/777" }
    })
  });
  const useCase = new GetPaymentIntentStatusUseCase(repo);

  const result = await useCase.execute({ merchant_id: "mrc_1", session_id: "sess_1", intent_id: "pay_int_1" });

  assert.equal(result.status, "approved");
  assert.equal(result.approved_amount_cents, 15000);
  assert.equal(result.amount_cents, 15000);
  assert.equal(result.currency, "BRL");
  assert.equal(result.method, "pix");
  assert.equal(result.order_id, "ord_777");
  assert.equal(result.provider_payment_id, "pay_asaas_99");
  assert.equal(result.receipt_url, "https://pay.example/receipt/777");
});

test("GetPaymentIntentStatusUseCase hides intents from another merchant", async () => {
  const repo = new InMemoryPaymentRepository();
  await repo.saveIntent({ intent: intent() });
  const useCase = new GetPaymentIntentStatusUseCase(repo);

  await assert.rejects(
    () => useCase.execute({ merchant_id: "mrc_other", session_id: "sess_1", intent_id: "pay_int_1" }),
    /payment_intent_not_found/
  );
});

test("GetPaymentIntentStatusUseCase hides intents from another session", async () => {
  const repo = new InMemoryPaymentRepository();
  await repo.saveIntent({ intent: intent() });
  const useCase = new GetPaymentIntentStatusUseCase(repo);

  await assert.rejects(
    () => useCase.execute({ merchant_id: "mrc_1", session_id: "sess_other", intent_id: "pay_int_1" }),
    /payment_intent_not_found/
  );
});

test("GetPaymentIntentStatusUseCase rejects missing fields", async () => {
  const repo = new InMemoryPaymentRepository();
  const useCase = new GetPaymentIntentStatusUseCase(repo);

  await assert.rejects(
    () => useCase.execute({ merchant_id: "", session_id: "sess_1", intent_id: "pay_int_1" }),
    /payment_status_fields_required/
  );
});
