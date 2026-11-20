import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { useCheckoutStore as store } from "../src/store/checkout-store.js";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { CheckoutApiError } from "../src/api/checkout-api-error.js";

// FISCAL-16/74/76: canonical buyer data before payment, the existing explicit
// payment choice, and current session/money/recovery fences remain authoritative.
const initial = store.getInitialState();
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; store.getState().stopPolling(); store.setState(initial, true); });
const buyer = { name: "Comprador", email: "buyer@example.test", phone: "11999999999" };

function fixture(options: { ready?: boolean; prepare?: () => Promise<unknown>; paymentError?: CheckoutApiError } = {}) {
  const chats: string[] = [], payments: Array<{ method: string; installments?: number; options: unknown }> = [];
  const api = {
    chat: async (text: string) => {
      chats.push(text);
      return text === "Quero continuar"
        ? { stage: "data_collection", message: "Informe seu CPF.", blocks: [{ type: "lead_capture" }] }
        : { stage: "payment", message: "Escolha como pagar.", experience: { customer: { ...buyer, cpf: "52998224725" } } };
    },
    prepareFiscalRecipient: async (mode: string) => {
      assert.equal(mode, "buyer");
      return options.prepare ? options.prepare() : { active: true, mode: "buyer", recipient: { taxId: "52998224725" }, fields: [] };
    },
    createPaymentIntent: async (method: string, installments?: number, intentOptions?: unknown) => {
      payments.push({ method, installments, options: intentOptions });
      if (options.paymentError) throw options.paymentError;
      return { intent_id: "current-intent", method, status: "requires_action", amount_cents: 10000,
        pix_code: "LOCAL_SYNTHETIC_PIX", stripe_client_secret: "pi_fixture_secret", stripe_publishable_key: "pk_test_fixture" };
    },
  };
  store.setState({ api: api as never, sessionId: "current-session", status: "active", buyer,
    leadRegistered: Boolean(options.ready), fiscalActive: true, fiscalFields: options.ready ? null : ["taxId"],
    merchantPaymentConfig: { paymentMethods: { pix: true, card: true, boleto: false } },
    cart: { items: [{ sku: "sku", name: "Produto", quantity: 1, price: 100 }], total: 100, discount: 0, serviceFee: 0,
      shipping: { key: "freight-a", label: "Entrega", cost: 0 }, status: "ready_to_pay" } });
  return { api, chats, payments };
}

test("FISCAL-76 current checkout collects CPF in chat then resumes the explicit card exactly once", async () => {
  const { chats, payments } = fixture();
  await store.getState().pay("credito", 3);
  assert.deepEqual(chats, ["Quero continuar"]); assert.equal(payments.length, 0);
  assert.equal(store.getState().pendingPayment?.method, "credito");
  assert.equal(store.getState().messages.some(m => m.blocks?.some(b => b.type === "lead_capture")), false);
  await store.getState().sendMessage("52998224725");
  assert.deepEqual(payments, [{ method: "credito", installments: 3, options: { confirmedCartFingerprint: undefined } }]);
  assert.equal(store.getState().buyer.cpf, "52998224725");
  assert.equal(store.getState().fiscalRecipient.taxId, "52998224725");
  assert.equal(store.getState().pendingPayment, null);
  assert.equal(store.getState().paymentIntent?.intent_id, "current-intent");
  assert.equal(store.getState().messages.flatMap(m => m.blocks ?? []).filter(b => b.type === "stripe_card").length, 1);
});

test("FISCAL-74 repeated choices keep one CPF conversation and resume the buyer's latest method", async () => {
  const { chats, payments } = fixture();
  await store.getState().pay("pix"); await store.getState().pay("credito"); await store.getState().pay("pix");
  assert.deepEqual(chats, ["Quero continuar"]); assert.equal(payments.length, 0);
  assert.equal(store.getState().pendingPayment?.method, "pix");
  await store.getState().sendMessage("52998224725");
  assert.equal(payments.length, 1); assert.equal(payments[0].method, "pix");
  assert.equal(store.getState().messages.flatMap(m => m.blocks ?? []).filter(b => b.type === "pix_payment").length, 1);
});

test("FISCAL-16 complete logged buyer uses the existing card path without collecting data again", async () => {
  const { chats, payments } = fixture({ ready: true });
  store.setState({ buyer: { ...buyer, cpf: "52998224725" } });
  await store.getState().pay("credito");
  assert.deepEqual(chats, []); assert.equal(payments.length, 1);
  assert.equal(store.getState().buyer.cpf, "52998224725");
  assert.equal(store.getState().messages.some(m => m.blocks?.some(b => b.type === "lead_capture")), false);
});

