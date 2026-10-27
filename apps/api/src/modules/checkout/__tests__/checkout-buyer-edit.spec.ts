import test from "node:test";
import assert from "node:assert/strict";
import { checkoutEditIntent } from "@zyon/shared-types";
import { reopenCheckout } from "../domain/services/reopen-checkout.js";
import { checkoutSession, merchantRules } from "./checkout-test-fixtures.js";
import { checkoutBenefitsPolicy } from "../domain/services/checkout-benefits-policy.js";
import { buildExperienceFromSession } from "../application/services/checkout-experience.service.js";

test("buyer requests route to editing without authorizing a payment or interpreting ordinary address data", () => {
  for (const [text, section] of [["Quero trocar para cartão", "payment"], ["Cartão", "payment"],
    ["entregar no trabalho", "address"], ["alterar endereço", "address"], ["frete mais barato", "shipping"],
    ["Usar cupom", "coupon"]]) assert.equal(checkoutEditIntent(text!), section, text);
  for (const text of ["sim", "100", "01310100", "Apto 42", "Estou aguardando meu Pix", "sem complemento"])
    assert.equal(checkoutEditIntent(text), undefined, text);
});

test("editing payment removes obsolete payment-only discounts and cart always includes the buyer fee", () => {
  const original = checkoutSession({ paymentMethod: "pix" });
  const advancedRules = [{ id: "pix-discount", enabled: true, priority: 1,
    conditions: [{ field: "payment_method", operator: "is", value: "pix" }],
    action: { type: "offer_discount", params: { percent: 10 } } }] as any;
  const rules = merchantRules({ allowFreeShipping: false });
  const first = checkoutBenefitsPolicy({ session: original, rules, advancedRules, events: [], paymentMethod: "pix" }).session;
  assert.equal(first.cart.currentDiscount, 30);
  const reopened = reopenCheckout(first, "payment");
  assert.equal(reopened.paymentMethod, undefined);
  const switched = checkoutBenefitsPolicy({ session: reopened, rules, advancedRules, events: [], paymentMethod: "card" }).session;
  assert.equal(switched.cart.currentDiscount, 0);
  assert.equal(buildExperienceFromSession(switched, { serviceFee: .99 }).totals.total_to_pay, 335.99);
  assert.equal(first.cart.currentDiscount, 30, "the cancelled payment snapshot is immutable");
});

test("reopening restores the original shipping quote before a conditional benefit is evaluated again", () => {
  const session = checkoutSession(); session.shippingOptions = [structuredClone(session.shipping!)];
  session.shipping!.customerPrice = 0;
  session.cart.appliedBenefits = [{ kind: "shipping", label: "Frete grátis", amount: 35 }];
  assert.equal(reopenCheckout(session, "payment").shipping?.customerPrice, 35);
  assert.equal(reopenCheckout(session, "shipping").shipping, undefined);
  delete session.shippingOptions;
  assert.equal(reopenCheckout(session, "payment").shipping, undefined, "no quote means re-quote, never invent a shipping price");
});

test("progressive stages reach the capped target after editing and never accumulate on repeated payment preparation", () => {
  const session = checkoutSession();
  const args = { rules: merchantRules({ allowFreeShipping: false }), advancedRules: [], paymentMethod: "pix", events: ["payment_method_selected" as const],
    progressivePolicy: { enabled: true, stages: { initial_coupon: 5, exit_intent: 5, abandoned_cart: 10, payment_nudge: 15 } } };
  const first = checkoutBenefitsPolicy({ ...args, session }).session;
  const edited = checkoutBenefitsPolicy({ ...args, session: reopenCheckout(first, "payment") }).session;
  assert.equal(first.cart.currentDiscount, 30); assert.equal(edited.cart.currentDiscount, 30);
  assert.equal(checkoutBenefitsPolicy({ ...args, session: edited }).session.cart.currentDiscount, 30);
  assert.equal(buildExperienceFromSession(edited, { serviceFee: .99 }).totals.total_to_pay, 305.99);
});
