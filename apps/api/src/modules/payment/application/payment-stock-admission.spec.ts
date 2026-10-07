import assert from "node:assert/strict";
import { test } from "node:test";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../infrastructure/fake-payment-provider.js";
import { ReconcilePaymentIntentsUseCase } from "./reconcile-payment-intents.use-case.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";

async function fixture(type = "physical", quantities = [1]) {
  const checkout = new InMemoryCheckoutRepository(), payments = new InMemoryPaymentRepository(checkout), provider = new FakePaymentProvider();
  await checkout.saveSession(checkoutSession({ customer: { email: "qa@example.test", asaasCustomerId: "cus_qa" },
    cart: { currency: "BRL", total: quantities.reduce((n, q) => n + 20*q, 0), items: quantities.map(quantity => ({ sku: "native", variantId: "native-variant", name: "QA", price: 20, quantity, productType: type })) } } as never));
  const stock = { quantity: 2, reserved: 0 }, reader = { productVariant: { findMany: async () => [{ id: "native-variant", sku: "native", isActive: true, product: { type, isActive: true, deletedAt: null }, stock: [stock] }] } };
  let creates = 0; const create = provider.createPayment.bind(provider);
  provider.createPayment = async input => { creates++; return create(input); };
  const args: ConstructorParameters<typeof CreatePaymentIntentUseCase> = [checkout, checkout, payments, provider]; args[14] = reader as never;
  const useCase = new CreatePaymentIntentUseCase(...args), request = { merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "native-payment", method: "pix" as const };
  const reconcile = () => new ReconcilePaymentIntentsUseCase(payments, provider, {} as never, undefined, undefined, checkout, reader as never);
  return { checkout, payments, provider, stock, reader, request, useCase, reconcile, creates: () => creates };
}
test("native physical and food quantities use aggregate available stock before any provider POST", async () => {
  for (const type of ["physical", "food"]) { const f = await fixture(type, [2,1]); await assert.rejects(f.useCase.execute(f.request), /cart_insufficient_stock/); assert.equal(f.creates(), 0); }
});
test("native digital and service stock zero remains under their own availability authority", async () => {
  for (const type of ["digital", "service"]) { const f = await fixture(type); f.stock.quantity = 0; assert.equal((await f.useCase.execute(f.request)).status, "requires_action"); assert.equal(f.creates(), 1); }
});
test("stock changing during preparation blocks the first financial POST, retry and worker until restored", async () => {
  const f = await fixture(); (f.provider as any).preparePayment = async (input: any) => { f.stock.quantity = 0; return input; };
  await assert.rejects(f.useCase.execute(f.request), /cart_insufficient_stock/); await assert.rejects(f.useCase.execute(f.request), /cart_insufficient_stock/);
  assert.equal((await f.reconcile().execute({ staleAfterMs: -1 })).reconciled[0]!.outcome, "unknown"); assert.equal(f.creates(), 0);
  f.stock.quantity = 2; assert.equal((await f.reconcile().execute({ staleAfterMs: -1 })).reconciled[0]!.outcome, "still_pending"); assert.equal(f.creates(), 1);
});
test("a ready payment journal never posts after the buyer changes its authoritative cart", async () => {
  const f = await fixture(); (f.provider as any).preparePayment = async (input: any) => { f.stock.quantity = 0; return input; };
  await assert.rejects(f.useCase.execute(f.request)); f.stock.quantity = 10;
  const session = (await f.checkout.getSession("mrc_1", "chk_1"))!;
  await f.checkout.saveSession({ ...session, cart: { ...session.cart, total: 40, items: [{ ...session.cart.items[0]!, quantity: 2 }] } });
  assert.equal((await f.reconcile().execute({ staleAfterMs: -1 })).reconciled[0]!.outcome, "unknown"); assert.equal(f.creates(), 0);
});
test("uncertain cancellation blocks new and replayed create commands before provider access", async () => {
  const f = await fixture(), intent = PaymentIntentEntity.create({ merchantId: "mrc_1", sessionId: "chk_1", idempotencyKey: "previous", amountCents: 2099, currency: "BRL", method: "pix" });
  intent.prepareCreation({ provider: "asaas", providerAccountFingerprint: "fixture", merchantId: "mrc_1", sessionId: "chk_1", intentId: intent.id, amountCents: 2099, currency: "BRL", method: "pix" });
  intent.claimCreation("first", new Date()); intent.markRequiresAction({ providerPaymentId: "pay_qa" }); intent.completeCreation("first");
  intent.recordCancellation({ operationId: `cancel_${intent.id}`, buyerId: "buyer", idempotencyKey: "cancel", providerPaymentId: "pay_qa", startedAt: new Date().toISOString(), state: "uncertain", mutationAttemptedAt: new Date().toISOString() });
  await f.payments.saveIntent({ intent });
  for (const idempotency_key of ["previous", "new"]) await assert.rejects(f.useCase.execute({ ...f.request, idempotency_key }), /payment_cancellation_pending/);
  assert.equal(f.creates(), 0);
});
