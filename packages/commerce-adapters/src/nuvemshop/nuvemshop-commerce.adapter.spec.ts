import assert from "node:assert/strict";
import test from "node:test";
import { NuvemshopCommerceAdapter } from "./nuvemshop-commerce.adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Nuvemshop adapter injects Bearer + User-Agent on every request", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const headersObj: Record<string, string> = {};
    headers.forEach((value, key) => {
      headersObj[key.toLowerCase()] = value;
    });
    calls.push({ url, headers: headersObj });
    if (url.endsWith("/store")) {
      return jsonResponse({
        id: 1234,
        name: "Test Nuvemshop",
        url: "https://mystore.example",
        currency: "BRL",
      });
    }
    if (url.includes("/products?")) {
      return jsonResponse([
        {
          id: 99,
          sku: "KEY-001",
          name: { es: "Teclado" },
          price: 199.9,
          stock: 10,
          variants: [
            { id: 1, sku: "KEY-001", price: 199.9, stock: 10, values: [] },
          ],
          images: [{ src: "https://cdn.example.com/key.jpg" }],
          categories: [{ name: "Workspace" }],
        },
      ]);
    }
    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new NuvemshopCommerceAdapter(
    { storeId: "1234", accessToken: "ns_token_abc", userAgent: "AACP-Test (qa@example)" },
    fetchImpl,
  );

  const health = await adapter.testConnection();
  const catalog = await adapter.searchCatalog({ merchantId: "mrc_1", limit: 10 });

  assert.equal(health.provider, "nuvemshop");
  assert.equal(health.storeName, "Test Nuvemshop");
  assert.equal(health.currency, "BRL");

  assert.ok(calls.length >= 1, "must have made at least one HTTP call");
  for (const call of calls) {
    assert.equal(call.headers["authorization"], "Bearer ns_token_abc");
    assert.equal(call.headers["user-agent"], "AACP-Test (qa@example)");
    assert.match(call.url, /^https:\/\/api\.tiendanube\.com\/v1\/1234\//);
  }

  assert.equal(catalog.products[0]?.variants[0]?.sku, "KEY-001");
  assert.equal(catalog.products[0]?.variants[0]?.unitPriceCents, 19_990);
});

test("Nuvemshop adapter rejects non-numeric store_id at construction time", () => {
  assert.throws(
    () => new NuvemshopCommerceAdapter({ storeId: "abc", accessToken: "tok" }),
    /nuvemshop_store_id_must_be_numeric/,
  );
});

test("Nuvemshop adapter maps pending order POST to /orders", async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return jsonResponse({ id: 555, currency: "BRL" });
  };
  const adapter = new NuvemshopCommerceAdapter(
    { storeId: "1234", accessToken: "tok" },
    fetchImpl,
  );
  const out = await adapter.createPendingOrder({
    merchantId: "mrc_1",
    sessionId: "sess_1",
    cart: {
      currency: "BRL",
      totalCents: 10000,
      lines: [{ sku: "SKU-A", quantity: 2, unitPriceCents: 5000, title: "Item A" }],
      commerceCartRef: "c1",
    },
  });
  assert.equal(out.commerceOrderId, "555");
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.url ?? "", /\/orders$/);
  assert.match(calls[0]?.body ?? "", /"sku":"SKU-A"/);
});

test("Nuvemshop adapter propagate HTTP errors with stable codes", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  const adapter = new NuvemshopCommerceAdapter(
    { storeId: "1234", accessToken: "tok" },
    fetchImpl,
  );
  await assert.rejects(
    () => adapter.testConnection(),
    /nuvemshop_test_connection_failed_401/,
  );
});
