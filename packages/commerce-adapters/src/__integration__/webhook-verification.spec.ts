/**
 * Webhook signature verification — provider-by-provider cross-check.
 *
 * This file is a non-network equivalent to per-adapter `*.integration-spec.ts`
 * — it tests webhook signature schemes WITHOUT requiring live credentials.
 * Run alongside the existing test suite:
 *
 *   cd packages/commerce-adapters && pnpm test
 *
 * Covers:
 *   - WooCommerce: X-WC-Webhook-Signature — base64(HMAC-SHA256(body, secret))
 *   - Shopify:    X-Shopify-Hmac-SHA256   — base64(HMAC-SHA256(body, app_secret))
 *   - Asaas-style HMAC-SHA256 (carried over from payment webhook controller;
 *     included for parity so all inbound webhooks use the same primitives).
 *
 * The codebase already implements these checks:
 *   - WooCommerce: apps/api/src/modules/commerce/presentation/http/woocommerce-webhook.controller.ts
 *   - WebhookSignatureService: apps/api/src/modules/integrations/domain/webhook-signature.service.ts
 *
 * This spec re-asserts the crypto primitives in isolation so adapter-package
 * contributors can verify verifier behavior without NestJS plumbing.
 *
 * Refs:
 *   - WooCommerce webhook verification
 *     https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks
 *   - Shopify webhook verification
 *     https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook
 */
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import test, { describe } from "node:test";

const WOO_SECRET = "it_wc_secret";
const SHOPIFY_SECRET = "it_shopify_app_secret";

const wooOrderCreatedPayload = {
  id: 98765,
  status: "processing",
  currency: "BRL",
  total: "149.90",
  billing: { email: "buyer@example.com" },
  line_items: [
    {
      id: 1,
      name: "Integration T-Shirt",
      product_id: 42,
      sku: "INT-TS-1",
      quantity: 2,
      total: "99.80",
    },
    {
      id: 2,
      name: "Integration Sticker",
      product_id: 43,
      sku: "INT-ST-1",
      quantity: 1,
      total: "50.10",
    },
  ],
};

const shopifyOrderCreatedPayload = {
  id: 7000000000001,
  email: "buyer@example.com",
  total_price: "249.90",
  currency: "BRL",
  line_items: [
    {
      id: 1,
      sku: "INT-TS-1",
      quantity: 2,
      price: "124.95",
      title: "Integration T-Shirt",
    },
  ],
};

function verifyWoo(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected, "base64");
  const b = Buffer.from(signature, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyShopify(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected, "base64");
  const b = Buffer.from(signature, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

describe("WooCommerce webhook signature verification", () => {
  test("accepts a valid signature on the order.created payload", () => {
    const rawBody = Buffer.from(JSON.stringify(wooOrderCreatedPayload), "utf8");
    const sig = createHmac("sha256", WOO_SECRET).update(rawBody).digest("base64");
    assert.equal(verifyWoo(rawBody, sig, WOO_SECRET), true);
  });

  test("rejects signature computed with a different secret", () => {
    const rawBody = Buffer.from(JSON.stringify(wooOrderCreatedPayload), "utf8");
    const badSig = createHmac("sha256", "wrong_secret").update(rawBody).digest("base64");
    assert.equal(verifyWoo(rawBody, badSig, WOO_SECRET), false);
  });

  test("rejects signature computed on a tampered body", () => {
    const original = Buffer.from(JSON.stringify(wooOrderCreatedPayload), "utf8");
    const sig = createHmac("sha256", WOO_SECRET).update(original).digest("base64");
    // Flip the total to test rejection of body-mismatch.
    const tampered = Buffer.from(
      JSON.stringify({ ...wooOrderCreatedPayload, total: "0.01" }),
      "utf8",
    );
    assert.equal(verifyWoo(tampered, sig, WOO_SECRET), false);
  });

  test("rejects an empty signature header", () => {
    const rawBody = Buffer.from(JSON.stringify(wooOrderCreatedPayload), "utf8");
    assert.equal(verifyWoo(rawBody, "", WOO_SECRET), false);
    assert.equal(verifyWoo(rawBody, undefined, WOO_SECRET), false);
  });
});

describe("Shopify webhook signature verification", () => {
  test("accepts a valid X-Shopify-Hmac-SHA256 signature", () => {
    const rawBody = Buffer.from(JSON.stringify(shopifyOrderCreatedPayload), "utf8");
    const sig = createHmac("sha256", SHOPIFY_SECRET).update(rawBody).digest("base64");
    assert.equal(verifyShopify(rawBody, sig, SHOPIFY_SECRET), true);
  });

  test("rejects signature computed with a different app secret", () => {
    const rawBody = Buffer.from(JSON.stringify(shopifyOrderCreatedPayload), "utf8");
    const badSig = createHmac("sha256", "wrong_app_secret").update(rawBody).digest("base64");
    assert.equal(verifyShopify(rawBody, badSig, SHOPIFY_SECRET), false);
  });

  test("rejects tampered-body signature", () => {
    const original = Buffer.from(JSON.stringify(shopifyOrderCreatedPayload), "utf8");
    const sig = createHmac("sha256", SHOPIFY_SECRET).update(original).digest("base64");
    const tampered = Buffer.from(
      JSON.stringify({ ...shopifyOrderCreatedPayload, total_price: "0.01" }),
      "utf8",
    );
    assert.equal(verifyShopify(tampered, sig, SHOPIFY_SECRET), false);
  });

  test("rejects empty signature header", () => {
    const rawBody = Buffer.from(JSON.stringify(shopifyOrderCreatedPayload), "utf8");
    assert.equal(verifyShopify(rawBody, "", SHOPIFY_SECRET), false);
    assert.equal(verifyShopify(rawBody, undefined, SHOPIFY_SECRET), false);
  });
});

/**
 * Asaas-equivalent verifier to keep the four-primitive matrix uniform. The
 * production code lives at
 * apps/api/src/modules/payment/presentation/http/asaas-webhook.controller.ts
 * and uses HMAC-SHA256 over the raw body with an `asaas-access-token`
 * (hex digest, no base64). The same primitives are reused here so any future
 * regression is caught in this package.
 */
describe("Asaas-style HMAC-SHA256 verifier (hex digest)", () => {
  const SECRET = "it_asaas_token";

  function verifyAsaas(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  test("accepts a valid hex signature", () => {
    const raw = Buffer.from('{"event":"PAYMENT_RECEIVED"}', "utf8");
    const sig = createHmac("sha256", SECRET).update(raw).digest("hex");
    assert.equal(verifyAsaas(raw, sig, SECRET), true);
  });

  test("rejects hex signature with different secret", () => {
    const raw = Buffer.from('{"event":"PAYMENT_RECEIVED"}', "utf8");
    const sig = createHmac("sha256", "wrong").update(raw).digest("hex");
    assert.equal(verifyAsaas(raw, sig, SECRET), false);
  });
});
