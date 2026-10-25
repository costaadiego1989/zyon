import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { StorefrontCart, StorefrontCartItem } from "../../domain/ports/storefront-cart.port.js";
import { StorefrontCartRepositoryCore } from "./prisma-storefront-cart.repository.js";
import type { StorefrontCartAccess, StorefrontCartTransactionWork, StorefrontCartTransactionResult } from "./storefront-cart-transaction.js";
import { storefrontToolArgumentSchemas } from "../../domain/contracts/storefront-tool.schemas.js";
import { selectStorefrontCartLine, storefrontCartLineIdentity } from "../../domain/services/storefront-cart-line-identity.js";
import { CheckoutCartAuthorityService } from "../../../checkout/application/services/checkout-cart-authority.service.js";

const option = (id: string) => ({ groupId: "size", groupName: "Size", itemId: id, itemName: id, priceModifierInCents: 100 });
const line = (id: string, quantity = 1): StorefrontCartItem => ({ variantId: "v", productId: "p", sku: "SKU", name: "Product",
  unitPriceCents: 1100, quantity, selectedOptions: id ? [option(id)] : [] });
// Real repository mutation methods, explicit transaction/delegate doubles only.
// This is not PostgreSQL concurrency, browser or payment/provider evidence.
class Fixture extends StorefrontCartRepositoryCore {
  saved: StorefrontCart; writes = 0;
  constructor(items = [line("small", 2), line("large", 3)], readonly available = 10) {
    super(); this.saved = { id: "c", merchantId: "m", sessionId: "s", items, total: 5500, discount: 0, couponCode: null,
      freeShipping: false, createdAt: new Date(0), updatedAt: new Date(0) };
  }
  protected async withCart<T>(_m: string, _s: string, work: StorefrontCartTransactionWork<T>, _access?: StorefrontCartAccess): Promise<StorefrontCartTransactionResult<T | void>> {
    const cart = structuredClone(this.saved);
    const tx = { productVariant: { findFirst: async () => ({ product: { type: "physical", metadata: {
      optionGroups: [{ id: "size", name: "Size", selectionType: "single", required: false,
        items: ["small", "large"].map(id => ({ id, name: id, priceModifierInCents: 100 })) }],
    } }, price: { basePriceInCents: 1000 }, stock: [{ quantity: this.available, reserved: 0 }] }) } };
    const result = await work(tx as unknown as Prisma.TransactionClient, cart);
    this.saved = structuredClone(cart); this.writes++; return { cart, result };
  }
}
test("remove selects one options line and preserves the other", async () => {
  const f = new Fixture(); const result = await f.removeItem("m", "s", "v", { optionItemIds: ["small"] });
  assert.deepEqual(result.items, [line("large", 3)]);
});
test("quantity zero selects one options line and preserves the other", async () => {
  const f = new Fixture(); const result = await f.updateItemQuantity("m", "s", "v", 0, { optionItemIds: ["large"] });
  assert.deepEqual(result.items, [line("small", 2)]);
});
test("quantity update addresses one canonical selection", async () => {
  const f = new Fixture(); const result = await f.updateItemQuantity("m", "s", "v", 4, { optionItemIds: ["small"] });
  assert.deepEqual(result.items, [line("small", 4), line("large", 3)]);
});
for (const operation of ["remove", "zero", "update"] as const) test(`ambiguous ${operation} fails without changing any line`, async () => {
  const f = new Fixture(), before = structuredClone(f.saved);
  await assert.rejects(operation === "remove" ? f.removeItem("m", "s", "v") : f.updateItemQuantity("m", "s", "v", operation === "zero" ? 0 : 4),
    /cart_option_line_selection_required/);
  assert.deepEqual(f.saved, before); assert.equal(f.writes, 0);
});
test("selected physical options quantities share stock", async () => {
  const f = new Fixture(undefined, 6), before = structuredClone(f.saved);
  await assert.rejects(f.updateItemQuantity("m", "s", "v", 4, { optionItemIds: ["small"] }), /variant_out_of_stock/);
  assert.deepEqual(f.saved, before); assert.equal(f.writes, 0);
});
test("explicit empty options select only the no-options line", async () => {
  const f = new Fixture([line(""), line("large")]);
  assert.deepEqual((await f.removeItem("m", "s", "v", { optionItemIds: [] })).items, [line("large")]);
});
test("unique legacy variant-only mutation remains compatible", async () => {
  const f = new Fixture([line("small")]);
  assert.equal((await f.updateItemQuantity("m", "s", "v", 2)).items[0]?.quantity, 2);
  assert.deepEqual((await f.removeItem("m", "s", "v")).items, []);
});
test("tools accept explicit identity and zero but reject duplicate option ids", () => {
  assert.equal(storefrontToolArgumentSchemas.update_cart_item.safeParse({ cartId: "s", variantId: "v", quantity: 0, optionItemIds: ["small"] }).success, true);
  assert.equal(storefrontToolArgumentSchemas.remove_cart_item.safeParse({ cartId: "s", variantId: "v", optionItemIds: [], serviceSlotId: "slot" }).success, true);
  assert.equal(storefrontToolArgumentSchemas.remove_cart_item.safeParse({ cartId: "s", variantId: "v", optionItemIds: ["small", "small"] }).success, false);
});
test("canonical selection is option-order independent and preserves service slot identity", async () => {
  const a = { ...line("small"), selectedServiceSlot: { slotId: "slot-a" } } as StorefrontCartItem;
  const b = { ...line("small"), selectedServiceSlot: { slotId: "slot-b" } } as StorefrontCartItem;
  const f = new Fixture([a, b]);
  await assert.rejects(f.removeItem("m", "s", "v", { optionItemIds: ["small"] }), /cart_option_line_selection_required/);
  assert.deepEqual((await f.removeItem("m", "s", "v", { optionItemIds: ["small"], serviceSlotId: "slot-b" })).items, [a]);
  const options = { ...line("small"), selectedOptions: [option("small"), option("large")] };
  assert.equal(selectStorefrontCartLine([options], "v", { optionItemIds: ["large", "small"] }), 0);
  assert.equal(storefrontCartLineIdentity(options), storefrontCartLineIdentity({ ...options, selectedOptions: [...options.selectedOptions].reverse() }));
});
test("unknown or malformed explicit selector never mutates a different selection", async () => {
  const f = new Fixture(), before = structuredClone(f.saved);
  await assert.rejects(f.updateItemQuantity("m", "s", "v", 4, { optionItemIds: ["missing"] }));
  await assert.rejects(f.removeItem("m", "s", "v", { optionItemIds: ["small", "small"] }), /cart_line_selection_invalid/);
  assert.deepEqual(f.saved, before); assert.equal(f.writes, 0);
});
test("explicit null slot distinguishes no-slot from the same options in a booked slot", async () => {
  const plain = line(""), booked = { ...plain, selectedServiceSlot: { slotId: "slot-a" } } as StorefrontCartItem;
  const f = new Fixture([plain, booked]);
  await assert.rejects(f.removeItem("m", "s", "v", { optionItemIds: [] }), /cart_option_line_selection_required/);
  assert.deepEqual((await f.removeItem("m", "s", "v", { optionItemIds: [], serviceSlotId: null })).items, [booked]);
  assert.deepEqual((await f.removeItem("m", "s", "v", { optionItemIds: [], serviceSlotId: "slot-a" })).items, []);
});
test("selector accepts the full catalog limit of250 distinct options and rejects251", () => {
  const optionItemIds = Array.from({ length: 250 }, (_, index) => `option-${index}`);
  const input = { cartId: "s", variantId: "v", optionItemIds, serviceSlotId: null };
  assert.equal(storefrontToolArgumentSchemas.remove_cart_item.safeParse(input).success, true);
  assert.equal(storefrontToolArgumentSchemas.remove_cart_item.safeParse({ ...input, optionItemIds: [...optionItemIds, "one-too-many"] }).success, false);
});
test("checkout authority preserves separate options lines, quantities and canonical composition", async () => {
  const items = [line("small", 2), line("large", 3)];
  const authority = new CheckoutCartAuthorityService({
    storefrontCart: { findUnique: async () => ({ items, discount: 0, couponCode: null, expiresAt: new Date(Date.now() + 60000) }) },
    productVariant: { findMany: async () => [{ id: "v", productId: "p", sku: "SKU", isActive: true, product: { merchantId: "m", isActive: true,
      name: "Product", type: "physical", metadata: { optionGroups: [{ id: "size", name: "Size", selectionType: "single", required: false,
        items: ["small", "large"].map(id => ({ id, name: id, priceModifierInCents: 100 })) }] } },
      price: { currency: "BRL", basePriceInCents: 1000, costInCents: null }, stock: [{ quantity: 10, reserved: 0 }], media: [{ url: "https://example.invalid/image" }] }] },
  } as never, {} as never);
  const result = await authority.resolveStorefront("m", "s");
  assert.equal(result.items.length, 2); assert.deepEqual(result.items.map(item => item.quantity), [2, 3]);
  assert.deepEqual(result.items.map(item => JSON.parse(item.variant!)), [["v", ["small"]], ["v", ["large"]]]);
  assert.equal(result.total, 55);
});
