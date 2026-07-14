import test from "node:test";
import assert from "node:assert/strict";
import { TrayCommerceAdapter } from "./tray-commerce.adapter.js";
import type { TrayCommerceCredentials } from "./tray-types.js";

function baseCreds(overrides?: Partial<TrayCommerceCredentials>): TrayCommerceCredentials {
  return {
    merchantId: "m1",
    provider: "tray",
    apiAddress: "https://store.com.br/web_api",
    accessToken: "tray_access_token_value",
    refreshToken: "tray_refresh_token_value",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400, // 24h from now
    consumerKey: "tray_ck",
    consumerSecret: "tray_cs",
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Tray adapter puts access_token in query string, not Authorization header", async () => {
  const seen: { url: string; authHeader?: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, authHeader: headers.get("authorization") });
    return json({ store_name: "My Store", currency: "BRL" });
  };

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  await adapter.testConnection();

  assert.equal(seen.length, 1);
  assert.ok(seen[0]!.url.includes("access_token=tray_access_token_value"));
  assert.equal(seen[0]!.authHeader, null, "must NOT send Authorization header");
});

test("Tray adapter searches catalog with pagination", async () => {
  const fetchImpl: typeof fetch = async () =>
    json({
      result: [
        {
          id: 42,
          name: "Widget",
          price: "49.90",
          cost: "20.00",
          quantity: 5,
          image: "https://cdn.example.com/img.jpg",
          url: "https://store.com.br/widget",
        },
      ],
      paging: { current: 1, next: 2 },
    });

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  const page = await adapter.searchCatalog({ merchantId: "m1", limit: 10 });

  assert.equal(page.products.length, 1);
  assert.equal(page.products[0]!.title, "Widget");
  assert.equal(page.products[0]!.variants[0]!.unitPriceCents, 4990);
  assert.equal(page.nextCursor, "2");
});

test("Tray adapter validates cart from order data", async () => {
  const fetchImpl: typeof fetch = async () =>
    json({
      id: 100,
      status: "open",
      number: "1000",
      total: "199.80",
      currency: "BRL",
      items: [
        { id: 1, name: "Product A", sku: "SKU-A", quantity: 2, price: "99.90" },
      ],
    });

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  const cart = await adapter.validateCart({ merchantId: "m1", commerceCartRef: "100" });

  assert.equal(cart.totalCents, 19980);
  assert.equal(cart.lines[0]!.sku, "SKU-A");
  assert.equal(cart.lines[0]!.unitPriceCents, 9990);
  assert.equal(cart.commerceCartRef, "100");
});

test("Tray adapter creates pending order", async () => {
  const calls: { url: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return json({ id: 555 });
  };

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  const result = await adapter.createPendingOrder({
    merchantId: "m1",
    sessionId: "sess_abc123xyz",
    cart: {
      currency: "BRL",
      totalCents: 5000,
      commerceCartRef: "ref",
      lines: [{ sku: "SKU-1", quantity: 1, unitPriceCents: 5000, title: "Item" }],
    },
  });

  assert.equal(result.commerceOrderId, "555");
  assert.ok(calls[0]!.url.includes("/orders?"));
  assert.ok(calls[0]!.url.includes("access_token="));
  const parsed = JSON.parse(calls[0]!.body!) as { number: string; items: unknown[] };
  assert.ok(parsed.number.startsWith("AACP-"));
});

test("Tray adapter marks order paid", async () => {
  const calls: { url: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return json({ id: 100, status: "invoiced" });
  };

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  await adapter.markOrderPaid({
    merchantId: "m1",
    commerceOrderId: "100",
    paymentReference: "pay_ref_123",
  });

  assert.ok(calls[0]!.url.includes("/orders/100?"));
  const parsed = JSON.parse(calls[0]!.body!) as { status: string };
  assert.equal(parsed.status, "invoiced");
});

test("Tray adapter cancels order", async () => {
  const calls: { url: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return json({ id: 100, status: "cancelled" });
  };

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  await adapter.cancelOrder({
    merchantId: "m1",
    commerceOrderId: "100",
    reason: "Customer request",
  });

  assert.ok(calls[0]!.url.includes("/orders/100/cancel?"));
  const parsed = JSON.parse(calls[0]!.body!) as { status: string; note: string };
  assert.equal(parsed.status, "cancelled");
  assert.equal(parsed.note, "Customer request");
});

test("Tray adapter triggers token refresh when expired", async () => {
  let refreshCalled = false;
  let callCount = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    callCount++;
    // First call is the refresh attempt
    if (url.includes("/auth")) {
      refreshCalled = true;
      return json({
        access_token: "new_token",
        refresh_token: "new_refresh",
        date_expiration_access_token: Math.floor(Date.now() / 1000) + 86400,
      });
    }
    // Second call is the actual request with new token
    assert.ok(url.includes("access_token=new_token"), "should use refreshed token");
    return json({ store_name: "Store", currency: "BRL" });
  };

  const creds = baseCreds({
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 100, // expired
  });
  const adapter = new TrayCommerceAdapter(creds, fetchImpl);
  await adapter.testConnection();

  assert.ok(refreshCalled, "should have called refresh");
  assert.equal(callCount, 2, "refresh call + actual request");
});

test("Tray adapter throws on app-level code 1000 (expired token)", async () => {
  const fetchImpl: typeof fetch = async () =>
    json({ code: 1000, message: "Token expired" });

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  await assert.rejects(
    () => adapter.testConnection(),
    /token_expired/,
  );
});

test("Tray adapter throws descriptive error on non-OK response", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  const adapter = new TrayCommerceAdapter(baseCreds(), fetchImpl);
  await assert.rejects(
    () => adapter.testConnection(),
    /tray_test_connection_failed_404/,
  );
});

test("Tray adapter rejects missing credentials", () => {
  assert.throws(
    () => new TrayCommerceAdapter({ ...baseCreds(), apiAddress: "" }),
    /tray_api_address_required/,
  );
  assert.throws(
    () => new TrayCommerceAdapter({ ...baseCreds(), accessToken: "" }),
    /tray_access_token_required/,
  );
  assert.throws(
    () => new TrayCommerceAdapter({ ...baseCreds(), refreshToken: "" }),
    /tray_refresh_token_required/,
  );
});