for (const mutation of ["quantity", "shipping", "benefit-revision"] as const) {
  test(`FISCAL-74 ${mutation} change during collection requires a fresh payment choice`, async () => {
    const { payments } = fixture();
    await store.getState().pay("credito");
    const cart = store.getState().cart;
    store.setState({ cart: { ...cart, ...(mutation === "quantity" ? { items: cart.items.map(i => ({ ...i, quantity: 2 })) }
      : mutation === "shipping" ? { shipping: { ...cart.shipping!, key: "freight-b" } } : { commercialBenefitsVersion: 1 }) } });
    await store.getState().sendMessage("52998224725");
    assert.equal(payments.length, 0); assert.equal(store.getState().pendingPayment, null);
    assert.equal(store.getState().paymentIntent, null);
  });
}

test("FISCAL-74 a fiscal refresh from an old session cannot restore data or pay in a new session", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(resolvePromise => { resolve = resolvePromise; });
  const { payments } = fixture({ prepare: () => pending });
  await store.getState().pay("credito");
  const reply = store.getState().sendMessage("52998224725");
  await new Promise<void>(next => setImmediate(next));
  assert.equal(store.getState().fiscalUpdating, true);
  store.getState().resetSession();
  resolve({ active: true, mode: "buyer", recipient: { taxId: "52998224725" }, fields: [] }); await reply;
  assert.equal(payments.length, 0); assert.equal(store.getState().sessionId, null);
  assert.deepEqual(store.getState().fiscalRecipient, {}); assert.equal(store.getState().pendingPayment, null);
});

test("FISCAL-16 server fiscal refusal resumes canonical collection without a second payment request", async () => {
  const { chats, payments } = fixture({ ready: true,
    paymentError: new CheckoutApiError("payment", 422, "fiscal_customer_data_required", undefined, { fields: ["taxId"] }) });
  await store.getState().pay("credito"); await new Promise<void>(next => setImmediate(next));
  assert.equal(payments.length, 1); assert.deepEqual(chats, ["Quero continuar"]);
  assert.deepEqual(store.getState().fiscalFields, ["taxId"]); assert.equal(store.getState().paymentIntent, null);
  assert.equal(store.getState().messages.some(m => m.blocks?.some(b => b.type === "lead_capture")), false);
});

test("FISCAL-16 outstanding durable recovery cannot start a fiscal conversation or payment", async () => {
  const { chats, payments } = fixture();
  store.setState({ chatRecovery: "blocked" }); await store.getState().pay("pix");
  assert.deepEqual(chats, []); assert.deepEqual(payments, []); assert.equal(store.getState().pendingPayment, null);
});

test("FISCAL-16 fiscal API requests use the existing embed origin, bearer and exact checkout session", async () => {
  const calls: Array<{ url: string; headers: unknown; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers, body: JSON.parse(String(init?.body)) });
    return String(url).endsWith("/embed/start") ? Response.json({ session_id: "fiscal-bound-session" })
      : Response.json({ active: true, mode: "buyer", recipient: { taxId: "52998224725" }, fields: [] });
  };
  const api = new CheckoutSession({ embedToken: "scoped-fixture-token", merchantId: "store",
    apiBaseUrl: "https://general.invalid/v1", embedApiBaseUrl: "https://embed.invalid/v1" });
  await api.start(); const result = await api.prepareFiscalRecipient("buyer");
  assert.deepEqual(calls[1], { url: "https://embed.invalid/v1/embed/customer/fiscal/prepare",
    headers: { "Content-Type": "application/json", Authorization: "Bearer scoped-fixture-token" },
    body: { session_id: "fiscal-bound-session", mode: "buyer" } });
  assert.equal(result.recipient.taxId, "52998224725"); assert.deepEqual(result.fields, []);
});

test("FISCAL-16 fiscal error fields preserve the durable chat receipt and reject arbitrary names", async () => {
  const error = await CheckoutApiError.fromResponse("payment", Response.json({ code: "fiscal_customer_data_required",
    fields: ["taxId", "address.cityCode", "password", null], chat_request: { message_id: "scoped_message_123456", status: "processing" } }, { status: 422 }));
  assert.deepEqual(error.details?.fields, ["taxId", "address.cityCode"]);
  assert.deepEqual(error.chatRequest, { message_id: "scoped_message_123456", status: "processing" });
});
