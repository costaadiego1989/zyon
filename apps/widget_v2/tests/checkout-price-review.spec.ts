import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { checkoutPriceReview } from "../src/api/checkout-price-review.js";
import { CheckoutApiError } from "../src/api/checkout-api-error.js";
import { useCheckoutStore } from "../src/store/checkout-store.js";

const originalFetch = globalThis.fetch;
const initial = useCheckoutStore.getInitialState();
afterEach(() => { globalThis.fetch = originalFetch; useCheckoutStore.setState(initial, true); });
const review = { currency: "BRL", confirmation_fingerprint: "a".repeat(64), order_total_cents: 11000, service_fee_cents: 137, total_to_pay_cents: 11137,
  cart: { currency: "BRL", total: 100, currentDiscount: 0, items: [{ sku: "sku", name: "Produto", price: 100, quantity: 1 }] },
  shipping: { carrierKey: "shipping", method: "Entrega", customerPrice: 10 } };

async function fixture() {
  const calls: any[] = [];
  let nextReview: any = review, pending: Promise<void> | undefined;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
    if (String(url).endsWith("/start")) return Response.json({ session_id: "session", experience: { items: [{ sku: "sku", name: "Produto", quantity: 1, unit_price: 100 }],
      totals: { subtotal: 100, discount: 5, shipping: 10, service_fee: 1.37, total: 105, total_to_pay: 106.37 } } });
    calls.push(body);
    if (pending) await pending;
    if (nextReview) return Response.json({ code: "checkout_review_required", review: nextReview }, { status: 409 });
    return Response.json({ id: "intent", method: body.method, status: "requires_action", amountCents: 11137,
      buyerFacing: { qrCodeCopyPaste: "fixture-pix" } });
  };
  const api = new CheckoutSession({ merchantId: "store", embedToken: "token", apiBaseUrl: "https://fixture.invalid" });
  await api.start();
  useCheckoutStore.setState({ api, leadRegistered: true, status: "active", merchantPaymentConfig: { paymentMethods: { pix: true, boleto: false, card: false }, cryptoPaymentsEnabled: true },
    cart: { items: [{ sku: "sku", name: "Produto", quantity: 1, price: 100 }], total: 100, discount: 5, serviceFee: 1.37,
      totalToPay: 106.37, shipping: { key: "shipping", label: "Entrega", cost: 10 }, status: "ready_to_pay" } });
  return { api, calls, response: (value: unknown) => { nextReview = value; }, delay: (value: Promise<void>) => { pending = value; } };
}

test("transport preserves the exact server review and sends no implicit confirmation or retry", async () => {
  const f = await fixture();
  await assert.rejects(() => f.api.createPaymentIntent("pix"), error => error instanceof CheckoutApiError && error.checkoutReview?.total_to_pay_cents === 11137);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].confirmed_cart_fingerprint, undefined);
  assert.equal((await f.api.fetchCart()).totalToPay, 111.37);
  assert.equal((await f.api.fetchCart()).discount, 0);
});

test("the store displays the revised total and only explicit confirmation can create the payment", async () => {
  const f = await fixture();
  await useCheckoutStore.getState().pay("pix");
  const state = useCheckoutStore.getState();
  assert.equal(state.cart.totalToPay, 111.37);
  assert.equal(state.cart.serviceFee, 1.37);
  assert.equal(state.cart.discount, 0);
  assert.equal(state.paymentIntent, null);
  assert.equal(state.messages.at(-1)?.blocks?.[0].type, "checkout_price_review");
  await state.pay("pix");
  await state.confirmUpdatedOrder("wrong");
  assert.equal(f.calls.length, 1);
  f.response(null);
  await state.confirmUpdatedOrder(review.confirmation_fingerprint);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].confirmed_cart_fingerprint, review.confirmation_fingerprint);
  assert.equal(useCheckoutStore.getState().pendingPriceReview, null);
  assert.equal(useCheckoutStore.getState().paymentIntent?.intent_id, "intent");
});

test("a changed price requires another confirmation and an old review button cannot submit", async () => {
  const f = await fixture(); await useCheckoutStore.getState().pay("pix");
  const updated = { ...review, confirmation_fingerprint: "b".repeat(64), service_fee_cents: 200, total_to_pay_cents: 11200 };
  f.response(updated);
  await useCheckoutStore.getState().confirmUpdatedOrder(review.confirmation_fingerprint);
  assert.equal(f.calls.length, 2);
  assert.equal(useCheckoutStore.getState().cart.totalToPay, 112);
  await useCheckoutStore.getState().confirmUpdatedOrder(review.confirmation_fingerprint);
  assert.equal(f.calls.length, 2);
  assert.equal(useCheckoutStore.getState().pendingPriceReview?.review.confirmation_fingerprint, updated.confirmation_fingerprint);
});

test("malformed totals or a review without authoritative fields cannot enable confirmation", async () => {
  assert.equal(checkoutPriceReview({ ...review, total_to_pay_cents: 1 }), undefined);
  assert.equal(checkoutPriceReview({ ...review, confirmation_fingerprint: "invalid" }), undefined);
  const f = await fixture(); f.response({ ...review, service_fee_cents: undefined });
  useCheckoutStore.setState({ paymentIntent: { intent_id: "existing", method: "pix", status: "pending" } });
  await useCheckoutStore.getState().pay("pix");
  assert.equal(useCheckoutStore.getState().pendingPriceReview, null);
  assert.equal(useCheckoutStore.getState().messages.at(-1)?.blocks, undefined);
  assert.equal(useCheckoutStore.getState().paymentIntent?.intent_id, "existing");
  assert.equal(f.calls.length, 1);
});

test("double confirmation admits one request and cryptocurrency preserves its selected chain", async () => {
  const f = await fixture(); await useCheckoutStore.getState().selectCryptoChain("base");
  f.response(null);
  let release!: () => void;
  f.delay(new Promise<void>(resolve => { release = resolve; }));
  const first = useCheckoutStore.getState().confirmUpdatedOrder(review.confirmation_fingerprint);
  const duplicate = useCheckoutStore.getState().confirmUpdatedOrder(review.confirmation_fingerprint);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].preferred_chain, "base");
  assert.equal(f.calls[1].confirmed_cart_fingerprint, review.confirmation_fingerprint);
  release(); await Promise.all([first, duplicate]);
  assert.equal(useCheckoutStore.getState().paymentSubmitting, false);
});

test("resetting the session removes pending confirmation", async () => {
  const f = await fixture(); await useCheckoutStore.getState().pay("pix");
  useCheckoutStore.getState().resetSession();
  await useCheckoutStore.getState().confirmUpdatedOrder(review.confirmation_fingerprint);
  assert.equal(f.calls.length, 1);
  assert.equal(useCheckoutStore.getState().pendingPriceReview, null);
});
