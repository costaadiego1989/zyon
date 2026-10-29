import test from "node:test";
import assert from "node:assert/strict";
import { MetaCatalogOrderAdapter } from "./meta-catalog-order.adapter.js";

test("a native catalog order ignores client prices and is scoped to the linked catalog and merchant", async () => {
  const requests: any[] = [];
  const adapter = new MetaCatalogOrderAdapter({ productVariant: { findMany: async (query: any) => { requests.push(query); return [{ id: "real-variant", product: { metadata: {} } }]; } } } as any);
  const order = { catalog_id: "catalog", product_items: [{ product_retailer_id: "SKU", quantity: 2, item_price: "0.01", currency: "USD" }] };
  assert.deepEqual(await adapter.resolve("merchant", "catalog", order), [{ variantId: "real-variant", quantity: 2 }]);
  assert.equal(requests[0].where.product.merchantId, "merchant");
  assert.equal(await adapter.resolve("merchant", "another-catalog", order), undefined);
  assert.equal(await adapter.resolve("merchant", "catalog", { ...order, product_items: [{ ...order.product_items[0], quantity: 0 }] }), undefined);
});
test("native catalog orders cannot skip service schedules or required product options", async () => {
  const adapter = new MetaCatalogOrderAdapter({ productVariant: { findMany: async () => [{ id: "variant", product: { metadata: { optionGroups: [{ id: "g", name: "Sabor", required: true, selectionType: "single", items: [{ id: "i", name: "Escolher", priceModifierInCents: 0 }] }] } } }] } } as any);
  assert.equal(await adapter.resolve("merchant", "catalog", { catalog_id: "catalog", product_items: [{ product_retailer_id: "variant", quantity: 1 }] }), undefined);
});
