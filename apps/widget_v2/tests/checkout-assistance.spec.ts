import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { useCheckoutStore as store } from "../src/store/checkout-store.js";
import { initTracking } from "../src/lib/tracking.js";
import { assistanceCommand, idleAssistanceMessage } from "../src/lib/checkout-assistance.js";

const experience = { items: [{ sku: "shirt", name: "Camiseta azul", quantity: 1, unit_price: 20 }], totals: { subtotal: 20, total: 20 } };
test("manual Pix consultation reports failure without any polling or websocket update", async t => {
  const f = await ready(t, url => {
    if (url.includes("/payment/intents/pix/status")) return Response.json({ status: "failed" });
    if (url.endsWith("/embed/track")) return Response.json({ trigger_agent: true });
  });
  initTracking(f.api, "checkout");
  store.setState({ triggerConfig: { mode: "silent_until_trigger", enabledTriggers: ["payment_failed"], cooldownMs: 30000, maxInterventions: 3 },
    triggerMessages: { payment_failed: { message: "Ajuda confirmada após consulta manual." } } });
  await store.getState().runHelpAction("check_payment", "pix");
  assert.equal(store.getState().status, "active");
  assert.equal(store.getState().cart.status, "ready_to_pay");
  assert(store.getState().messages.some(message => message.text === "Ajuda confirmada após consulta manual."));
  assert.equal(f.requests.filter(request => request.url.endsWith("/embed/track") && JSON.parse(String(request.init.body)).event === "payment_failed").length, 1);
  assert.equal(f.requests.filter(request => request.url.endsWith("/embed/payment/intents")).length, 0);
});
test("a recovered terminal payment is verified before retry and an active payment is retained", async t => {
  for (const observed of ["requires_action", "failed"]) {
    const f = await ready(t, (url, init) => {
      if (url.includes("/payment/intents/pix/status")) return Response.json({ status: observed });
      if (url.endsWith("/embed/payment/intents")) return Response.json({ id: "new-pix", method: "pix", status: "requires_action", amountCents: 2000, buyerFacing: { qrCodeCopyPaste: "new-code" } });
    });
    f.api.chatState = { protocol: "durable_v2", session_id: "checkout", conversation_id: "conversation", turns: [], payment_intent_id: "pix" };
    store.setState({ paymentIntent: { ...store.getState().paymentIntent!, status: "failed" } });
    await store.getState().pay("pix");
    const creations = f.requests.filter(request => request.url.endsWith("/embed/payment/intents"));
    assert.equal(creations.length, observed === "failed" ? 1 : 0);
    assert(f.requests[0].url.includes("/payment/intents/pix/status"));
    if (observed === "failed") { assert.equal(store.getState().paymentIntent?.intent_id, "new-pix"); assert.equal(f.api.chatState.payment_intent_id, undefined); }
    else { assert.equal(store.getState().paymentIntent?.intent_id, "pix"); assert.equal(f.api.chatState.payment_intent_id, "pix"); }
    store.getState().resetSession();
  }
});
async function ready(t: TestContext, transport?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  store.getState().resetSession();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (input, init: RequestInit = {}) => {
    const url = String(input); requests.push({ url, init });
    if (url.endsWith("/embed/start")) return Response.json({ session_id: "checkout", experience });
    const result = transport?.(url, init); if (result) return result;
    if (url.endsWith("/embed/track")) return Response.json({ trigger_agent: false });
    throw Error(`unexpected_request:${url}`);
  });
  const api = new CheckoutSession({ embedToken: "fixture", merchantId: "merchant", apiBaseUrl: "https://api.test" });
  await api.start(); requests.length = 0;
  store.setState({ api, sessionId: "checkout", status: "active", leadRegistered: true,
    cart: { items: [{ sku: "shirt", name: "Camiseta azul", qty: 1, price: 20 }], total: 20, serviceFee: 0, discount: 0,
      shipping: { key: "delivery", label: "Entrega", cost: 0 }, status: "ready_to_pay" },
    paymentIntent: { intent_id: "pix", method: "pix", status: "pending", pix_code: "same-code", expires_at_unix: Math.floor(Date.now() / 1000) + 60 },
    merchantPaymentConfig: { paymentMethods: { pix: true, card: true, providers: { card: "stripe" } } },
  });
  t.after(() => store.getState().resetSession());
  return { api, requests };
}

