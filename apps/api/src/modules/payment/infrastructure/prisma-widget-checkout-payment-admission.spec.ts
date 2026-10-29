import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { widgetPaymentAuthorityFixture } from "../domain/widget-checkout-payment.fixture.js";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { createWidgetCheckoutPaymentAdmission, type AcceptedWidgetCheckoutPaymentCurrent } from "./prisma-widget-checkout-payment-admission.js";

function fixture() {
  const f = widgetPaymentAuthorityFixture(), state = { currentRow: null as Record<string, unknown> | null };
  const snapshot: PaymentIntentSnapshot = { id: "payment", merchantId: "merchant", sessionId: "checkout", idempotencyKey: "key", version: 0,
    amountCents: 12849, currency: "BRL", method: "pix", status: "pending", statusHistory: [], amountBreakdown: f.authority.amountBreakdown,
    creation: { state: "ready", input: { ...f.scope.creation.input, method: "pix" } } };
  const current: AcceptedWidgetCheckoutPaymentCurrent = { stored: { merchantId: "merchant", sessionId: "checkout", version: 9,
    strategyContextVersion: 4, globalUserId: "buyer", customer: { ...f.authority.frozenProjection.customer, otp_code: "PRIVATE_SYNTHETIC_OTP", externalCustomerId: "PRIVATE_PROVIDER" },
    shipping: f.authority.frozenProjection.shipping, shippingOptions: null, paymentMethod: null }, receipt: { eventId: "acceptance", revision: { eventId: "revision" } },
    quote: { quotedAt: f.authority.admittedAt }, projectedCart: f.authority.frozenProjection.cart, selectedShipping: f.authority.frozenProjection.shipping };
  const calls: Array<{ scope: unknown; options: unknown; sameTransaction: boolean }> = [];
  const tx = { paymentIntent: { async findUnique() { return structuredClone(state.currentRow); } } } as unknown as Prisma.TransactionClient;
  const capture = createWidgetCheckoutPaymentAdmission(async (receivedTx, scope, options) => {
    calls.push({ scope, options, sameTransaction: tx === receivedTx }); return structuredClone(current);
  }, () => 149);
  return { ...f, snapshot, current, tx, capture, calls, state };
}

test("new admission freezes only canonical effective cart/shipping/buyer and uses the caller transaction", async () => {
  const f = fixture(), before = structuredClone(f.snapshot), result = await f.capture(f.tx, f.snapshot);
  assert.equal(result.paymentId, "payment"); assert.equal(result.checkoutVersion, 9); assert.equal(result.amountCents, 12849);
  assert.equal(result.amountBreakdown.itemsSubtotalCents, 11800); assert.equal(result.amountBreakdown.discountCents, 0);
  assert.equal(result.frozenProjection.cart.items[1]!.price, 18); assert.equal(result.frozenProjection.cart.discountBudget.promotionDiscountCents, 200);
  assert.deepEqual(f.calls, [{ scope: { merchantId: "merchant", sessionId: "checkout" }, options: undefined, sameTransaction: true }]);
  assert.deepEqual(f.snapshot, before);
  for (const privateValue of ["PRIVATE_SYNTHETIC_OTP", "PRIVATE_PROVIDER", "otp_code", "externalCustomerId"]) assert.ok(!JSON.stringify(result).includes(privateValue));
  f.current.projectedCart.items[0]!.price = 999; assert.equal(result.frozenProjection.cart.items[0]!.price, 100);
});
test("new journals cannot carry a precaptured authority even with matching valid fields", async () => {
  const f = fixture(); Reflect.set(f.snapshot.creation!, "widgetCheckoutAuthority", f.authority);
  await assert.rejects(f.capture(f.tx, f.snapshot)); assert.equal(f.calls.length, 0);
});
for (const field of ["merchantId", "sessionId", "intentId", "amountCents", "method"] as const)
  test(`new capture must bind provider input ${field} to its immutable journal`, async () => {
    const f = fixture(); Reflect.set(f.snapshot.creation!.input, field, field === "amountCents" ? 12850 : "foreign");
    await assert.rejects(f.capture(f.tx, f.snapshot), /payment_widget_checkout_authority_conflict/);
  });
