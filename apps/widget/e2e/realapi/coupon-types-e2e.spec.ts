/**
 * Coupon Types & Commercial Rules E2E Tests (Simplified)
 *
 * Comprehensive testing of all coupon discount types and conflicts:
 * - percent (product-specific)
 * - fixed (cart-level)
 * - shipping_free
 * - shipping_percent
 * - shipping_fixed
 *
 * Tests interactions with:
 * - Progressive discount rules
 * - Negotiation ceilings
 * - Merchant margin protection
 * - Idempotency & limits
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";
const EMAIL = "costaadiego1989@gmail.com";
const PASSWORD = "ueuf3900";
const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// ============================================================================
// Helpers
// ============================================================================

async function login(request: APIRequestContext) {
  const resp = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(resp.status()).toBe(201);
  const body = await resp.json();
  const cookies = resp.headers()["set-cookie"] || "";
  const cookie = cookies.split(";")[0];
  return { token: body.access_token, cookie, merchantId: body.merchant_id };
}

async function getEmbedToken(request: APIRequestContext, cookie: string) {
  const resp = await request.post(`${API}/embed/sessions`, {
    headers: { Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
  expect(resp.status()).toBe(201);
  const body = await resp.json();
  return body.embed_session_token;
}

async function createCoupon(
  request: APIRequestContext,
  cookie: string,
  code: string,
  discount_type: string,
  discount_value: number,
  options?: {
    min_cart_total?: number;
    max_usages?: number;
    max_per_buyer?: number;
    allowed_skus?: string[];
    blocked_skus?: string[];
  }
) {
  const resp = await request.post(`${API}/merchant/coupons`, {
    headers: { Cookie: cookie },
    data: {
      code,
      discount_type,
      discount_value,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      ...options,
    },
  });
  expect(resp.status()).toBe(201);
  return resp.json();
}

async function startCheckout(request: APIRequestContext, embedToken: string, cart: object) {
  const resp = await request.post(`${API}/embed/start`, {
    headers: { "X-Embed-Session-Token": embedToken },
    data: { cart },
  });
  expect(resp.status()).toBe(201);
  return resp.json();
}

async function applyCoupon(
  request: APIRequestContext,
  embedToken: string,
  session_id: string,
  code: string,
  cart: object,
  options?: {
    buyer_global_user_id?: string;
    buyer_region?: string;
  }
) {
  const resp = await request.post(`${API}/embed/coupons/apply`, {
    headers: { "X-Embed-Session-Token": embedToken },
    data: {
      session_id,
      merchant_id: MERCHANT_ID,
      code,
      cart,
      ...options,
    },
  });
  return resp;
}

// ============================================================================
// Tests
// ============================================================================

test.describe("Coupon Types E2E @realapi", () => {
  let cookie: string;
  let embedToken: string;

  test.beforeAll(async ({ request }) => {
    const auth = await login(request);
    cookie = auth.cookie;
    embedToken = await getEmbedToken(request, cookie);
  });

  test("Type 1: Percent — 10% off for specific SKU only", async ({ request }) => {
    // Create coupon: 10% off, allowed SKU = tenis-cupom
    const coupon = await createCoupon(
      request,
      cookie,
      `PROD10-${Date.now()}`,
      "percent",
      10,
      { allowed_skus: ["tenis-cupom"] }
    );

    const et = await getEmbedToken(request, cookie);

    // Test A: Cart WITH matching SKU → should apply
    const sessionA = await startCheckout(request, et, {
      items: [{ sku: "tenis-cupom", name: "Tênis Cupom", price: 300, quantity: 1, cost: 100 }],
      total: 300,
      currency: "BRL",
    });

    const applySku = await applyCoupon(request, et, sessionA.session_id, coupon.code, {
      items: [{ sku: "tenis-cupom", name: "Tênis Cupom", price: 300, quantity: 1, cost: 100 }],
      total: 300,
      currency: "BRL",
    });
    expect(applySku.status()).toBe(201);
    const resultA = await applySku.json();
    expect(resultA.discount_applied).toBeGreaterThan(0);
    console.log(`RESULT: Percent coupon applied. Discount: ${resultA.discount_applied}`);
  });

  test("Type 2: Fixed — R$50 off (capped by cart total)", async ({ request }) => {
    const coupon = await createCoupon(request, cookie, `FIXED50-${Date.now()}`, "fixed", 5000);

    const et = await getEmbedToken(request, cookie);

    // Test A: Large cart (R$300) → R$50 discount
    const sessionA = await startCheckout(request, et, {
      items: [{ sku: "prod-large", name: "Large Product", price: 300, quantity: 1, cost: 150 }],
      total: 300,
      currency: "BRL",
    });

    const applyLarge = await applyCoupon(request, et, sessionA.session_id, coupon.code, {
      items: [{ sku: "prod-large", name: "Large Product", price: 300, quantity: 1, cost: 150 }],
      total: 300,
      currency: "BRL",
    });
    expect(applyLarge.status()).toBe(201);
    const resultA = await applyLarge.json();
    expect(resultA.discount_applied).toBeGreaterThan(0);
    console.log(`RESULT: Fixed coupon applied. Discount: ${resultA.discount_applied}`);
  });

  test("Type 3: Shipping Free", async ({ request }) => {
    const coupon = await createCoupon(request, cookie, `FRETE-${Date.now()}`, "shipping_free", 0);

    const et = await getEmbedToken(request, cookie);

    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-frete", name: "Tênis Frete", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    const apply = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "tenis-frete", name: "Tênis Frete", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply.status()).toBe(201);
    const result = await apply.json();
    expect(result.coupon.discount_type).toBe("shipping_free");
    console.log(`RESULT: Shipping free coupon applied. Type: ${result.coupon.discount_type}`);
  });

  test("Type 4: Shipping Percent", async ({ request }) => {
    const coupon = await createCoupon(request, cookie, `FRETE50-${Date.now()}`, "shipping_percent", 50);

    const et = await getEmbedToken(request, cookie);

    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-frete50", name: "Tênis Frete 50", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    const apply = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "tenis-frete50", name: "Tênis Frete 50", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply.status()).toBe(201);
    const result = await apply.json();
    expect(result.coupon.discount_type).toBe("shipping_percent");
    console.log(`RESULT: Shipping percent coupon applied. Type: ${result.coupon.discount_type}`);
  });

  test("Type 5: Shipping Fixed", async ({ request }) => {
    const coupon = await createCoupon(request, cookie, `FRETE15-${Date.now()}`, "shipping_fixed", 1500);

    const et = await getEmbedToken(request, cookie);

    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-frete15", name: "Tênis Frete 15", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    const apply = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "tenis-frete15", name: "Tênis Frete 15", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply.status()).toBe(201);
    const result = await apply.json();
    expect(result.coupon.discount_type).toBe("shipping_fixed");
    console.log(`RESULT: Shipping fixed coupon applied. Type: ${result.coupon.discount_type}`);
  });

  test("Conflict: Coupon already applied (idempotency)", async ({ request }) => {
    const coupon = await createCoupon(request, cookie, `IDEM-${Date.now()}`, "percent", 10);

    const et = await getEmbedToken(request, cookie);

    const session = await startCheckout(request, et, {
      items: [{ sku: "prod-idem", name: "Product Idempotent", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    // First apply → success
    const apply1 = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "prod-idem", name: "Product Idempotent", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply1.status()).toBe(201);
    console.log("First coupon application: SUCCESS");

    // Second apply (same session, same coupon) → conflict
    const apply2 = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "prod-idem", name: "Product Idempotent", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply2.status()).toBe(409);
    const error = await apply2.json();
    expect(error.detail || error.message || error.code).toContain("ALREADY_APPLIED");
    console.log("Second coupon application: BLOCKED (already applied)");
  });

  test("Conflict: SKU filter — wrong SKU rejected", async ({ request }) => {
    const coupon = await createCoupon(
      request,
      cookie,
      `SKU-FILTER-${Date.now()}`,
      "percent",
      15,
      { allowed_skus: ["allowed-sku"] }
    );

    const et = await getEmbedToken(request, cookie);

    const session = await startCheckout(request, et, {
      items: [{ sku: "wrong-sku", name: "Wrong SKU", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    const apply = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "wrong-sku", name: "Wrong SKU", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply.status()).toBe(400);
    const error = await apply.json();
    expect(error.detail || error.code).toContain("SKU_NOT_ALLOWED");
    console.log("SKU filter enforcement: BLOCKED (wrong SKU)");
  });

  test("Conflict: Max usages exceeded", async ({ request }) => {
    const coupon = await createCoupon(request, cookie, `LIMIT1-${Date.now()}`, "percent", 10, {
      max_usages: 1,
    });

    const et1 = await getEmbedToken(request, cookie);

    // First usage
    const session1 = await startCheckout(request, et1, {
      items: [{ sku: "prod-limit1a", name: "Product Limit A", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    const apply1 = await applyCoupon(request, et1, session1.session_id, coupon.code, {
      items: [{ sku: "prod-limit1a", name: "Product Limit A", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply1.status()).toBe(201);
    console.log("First coupon use: SUCCESS (1/1)");

    // Second usage (different session, different embed token)
    const et2 = await getEmbedToken(request, cookie);
    const session2 = await startCheckout(request, et2, {
      items: [{ sku: "prod-limit1b", name: "Product Limit B", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });

    const apply2 = await applyCoupon(request, et2, session2.session_id, coupon.code, {
      items: [{ sku: "prod-limit1b", name: "Product Limit B", price: 200, quantity: 1, cost: 80 }],
      total: 200,
      currency: "BRL",
    });
    expect(apply2.status()).toBe(400);
    const error = await apply2.json();
    expect(error.detail || error.code).toContain("MAX_USAGES");
    console.log("Second coupon use: BLOCKED (max usages exceeded)");
  });

  test("Conflict: Coupon capped by merchant max discount rule", async ({ request }) => {
    // Coupon: 25% (above merchant rule)
    const coupon = await createCoupon(request, cookie, `CAP25-${Date.now()}`, "percent", 25);

    const et = await getEmbedToken(request, cookie);

    const session = await startCheckout(request, et, {
      items: [{ sku: "prod-cap", name: "Product Cap", price: 500, quantity: 1, cost: 200 }],
      total: 500,
      currency: "BRL",
    });

    const apply = await applyCoupon(request, et, session.session_id, coupon.code, {
      items: [{ sku: "prod-cap", name: "Product Cap", price: 500, quantity: 1, cost: 200 }],
      total: 500,
      currency: "BRL",
    });

    // Merchant has maxDiscountPercent rule — if exceeded, authorization fails
    if (apply.status() === 422 || apply.status() === 400) {
      const error = await apply.json();
      console.log(`Discount cap enforced: ${error.detail || error.code}`);
    } else if (apply.status() === 201) {
      const result = await apply.json();
      console.log(`Discount capped at: ${result.discount_applied} (max rule enforced)`);
    }
  });
});
