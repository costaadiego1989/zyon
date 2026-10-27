import assert from "node:assert/strict";
import test from "node:test";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "./payment-intent.entity.js";
import { assertSamePaymentIdentity } from "./payment-persistence.js";
import { widgetPaymentAuthorityFixture } from "./widget-checkout-payment.fixture.js";

function fixture() {
  const f = widgetPaymentAuthorityFixture();
  const intent = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "checkout", idempotencyKey: "key",
    method: "pix", currency: "BRL", amountCents: 12849, amountBreakdown: f.authority.amountBreakdown });
  intent.prepareCreation({ ...f.scope.creation.input, method: "pix", intentId: intent.id });
  const authority = { ...f.authority, paymentId: intent.id };
  return { intent, authority };
}

test("widget journal capture is detached and keeps provider input private", () => {
  const f = fixture(); f.intent.acknowledgeWidgetCheckoutCapture(f.authority);
  f.authority.frozenProjection.customer.email = "changed@example.test";
  assert.equal(f.intent.snapshot().creation!.widgetCheckoutAuthority!.frozenProjection.customer.email, "buyer@example.test");
  assert.equal("widgetCheckoutAuthority" in f.intent.snapshot().creation!.input, false);
  assert.throws(() => f.intent.acknowledgeWidgetCheckoutCapture(f.authority), /payment_widget_checkout_authority_conflict/);
});
for (const key of ["widgetCheckoutAuthority", "widget_checkout_authority", "_widgetCrossSellAcceptance", "widgetCheckoutScope"])
  test(`payment prepare rejects private provider alias ${key}`, () => {
    const f = widgetPaymentAuthorityFixture(), intent = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "checkout", idempotencyKey: "key",
      method: "pix", currency: "BRL", amountCents: 12849, amountBreakdown: f.authority.amountBreakdown });
    assert.throws(() => intent.prepareCreation({ ...f.scope.creation.input, method: "pix", intentId: intent.id, [key]: undefined }), /payment_widget_checkout_authority_conflict/);
  });
for (const fault of ["persisted", "attempt", "failed", "foreign"] as const)
  test(`capture acknowledgement rejects ${fault}`, () => {
    const f = fixture();
    if (fault === "persisted") f.intent.persisted(1);
    if (fault === "attempt") f.intent.claimCreation("lease", new Date("2026-10-20T12:00:01Z"));
    if (fault === "failed") f.intent.markFailed();
    if (fault === "foreign") f.authority.paymentId = "foreign";
    assert.throws(() => f.intent.acknowledgeWidgetCheckoutCapture(f.authority), /payment_widget_checkout_authority_conflict/);
  });
test("rehydration preserves frozen journal through uncertain recovery", () => {
  const f = fixture(); f.intent.acknowledgeWidgetCheckoutCapture(f.authority); f.intent.persisted(1);
  f.intent.claimCreation("lease", new Date("2026-10-20T12:00:01Z")); f.intent.markCreationUncertain("lease", "provider_ack_unknown");
  const before = f.intent.snapshot(), recovered = PaymentIntentEntity.rehydrate(before);
  assert.equal(recovered.claimCreation("recover", new Date("2026-10-20T12:02:00Z")), "recover");
  assertSamePaymentIdentity(before, recovered.snapshot());
  assert.deepEqual(recovered.snapshot().creation!.widgetCheckoutAuthority, f.authority);
});
for (const fault of ["drop", "replace", "add"] as const)
  test(`immutable identity rejects widget authority ${fault}`, () => {
    const f = fixture(); f.intent.acknowledgeWidgetCheckoutCapture(f.authority);
    const current = f.intent.snapshot(), next = structuredClone(current);
    if (fault === "drop") delete next.creation!.widgetCheckoutAuthority;
    if (fault === "replace") next.creation!.widgetCheckoutAuthority!.acceptanceEventId = "different";
    if (fault === "add") delete current.creation!.widgetCheckoutAuthority;
    assert.throws(() => assertSamePaymentIdentity(current, next), /payment_widget_checkout_authority_conflict/);
  });
test("hydration snapshots parsed authority and refuses accessor-backed sibling", () => {
  const f = fixture(); f.intent.acknowledgeWidgetCheckoutCapture(f.authority);
  const snapshot = f.intent.snapshot();
  Object.defineProperty(snapshot.creation!, "widgetCheckoutAuthority", { enumerable: true, get: () => f.authority });
  assert.throws(() => PaymentIntentEntity.rehydrate(snapshot), /payment_widget_checkout_authority_conflict/);
});
test("widget authority is not a provider input capability during hydration", () => {
  const f = fixture(), snapshot: PaymentIntentSnapshot = f.intent.snapshot();
  Reflect.set(snapshot.creation!.input, "widgetCheckoutAuthority", null);
  assert.throws(() => PaymentIntentEntity.rehydrate(snapshot), /payment_widget_checkout_authority_conflict/);
});
