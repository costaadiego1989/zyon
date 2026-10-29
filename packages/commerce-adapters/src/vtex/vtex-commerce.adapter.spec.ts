import assert from "node:assert/strict";
import test from "node:test";
import { VtexCommerceAdapter } from "./vtex-commerce.adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("VTEX adapter injects AppKey + AppToken on every request", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const headersObj: Record<string, string> = {};
    headers.forEach((value, key) => {
      headersObj[key.toLowerCase()] = value;
    });
    calls.push({ url, headers: headersObj });
    if (url.includes("/api/catalog_system/pvt/sku/stockkeepingunitids")) {
      return jsonResponse([{ sku: "SKU-001" }]);
    }
    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new VtexCommerceAdapter(
    {
      accountName: "mystore",
      appKey: "vtex_key_12345",
      appToken: "vtex_token_abcdef",
    },
    fetchImpl,
  );

  const health = await adapter.testConnection();

  assert.equal(health.provider, "vtex");
  assert.equal(health.storeName, "mystore");
  assert.match(health.storeUrl, /mystore\.vtexcommercestable\.com\.br/);

  assert.ok(calls.length >= 1, "must have made at least one HTTP call");
  for (const call of calls) {
    assert.equal(call.headers["x-vtex-api-appkey"], "vtex_key_12345");
    assert.equal(call.headers["x-vtex-api-apptoken"], "vtex_token_abcdef");
  }
});

test("VTEX adapter rejects missing credentials at construction time", () => {
  assert.throws(
    () => new VtexCommerceAdapter({ accountName: "", appKey: "key", appToken: "token" }),
    /vtex_account_name_required/,
  );
  assert.throws(
    () => new VtexCommerceAdapter({ accountName: "store", appKey: "", appToken: "token" }),
    /vtex_app_key_required/,
  );
  assert.throws(
    () => new VtexCommerceAdapter({ accountName: "store", appKey: "key", appToken: "" }),
    /vtex_app_token_required/,
  );
});

test("VTEX adapter maps validateCart to GET /orderForm", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/orderForm/cart123")) {
      return jsonResponse({
        id: "cart123",
        orderFormId: "cart123",
        items: [
          {
            id: "item1",
            productId: "prod1",
            skuId: "sku1",
            name: "Product A",
            quantity: 2,
            price: 50.0,
          },
        ],
        value: 10000,
      });
    }
    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new VtexCommerceAdapter(
    { accountName: "store", appKey: "key", appToken: "token" },
    fetchImpl,
  );

  const cart = await adapter.validateCart({
    merchantId: "mrc_1",
    commerceCartRef: "cart123",
  });

  assert.equal(cart.lines[0]?.sku, "sku1");
  assert.equal(cart.lines[0]?.quantity, 2);
  assert.equal(cart.lines[0]?.unitPriceCents, 5000);
});

test("VTEX adapter maps searchCatalog to GET /products/search", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/catalog_system/pub/products/search")) {
      return jsonResponse([
        {
          productId: "prod1",
          productName: "Keyboard",
          description: "Mechanical keyboard",
          items: [
            {
              itemId: "item1",
              name: "Keyboard - Black",
              images: [{ imageUrl: "https://cdn.example.com/kb.jpg" }],
              sellers: [
                {
                  sellerId: "1",
                  sellerName: "Store",
                  commertialOffer: { price: 199.9, stock: 10 },
                },
              ],
            },
          ],
        },
      ]);
    }
    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new VtexCommerceAdapter(
    { accountName: "store", appKey: "key", appToken: "token" },
    fetchImpl,
  );

  const page = await adapter.searchCatalog({
    merchantId: "mrc_1",
    query: "keyboard",
    limit: 20,
  });

  assert.equal(page.products[0]?.title, "Keyboard");
  assert.equal(page.products[0]?.variants[0]?.unitPriceCents, 19990);
});

test("VTEX adapter maps createPendingOrder to POST /orderForm", async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return jsonResponse({
      id: "order123",
      orderFormId: "order123",
      items: [],
      value: 0,
    });
  };

  const adapter = new VtexCommerceAdapter(
    { accountName: "store", appKey: "key", appToken: "token" },
    fetchImpl,
  );

  const result = await adapter.createPendingOrder({
    merchantId: "mrc_1",
    sessionId: "sess_abc",
    cart: {
      currency: "BRL",
      totalCents: 10000,
      lines: [
        {
          sku: "SKU-1",
          quantity: 2,
          unitPriceCents: 5000,
          title: "Item",
        },
      ],
      commerceCartRef: "cart1",
    },
  });

  assert.equal(result.commerceOrderId, "order123");
  assert.ok(calls[0]?.body?.includes("aacp"));
});
