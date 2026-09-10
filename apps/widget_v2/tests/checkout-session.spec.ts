import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession, cartFromExperience } from "../src/api/checkout-session.js";

test("widget starts and updates the signed checkout session without reading or mutating public carts", async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; body: any; headers: any }> = [];
  const experience = { items: [{ sku: "real-sku", variant: "with-cheese", name: "Sanduíche", quantity: 2, unit_price: 22.5 }], totals: { subtotal: 45, discount: 5, service_fee: 1.37, total_to_pay: 41.37, total: 40 } };
  globalThis.fetch = async (url, init) => {
    const request = { url: String(url), body: JSON.parse(init!.body as string), headers: init!.headers };
    requests.push(request);
    assert.equal(new Headers(request.headers).get("Authorization"), "Bearer signed-token");
    if (request.url.endsWith("/embed/start")) return Response.json({ session_id: "bound-session", experience });
    if (request.url.endsWith("/embed/cart")) return Response.json({ session_id: "bound-session", experience: {
      items: [{ ...experience.items[0], quantity: 1 }], totals: { subtotal: 22.5, discount: 0, service_fee: 1.37, total_to_pay: 23.87, total: 22.5 },
    } });
    if (request.url.endsWith("/embed/payment/intents")) return Response.json({ id: "intent", method: "pix", status: "pending", amountCents: 2250 });
    throw new Error(`unexpected_endpoint:${url}`);
  };
  try {
    const api = new CheckoutSession({ embedToken: "signed-token", merchantId: "merchant", cartRef: "untrusted-browser-ref", apiBaseUrl: "https://api.example" });
    const started = await api.start();
    assert.equal(requests[0]!.body.cart_ref, undefined);
    assert.deepEqual(await api.fetchCart(), cartFromExperience(started.experience));
    assert.equal(requests.length, 1);
    assert.equal((await api.fetchCart()).items[0]!.sku, "real-sku");
    assert.equal((await api.fetchCart()).total, 45);
    assert.equal((await api.fetchCart()).discount, 5);
    assert.equal((await api.fetchCart()).serviceFee, 1.37);
    assert.equal((await api.fetchCart()).totalToPay, 41.37);
    await api.createPaymentIntent("pix");
    const firstPaymentKey = requests.at(-1)!.body.idempotency_key;
    await api.updateCartItemQty("real-sku", 1, "with-cheese");
    assert.deepEqual(requests.at(-1)!.body, { session_id: "bound-session", items: [{ sku: "real-sku", quantity: 1, variant: "with-cheese" }] });
    assert.equal((await api.fetchCart()).total, 22.5);
    assert.equal((await api.fetchCart()).serviceFee, 1.37);
    assert.equal((await api.fetchCart()).totalToPay, 23.87);
    await api.createPaymentIntent("pix");
    assert.notEqual(requests.at(-1)!.body.idempotency_key, firstPaymentKey);
    const retryKey = requests.at(-1)!.body.idempotency_key;
    await api.createPaymentIntent("pix");
    assert.equal(requests.at(-1)!.body.idempotency_key, retryKey);
  } finally { globalThis.fetch = original; }
});

test("missing API cart snapshot is an error instead of a fabricated empty checkout", () => {
  assert.throws(() => cartFromExperience(undefined), /checkout_cart_snapshot_missing/);
});

test("widget preserves every quoted crypto transfer in payment intent", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/embed/start")) {
      return Response.json({
        session_id: "crypto-session",
        experience: {
          items: [{ sku: "sku", name: "Produto", quantity: 1, unit_price: 10 }],
          totals: { subtotal: 10, total: 10, total_to_pay: 10 },
        },
      });
    }
    if (String(url).endsWith("/embed/payment/intents")) {
      return Response.json({
        id: "crypto-intent",
        method: "crypto",
        status: "requires_action",
        amountCents: 1000,
        buyerFacing: {
          chain: "polygon",
          transfers: [
            { kind: "merchant", destinationAddress: "0x1111111111111111111111111111111111111111", amountAtomic: "990000", amountDisplay: "0.990000 USDC" },
            { kind: "platform_fee", destinationAddress: "0x2222222222222222222222222222222222222222", amountAtomic: "10000", amountDisplay: "0.010000 USDC" },
          ],
        },
      });
    }
    throw new Error(`unexpected_endpoint:${url}`);
  };
  try {
    const api = new CheckoutSession({ embedToken: "signed-token", merchantId: "merchant", apiBaseUrl: "https://api.example" });
    await api.start();
    const intent = await api.createPaymentIntent("crypto");
    assert.deepEqual(intent.crypto_transfers, [
      { kind: "merchant", destination_address: "0x1111111111111111111111111111111111111111", amount_atomic: "990000", amount_display: "0.990000 USDC" },
      { kind: "platform_fee", destination_address: "0x2222222222222222222222222222222222222222", amount_atomic: "10000", amount_display: "0.010000 USDC" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
