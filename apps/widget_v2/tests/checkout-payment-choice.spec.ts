import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { paymentChoicesForConfig, paymentMethodsForConfig, useCheckoutStore } from "../src/store/checkout-store.js";

const initial = useCheckoutStore.getInitialState();
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; useCheckoutStore.setState(initial, true); });

const experience = {
  items: [{ sku: "fixture-sku", name: "Produto teste", quantity: 1, unit_price: 10 }],
  shipping: { carrierKey: "fixture-shipping", method: "Entrega", customerPrice: 0 },
  totals: { subtotal: 10, discount: 0, service_fee: 0.99, total: 10, total_to_pay: 10.99 },
  paymentMethods: { pix: false, card: true, boleto: false },
};

async function fixture(options: { unavailable?: boolean; cancellationFails?: boolean; waitForCancel?: Promise<void> } = {}) {
  const calls: Array<{ path: string; body: any }> = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/embed/start")) return Response.json({ session_id: "choice-session", experience });
    calls.push({ path, body });
    if (path.endsWith("/embed/checkout/edit")) {
      await options.waitForCancel;
      return options.cancellationFails
        ? Response.json({ code: "checkout_edit_payment_cancel_pending" }, { status: 409 })
        : Response.json({ experience, revision: 1 });
    }
    if (path.endsWith("/embed/payment/intents")) {
      return options.unavailable
        ? Response.json({ code: "payment_provider_not_configured" }, { status: 400 })
        : Response.json({ id: "new-pix", method: "pix", status: "pending", amountCents: 1099,
          buyerFacing: { qrCodeCopyPaste: "TEST_ONLY_NOT_A_REAL_PIX" } });
    }
    throw new Error(`unexpected_endpoint:${path}`);
  };
  const api = new CheckoutSession({ embedToken: "fixture-token", buyerAccessToken: "buyer-proof", merchantId: "fixture-store", apiBaseUrl: "https://fixture.invalid" });
  await api.start();
  useCheckoutStore.setState({ api, status: "active", leadRegistered: true,
    merchantPaymentConfig: { paymentMethods: { ...experience.paymentMethods } },
    oneBuyClickPreferences: { shippingPreference: "cheapest", paymentPreference: "card" },
    paymentIntent: { intent_id: "old-card", method: "credito", status: "requires_action", amount_cents: 1099 },
    messages: [{ id: "card", role: "agent", text: "Preencha o cartão.", timestamp: 0,
      checkoutStage: "payment_pending", blocks: [{ type: "stripe_card", data: { intent_id: "old-card" } }] }],
    cart: { items: [{ sku: "fixture-sku", name: "Produto teste", quantity: 1, price: 10 }], total: 10,
      discount: 0, serviceFee: 0.99, totalToPay: 10.99, shipping: { key: "fixture-shipping", label: "Entrega", cost: 0 }, status: "ready_to_pay" },
  });
  return { api, calls };
}

test("Pix stays selectable with pix:false, including when the server's choices omit it", async () => {
  await fixture();
  const config = useCheckoutStore.getState().merchantPaymentConfig;
  assert.equal(paymentMethodsForConfig(config).some((method) => method.key === "pix"), false);
  assert.equal(paymentChoicesForConfig(config).some((method) => method.key === "pix"), true);
  useCheckoutStore.getState().proceedToPayment([{ key: "credito", label: "Cartão", sub: "" }]);
  const methods = useCheckoutStore.getState().messages.at(-1)?.blocks?.[0].data?.methods as Array<{ key: string }>;
  assert.equal(methods.some((method) => method.key === "pix"), true);
});

test("clicking Pix rechecks it through the API without changing saved card preference or provider snapshot", async () => {
  const { calls } = await fixture();
  await useCheckoutStore.getState().changePaymentMethod("pix");
  const state = useCheckoutStore.getState();
  assert.deepEqual(calls.map((call) => call.path), ["/embed/checkout/edit", "/embed/payment/intents"]);
  assert.equal(calls[0].body.section, "payment");
  assert.equal(calls[0].body.buyer_access_token, "buyer-proof");
  assert.equal(calls[1].body.method, "pix");
  assert.equal(state.selectedPaymentMethod, "pix");
  assert.equal(state.paymentIntent?.intent_id, "new-pix");
  assert.equal(state.oneBuyClickPreferences?.paymentPreference, "card");
  assert.equal(state.merchantPaymentConfig.paymentMethods?.pix, false);
  assert.equal(state.messages.some((message) => message.blocks?.some((block) => block.type === "stripe_card")), false);
  assert.equal(state.messages.at(-1)?.blocks?.[0].type, "pix_payment");
});

test("typing an explicit Pix choice switches even after a server-owned payment stage", async () => {
  for (const text of ["Pix", "quero pagar com Pix", "Trocar para Pix", "pagar no Pix!"]) {
    useCheckoutStore.setState(initial, true);
    const { calls } = await fixture();
    await useCheckoutStore.getState().sendMessage(text);
    assert.equal(calls.filter((call) => call.path.endsWith("/payment/intents")).length, 1, text);
    assert.equal(useCheckoutStore.getState().selectedPaymentMethod, "pix", text);
    assert.equal(useCheckoutStore.getState().oneBuyClickPreferences?.paymentPreference, "card", text);
  }
});

test("provider refusal keeps the explicit Pix choice and reports the real error without fabricating a QR", async () => {
  const { calls } = await fixture({ unavailable: true });
  await useCheckoutStore.getState().changePaymentMethod("pix");
  const state = useCheckoutStore.getState();
  assert.equal(calls.length, 2);
  assert.equal(state.selectedPaymentMethod, "pix");
  assert.equal(state.paymentIntent, null);
  assert.match(state.messages.at(-1)?.text ?? "", /não está configurada/);
  assert.equal(state.messages.some((message) => message.blocks?.some((block) => block.type === "pix_payment")), false);
  assert.equal(state.oneBuyClickPreferences?.paymentPreference, "card");
});

test("cancellation failure retains the previous payment and never creates another one", async () => {
  const { calls } = await fixture({ cancellationFails: true });
  await useCheckoutStore.getState().changePaymentMethod("pix");
  assert.equal(calls.length, 1);
  assert.equal(useCheckoutStore.getState().paymentIntent?.intent_id, "old-card");
  assert.equal(useCheckoutStore.getState().isTyping, false);
});

test("repeated clicks cannot race cancellation and create duplicate payments", async () => {
  let release!: () => void;
  const waitForCancel = new Promise<void>((resolve) => { release = resolve; });
  const { calls } = await fixture({ waitForCancel });
  const first = useCheckoutStore.getState().changePaymentMethod("pix");
  const second = useCheckoutStore.getState().changePaymentMethod("pix");
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.equal(useCheckoutStore.getState().paymentIntent?.intent_id, "new-pix");
});
