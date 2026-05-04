import test from "node:test";
import assert from "node:assert/strict";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";

test("AsaasPaymentAdapter posts /v3/payments with access_token and fetches PIX QR when method is pix", async () => {
  let step = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : String(url);
    if (href.endsWith("/pixQrCode")) {
      step += 1;
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal((init?.headers as Record<string, string>).access_token, "test_key_hidden");
      return new Response(JSON.stringify({ payload: "br_code_here", encodedImage: "Zm9v" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    assert.match(href, /\/v3\/payments$/);
    assert.equal(init?.method, "POST");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.access_token, "test_key_hidden");
    const bodyJson = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    assert.equal(bodyJson.externalReference, "pay_int_test");
    assert.equal(bodyJson.billingType, "PIX");

    step += 1;

    return new Response(JSON.stringify({ id: "pay_123", invoiceUrl: "https://sandbox.asaas.com/i/123" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const adapter = new AsaasPaymentAdapter("https://api-sandbox.asaas.com", "test_key_hidden", fetchImpl);

  const out = await adapter.createPayment({
    merchantId: "m1",
    sessionId: "s1",
    intentId: "pay_int_test",
    amountCents: 15025,
    currency: "BRL",
    method: "pix",
    asaasCustomerId: "cus_1"
  });

  assert.equal(step, 2);
  assert.equal(out.providerPaymentId, "pay_123");
  assert.equal(out.status, "requires_action");
  assert.ok(out.buyerFacingPayload.invoiceUrl?.startsWith("https://"));
  assert.equal(out.buyerFacingPayload.qrCodeCopyPaste, "br_code_here");
  assert.ok(!JSON.stringify(out).includes("test_key_hidden"));
});
