import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../infrastructure/fake-payment-provider.js";
import type { SavePaymentIntentWithSettlementPlanInput } from "../domain/ports/payment-repository.port.js";
import { parseStorefrontCouponPaymentScope } from "../domain/storefront-coupon-payment-scope.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";

const scope = () => ({ merchantId: "mrc_1", checkoutSessionId: "chk_1", cartId: "cart_1", buyerId: "usr_1" });
const request = () => ({ merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "key", method: "pix" as const });
class CapturingPayments extends InMemoryPaymentRepository {
  readonly admissions: Array<SavePaymentIntentWithSettlementPlanInput["storefrontCouponScope"]> = [];
  async saveIntentWithSettlementPlan(input: SavePaymentIntentWithSettlementPlanInput) {
    this.admissions.push(structuredClone(input.storefrontCouponScope));
    return super.saveIntentWithSettlementPlan(input);
  }
}
async function fixture() {
  const checkout = new InMemoryCheckoutRepository(), payments = new CapturingPayments();
  await checkout.saveSession(checkoutSession({
    cart: { source: "storefront", cart_ref: "cart_1", currency: "BRL", total: 10, currentDiscount: 1,
      items: [{ sku: "external_service", name: "Synthetic service", productType: "service", price: 10, quantity: 1 }] },
    customer: { email: "buyer@example.test", email_verified: true, asaasCustomerId: "cus_synthetic" }, shipping: undefined,
  }));
  const sent: unknown[] = [], fake = new FakePaymentProvider();
  const provider = { async createPayment(input: Parameters<FakePaymentProvider["createPayment"]>[0]) {
    sent.push(structuredClone(input)); return fake.createPayment(input);
  } };
  const prisma = { checkoutSession: { async findUnique() { return checkout.getSession("mrc_1", "chk_1"); } },
    crossStoreLineItem: { async findFirst() { return null; } }, productVariant: { async findMany() { return []; } } };
  const useCase = new CreatePaymentIntentUseCase(checkout, checkout, payments, provider,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, prisma as unknown as PrismaClient);
  return { checkout, payments, sent, useCase };
}

test("private context reaches admission only, never provider input or public response", async () => {
  const f = await fixture(), trusted = scope();
  const result = await f.useCase.execute(request(), { marketplaceSurface: "embed", storefrontCouponScope: trusted });
  assert.deepEqual(f.payments.admissions, [trusted]);
  assert.equal(f.sent.length, 1);
  for (const value of [f.sent[0], result]) for (const field of ["storefrontCouponScope", "couponAuthority", "creation"])
    assert.equal(Object.hasOwn(value as object, field), false);
});

test("private scope is detached before an awaited checkout lookup", async () => {
  const f = await fixture(), trusted = scope();
  const original = f.checkout.getSession.bind(f.checkout);
  let resume!: () => void, entered!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const checkoutPort: CheckoutSessionRepository = f.checkout;
  checkoutPort.getSession = async (...args) => {
    if (++calls === 1) { entered(); await waiting; }
    return original(...args);
  };
  const pending = f.useCase.execute(request(), { marketplaceSurface: "embed", storefrontCouponScope: trusted });
  await started; trusted.buyerId = "changed_after_await"; resume();
  await pending;
  assert.deepEqual(f.payments.admissions, [scope()]);
});

for (const field of ["merchantId", "checkoutSessionId", "cartId", "buyerId"] as const) {
  test(`private scope mismatch ${field} never admits or calls provider`, async () => {
    const f = await fixture();
    await assert.rejects(f.useCase.execute(request(), { marketplaceSurface: "embed",
      storefrontCouponScope: { ...scope(), [field]: "foreign" } }), /payment_coupon_authority_conflict/);
    assert.equal(f.payments.admissions.length, 0); assert.equal(f.sent.length, 0);
  });
}

test("private admission scope is strict and never inferred from a V1 surface", async () => {
  for (const bad of [null, { ...scope(), extra: true }, { ...scope(), buyerId: " " }, { ...scope(), cartId: " cart_1" }])
    assert.throws(() => parseStorefrontCouponPaymentScope(bad), /payment_coupon_authority_conflict/);
  const f = await fixture();
  await assert.rejects(f.useCase.execute(request(), { marketplaceSurface: "v1", storefrontCouponScope: scope() }), /payment_coupon_authority_conflict/);
  assert.equal(f.sent.length, 0);
});
