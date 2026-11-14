import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession, cartFromExperience, type Experience } from "../src/api/checkout-session.js";
import { CheckoutApiError } from "../src/api/checkout-api-error.js";
import { useCheckoutStore, crossSellPreparedQuoteKey } from "../src/store/checkout-store.js";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";

const originalFetch = globalThis.fetch;
const initial = useCheckoutStore.getInitialState();
const reviewCopy = "Este complemento precisa de uma nova cotação. Aguarde uma nova sugestão para adicioná-lo.";
const unknownCopy = "Não foi possível confirmar a inclusão deste complemento. Confira o carrinho antes de continuar.";
afterEach(() => {
  useCheckoutStore.getState().stopPolling();
  useCheckoutStore.setState(initial, true);
  globalThis.fetch = originalFetch;
});

type Failure = "review_required" | "network";
type Request = { url: string; method: string; authorization: string | null; body: unknown };
const experience: Experience = {
  items: [{ sku: "original-sku", name: "Original product", quantity: 2, unit_price: 50, original_unit_price: 55 }],
  totals: { subtotal: 100, discount: 5, shipping: 10, service_fee: 1.37, total: 105, total_to_pay: 106.37 },
  shipping: { carrier: "Carrier", method: "Delivery", carrierKey: "shipping", customerPrice: 10 },
  applied_benefits: [{ kind: "discount", label: "Existing authorized target", amount: 5 }],
};

// Existing refusal cases start AFTER a displayed quote. These explicit wire
// fixtures do not claim a real server quote or change the refusal assertions.
function shownQuote(api: CheckoutSession, suggestionId = "suggestion") {
  return normalCheckoutCrossSellQuoteSchema.parse({ version: 1, merchantId: api.currentMerchantId, sessionId: api.currentSessionId, suggestionId,
    sessionVersion: 2, contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: api.currentMerchantId,
      targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T12:00:00Z", acceptedQuantity: 1, originalUnitPriceCents: 2000,
        maximumUnitPriceCents: 1800, variantId: "target", productId: "target-product", sku: "recommended-sku", source: "cross_sell" }],
      items: [{ variantId: "original", productId: "original-product", sku: "original-sku", quantity: 2, baseUnitPriceCents: 5500, unitPriceCents: 5000 },
        { variantId: "target", productId: "target-product", sku: "recommended-sku", quantity: 1, baseUnitPriceCents: 2000, unitPriceCents: 1800 }],
      originalSubtotalCents: 13000, preservedSavingsCents: 1000, allocatedSavingsCents: 200, promotionDiscountCents: 1200,
      cartDiscountCents: 500, merchandiseSubtotalCents: 11800, payableMerchandiseCents: 11300, remainingDiscountCents: 500 } });
}
function acceptPresented(suggestionId: string, sku: string) {
  const state = useCheckoutStore.getState(), api = state.api;
  const quote = api ? shownQuote(api, suggestionId) : undefined;
  if (api && quote) useCheckoutStore.setState({ preparedCrossSellQuotes: { ...state.preparedCrossSellQuotes,
    [crossSellPreparedQuoteKey(quote)]: quote } });
  return useCheckoutStore.getState().acceptCrossSell(suggestionId, sku, quote);
}

async function fixture(failure: Failure, wait?: Promise<void>, override?: { status: number; body: unknown }) {
  const requests: Request[] = [];
  let acceptSent!: () => void; const whenAcceptSent = new Promise<void>(resolve => { acceptSent = resolve; });
  globalThis.fetch = async (input, init) => {
    const url = String(input), request = { url, method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body ?? "null")) as unknown };
    requests.push(request);
    assert.equal(new URL(url).origin, "https://fixture.invalid");
    assert.equal(request.authorization, "Bearer fixture-signed-token");
    if (new URL(url).pathname === "/embed/start") return Response.json({ session_id: "signed-session", experience });
    if (new URL(url).pathname === "/embed/cross-sell/accept") {
      acceptSent();
      if (wait) await wait;
      if (failure === "network") throw new TypeError("synthetic_network_failure");
      if (override) return Response.json(override.body, { status: override.status });
      // An error body is never an authoritative replacement cart, even if it
      // happens to contain fields shaped like a successful response.
      return Response.json({ code: "cross_sell_quote_review_required", message: "cross_sell_quote_review_required",
        experience: { items: [], totals: { subtotal: 0, discount: 0, total: 0 } },
        agent_turn: { role: "agent", text: "DO_NOT_SHOW_SUCCESS_ON_REFUSAL" },
      }, { status: 422 });
    }
    throw new Error(`UNEXPECTED_ALTERNATE_REQUEST:${new URL(url).pathname}`);
  };
  const api = new CheckoutSession({ merchantId: "merchant", embedToken: "fixture-signed-token", apiBaseUrl: "https://fixture.invalid", paymentRevision: 7 });
  await api.start();
  const cachedCart = await api.fetchCart();
  useCheckoutStore.setState({ api, sessionId: "signed-session", status: "active", leadRegistered: true,
    cart: { ...cartFromExperience(experience), status: "ready_to_pay" },
    paymentIntent: { intent_id: "existing-pix-intent", method: "pix", status: "pending", pix_code: "synthetic-existing-pix", amount_cents: 10637 },
    pendingPayment: { method: "pix" }, paymentPolling: true,
    activeDiscount: { stage: "initial_coupon", percent: 5, message: "Existing authorized target" },
    messages: [{ id: "before-accept", role: "agent", text: "Existing payment remains available.", timestamp: 1,
      blocks: [{ type: "pix_payment", data: { pix_code: "synthetic-existing-pix" } }] }],
  });
  return { api, requests, cachedCart, whenAcceptSent, calls: () => requests.filter(request => !request.url.endsWith("/embed/start")) };
}

