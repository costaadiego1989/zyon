import test from "node:test";
import assert from "node:assert/strict";
import { buildCheckoutCart, startFakeCommerceApiServer } from "./server.js";

test("buildCheckoutCart returns shared Cart totals from product selection", () => {
  const cart = buildCheckoutCart([
    { sku: "bag-001", quantity: 2 },
    { sku: "wallet-001", quantity: 1 }
  ]);

  assert.equal(cart.currency, "BRL");
  assert.equal(cart.source, "platform_api");
  assert.equal(cart.total, 1029.7);
  assert.deepEqual(cart.items.map((item) => item.sku), ["bag-001", "wallet-001"]);
});

test("buildCheckoutCart rejects invalid SKU and quantity", () => {
  assert.throws(() => buildCheckoutCart([{ sku: "missing", quantity: 1 }]), /product_not_found/);
  assert.throws(() => buildCheckoutCart([{ sku: "bag-001", quantity: 0 }]), /selection_invalid/);
});

test("fake commerce HTTP API exposes health, products and checkout-cart", async () => {
  const { server, url } = await startFakeCommerceApiServer();
  try {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);

    const products = await fetch(`${url}/products`).then((res) => res.json()) as {
      products: Array<{ sku: string }>;
    };
    assert.ok(products.products.some((product) => product.sku === "bag-001"));

    const cartResponse = await fetch(`${url}/checkout-cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "bag-001", quantity: 1 }] })
    });
    assert.equal(cartResponse.status, 200);
    const payload = await cartResponse.json() as { cart: { total: number; items: Array<{ sku: string }> } };
    assert.equal(payload.cart.total, 449.9);
    assert.equal(payload.cart.items[0]?.sku, "bag-001");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
