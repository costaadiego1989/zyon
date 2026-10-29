import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontController } from "./storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { createCartHandlers } from "../../infrastructure/tool-handlers/cart.handlers.js";

const items = [{ variantId: "v", productId: "p", sku: "SKU", name: "Product", quantity: 2, unitPriceCents: 1100,
  selectedOptions: [{ groupId: "g", groupName: "Size", itemId: "large", itemName: "L", priceModifierInCents: 100 }] }];
function fixture() {
  const calls: unknown[][] = [], cart = { sessionId: "cart", merchantId: "m", items, total: 2200, discount: 0, freeShipping: false };
  const capabilities = new RealtimeCapabilityService("synthetic-line-selection-secret-32-characters");
  const token = capabilities.issue({ purpose: "storefront-conversation", merchantId: "m", resourceId: "cart", origin: "https://store.example" });
  const request = { headers: { authorization: `Bearer ${token.token}`, origin: "https://store.example" } };
  const cartRepo = { getOrCreate: async () => cart,
    updateItemQuantity: async (...args: unknown[]) => { calls.push(args); return cart; },
    removeItem: async (...args: unknown[]) => { calls.push(args); return cart; } };
  const controller = Object.assign(Object.create(StorefrontController.prototype), { capabilities, cartRepo,
    priceCart: async (_m: string, _c: string, value: unknown) => ({ cart: value }) }) as StorefrontController;
  const handlers = createCartHandlers({ cartRepo, prisma: {
    checkoutSetting: { findUnique: async () => null },
    productPrice: { findMany: async () => [{ variantId: "v", basePriceInCents: 1000, costInCents: null,
      variant: { productId: "p", product: { categoryId: null, metadata: { optionGroups: [
        { id: "g", name: "Size", required: true, selectionType: "single",
          items: [{ id: "large", name: "L", priceModifierInCents: 100 }] },
      ] } } } }] },
  } } as never,
    { merchantId: "m", sessionId: "cart" } as never);
  return { controller, request, calls, handlers };
}
test("HTTP cart read preserves explicit canonical option identity", async () => {
  const f = fixture(), result = await f.controller.getCart("cart", "m", f.request);
  assert.deepEqual(result.items[0]?.optionItemIds, ["large"]);
  assert.equal(result.items[0]?.serviceSlotId, null); assert.equal(result.items[0]?.selectionLabel, "Size: L");
});
test("HTTP quantity zero forwards exact selection after authenticated scope guards", async () => {
  const f = fixture(); const result = await f.controller.updateCartItem("cart", "v", "m", { quantity: 0, optionItemIds: ["large"] }, f.request);
  assert.deepEqual(f.calls, [["m", "cart", "v", 0, { optionItemIds: ["large"] }]]);
  assert.deepEqual(result.items[0]?.optionItemIds, ["large"]);
});
test("HTTP malformed duplicate selector never reaches repository", async () => {
  const f = fixture();
  await assert.rejects(f.controller.updateCartItem("cart", "v", "m", { quantity: 0, optionItemIds: ["large", "large"] }, f.request));
  assert.equal(f.calls.length, 0);
});
test("tools forward exact selector and authenticated cart rather than model cart", async () => {
  const f = fixture(); await f.handlers.removeCartItem({ cartId: "foreign", variantId: "v", optionItemIds: ["large"] });
  await f.handlers.updateCartItem({ cartId: "foreign", variantId: "v", quantity: 0, optionItemIds: ["large"] });
  assert.deepEqual(f.calls, [["m", "cart", "v", { optionItemIds: ["large"] }], ["m", "cart", "v", 0, { optionItemIds: ["large"] }]]);
});
test("tool cart output carries item IDs, not only option labels", async () => {
  const f = fixture(), output = await f.handlers.getCart({ cartId: "cart" }) as { items: Array<{ optionItemIds: string[]; selectedOptions: Array<{ itemId: string }> }> };
  assert.deepEqual(output.items[0]?.optionItemIds, ["large"]); assert.equal(output.items[0]?.selectedOptions[0]?.itemId, "large");
});