function assertOneBoundAccept(requests: Request[]) {
  assert.equal(requests.length, 1, "no retry, chat, cart/add, payment, or event fallback may be dispatched");
  const request = requests[0]!;
  assert.equal(new URL(request.url).pathname, "/embed/cross-sell/accept");
  assert.equal(request.method, "POST");
  assert.equal(request.authorization, "Bearer fixture-signed-token");
  const expected = shownQuote(useCheckoutStore.getState().api!, "suggestion");
  assert.deepEqual(request.body, { session_id: "signed-session", suggestion_id: "suggestion", accepted_skus: ["recommended-sku"], expected_quote: expected });
}

const preservedState = () => {
  const state = useCheckoutStore.getState();
  return structuredClone({ cart: state.cart, paymentIntent: state.paymentIntent, pendingPayment: state.pendingPayment,
    messages: state.messages, activeDiscount: state.activeDiscount, status: state.status,
    paymentPolling: state.paymentPolling, paymentSubmitting: state.paymentSubmitting, paymentCreating: state.paymentCreating });
};

for (const failure of ["review_required", "network"] as const) {
  test(`real CheckoutSession ${failure} rejects one accept and preserves its cached signed cart`, async () => {
    const f = await fixture(failure);
    await assert.rejects(f.api.acceptCrossSell("suggestion", "recommended-sku", shownQuote(f.api)), (error: unknown) => failure === "review_required"
      ? error instanceof CheckoutApiError && error.operation === "cross_sell_accept" && error.status === 422 && error.code === "cross_sell_quote_review_required"
      : error instanceof Error && error.message === "synthetic_network_failure");
    assertOneBoundAccept(f.calls());
    assert.deepEqual(await f.api.fetchCart(), f.cachedCart);
    assert.equal(f.api.currentSessionId, "signed-session");
    assert.equal(f.api.currentMerchantId, "merchant");
    assert.equal(f.api.requiresChatRecovery, false);
  });

  test(`real store ${failure} exposes the error without losing cart, payment, or showing success`, async () => {
    const f = await fixture(failure), before = preservedState();
    const observed: Array<{ updating: boolean; error: string | null }> = [];
    const unsubscribe = useCheckoutStore.subscribe(state => { observed.push({ updating: state.cartUpdating, error: state.cartError }); });
    try {
      const result = await acceptPresented("suggestion", "recommended-sku");
      const state = useCheckoutStore.getState();
      assert.equal(result.ok, false); assert.ok(result.error?.trim());
      assert.equal(result.error, failure === "review_required" ? reviewCopy : unknownCopy);
      assert.equal(state.cartError, result.error, "the component receives the same visible store error");
      assert.equal(state.cartUpdating, false); assert.equal(state.error, null);
      assert.equal(result.error.includes("DO_NOT_SHOW_SUCCESS"), false);
      assert.equal(result.error.includes("synthetic_network_failure"), false);
      assert.deepEqual(preservedState(), before);
      assert.ok(observed.some(event => event.updating));
      assert.deepEqual(observed.at(-1), { updating: false, error: result.error });
      assertOneBoundAccept(f.calls()); assert.deepEqual(await f.api.fetchCart(), f.cachedCart);
    } finally { unsubscribe(); }
  });

  test(`in-flight ${failure} blocks a second accept instead of replaying or submitting another action`, async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(failure, pending), before = preservedState();
    const first = acceptPresented("suggestion", "recommended-sku");
    try {
      assert.equal(useCheckoutStore.getState().cartUpdating, true);
      const duplicate = await acceptPresented("other-suggestion", "other-sku");
      assert.deepEqual(duplicate, { ok: false, error: "checkout_unavailable" });
      await f.whenAcceptSent;
      assertOneBoundAccept(f.calls());
    } finally { release(); }
    assert.equal((await first).ok, false);
    assert.equal(useCheckoutStore.getState().cartUpdating, false);
    assert.deepEqual(preservedState(), before); assertOneBoundAccept(f.calls());
  });
}

