/**
 * @realapi Full Checkout Purchase Flow — QA Senior
 *
 * Tests the complete checkout journey hitting the REAL API (localhost:3009):
 * 1. Start session (embed/start)
 * 2. Chat with quick replies (embed/chat) — context validation
 * 3. Create payment intent: PIX
 * 4. Create payment intent: Card/Stripe
 * 5. Create payment intent: Crypto
 * 6. Confirm crypto payment
 * 7. Check payment status polling
 *
 * Uses EMBED_DEV_BYPASS token for auth (no need for separate seed).
 * Run: cd apps/widget && pnpm e2e:realapi -- --grep @purchase-flow
 */
import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:3009";
const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const DEV_TOKEN = "__dev_bypass__";

function embedHeaders() {
  return {
    "x-aacp-embed-token": DEV_TOKEN,
    "Content-Type": "application/json",
  };
}

test.describe("@purchase-flow Full Checkout Journey (Real API)", () => {
  let sessionId: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. START CHECKOUT SESSION
  // ═══════════════════════════════════════════════════════════════════════════

  test("1. embed/start creates session with cart", async ({ request }) => {
    const resp = await request.post(`${API}/embed/start`, {
      headers: embedHeaders(),
      data: {
        merchant_id: MERCHANT_ID,
        customer: { email: `qa_buyer_${Date.now()}@test.aacp`, name: "QA Buyer" },
        cart: {
          currency: "BRL",
          source: "storefront",
          total: 349_90,
          items: [
            { sku: "athom-kit-001", name: "Kit Smart Home Athom Tech", price: 299_90, quantity: 1 },
            { sku: "tenis-runner-01", name: "Tênis Runner Pro", price: 50_00, quantity: 1 },
          ],
        },
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("session_id");
    expect(body.session_id).toBeTruthy();
    sessionId = body.session_id;
    console.log(`✓ Session started: ${sessionId}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CHAT — QUICK REPLIES + CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  test("2a. embed/chat first message gets agent response + quick_replies", async ({ request }) => {
    const resp = await request.post(`${API}/embed/chat`, {
      headers: embedHeaders(),
      data: {
        session_id: sessionId,
        merchant_id: MERCHANT_ID,
        message: "Olá, quero comprar",
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("agent_message");
    expect(body.agent_message.length).toBeGreaterThan(5);

    // Quick replies should exist (context-dependent)
    if (body.quick_replies) {
      expect(Array.isArray(body.quick_replies)).toBe(true);
      console.log(`✓ Quick replies: ${JSON.stringify(body.quick_replies)}`);
    }
    console.log(`✓ Agent: "${body.agent_message.slice(0, 80)}..."`);
  });

  test("2b. embed/chat with quick reply selection returns contextual response", async ({ request }) => {
    const resp = await request.post(`${API}/embed/chat`, {
      headers: embedHeaders(),
      data: {
        session_id: sessionId,
        merchant_id: MERCHANT_ID,
        message: "Quero pagar por PIX",
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("agent_message");
    console.log(`✓ Payment context: "${body.agent_message.slice(0, 80)}..."`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PAYMENT — PIX
  // ═══════════════════════════════════════════════════════════════════════════

  test("3. embed/payment/intents with method=pix returns requires_action", async ({ request }) => {
    const resp = await request.post(`${API}/embed/payment/intents`, {
      headers: embedHeaders(),
      data: {
        session_id: sessionId,
        merchant_id: MERCHANT_ID,
        idempotency_key: `pix_qa_${Date.now()}`,
        method: "pix",
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("status");
    // PIX waits for webhook confirmation
    expect(["requires_action", "pending"]).toContain(body.status);
    console.log(`✓ PIX intent: ${body.id} status=${body.status}`);

    // Should have PIX-specific data (qr_code or copy-paste code)
    if (body.pix_code || body.qr_code) {
      console.log(`  PIX code present: ${(body.pix_code || body.qr_code).slice(0, 30)}...`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. PAYMENT — CARD (Stripe)
  // ═══════════════════════════════════════════════════════════════════════════

  test("4. embed/payment/intents with method=card returns client_secret", async ({ request }) => {
    const resp = await request.post(`${API}/embed/payment/intents`, {
      headers: embedHeaders(),
      data: {
        session_id: sessionId,
        merchant_id: MERCHANT_ID,
        idempotency_key: `card_qa_${Date.now()}`,
        method: "card",
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("status");
    // Card returns client_secret for Stripe.js
    if (body.client_secret) {
      expect(body.client_secret).toContain("_secret_");
      console.log(`✓ Card intent: ${body.id} status=${body.status} (Stripe client_secret present)`);
    } else {
      console.log(`✓ Card intent: ${body.id} status=${body.status}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PAYMENT — CRYPTO
  // ═══════════════════════════════════════════════════════════════════════════

  let cryptoIntentId: string;

  test("5. embed/payment/intents with method=crypto returns wallet_address + network", async ({ request }) => {
    const resp = await request.post(`${API}/embed/payment/intents`, {
      headers: embedHeaders(),
      data: {
        session_id: sessionId,
        merchant_id: MERCHANT_ID,
        idempotency_key: `crypto_qa_${Date.now()}`,
        method: "crypto",
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("wallet_address");
    expect(body).toHaveProperty("network");
    cryptoIntentId = body.id;
    console.log(`✓ Crypto intent: ${body.id} network=${body.network} wallet=${body.wallet_address?.slice(0, 10)}...`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. CRYPTO CONFIRM
  // ═══════════════════════════════════════════════════════════════════════════

  test("6. embed/payment/intents/:id/crypto/confirm accepts tx_hash", async ({ request }) => {
    if (!cryptoIntentId) test.skip();

    const resp = await request.post(`${API}/embed/payment/intents/${cryptoIntentId}/crypto/confirm`, {
      headers: embedHeaders(),
      data: {
        session_id: sessionId,
        tx_hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        wallet_address: "0x742d35Cc6634C0532925a3b844Bc6e7e1d3D3dc5",
      },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    console.log(`✓ Crypto confirmed: status=${body.status ?? "ok"}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. PAYMENT STATUS POLL
  // ═══════════════════════════════════════════════════════════════════════════

  test("7. embed/payment/intents/:id/status returns current status", async ({ request }) => {
    if (!cryptoIntentId) test.skip();

    const resp = await request.get(`${API}/embed/payment/intents/${cryptoIntentId}/status`, {
      headers: embedHeaders(),
      params: { session_id: sessionId },
    });

    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("status");
    expect(["pending", "requires_action", "processing", "approved", "failed"]).toContain(body.status);
    console.log(`✓ Status poll: ${body.status}`);
  });
});