test("explicit questions recognize Pix and installments, and respect a declined human offer", () => {
  assert.equal(assistanceCommand("Paguei o Pix, pode confirmar?"), "pix");
  assert.equal(assistanceCommand("Em quantas parcelas posso pagar?"), "installments");
  assert.equal(assistanceCommand("Quero falar com atendente"), "human");
  assert.equal(assistanceCommand("Não quero atendente humano"), undefined);
});

test("inactivity help follows the actual checkout stage", () => {
  const state = { paymentIntent: null, hasAddress: false, shippingChosen: false, leadRegistered: false };
  assert.match(idleAssistanceMessage(state), /CEP/);
  assert.match(idleAssistanceMessage({ ...state, hasAddress: true }), /frete/);
  assert.match(idleAssistanceMessage({ ...state, hasAddress: true, shippingChosen: true }), /dados/);
  assert.match(idleAssistanceMessage({ ...state, hasAddress: true, shippingChosen: true, leadRegistered: true }), /cartão/);
  assert.match(idleAssistanceMessage({ ...state, paymentIntent: { method: "pix", intent_id: "pix", status: "pending" } }), /confirmação/);
});

test("refunded Pix is presented as terminated and never offers copy or renewal", async t => {
  const { requests } = await ready(t, url => url.includes("/pix/status?") ? Response.json({ status: "refunded" }) : undefined);
  await store.getState().runHelpAction("show_pix", "pix");
  const message = store.getState().messages.at(-1)!;
  assert.match(message.text, /encerrado/);
  assert.deepEqual(message.blocks?.[0].data?.actions, [{ action: "check_payment", label: "Consultar pagamento" }]);
  assert.equal(store.getState().paymentPolling, false);
  assert.equal(requests.filter(request => request.init.method === "POST").length, 0);
});

test("two consecutive failures offer human support once; no ticket is requested before the click", async t => {
  const { requests } = await ready(t);
  store.getState().recordCheckoutDifficulty(); assert.equal(store.getState().messages.length, 0);
  store.getState().recordCheckoutDifficulty(); store.getState().recordCheckoutDifficulty();
  assert.equal(store.getState().messages.length, 1); assert.equal(store.getState().supportRequest, null);
  assert.equal(requests.length, 0);
  await store.getState().runHelpAction("human");
  assert.match(store.getState().supportRequest!.message, /atendente humano/);
});

test("disabled human handoff, manual mode and payment observation suppress unsolicited help", async t => {
  await ready(t);
  for (const patch of [{ handoffEnabled: false }, { assistance: { ...store.getState().assistance, humanHandoff: false } },
    { triggerConfig: { mode: "manual_only" as const, enabledTriggers: [], cooldownMs: 0, maxInterventions: 3 } }, { paymentObservation: true }]) {
    store.setState({ handoffEnabled: true, assistance: { pix: true, installments: true, unavailableProduct: true, humanHandoff: true },
      triggerConfig: null, paymentObservation: false, messages: [], ...patch });
    store.getState().recordCheckoutDifficulty(); store.getState().recordCheckoutDifficulty();
    assert.equal(store.getState().messages.length, 0);
  }
});

test("Pix confirmation and code help use the same intent with no creation request", async t => {
  const { requests } = await ready(t, url => url.includes("/status?") ? Response.json({ status: "pending" }) : undefined);
  await store.getState().runHelpAction("show_pix", "pix");
  assert.equal(store.getState().messages.at(-1)?.blocks?.[0].data?.pix_code, "same-code");
  assert.equal(requests.length, 1); assert.equal(requests[0].init.method, "GET");
  await store.getState().runHelpAction("show_pix", "other"); assert.equal(requests.length, 1);
});

