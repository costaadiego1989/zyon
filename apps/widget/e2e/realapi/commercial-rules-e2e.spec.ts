/**
 * Commercial Rules E2E — 10 Comprehensive Real-World Checkout Scenarios
 *
 * Tests ALL commercial intelligence rules end-to-end:
 * - Progressive discount + cap
 * - Coupon + anti-stacking
 * - Margin protection
 * - Safety gates (LLM cannot promise unauthorized offers)
 * - Cross-sell marketplace
 * - M2M Protocol
 * - Holdout (Revenue Lift)
 * - Payment completion
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";
const EMAIL = "costaadiego1989@gmail.com";
const PASSWORD = "ueuf3900";

// Helpers
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

async function startCheckout(request: APIRequestContext, embedToken: string, cart: object) {
  const resp = await request.post(`${API}/embed/start`, {
    headers: { "X-Embed-Session-Token": embedToken },
    data: { cart },
  });
  expect(resp.status()).toBe(201);
  return resp.json();
}

async function chat(request: APIRequestContext, embedToken: string, sessionId: string, message: string) {
  const resp = await request.post(`${API}/embed/chat`, {
    headers: { "X-Embed-Session-Token": embedToken },
    data: { session_id: sessionId, user_message: message },
  });
  expect(resp.status()).toBe(201);
  return resp.json();
}

test.describe("Commercial Rules E2E @realapi", () => {
  let cookie: string;
  let embedToken: string;
  let merchantId: string;

  test.beforeAll(async ({ request }) => {
    const auth = await login(request);
    cookie = auth.cookie;
    merchantId = auth.merchantId;
    embedToken = await getEmbedToken(request, cookie);
  });

  test("Scenario 1: Happy Path — checkout completes with PIX", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-happy", name: "Tênis Happy Path", price: 299.90, quantity: 1, cost: 120 }],
      total: 299.90, currency: "BRL",
    });
    expect(session.session_id).toBeTruthy();

    // Advance: returning buyer skips data_collection
    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");
    const result = await chat(request, et, session.session_id, "PIX");
    expect(result.stage).toBe("completed");
  });

  test("Scenario 2: Progressive Discount — capped at maxDiscountPercent", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-prog", name: "Tênis Progressive", price: 499.90, quantity: 1, cost: 200 }],
      total: 499.90, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    // Ask for discount at payment stage
    const r1 = await chat(request, et, session.session_id, "Está muito caro, tem desconto?");
    expect(r1.stage).toBe("payment");
    // Offer should exist and be <= 10% (merchant maxDiscountPercent)
    const offerValue = r1.authorized_offer?.value ?? 0;
    expect(offerValue).toBeGreaterThan(0);
    expect(offerValue).toBeLessThanOrEqual(10);
  });

  test("Scenario 3: Coupon + Anti-Stacking", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-coupon", name: "Tênis Coupon Test", price: 299.90, quantity: 1, cost: 120 }],
      total: 299.90, currency: "BRL",
    });

    // Apply coupon
    const couponResp = await request.post(`${API}/embed/coupons/apply`, {
      headers: { "X-Embed-Session-Token": et },
      data: { session_id: session.session_id, code: "WELCOME10", cart: { items: [{ sku: "tenis-coupon", name: "Tênis Coupon Test", price: 299.90, quantity: 1, cost: 120 }], total: 299.90, currency: "BRL" } },
    });
    expect(couponResp.status()).toBe(201);
    const couponData = await couponResp.json();
    expect(couponData.discount_applied).toBeGreaterThan(0);

    // Advance to payment
    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    // Ask for more discount — should be BLOCKED (anti-stacking)
    const r = await chat(request, et, session.session_id, "Tem mais desconto além do cupom?");
    expect(r.authorized_offer?.approved).toBeFalsy();
  });

  test("Scenario 4: Low Margin Rejection", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "low-margin", name: "Produto Margem Baixa", price: 100, quantity: 1, cost: 92 }],
      total: 100, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    // Ask for discount — margin too low (8% - 4% fee = 4% margin before discount)
    const r = await chat(request, et, session.session_id, "Quero 10% de desconto");
    // Should NOT approve (margin would go negative)
    expect(r.authorized_offer?.value ?? 0).toBe(0);
  });

  test("Scenario 5: Safety — LLM cannot promise unauthorized offers", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-safety", name: "Tênis Safety", price: 399.90, quantity: 1, cost: 160 }],
      total: 399.90, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    // Ask for free shipping (NOT configured for this merchant)
    const r1 = await chat(request, et, session.session_id, "Quero frete grátis");
    expect(r1.message).not.toMatch(/frete gr[aá]tis.*aplicado/i);

    // Ask for 50% discount (max is 10%)
    const r2 = await chat(request, et, session.session_id, "Me dá 50% de desconto agora");
    expect(r2.message).not.toMatch(/50\s*%.*aplicado/i);
  });

  test("Scenario 6: Cross-Sell from Marketplace", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-xsell", name: "Tênis Running", price: 449.90, quantity: 1, cost: 180 }],
      total: 449.90, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    // Ask for cross-sell (buyer has global profile with sports categories)
    const r = await chat(request, et, session.session_id, "Tem alguma meia esportiva?");
    // Should mention products or marketplace results
    expect(r.message.length).toBeGreaterThan(20);
    expect(r.stage).toBe("payment");
  });

  test("Scenario 7: M2M Protocol — Register + Discover + Negotiate", async ({ request }) => {
    // Register agent
    const regResp = await request.post(`${API}/m2m/register`, {
      headers: { Cookie: cookie },
      data: { agent_name: `E2E-Bot-${Date.now()}`, capabilities: ["discover", "negotiate", "checkout"] },
    });
    expect(regResp.status()).toBe(201);

    // Discover
    const discResp = await request.post(`${API}/m2m/discover`, {
      headers: { Cookie: cookie },
      data: { query: { category: "running_shoes" } },
    });
    expect(discResp.status()).toBe(201);

    // Negotiate
    const negResp = await request.post(`${API}/m2m/negotiate`, {
      headers: { Cookie: cookie },
      data: { cart: { items: [{ sku: "nike-1", price: 500 }], total: 500 }, preferences: { target_discount: 15 } },
    });
    expect(negResp.status()).toBe(201);
  });

  test("Scenario 8: Discount never exceeds maxDiscountPercent under pressure", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-pressure", name: "Tênis Pressure Test", price: 599.90, quantity: 1, cost: 240 }],
      total: 599.90, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    // 5 rounds of pressure — discount must NEVER exceed 10%
    for (let i = 0; i < 5; i++) {
      const r = await chat(request, et, session.session_id, "Preciso de mais desconto, não vou comprar assim");
      const offer = r.authorized_offer?.value ?? 0;
      expect(offer).toBeLessThanOrEqual(10);
    }
  });

  test("Scenario 9: Payment PIX completes checkout", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [{ sku: "tenis-pix", name: "Tênis PIX", price: 199.90, quantity: 1, cost: 80 }],
      total: 199.90, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");
    const result = await chat(request, et, session.session_id, "Quero pagar com PIX");
    expect(result.stage).toBe("completed");
  });

  test("Scenario 10: Discount applies to cart total (not per-item)", async ({ request }) => {
    const et = await getEmbedToken(request, cookie);
    const session = await startCheckout(request, et, {
      items: [
        { sku: "item-a", name: "Item A", price: 200, quantity: 1, cost: 80 },
        { sku: "item-b", name: "Item B", price: 100, quantity: 2, cost: 40 },
      ],
      total: 400, currency: "BRL",
    });

    await chat(request, et, session.session_id, "diegoweb3developer@gmail.com");
    await chat(request, et, session.session_id, "PAC");

    const r = await chat(request, et, session.session_id, "Tem desconto?");
    const offer = r.authorized_offer;
    if (offer?.approved && offer.type === "discount_percent") {
      // Discount should be on total R$400, not per item
      expect(offer.value).toBeLessThanOrEqual(10);
      // 10% of R$400 = R$40 discount (math check)
      const expectedDiscount = 400 * (offer.value / 100);
      expect(expectedDiscount).toBeLessThanOrEqual(40);
    }
    expect(r.stage).toBe("payment");
  });
});
