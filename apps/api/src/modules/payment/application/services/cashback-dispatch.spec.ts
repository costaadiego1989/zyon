import { test } from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../../infrastructure/in-memory-payment.repository.js";
import { PaymentDispatchService } from "./payment-dispatch.service.js";

async function fixture() {
  const payments = new InMemoryPaymentRepository(); const compensations: any[] = [];
  const intent = PaymentIntentEntity.create({ merchantId: "m", sessionId: "s", idempotencyKey: "cashback", currency: "BRL", method: "pix", amountCents: 8099,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0, cashbackCents: 2000,
      cashbackReservationId: "r", cashbackEarningQuoteId: "q", shippingCents: 0, platformFeeCents: 99, totalCents: 8099 } });
  intent.markRequiresAction({ providerPaymentId: "provider" }); intent.markApproved({ providerPaymentId: "provider", approvedAmountCents: 8099 });
  await payments.saveIntent({ intent });
  let fail = false;
  const dispatch = new PaymentDispatchService(payments, { recordPaymentStatusChanged: async () => undefined } as any,
    undefined, undefined, undefined, undefined, { confirmedExternalRefund: async (input: any) => {
      assert.ok(["refunded", "chargeback_lost"].includes((await payments.getIntentById("m", intent.id))!.status));
      if (fail) throw new Error("database_temporarily_unavailable"); compensations.push(input);
    } } as any);
  return { payments, intent, dispatch, compensations, failOnce: () => { fail = true; }, recover: () => { fail = false; } };
}

test("CB-23 persisted full provider refund reaches cashback compensation and retries after a local failure", async () => {
  const f = await fixture(); f.failOnce();
  await assert.rejects(f.dispatch.markRefunded(f.intent, "provider_full_refund"), /database_temporarily_unavailable/);
  assert.equal((await f.payments.getIntentById("m", f.intent.id))!.status, "refunded"); assert.deepEqual(f.compensations, []);
  f.recover(); await f.dispatch.markRefunded(f.intent, "provider_full_refund");
  assert.deepEqual(f.compensations, [{ merchantId: "m", paymentIntentId: f.intent.id }]);
});

test("CB-11 only a terminal lost chargeback authorizes cashback compensation", async () => {
  const f = await fixture();
  await f.dispatch.syncChargebackStatus(f.intent, "pending", "dispute_opened");
  await f.dispatch.syncChargebackStatus(f.intent, "disputed", "evidence_submitted");
  assert.deepEqual(f.compensations, []);
  await f.dispatch.syncChargebackStatus(f.intent, "lost", "provider_final_loss");
  assert.equal((await f.payments.getIntentById("m", f.intent.id))!.status, "chargeback_lost");
  assert.deepEqual(f.compensations, [{ merchantId: "m", paymentIntentId: f.intent.id }]);
});
