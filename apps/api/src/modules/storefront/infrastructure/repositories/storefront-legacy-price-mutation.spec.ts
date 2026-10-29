import test from "node:test";
import assert from "node:assert/strict";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { StorefrontCartRepositoryCore } from "./prisma-storefront-cart.repository.js";
import type { StorefrontCartTransactionWork, StorefrontCartTransactionResult } from "./storefront-cart-transaction.js";

// Unit transaction double: source replaces only after work resolves. Not SQL
// rollback/isolation evidence; root's native gate covers the actual runner.
class FixtureRepository extends StorefrontCartRepositoryCore {
  commits = 0;
  source: StorefrontCart = { id: "row", merchantId: "merchant", sessionId: "cart", total: 18000, discount: 0, couponCode: null, freeShipping: false,
    createdAt: new Date(0), updatedAt: new Date(0), items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Saved", unitPriceCents: 9000, quantity: 2 }] };
  protected async withCart<T>(merchantId: string, sessionId: string, work: StorefrontCartTransactionWork<T>): Promise<StorefrontCartTransactionResult<T>> {
    assert.equal(merchantId, "merchant"); assert.equal(sessionId, "cart");
    const cart = structuredClone(this.source), tx = { productVariant: { findFirst: async () => ({
      price: { basePriceInCents: 10000, currency: "BRL" }, stock: [{ quantity: 100, reserved: 0 }],
      product: { type: "physical", metadata: { optionGroups: [{ id: "size", name: "Tamanho", required: false, selectionType: "single",
        items: [{ id: "large", name: "Grande", priceModifierInCents: 500 }] }] } },
    }) } };
    const result = await work(tx as never, cart); cart.total = cart.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    this.source = structuredClone(cart); this.commits++; return { result, cart };
  }
}
const incoming = () => ({ variantId: "variant", productId: "product", sku: "SKU", name: "Canonical", unitPriceCents: 10000, quantity: 1 });
test("ordinary add cannot extend an existing saved discount to additional units before commit", async () => {
  const repo = new FixtureRepository(), before = structuredClone(repo.source);
  await assert.rejects(repo.addItem("merchant", "cart", incoming())); assert.equal(repo.commits, 0); assert.deepEqual(repo.source, before);
});
test("quantity increase of a saved reduced line requires a new quote before commit", async () => {
  const repo = new FixtureRepository(), before = structuredClone(repo.source);
  await assert.rejects(repo.updateItemQuantity("merchant", "cart", "variant", 3)); assert.equal(repo.commits, 0); assert.deepEqual(repo.source, before);
});
test("decrement preserves saved unit price; increasing it back cannot restore surrendered quantity", async () => {
  const repo = new FixtureRepository();
  await repo.updateItemQuantity("merchant", "cart", "variant", 1); assert.equal(repo.source.items[0]!.unitPriceCents, 9000);
  const before = structuredClone(repo.source);
  await assert.rejects(repo.updateItemQuantity("merchant", "cart", "variant", 2)); assert.equal(repo.commits, 1); assert.deepEqual(repo.source, before);
});
test("over-cap old lines can still be removed or cleared without being locked into checkout", async () => {
  const repo = new FixtureRepository(); repo.source.items[0]!.unitPriceCents = 5000;
  await repo.removeItem("merchant", "cart", "variant"); assert.equal(repo.source.items.length, 0);
  await repo.clear("merchant", "cart"); assert.equal(repo.source.items.length, 0);
});
test("same variant with different options is a new canonical line, never merged with the saved concession", async () => {
  const repo = new FixtureRepository();
  await repo.addItem("merchant", "cart", { ...incoming(), unitPriceCents: 10500,
    selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 }] });
  assert.equal(repo.source.items.length, 2); assert.equal(repo.source.items[0]!.quantity, 2); assert.equal(repo.source.items[0]!.unitPriceCents, 9000);
  assert.equal(repo.source.items[1]!.quantity, 1); assert.equal(repo.source.items[1]!.unitPriceCents, 10500);
});
test("changed option identity cannot carry the old saved unit price into a new line", async () => {
  const repo = new FixtureRepository(), before = structuredClone(repo.source);
  await assert.rejects(repo.addItem("merchant", "cart", { ...incoming(), unitPriceCents: 9000,
    selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 }] }));
  assert.equal(repo.commits, 0); assert.deepEqual(repo.source, before);
});
