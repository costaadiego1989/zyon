import test from "node:test";
import assert from "node:assert/strict";
import { AddStorefrontItemUseCase } from "./add-storefront-item.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, testCart } from "../../checkout/__tests__/checkout-test-fixtures.js";

async function fixture(available = 1, paymentStatus?: string) {
  const repo = new InMemoryCheckoutRepository();
  const original = checkoutSession({ sessionId: "replacement", cart: testCart({ total: 20,
    items: [{ sku: "OLD", name: "Esgotado", price: 20, quantity: 2 }] }) });
  await repo.saveSession(original);
  const catalog = { search: async () => [], findBySku: async (_merchant: string, sku: string) =>
    sku === "NEW" ? { sku, name: "Alternativa", unit_price: 15, in_stock: true } : null };
  const stock = { paymentIntent: { findFirst: async (query: { where: Record<string, unknown> }) => {
    assert.equal(query.where.merchantId, "mrc_1"); assert.equal(query.where.sessionId, "replacement");
    assert.deepEqual(query.where.status, { notIn: ["failed", "cancelled", "expired"] });
    return paymentStatus && !["failed", "cancelled", "expired"].includes(paymentStatus) ? { id: "persisted-payment" } : null;
  } }, productVariant: { findMany: async () => [{ id: "new", sku: "NEW", isActive: true,
    product: { isActive: true, type: "physical", deletedAt: null }, stock: [{ quantity: available, reserved: 0 }] }] } };
  const useCase = new AddStorefrontItemUseCase(catalog, repo, repo, { isKnownCrossSellSku: () => false, resolveCartItem: () => null } as never,
    undefined, undefined, stock as never);
  return { repo, useCase, original };
}

test("confirmed replacement removes the unavailable line only after the alternative passes stock validation", async () => {
  const { repo, useCase, original } = await fixture();
  await useCase.execute({ merchant_id: "mrc_1", session_id: "replacement", sku: "NEW", quantity: 1, replace_sku: "OLD" });
  const saved = await repo.getSession("mrc_1", "replacement");
  assert.deepEqual(saved?.cart.items.map(item => [item.sku, item.quantity]), [["NEW", 1]]);
  assert.equal(saved?.cart.total, 15);
  assert.equal(saved?.shipping, undefined);
  assert.equal(original.cart.items[0].sku, "OLD");
});

test("a sold-out alternative preserves all original cart items", async () => {
  const { repo, useCase } = await fixture(0);
  const before = structuredClone((await repo.getSession("mrc_1", "replacement"))!.cart);
  await assert.rejects(useCase.execute({ merchant_id: "mrc_1", session_id: "replacement", sku: "NEW", quantity: 1, replace_sku: "OLD" }), /Conflict/);
  assert.deepEqual((await repo.getSession("mrc_1", "replacement"))!.cart, before);
});

test("pending, paid and refunded payments, unknown replacements and foreign merchant sessions cannot be replaced", async () => {
  for (const status of ["pending", "requires_action", "approved", "refunded"]) {
    const f = await fixture(1, status);
    await assert.rejects(f.useCase.execute({ merchant_id: "mrc_1", session_id: "replacement", sku: "NEW", replace_sku: "OLD" }), /checkout_replacement_unavailable/);
    assert.equal((await f.repo.getSession("mrc_1", "replacement"))?.cart.items[0].sku, "OLD");
  }
  const f = await fixture();
  await assert.rejects(f.useCase.execute({ merchant_id: "mrc_1", session_id: "replacement", sku: "NEW", replace_sku: "FOREIGN" }), /checkout_replacement_item_invalid/);
  await assert.rejects(f.useCase.execute({ merchant_id: "other", session_id: "replacement", sku: "NEW", replace_sku: "OLD" }), /checkout_session_not_found/);
  assert.equal((await f.repo.getSession("mrc_1", "replacement"))?.cart.items[0].sku, "OLD");
});
