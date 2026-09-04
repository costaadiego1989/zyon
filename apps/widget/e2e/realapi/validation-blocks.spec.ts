/**
 * Validation Blocks 3-5-6 — M2M Protocol, Cross-sell, Chargeback
 *
 * BLOCK 3: M2M full flow (register → discover → negotiate → quote → checkout → track)
 * BLOCK 4: Cross-sell rendering check via API
 * BLOCK 5: Chargeback infrastructure verification
 */
import { test, expect } from "@playwright/test";
import { REALAPI_URL, seedCheckout, openChatCheckout } from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function login(request: any): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: "costaadiego1989@gmail.com", password: "ueuf3900" },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.access_token;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── BLOCK 3: M2M Full Flow ─────────────────────────────────────────────────

test.describe("@realapi BLOCK 3: M2M protocol flow", () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request);
  });

  test("POST /m2m/register — agent registration", async ({ request }) => {
    const res = await request.post(`${API}/m2m/register`, {
      headers: headers(token),
      data: { agentId: "e2e-agent-001" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("merchantId");
    expect(body).toHaveProperty("agentId", "e2e-agent-001");
    expect(body).toHaveProperty("message");
  });

  test("POST /m2m/discover — catalog search", async ({ request }) => {
    const res = await request.post(`${API}/m2m/discover`, {
      headers: headers(token),
      data: { query: "camiseta" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("merchantId");
    expect(body).toHaveProperty("query", "camiseta");
    expect(body).toHaveProperty("results");
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("POST /m2m/negotiate — initiate negotiation", async ({ request }) => {
    const res = await request.post(`${API}/m2m/negotiate`, {
      headers: headers(token),
      data: { sessionId: "e2e-session-001" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("merchantId");
    expect(body).toHaveProperty("sessionId", "e2e-session-001");
  });

  test("POST /m2m/quote — get pricing quote", async ({ request }) => {
    const res = await request.post(`${API}/m2m/quote`, {
      headers: headers(token),
      data: { cart: { items: [{ sku: "SKU-001", qty: 2 }] } },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("quote");
    expect(body.quote).toHaveProperty("subtotalCents");
    expect(body.quote).toHaveProperty("shippingCents");
    expect(body.quote).toHaveProperty("totalCents");
  });

  test("POST /m2m/checkout — create order", async ({ request }) => {
    const res = await request.post(`${API}/m2m/checkout`, {
      headers: headers(token),
      data: { orderId: "e2e-order-001" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("merchantId");
    expect(body).toHaveProperty("orderId", "e2e-order-001");
  });

  test("GET /m2m/track/:orderId — track fulfillment", async ({ request }) => {
    const res = await request.get(`${API}/m2m/track/e2e-order-001`, {
      headers: headers(token),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("orderId", "e2e-order-001");
    expect(body).toHaveProperty("status");
    expect(["pending", "processing", "shipped", "delivered"]).toContain(body.status);
  });

  test("M2M endpoints reject unauthenticated requests", async ({ request }) => {
    const endpoints = [
      { method: "POST", path: "/m2m/register" },
      { method: "POST", path: "/m2m/discover" },
      { method: "POST", path: "/m2m/negotiate" },
      { method: "POST", path: "/m2m/quote" },
      { method: "POST", path: "/m2m/checkout" },
      { method: "GET", path: "/m2m/track/any-id" },
    ];

    for (const ep of endpoints) {
      const res = ep.method === "GET"
        ? await request.get(`${API}${ep.path}`)
        : await request.post(`${API}${ep.path}`, { data: {} });
      expect(res.status()).toBe(401);
    }
  });
});

// ─── BLOCK 4: Cross-sell Rendering Check ─────────────────────────────────────

test.describe("@realapi BLOCK 4: Cross-sell", () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request);
  });

  test("GET /merchant/cross-sell/promotions — returns promotions array", async ({ request }) => {
    const res = await request.get(`${API}/merchant/cross-sell/promotions`, {
      headers: headers(token),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("cross-sell promotions have recommended SKUs configured", async ({ request }) => {
    const promoRes = await request.get(`${API}/merchant/cross-sell/promotions`, {
      headers: headers(token),
    });
    expect(promoRes.ok()).toBe(true);
    const promos = await promoRes.json();
    expect(Array.isArray(promos)).toBe(true);
    // E2E seeds create cross-sell promotions with recommended_skus
    const hasE2ePromo = promos.some(
      (p: any) => p.s?.recommended_skus?.length > 0 || p.recommended_skus?.length > 0,
    );
    expect(hasE2ePromo).toBe(true);
  });
});

// ─── BLOCK 5: Chargeback Infrastructure ──────────────────────────────────────

test.describe("@realapi BLOCK 5: Chargeback", () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request);
  });

  test("GET /marketplace/dashboard/chargebacks — returns chargebacks list", async ({ request }) => {
    const res = await request.get(`${API}/marketplace/dashboard/chargebacks`, {
      headers: headers(token),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("chargebacks");
    expect(Array.isArray(body.chargebacks)).toBe(true);
    expect(body).toHaveProperty("totalDebtCents");
    expect(body).toHaveProperty("totalCancelled");
    expect(body).toHaveProperty("totalWithDebt");
  });

  test("POST /marketplace/dashboard/chargeback/:id — handles chargeback event", async ({ request }) => {
    // Create a chargeback request against a non-existent settlement
    const res = await request.post(`${API}/marketplace/dashboard/chargeback/nonexistent-id`, {
      headers: headers(token),
    });
    // Should fail gracefully (500 or 404) — settlement not found
    expect([404, 500]).toContain(res.status());
  });

  test("chargeback endpoint rejects unauthenticated", async ({ request }) => {
    const res = await request.get(`${API}/marketplace/dashboard/chargebacks`);
    expect(res.status()).toBe(401);
  });
});
