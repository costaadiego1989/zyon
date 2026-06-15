import assert from "node:assert/strict";
import test from "node:test";
import { WooCommerceCommerceAdapter } from "./woocommerce-commerce.adapter.js";

test("WooCommerce adapter authenticates and reads live catalog data", async () => {
  const seen: Array<{ url: string; authorization?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, authorization: headers.get("authorization") ?? undefined });

    if (url.endsWith("/wp-json")) {
      return json({ name: "AACP Store", url: "https://shop.example.com" });
    }
    if (url.includes("/settings/general/woocommerce_currency")) {
      return json({ value: "BRL" });
    }
    if (url.includes("/products?")) {
      return json(
        [
          {
            id: 10,
            name: "Enterprise Keyboard",
            type: "simple",
            sku: "KEY-001",
            price: "299.90",
            regular_price: "349.90",
            permalink: "https://shop.example.com/product/keyboard",
            description: "<p>Quiet mechanical keyboard</p>",
            short_description: "",
            stock_quantity: 7,
            stock_status: "instock",
            images: [{ src: "https://cdn.example.com/keyboard.jpg" }],
            categories: [{ name: "Workspace" }],
            variations: [],
          },
        ],
        { "x-wp-totalpages": "2" },
      );
    }
    throw new Error(`unexpected_url_${url}`);
  };
  const adapter = new WooCommerceCommerceAdapter(
    {
      storeUrl: "https://shop.example.com",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
    },
    fetchImpl,
  );

  const health = await adapter.testConnection();
  const catalog = await adapter.searchCatalog({
    merchantId: "mrc_1",
    query: "keyboard",
    limit: 10,
  });

  assert.equal(health.currency, "BRL");
  assert.equal(catalog.products[0]?.variants[0]?.sku, "KEY-001");
  assert.equal(catalog.products[0]?.variants[0]?.unitPriceCents, 29_990);
  assert.equal(catalog.nextCursor, "2");
  assert.match(seen[1]?.authorization ?? "", /^Basic /);
});

test("WooCommerce adapter validates and marks an existing order paid", async () => {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (init?.method === "PUT") return json({ id: 99, status: "processing" });
    return json({
      id: 99,
      currency: "BRL",
      total: "120.00",
      line_items: [
        { name: "Product", sku: "SKU-1", quantity: 2, total: "120.00" },
      ],
    });
  };
  const adapter = new WooCommerceCommerceAdapter(
    {
      storeUrl: "https://shop.example.com",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
    },
    fetchImpl,
  );

  const cart = await adapter.validateCart({
    merchantId: "mrc_1",
    commerceCartRef: "99",
  });
  const order = await adapter.createPendingOrder({
    merchantId: "mrc_1",
    sessionId: "sess_1",
    cart,
  });
  await adapter.markOrderPaid({
    merchantId: "mrc_1",
    commerceOrderId: order.commerceOrderId,
    paymentReference: "pay_1",
  });

  assert.equal(cart.totalCents, 12_000);
  assert.equal(cart.lines[0]?.unitPriceCents, 6_000);
  assert.equal(order.commerceOrderId, "99");
  assert.match(calls[1]?.body ?? "", /"set_paid":true/);
});

function json(body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
