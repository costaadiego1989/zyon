import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { widgetPaymentAuthorityFixture } from "../../../payment/domain/widget-checkout-payment.fixture.js";
import { widgetCheckoutRevisionContextHash } from "./widget-cross-sell-checkout-revision.js";
import { widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { readWidgetCheckoutOwnPayment } from "./widget-checkout-own-payment.js";

// Actual delegate rows are explicit doubles here; native SQL is a separate gate.
function fixture() {
  const f = widgetPaymentAuthorityFixture();
  const scope = { merchantId: f.authority.merchantId, sessionId: f.authority.checkoutSessionId };
  const stored = { ...scope, globalUserId: f.authority.buyerId, version: f.authority.checkoutVersion,
    strategyContextVersion: 4, customer: f.authority.frozenProjection.customer,
    shipping: f.authority.frozenProjection.shipping, shippingOptions: null, paymentMethod: f.authority.method };
  f.authority.contextHash = widgetCheckoutRevisionContextHash(stored);
  // Only the receipt identity is consumed here; full receipt/evidence parsing is
  // separately mandatory in prepareAcceptedWidgetCheckout before this helper.
  const receipt = { eventId: f.authority.acceptanceEventId,
    ...(f.authority.revisionEventId ? { revision: { eventId: f.authority.revisionEventId } } : {}) } as ReturnType<typeof widgetCrossSellCheckoutReceiptSchema.parse>;
  const row: Record<string, unknown> = { ...f.scope, version: 1, status: "pending", providerPaymentId: null,
    approvedAmountCents: null, acceptedOfferId: null, commerceOrderId: null, creation: { ...f.scope.creation, state: "ready" } };
  const calls: string[] = [];
  let lookup: unknown;
  const tx = { async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
    const sql = parts.join("?"); calls.push(sql); assert.match(sql, /payment_intents.*merchant_id/s);
    assert.deepEqual(values, [scope.merchantId, scope.sessionId, row.id]); return [];
  }, paymentIntent: { async findFirst(args: unknown) { calls.push("row"); lookup = args; return row; } } } as unknown as Prisma.TransactionClient;
  return { ...f, scope, stored, receipt, row, tx, calls, lookup: () => lookup,
    read: () => readWidgetCheckoutOwnPayment(tx, scope, stored, receipt, f.authority.paymentId) };
}

test("own-payment lookup proves committed scoped ready row and immutable context, never a caller id exemption", async () => {
  const f = fixture(); assert.deepEqual(await f.read(), f.authority);
  assert.deepEqual(f.lookup(), { where: { id: f.authority.paymentId, ...f.scope } });
  assert.match(f.calls[0]!, /FOR UPDATE/); assert.equal(f.calls[1], "row");
});

for (const [key, value] of Object.entries({ id: "foreign", merchantId: "foreign", sessionId: "foreign", version: 0,
  status: "approved", providerPaymentId: "provider", approvedAmountCents: 1, acceptedOfferId: "offer", commerceOrderId: "order" }))
  test(`own-payment refuses actual row drift ${key}`, async () => {
    const f = fixture(); f.row[key] = value;
    await assert.rejects(f.read(), { message: "cross_sell_quote_review_required" });
  });

for (const key of ["firstAttemptAt", "leaseToken", "leaseUntil", "cancellation", "couponAuthority"])
  test(`own-payment never exempts already-started/other-source journal ${key}`, async () => {
    const f = fixture(); Reflect.set(f.row.creation as object, key, undefined);
    await assert.rejects(f.read(), { message: "cross_sell_quote_review_required" });
  });

for (const state of ["in_flight", "uncertain", "complete"])
  test(`own-payment refuses ${state}, even without provider id`, async () => {
    const f = fixture(); Reflect.set(f.row.creation as object, "state", state);
    await assert.rejects(f.read(), { message: "cross_sell_quote_review_required" });
  });

for (const key of ["buyerId", "checkoutVersion", "acceptanceEventId", "revisionEventId", "contextHash"] as const)
  test(`own-payment refuses detached identity mismatch ${key}`, async () => {
    const f = fixture(); Reflect.set(f.authority, key, key === "checkoutVersion" ? f.stored.version + 1 : "foreign");
    await assert.rejects(f.read(), { message: "cross_sell_quote_review_required" });
  });

test("own-payment cannot bypass absent acceptance or actual persisted sibling", async () => {
  const f = fixture();
  await assert.rejects(readWidgetCheckoutOwnPayment(f.tx, f.scope, f.stored, undefined, f.authority.paymentId));
  assert.equal(f.calls.length, 0);
  Reflect.deleteProperty(f.row.creation as object, "widgetCheckoutAuthority");
  await assert.rejects(f.read(), { message: "cross_sell_quote_review_required" });
});

test("own-payment context includes canonical customer, address, selection and generation", async () => {
  for (const patch of [{ strategyContextVersion: 5 }, { paymentMethod: "card" }, { customer: { email: "changed@example.test" } },
    { shipping: null }, { shippingOptions: {} }, { globalUserId: "foreign" }]) {
    const f = fixture(); Object.assign(f.stored, patch);
    await assert.rejects(f.read(), { message: "cross_sell_quote_review_required" });
  }
});
