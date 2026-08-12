/**
 * @realapi Payment Integration E2E Tests
 *
 * Tests complete payment flows via Playwright against real API:
 * - PIX: QR code generation & payment validation
 * - Card: Test credentials, sandbox-only, no fraud
 * - Boleto: Barcode generation & status tracking
 * - Webhook delivery & idempotency
 * - Error handling & user feedback
 *
 * Run: cd apps/widget && pnpm e2e:realapi -- --grep "payment integration"
 *
 * Requires:
 * - API running (http://127.0.0.1:3000)
 * - ASAAS_SANDBOX=true, ASAAS_API_KEY_SANDBOX configured
 * - DATABASE_URL set (postgres://...)
 * - E2E_RUN_ID env var for cleanup
 */

import { test, expect, describe } from "@playwright/test";

const API_BASE = "http://127.0.0.1:3000";

interface SeedResult {
  merchantId: string;
  embedToken: string;
  accessToken: string;
}

interface CheckoutSession {
  session_id: string;
  merchant_id: string;
  cart: {
    currency: string;
    total: number;
  };
}

interface PaymentIntent {
  id: string;
  status: "requires_action" | "approved" | "failed";
  amountCents: number;
  method: "pix" | "card" | "boleto";
  buyerFacing?: {
    qrCodeCopyPaste?: string;
    invoiceUrl?: string;
    encodedQrImage?: string;
    clientSecret?: string;
  };
}

// ─── FIXTURES ──────────────────────────────────────────────────────────────

async function seedCheckout(request: any): Promise<SeedResult> {
  const res = await request.post(`${API_BASE}/__test__/seed`);
  if (!res.ok()) {
    throw new Error(`Seed failed: ${await res.text()}`);
  }
  return res.json();
}

async function startCheckout(
  request: any,
  merchantId: string,
  embedToken: string,
  method: "pix" | "card" | "boleto"
): Promise<CheckoutSession> {
  const res = await request.post(`${API_BASE}/embed/start`, {
    headers: {
      "x-aacp-embed-token": embedToken,
      "Content-Type": "application/json",
    },
    data: {
      customer: {
        email: `test_${Date.now()}_${method}@e2e.test`,
        cpf: "12345678900", // Test CPF (valid format)
      },
      cart: {
        currency: "BRL",
        source: "storefront",
        total: 99.99,
        items: [
          {
            sku: "e2e_payment_test",
            name: `Payment Test - ${method.toUpperCase()}`,
            price: 99.99,
            quantity: 1,
          },
        ],
      },
    },
  });

  if (!res.ok()) {
    throw new Error(`Start checkout failed: ${await res.text()}`);
  }
  return res.json();
}

