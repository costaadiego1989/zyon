import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { useCheckoutStore as store } from "../src/store/checkout-store.js";
import { paymentCancellationCommand, parsePaymentCancellation } from "../src/lib/payment-cancellation.js";

// Real API client/store/parser; local simulated transport, never a real payment.
const response = (cancellation = "cancelled", status = "cancelled") => ({ version: 1, intent_id: "intent_qa", status, cancellation });
async function setup(t: TestContext, cancel: () => Response | Promise<Response> = () => Response.json(response()), authenticated = true) {
  store.getState().resetSession(); const requests: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (input, init: RequestInit = {}) => {
    const url = String(input); requests.push({ url, init });
    if (url.endsWith("/embed/start")) return Response.json({ session_id: "session_qa", experience: { items: [{ sku: "qa", name: "QA", quantity: 1, unit_price: 19.47 }], totals: { subtotal: 19.47, total: 19.47 } } });
    if (url.endsWith("/cancel")) return cancel();
    throw Error(`unexpected_request:${url}`);
  });
  const api = new CheckoutSession({ embedToken: "signed-fixture", merchantId: "merchant", apiBaseUrl: "https://api.test", ...(authenticated ? { buyerAccessToken: "buyer-fixture-jwt" } : {}) });
  await api.start(); requests.length = 0;
  const cart = { ...store.getState().cart, items: [{ sku: "qa", name: "QA", quantity: 1, unitPrice: 19.47 }], subtotal: 19.47, total: 19.47 };
  store.setState({ api, sessionId: "session_qa", status: "active", isTyping: false, cart, shippingMode: "single_store", leadRegistered: true,
    paymentIntent: { intent_id: "intent_qa", method: "pix", status: "requires_action", amount_cents: 1947, currency: "BRL", pix_code: "fixture-only", pix_qr_url: "fixture-only" },
    messages: [{ id: "payment", role: "agent", text: "Pagamento", timestamp: 1, blocks: [{ type: "pix_qr", data: { intent_id: "intent_qa" } }, { type: "other", data: {} }] }],
  } as never);
  t.after(() => store.getState().resetSession()); return { api, requests, cart };
}
test("only exact explicit buyer commands authorize financial cancellation", () => {
  assert.equal(paymentCancellationCommand("Cancelar o Pix!"), "pix"); assert.equal(paymentCancellationCommand("cancelar pagamento"), "payment");
  for (const text of ["não cancelar pix", "fechar", "voltar", "pausar compra rápida", "como cancelar pagamento", "cancelar pedido", "cancelar pagamento depois"]) assert.equal(paymentCancellationCommand(text), null);
});
test("explicit command sends the bound buyer token and same operation key, then clears only payment credentials", async t => {
  const f = await setup(t); await store.getState().sendMessage("cancelar pix");
  assert.equal(f.requests.length, 1); const request = f.requests[0]!;
  assert.equal(request.url, "https://api.test/embed/payment/intents/intent_qa/cancel"); assert.equal(request.init.method, "POST"); assert.equal(request.init.cache, "no-store");
  assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer signed-fixture");
  assert.deepEqual(JSON.parse(request.init.body as string), { session_id: "session_qa", idempotency_key: "cancel_intent_qa", buyer_access_token: "buyer-fixture-jwt" });
  assert.deepEqual(store.getState().cart, f.cart); assert.equal(store.getState().paymentIntent, null); assert.equal(store.getState().paymentCancellationPending, null);
  assert.equal(store.getState().messages[0]!.blocks!.length, 1); assert.match(store.getState().messages.at(-1)!.text, /carrinho foi mantido/);
});
test("uncertain cancellation hides payable credentials, preserves total and blocks all new payment methods", async t => {
  const f = await setup(t, () => Response.json(response("pending", "requires_action"))); await store.getState().cancelPendingPayment();
  assert.equal(store.getState().paymentIntent?.intent_id, "intent_qa"); assert.equal(store.getState().paymentIntent?.pix_code, undefined);
  assert.equal(store.getState().paymentCancellationPending, "intent_qa"); assert.deepEqual(store.getState().cart, f.cart);
  await store.getState().pay("pix"); await store.getState().pay("credito"); await store.getState().selectCryptoChain("base"); assert.equal(f.requests.length, 1);
  await store.getState().sendMessage("cancelar pagamento"); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0]!.init.body, f.requests[1]!.init.body);
});
test("transport failure never fabricates success or leaves stale QR payable", async t => {
  const f = await setup(t, () => { throw Error("timeout"); }); await store.getState().cancelPendingPayment();
  assert.equal(store.getState().paymentCancellationPending, "intent_qa"); assert.equal(store.getState().paymentIntent?.pix_code, undefined);
  assert.deepEqual(store.getState().cart, f.cart); assert.match(store.getState().messages.at(-1)!.text, /não foi possível confirmar/i);
});
test("missing buyer auth and unsupported marketplace never invoke cancellation transport", async t => {
  const f = await setup(t, undefined, false); await store.getState().cancelPendingPayment(); assert.equal(f.requests.length, 0);
  assert.equal(store.getState().paymentCancellationPending, null); assert.match(store.getState().messages.at(-1)!.text, /conta de comprador/);
  store.setState({ shippingMode: "marketplace" }); await store.getState().cancelPendingPayment(); assert.equal(f.requests.length, 0);
});
test("a late cancellation response cannot overwrite webhook completion or another session", async t => {
  let resolve!: (value: Response) => void; const promise = new Promise<Response>(yes => resolve = yes);
  await setup(t, () => promise); const cancelling = store.getState().cancelPendingPayment();
  store.setState({ status: "completed", cart: { ...store.getState().cart, status: "paid" } }); resolve(Response.json(response())); await cancelling;
  assert.equal(store.getState().status, "completed"); assert.equal(store.getState().paymentIntent?.intent_id, "intent_qa"); assert.equal(store.getState().paymentCancellationPending, null);
});
test("reset/closing without a cancellation command cannot send a cancellation", async t => {
  const f = await setup(t); store.getState().resetSession(); assert.equal(f.requests.length, 0); assert.equal(store.getState().paymentCancellationPending, null);
});
test("malformed/foreign/contradictory PSP projections fail closed", () => {
  for (const value of [undefined, {}, { ...response(), intent_id: "foreign" }, { ...response(), status: "approved" }, response("pending", "approved"), { ...response(), version: 2 }]) {
    assert.throws(() => parsePaymentCancellation(value, "intent_qa"), /response_invalid/);
  }
});