for (const blocked of ["payment_submitting", "completed", "missing_session"] as const) test(`store guard ${blocked} cannot dispatch an accept or alternate operation`, async () => {
  const f = await fixture("review_required");
  if (blocked === "payment_submitting") useCheckoutStore.setState({ paymentSubmitting: true });
  if (blocked === "completed") useCheckoutStore.setState({ status: "completed" });
  if (blocked === "missing_session") useCheckoutStore.setState({ api: null });
  const before = preservedState(), result = await acceptPresented("suggestion", "recommended-sku");
  assert.deepEqual(result, { ok: false, error: "checkout_unavailable" });
  assert.equal(f.calls().length, 0); assert.deepEqual(preservedState(), before);
});

test("known stale quotation is blocked in the store without another request; a new suggestion ID can resume", async () => {
  const f = await fixture("review_required"), before = preservedState();
  const first = await acceptPresented("suggestion", "recommended-sku");
  assert.deepEqual(first, { ok: false, error: reviewCopy, reviewRequired: true });
  const repeated = await acceptPresented("suggestion", "different-sku");
  assert.deepEqual(repeated, first); assertOneBoundAccept(f.calls()); assert.deepEqual(preservedState(), before);
  await acceptPresented("new-quotation", "recommended-sku");
  assert.equal(f.calls().length, 2);
  assert.deepEqual(f.calls()[1].body, { session_id: "signed-session", suggestion_id: "new-quotation", accepted_skus: ["recommended-sku"], expected_quote: shownQuote(f.api, "new-quotation") });
});

test("network uncertainty is not classified as a known stale quote and never claims non-execution", async () => {
  await fixture("network");
  assert.deepEqual(await acceptPresented("suggestion", "recommended-sku"), { ok: false, error: unknownCopy });
});

for (const [status, body] of [
  [500, { code: "cross_sell_quote_review_required" }],
  [422, { code: "cross_sell_quote_review_required_extra", message: "cross_sell_quote_review_required" }],
  [422, { code: "other", message: "cross_sell_quote_review_required" }],
] as const) test(`structured status/code mismatch cannot select review guidance (${status}/${body.code})`, async () => {
  await fixture("review_required", undefined, { status, body });
  const result = await acceptPresented("suggestion", "recommended-sku");
  assert.deepEqual(result, { ok: false, error: unknownCopy });
});

test("Nest message code fallback is typed, but arbitrary server prose is never user-facing", async () => {
  const f = await fixture("review_required", undefined, { status: 422, body: { message: "cross_sell_quote_review_required", detail: "UNSAFE_RAW_BODY" } });
  assert.deepEqual(await acceptPresented("suggestion", "recommended-sku"), { ok: false, error: reviewCopy, reviewRequired: true });
  assertOneBoundAccept(f.calls());
});

test("an Error containing the known code is not a structured refusal", async () => {
  const f = await fixture("review_required");
  f.api.acceptCrossSell = async () => { throw new Error("cross_sell_quote_review_required"); };
  assert.deepEqual(await acceptPresented("suggestion", "recommended-sku"), { ok: false, error: unknownCopy });
  assert.equal(f.calls().length, 0);
});

test("session reset clears stale-quotation refusals without submitting or replaying", async () => {
  const f = await fixture("review_required");
  await acceptPresented("suggestion", "recommended-sku");
  useCheckoutStore.getState().resetSession();
  useCheckoutStore.setState({ api: f.api, status: "active" });
  await acceptPresented("suggestion", "recommended-sku");
  assert.equal(f.calls().length, 2);
});

test("stale suggestion identity is merchant/session scoped rather than globally blacklisting the ID", async () => {
  const f = await fixture("review_required");
  await acceptPresented("suggestion", "recommended-sku");
  const other = new CheckoutSession({ merchantId: "other-merchant", embedToken: "fixture-signed-token", apiBaseUrl: "https://fixture.invalid" });
  await other.start(); useCheckoutStore.setState({ api: other, status: "active" });
  await acceptPresented("suggestion", "recommended-sku");
  assert.equal(f.calls().length, 2);
});

test("late refusal from a reset session cannot poison the new session or stop its pending operation", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture("review_required", waiting);
  const pending = acceptPresented("suggestion", "recommended-sku");
  await f.whenAcceptSent;
  useCheckoutStore.getState().resetSession();
  const other = new CheckoutSession({ merchantId: "other-merchant", embedToken: "fixture-signed-token", apiBaseUrl: "https://fixture.invalid" });
  await other.start(); useCheckoutStore.setState({ api: other, status: "active", cartUpdating: true });
  const before = preservedState(); release();
  assert.deepEqual(await pending, { ok: false, error: "checkout_unavailable" });
  assert.deepEqual(preservedState(), before); assert.equal(useCheckoutStore.getState().cartUpdating, true);
  assert.equal(useCheckoutStore.getState().cartError, null);
});