test("Pix renewal refuses pending, approved, uncertain and stale observations without any POST", async t => {
  let status = "pending", stale = false;
  const { requests } = await ready(t, url => {
    if (!url.includes("/status?")) return;
    if (status === "uncertain") throw Error("network");
    if (stale) store.setState({ status: "completed" });
    return Response.json({ status });
  });
  for (const next of ["pending", "approved", "refunded", "uncertain", "failed"]) {
    status = next; stale = next === "failed"; store.setState({ status: "active" });
    await store.getState().runHelpAction("renew_pix", "pix");
  }
  assert.equal(requests.filter(request => request.init.method === "POST").length, 0);
});

test("expired Pix renewal retries the same idempotency key after a lost creation response", async t => {
  let attempts = 0;
  const { requests } = await ready(t, url => {
    if (url.includes("/status?")) return Response.json({ status: "cancelled" });
    if (url.endsWith("/payment/intents")) {
      if (++attempts === 1) throw Error("response lost");
      return Response.json({ id: "renewed", status: "pending", method: "pix", amountCents: 2000,
        buyerFacing: { qrCodeCopyPaste: "new-code", quoteExpiresAt: new Date(Date.now() + 300000).toISOString() } });
    }
  });
  await store.getState().runHelpAction("renew_pix", "pix");
  await store.getState().runHelpAction("renew_pix", "pix");
  const posts = requests.filter(request => request.init.method === "POST" && request.url.endsWith("/payment/intents"));
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(String(posts[0].init.body)).idempotency_key, JSON.parse(String(posts[1].init.body)).idempotency_key);
  assert.equal(store.getState().paymentIntent?.intent_id, "renewed");
});

test("marketplace and observation cannot renew Pix", async t => {
  const { requests } = await ready(t);
  store.setState({ shippingMode: "marketplace" }); await store.getState().runHelpAction("renew_pix", "pix");
  store.setState({ shippingMode: "standard", paymentObservation: true }); await store.getState().runHelpAction("renew_pix", "pix");
  assert.equal(requests.length, 0);
});

test("stock help lists only available catalog alternatives and requires an explicit addition", async t => {
  const { requests } = await ready(t, url => {
    if (url.includes("/catalog/search?")) return Response.json({ products: [
      { sku: "shirt", name: "Current", unit_price: 20, in_stock: true },
      { sku: "soldout", name: "Sold out", unit_price: 10, in_stock: false },
      { sku: "available", name: "Camiseta verde", unit_price: 15, in_stock: true },
    ] });
    if (url.endsWith("/catalog/add")) return Response.json({ experience: { ...experience,
      items: [...experience.items, { sku: "available", name: "Camiseta verde", quantity: 1, unit_price: 15 }] } });
  });
  store.setState({ paymentIntent: null });
  store.getState().recordCheckoutDifficulty({ code: "cart_insufficient_stock", details: { sku: "shirt" } });
  assert.equal(requests.length, 0);
  const context = JSON.stringify(store.getState().cart.items);
  await store.getState().runHelpAction("alternatives", undefined, context, "shirt");
  const products = store.getState().messages.at(-1)!.blocks![0].data!.products as Array<{ sku: string }>;
  assert.deepEqual(products.map(product => product.sku), ["available"]);
  assert.equal(requests.some(request => request.init.method === "POST"), false);
  await store.getState().addAlternative("available", context);
  assert.equal(store.getState().cart.items.length, 2);
  assert.equal(store.getState().assistanceFailures, 0);
  assert.equal(store.getState().cart.status, "awaiting");
  await store.getState().addAlternative("available", context);
  assert.equal(requests.filter(request => request.url.endsWith("/catalog/add")).length, 1);
});

test("installment help does not invent installments or create a payment", async t => {
  const { requests } = await ready(t); store.setState({ paymentIntent: null });
  store.getState().showCheckoutHelp("installments", true);
  assert.match(store.getState().messages.at(-1)!.text, /à vista/);
  await store.getState().runHelpAction("card_conditions");
  assert.equal(store.getState().messages.at(-1)!.blocks![0].type, "payment_methods");
  assert.equal(requests.length, 0);
});
