import { test } from "node:test";
import assert from "node:assert/strict";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { checkoutScopeReader } from "../../checkout/__tests__/checkout-scope-reader.fixture.js";

async function fixture(cashbackCents = 2000, bindFailure = false) {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(checkoutSession({ customer: { email: "buyer@example.test", asaasCustomerId: "cus" },
    cart: { currency: "BRL", total: 100, items: [{ sku: "item", name: "Produto", price: 100, quantity: 1 }] },
    shipping: { customerPrice: 15, realCost: 15, region: "SP" } }));
  const payments = new InMemoryPaymentRepository(checkout);
  const external: any[] = []; const bindings: any[] = [];
  const core = { preparePayment: async () => ({ cashbackCents, reservationId: cashbackCents ? "reservation" : null,
    earningQuoteId: cashbackCents ? "earning" : null }),
    bindPayment: async (...input: any[]) => { if (bindFailure) throw new Error("cashback_payment_binding_failed"); bindings.push(input); } };
  const useCase = new CreatePaymentIntentUseCase(checkout, checkout, payments, {
    createPayment: async (input: any) => { assert.ok(!cashbackCents || bindings.length > 0); external.push(input);
      return { providerPaymentId: "provider", status: "requires_action", buyerFacingPayload: { qrCodeCopyPaste: "fake" } }; },
  } as any, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    checkoutScopeReader(checkout), undefined, undefined, undefined, undefined, core as any);
  const request = { merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "cashback-intent", method: "pix" as const };
  return { useCase, payments, external, request, bindings };
}

test("CB-13 payment intent charges products less cashback plus original freight and separate platform fee", async () => {
  const { useCase, payments, external, request } = await fixture();
  const created = await useCase.execute(request);
  assert.equal(created.amountCents, 9599); assert.equal(external[0].amountCents, 9599);
  const snap = (await payments.getByIdempotency("mrc_1", "chk_1", request.idempotency_key))!.snapshot();
  assert.equal(snap.amountBreakdown?.cashbackCents, 2000); assert.equal(snap.amountBreakdown?.discountCents, 0);
  assert.equal(snap.amountBreakdown?.shippingCents, 1500); assert.equal(snap.amountBreakdown?.platformFeeCents, 99);
  assert.equal(snap.amountBreakdown?.cashbackReservationId, "reservation"); assert.equal(snap.amountBreakdown?.cashbackEarningQuoteId, "earning");
  assert.deepEqual(await useCase.execute(request), created); assert.equal(external.length, 1);
});

test("CB-14 PSP is never called when the persisted payment cannot bind its cashback reservation", async () => {
  const { useCase, payments, external, request } = await fixture(2000, true);
  await assert.rejects(useCase.execute(request), /cashback_payment_binding_failed/);
  assert.equal(external.length, 0);
  const persisted = await payments.getByIdempotency("mrc_1", "chk_1", request.idempotency_key);
  assert.equal(persisted?.snapshot().amountCents, 9599);
  await assert.rejects(useCase.execute(request), /cashback_payment_binding_failed/);
  assert.equal(external.length, 0);
});

test("CB-17 disabled cashback preserves the original payment intent and omits optional cashback snapshot fields", async () => {
  const { useCase, payments, external, request, bindings } = await fixture(0);
  const created = await useCase.execute(request); assert.equal(created.amountCents, 11599);
  const snap = (await payments.getByIdempotency("mrc_1", "chk_1", request.idempotency_key))!.snapshot();
  assert.equal("cashbackCents" in snap.amountBreakdown!, false); assert.equal(bindings.length, 0);
  assert.equal(external.length, 1);
});