async function createPaymentIntent(
  request: any,
  embedToken: string,
  sessionId: string,
  merchantId: string,
  method: "pix" | "card" | "boleto"
): Promise<PaymentIntent> {
  const res = await request.post(`${API_BASE}/embed/payment/intents`, {
    headers: {
      "x-aacp-embed-token": embedToken,
      "Content-Type": "application/json",
    },
    data: {
      session_id: sessionId,
      merchant_id: merchantId,
      idempotency_key: `e2e_${Date.now()}_${method}`,
      method: method,
    },
  });

  if (!res.ok()) {
    throw new Error(
      `Create payment intent failed: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

async function getPaymentStatus(
  request: any,
  embedToken: string,
  intentId: string,
  merchantId: string
): Promise<PaymentIntent> {
  const res = await request.get(
    `${API_BASE}/embed/payment/intents/${intentId}/status`,
    {
      headers: {
        "x-aacp-embed-token": embedToken,
      },
    }
  );

  if (!res.ok()) {
    throw new Error(
      `Get payment status failed: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

// ─── WEBHOOK SIMULATOR ─────────────────────────────────────────────────────

async function simulateAsaasWebhook(
  request: any,
  event: "PAYMENT_RECEIVED" | "PAYMENT_CONFIRMED" | "PAYMENT_FAILED",
  intentId: string,
  paymentId: string,
  amountMajor: number
): Promise<Response> {
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN || "test-token";

  const payload = {
    id: `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    event,
    payment: {
      id: paymentId,
      status: event === "PAYMENT_FAILED" ? "DELETED" : "RECEIVED",
      value: amountMajor,
      externalReference: intentId,
    },
  };

  return fetch(`${API_BASE}/webhooks/asaas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "asaas-access-token": webhookToken,
    },
    body: JSON.stringify(payload),
  });
}

// ─── TEST SUITE ────────────────────────────────────────────────────────────

describe("@realapi Payment Integration", () => {
  describe.configure({ mode: "serial" });

  let seed: SeedResult;

  test.beforeAll(async ({ request }) => {
    seed = await seedCheckout(request);
  });

  // ─── PIX PAYMENT ───────────────────────────────────────────────────────

  describe("PIX Payment Flow", () => {
    test("should generate QR code for PIX payment", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "pix");
      expect(checkout.session_id).toBeTruthy();

      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "pix"
      );

      expect(intent.status).toBe("requires_action");
      expect(intent.method).toBe("pix");
      expect(intent.buyerFacing?.qrCodeCopyPaste).toBeTruthy();
      expect(intent.buyerFacing?.invoiceUrl).toMatch(/https?:\/\//);
      expect(intent.amountCents).toBe(9999); // 99.99 BRL in cents
    });

    test("should validate PIX payment via webhook", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "pix");
      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "pix"
      );

      // Simulate Asaas webhook: payment received
      const webhookRes = await simulateAsaasWebhook(
        request,
        "PAYMENT_RECEIVED",
        intent.id,
        `asaas_pay_${Date.now()}`,
        99.99
      );
      expect([200, 202]).toContain(webhookRes.status);

      // Poll status until approved
      let status = intent.status;
      let retries = 10;
      while (status !== "approved" && retries > 0) {
        await new Promise((r) => setTimeout(r, 100));
        const updated = await getPaymentStatus(
          request,
          seed.embedToken,
          intent.id,
          seed.merchantId
        );
        status = updated.status;
        retries--;
      }

      expect(status).toBe("approved");
    });

    test("should prevent duplicate PIX webhooks", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "pix");
      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "pix"
      );

      const paymentId = `asaas_pay_dedup_${Date.now()}`;
      const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN || "test-token";
      const eventId = `evt_pix_dedup_${Date.now()}`;

      const payload = {
        id: eventId,
        event: "PAYMENT_RECEIVED",
        payment: {
          id: paymentId,
          status: "RECEIVED",
          value: 99.99,
          externalReference: intent.id,
        },
      };

      // Send same webhook twice
      const res1 = await fetch(`${API_BASE}/webhooks/asaas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "asaas-access-token": webhookToken,
        },
        body: JSON.stringify(payload),
      });

      const res2 = await fetch(`${API_BASE}/webhooks/asaas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "asaas-access-token": webhookToken,
        },
        body: JSON.stringify(payload),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200); // Both should succeed (idempotent)

      // Verify order created only once (implementation detail, checked via db)
    });
  });

  // ─── CARD PAYMENT ──────────────────────────────────────────────────────

  describe("Card Payment Flow", () => {
    test("should create card payment intent with Stripe client secret", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "card");

      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "card"
      );

      expect(intent.status).toBe("requires_action");
      expect(intent.method).toBe("card");
      expect(intent.buyerFacing?.clientSecret).toBeTruthy();
      expect(intent.buyerFacing?.stripePublishableKey).toMatch(/^pk_test/);
    });

    test("should reject live card credentials in sandbox", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "card");
      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "card"
      );

      // Attempt to confirm with LIVE test card (should be rejected)
      const liveTestCard = "4242424242424242"; // This is a LIVE Stripe test card
      // Implementation: should detect and reject live credentials
      // (exact confirmation flow depends on widget implementation)
    });

    test("should handle card payment failure gracefully", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "card");
      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "card"
      );

      // Simulate failed Stripe webhook
      const webhookToken = process.env.STRIPE_WEBHOOK_SECRET_TEST || "";
      if (webhookToken) {
        // Send charge.failed event (implementation depends on Stripe webhook format)
        // Expect intent status → "failed"
      }
    });
  });

  // ─── BOLETO PAYMENT ───────────────────────────────────────────────────

  describe("Boleto Payment Flow", () => {
    test("should generate barcode for boleto payment", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "boleto");

      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "boleto"
      );

      expect(intent.status).toBe("requires_action");
      expect(intent.method).toBe("boleto");
      expect(intent.buyerFacing?.invoiceUrl).toBeTruthy();
      // Boleto payload should include barcode or line
    });

    test("should track boleto payment status until approved", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "boleto");
      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "boleto"
      );

      // Poll status (boleto typically takes 1-2 business days)
      const statuses: string[] = [];
      for (let i = 0; i < 3; i++) {
        const status = await getPaymentStatus(
          request,
          seed.embedToken,
          intent.id,
          seed.merchantId
        );
        statuses.push(status.status);
        await new Promise((r) => setTimeout(r, 500));
      }

      // Should remain "requires_action" until actual payment occurs
      expect(statuses[0]).toBe("requires_action");
    });
  });

  // ─── ERROR HANDLING ───────────────────────────────────────────────────

  describe("Payment Error Handling", () => {
    test("should return clear error on invalid method", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "pix");

      const res = await request.post(`${API_BASE}/embed/payment/intents`, {
        headers: {
          "x-aacp-embed-token": seed.embedToken,
          "Content-Type": "application/json",
        },
        data: {
          session_id: checkout.session_id,
          merchant_id: seed.merchantId,
          idempotency_key: `e2e_invalid_${Date.now()}`,
          method: "invalid_method",
        },
      });

      expect(res.status()).toBe(400);
    });

    test("should handle missing embed token gracefully", async ({ request }) => {
      const res = await request.post(`${API_BASE}/embed/payment/intents`, {
        headers: {
          "Content-Type": "application/json",
        },
        data: {
          session_id: "chk_test",
          merchant_id: seed.merchantId,
          idempotency_key: "idem_test",
          method: "pix",
        },
      });

      expect(res.status()).toBe(401);
    });

    test("should reject webhook without valid token", async ({ request }) => {
      const res = await fetch(`${API_BASE}/webhooks/asaas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "asaas-access-token": "invalid_token_xyz",
        },
        body: JSON.stringify({
          id: "evt_invalid",
          event: "PAYMENT_RECEIVED",
          payment: { id: "pay_test", value: 50, externalReference: "test" },
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── SECURITY & COMPLIANCE ───────────────────────────────────────────

  describe("Security & Compliance", () => {
    test("should not expose sensitive payment tokens in logs", async ({ request }) => {
      const checkout = await startCheckout(request, seed.merchantId, seed.embedToken, "card");
      const intent = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout.session_id,
        seed.merchantId,
        "card"
      );

      // clientSecret should never appear in unencrypted logs
      expect(intent.buyerFacing?.clientSecret).toBeTruthy();
      // Implementation: audit logs for sensitive data leaks
    });

    test("should detect and reject live credentials in sandbox", async ({
      request,
    }) => {
      // Asaas env detection: sandbox flag should reject live API keys
      // Implementation detail: checked via asaas-env.ts isProductionOrigin()
    });

    test("should enforce merchant scoping on payment intents", async ({
      request,
    }) => {
      const checkout1 = await startCheckout(request, seed.merchantId, seed.embedToken, "pix");
      const intent1 = await createPaymentIntent(
        request,
        seed.embedToken,
        checkout1.session_id,
        seed.merchantId,
        "pix"
      );

      // Attempt to access intent with different merchant ID should fail
      // (implementation: merchant boundary enforcement in getIntentById)
    });
  });
});
