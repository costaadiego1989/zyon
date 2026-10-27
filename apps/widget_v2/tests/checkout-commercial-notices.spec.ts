import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { cartFromExperience, type Experience } from "../src/api/checkout-session";
import { useCheckoutStore } from "../src/store/checkout-store";
import { SmartCart } from "../src/components/SmartCart";

const notice = { version: 1 as const, code: "discount_limit_reached" as const, message: "Você já obteve o desconto máximo permitido por esta loja nos produtos deste pedido. Outros benefícios não aumentam esse desconto." };
const experience = (notices?: unknown): Experience => ({ items: [{ sku: "SKU", name: "Produto", quantity: 1, unit_price: 20 }],
  totals: { subtotal: 20, discount: 2, service_fee: 0, total_to_pay: 18, total: 18, currency: "BRL" },
  ...(notices === undefined ? {} : { commercial_notices: notices }) } as Experience);
test("cart maps structured notices and a following snapshot clears old notices", () => {
  assert.deepEqual(cartFromExperience(experience([notice])).commercialNotices, [notice]);
  assert.deepEqual(cartFromExperience(experience()).commercialNotices, []);
});
test("invalid or oversized notice groups cannot be displayed", () => {
  for (const value of [[{ ...notice, version: 2 }], [{ ...notice, code: "invented" }], [{ ...notice, private_reason: "secret" }], Array(6).fill(notice)])
    assert.deepEqual(cartFromExperience(experience(value)).commercialNotices, []);
});
test("existing cart renders the notice as status text without changing totals or components", () => {
  // Zustand's server snapshot deliberately reads initial state, not live
  // client state. Exercise the real SSR hook without changing production code.
  const initial = useCheckoutStore.getInitialState(), prior = initial.cart;
  try {
    initial.cart = { ...cartFromExperience(experience([notice])), status: "ready_to_pay" };
    const html = renderToStaticMarkup(createElement(SmartCart));
    assert.match(html, /role="status"[^>]*>Você já obteve o desconto máximo/);
    assert.match(html, /checkout-cart__total/);
    assert.equal(initial.cart.totalToPay, 18);
  } finally { initial.cart = prior; }
});
test("actual checkout bootstrap stores the notice and a new signed snapshot removes it", async () => {
  const prior = useCheckoutStore.getState(), originalFetch = globalThis.fetch;
  let snapshot = experience([notice]);
  globalThis.fetch = async input => String(input).endsWith("/embed/start")
    ? Response.json({ session_id: "session", experience: snapshot }) : Response.json({});
  try {
    const config = { embedToken: "synthetic", merchantId: "store", apiBaseUrl: "https://owned.fixture.invalid" };
    await useCheckoutStore.getState().init(config);
    assert.deepEqual(useCheckoutStore.getState().cart.commercialNotices, [notice]);
    snapshot = experience();
    await useCheckoutStore.getState().init(config);
    assert.deepEqual(useCheckoutStore.getState().cart.commercialNotices, []);
    assert.equal(useCheckoutStore.getState().cart.totalToPay, 18);
  } finally {
    useCheckoutStore.getState().stopPolling();
    useCheckoutStore.setState(prior, true);
    globalThis.fetch = originalFetch;
  }
});
