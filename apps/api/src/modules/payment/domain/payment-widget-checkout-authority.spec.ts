import assert from "node:assert/strict";
import test from "node:test";
import { widgetPaymentAuthorityFixture } from "./widget-checkout-payment.fixture.js";
import { parseWidgetCheckoutPaymentAuthority } from "./widget-checkout-payment-authority.schemas.js";
import { readPaymentWidgetCheckoutAuthority, assertSamePaymentWidgetCheckoutAuthority,
  assertNoPaymentWidgetCheckoutAuthorityInProviderInput } from "./payment-widget-checkout-authority.js";

test("reads detached frozen effective P+D projection with shipping and buyer fee exactly once", () => {
  const f = widgetPaymentAuthorityFixture(), authority = readPaymentWidgetCheckoutAuthority(f.scope)!;
  assert.deepEqual(authority, f.authority); f.authority.frozenProjection.cart.items[1]!.price = 999;
  assert.equal(authority.frozenProjection.cart.total, 118); assert.equal(authority.frozenProjection.cart.items[1]!.price, 18);
  assert.equal(authority.amountBreakdown.itemsSubtotalCents, 11800); assert.equal(authority.amountBreakdown.discountCents, 0);
  assert.equal(authority.amountCents, 12849); assert.equal(authority.frozenProjection.cart.discountBudget.promotionDiscountCents, 200);
});
for (const value of [null, undefined, {}, { origin: "storefront" }]) test(`present invalid widget authority cannot become legacy (${JSON.stringify(value)})`, () => {
  const f = widgetPaymentAuthorityFixture(); Reflect.set(f.scope.creation, "widgetCheckoutAuthority", value);
  assert.throws(() => readPaymentWidgetCheckoutAuthority(f.scope), /payment_widget_checkout_authority_conflict/);
});
for (const key of ["widgetCheckoutAuthority", "widget_checkout_authority", "_widgetCrossSellAcceptance", "widgetCheckoutScope"]) {
  test(`provider input refuses private ${key} presence including undefined/null/inherited`, () => {
    for (const value of [undefined, null, {}]) assert.throws(() => assertNoPaymentWidgetCheckoutAuthorityInProviderInput({ [key]: value }));
    assert.throws(() => assertNoPaymentWidgetCheckoutAuthorityInProviderInput(Object.create({ [key]: undefined })));
  });
}
for (const corruption of ["scope", "payment", "method", "amount", "input-scope", "input-amount", "input-method", "breakdown", "buyer", "budget", "quantity", "private-customer"] as const)
  test(`malformed frozen identity is refused: ${corruption}`, () => {
    const f = widgetPaymentAuthorityFixture();
    if (corruption === "scope") f.authority.merchantId = "foreign";
    if (corruption === "payment") f.authority.paymentId = "foreign";
    if (corruption === "method") Reflect.set(f.authority, "method", "card");
    if (corruption === "amount") f.authority.amountCents++;
    if (corruption === "input-scope") f.scope.creation.input.sessionId = "foreign";
    if (corruption === "input-amount") f.scope.creation.input.amountCents++;
    if (corruption === "input-method") f.scope.creation.input.method = "card";
    if (corruption === "breakdown") Reflect.set(f.authority.amountBreakdown, "discountCents", 200);
    if (corruption === "buyer") f.authority.frozenProjection.globalUserId = "foreign";
    if (corruption === "budget") f.authority.frozenProjection.cart.discountBudget.promotionDiscountCents++;
    if (corruption === "quantity") f.authority.frozenProjection.cart.items[0]!.quantity++;
    if (corruption === "private-customer") Reflect.set(f.authority.frozenProjection.customer, "otp_code", "PRIVATE_SYNTHETIC_OTP");
    assert.throws(() => readPaymentWidgetCheckoutAuthority(f.scope), /payment_widget_checkout_authority_conflict/);
  });
test("immutable identity is symmetric, including absent authority", () => {
  const f = widgetPaymentAuthorityFixture(), before = structuredClone(f.scope), without = structuredClone(f.scope);
  Reflect.deleteProperty(without.creation, "widgetCheckoutAuthority");
  assertSamePaymentWidgetCheckoutAuthority(before, f.scope);
  assert.throws(() => assertSamePaymentWidgetCheckoutAuthority(before, without));
  assert.throws(() => assertSamePaymentWidgetCheckoutAuthority(without, before));
  const changed = structuredClone(before); changed.creation.widgetCheckoutAuthority.acceptanceEventId = "other";
  assert.throws(() => assertSamePaymentWidgetCheckoutAuthority(before, changed));
});
test("inherited/nonenumerable/accessor private sibling cannot disappear during JSON clone", () => {
  const f = widgetPaymentAuthorityFixture();
  for (const mode of ["inherited", "nonenumerable", "accessor"] as const) {
    const creation = mode === "inherited" ? Object.assign(Object.create({ widgetCheckoutAuthority: f.authority }), { input: f.scope.creation.input }) : { input: f.scope.creation.input };
    if (mode === "nonenumerable") Object.defineProperty(creation, "widgetCheckoutAuthority", { value: f.authority, enumerable: false });
    if (mode === "accessor") Object.defineProperty(creation, "widgetCheckoutAuthority", { enumerable: true, get() { throw new Error("PRIVATE_CALLER_ERROR"); } });
    assert.throws(() => readPaymentWidgetCheckoutAuthority({ ...f.scope, creation }), (error: unknown) => error instanceof Error
      && error.message === "payment_widget_checkout_authority_conflict" && !error.stack?.includes("PRIVATE_CALLER_ERROR"));
  }
});
test("schema rejects discounted storage BASE and arbitrary OTP/private journal extras", () => {
  const f = widgetPaymentAuthorityFixture();
  assert.deepEqual(parseWidgetCheckoutPaymentAuthority(f.authority), f.authority);
  for (const patch of [{ _widgetCrossSellAcceptance: {} }, { couponAuthority: {} }, { providerInput: {} }])
    assert.throws(() => parseWidgetCheckoutPaymentAuthority({ ...f.authority, ...patch }));
  f.authority.frozenProjection.cart.total = 120;
  assert.throws(() => parseWidgetCheckoutPaymentAuthority(f.authority));
});