test("malformed canonical customer does not expose private Zod input in admission error", async () => {
  const f = fixture(); f.current.stored.customer!.email = "PRIVATE_SYNTHETIC_EMAIL";
  await assert.rejects(f.capture(f.tx, f.snapshot), (error: unknown) => error instanceof Error
    && error.message === "payment_widget_checkout_authority_conflict" && !String(error).includes("PRIVATE_SYNTHETIC_EMAIL"));
});
test("first-send proves persisted immutable own journal before invoking the canonical exclusion", async () => {
  const f = fixture(), captured = await f.capture(f.tx, f.snapshot);
  f.snapshot.creation!.widgetCheckoutAuthority = captured;
  f.snapshot.version = 1;
  f.state.currentRow = { ...structuredClone(f.snapshot), providerPaymentId: null, acceptedOfferId: null, commerceOrderId: null, buyerFacing: null, approvedAmountCents: null };
  f.snapshot.creation = { ...f.snapshot.creation!, state: "in_flight", firstAttemptAt: "2026-10-20T12:00:01Z", leaseToken: "lease", leaseUntil: "2026-10-20T12:01:01Z" };
  f.calls.length = 0; const result = await f.capture(f.tx, f.snapshot);
  assert.deepEqual(result, captured); assert.deepEqual(f.calls, [{ scope: { merchantId: "merchant", sessionId: "checkout" }, options: { ownPaymentIntentId: "payment" }, sameTransaction: true }]);
});
for (const fault of ["version", "scope", "amount", "authority", "missing-authority", "provider", "prior-attempt", "not-ready"] as const)
  test(`no arbitrary own-journal exclusion for ${fault}`, async () => {
    const f = fixture(), captured = await f.capture(f.tx, f.snapshot); f.snapshot.creation!.widgetCheckoutAuthority = captured; f.snapshot.version = 1;
    f.state.currentRow = { ...structuredClone(f.snapshot), providerPaymentId: null, acceptedOfferId: null, commerceOrderId: null, buyerFacing: null, approvedAmountCents: null };
    f.snapshot.creation = { ...f.snapshot.creation!, state: "in_flight", firstAttemptAt: "2026-10-20T12:00:01Z" };
    const row = f.state.currentRow;
    if (fault === "version") row.version = 2;
    if (fault === "scope") row.merchantId = "foreign";
    if (fault === "amount") row.amountCents = 12850;
    if (fault === "authority") (row.creation as typeof f.snapshot.creation)!.widgetCheckoutAuthority!.acceptanceEventId = "foreign";
    if (fault === "missing-authority") Reflect.deleteProperty(row.creation as object, "widgetCheckoutAuthority");
    if (fault === "provider") row.providerPaymentId = "psp";
    if (fault === "prior-attempt") Reflect.set(row.creation as object, "firstAttemptAt", "2026-10-20T12:00:00Z");
    if (fault === "not-ready") Reflect.set(row.creation as object, "state", "uncertain");
    f.calls.length = 0; await assert.rejects(f.capture(f.tx, f.snapshot)); assert.equal(f.calls.length, 0);
  });
for (const change of ["price", "shipping", "fee", "buyer", "version", "revision", "context", "verified"] as const)
  test(`canonical ${change} mismatch cannot admit a new payment`, async () => {
    const f = fixture();
    if (change === "price") f.current.projectedCart.items[1]!.price = 19;
    if (change === "shipping") Reflect.set(f.current.selectedShipping as object, "customerPrice", 10);
    if (change === "fee") f.snapshot.amountBreakdown!.platformFeeCents = 150;
    if (change === "buyer") f.current.stored.globalUserId = "";
    if (change === "version") f.current.stored.version = 0;
    if (change === "revision") f.current.receipt.eventId = "";
    if (change === "context") f.current.stored.strategyContextVersion = -1;
    if (change === "verified") f.current.stored.customer!.email_verified = false;
    await assert.rejects(f.capture(f.tx, f.snapshot));
  });
test("first-send refuses changed canonical prices/context/shipping rather than updating the frozen journal", async () => {
  const f = fixture(), captured = await f.capture(f.tx, f.snapshot); f.snapshot.creation!.widgetCheckoutAuthority = captured; f.snapshot.version = 1;
  f.state.currentRow = { ...structuredClone(f.snapshot), providerPaymentId: null, acceptedOfferId: null, commerceOrderId: null, buyerFacing: null, approvedAmountCents: null };
  f.snapshot.creation = { ...f.snapshot.creation!, state: "in_flight", firstAttemptAt: "2026-10-20T12:00:01Z" };
  f.current.stored.strategyContextVersion++; const before = structuredClone(f.snapshot);
  await assert.rejects(f.capture(f.tx, f.snapshot)); assert.deepEqual(f.snapshot, before);
});
