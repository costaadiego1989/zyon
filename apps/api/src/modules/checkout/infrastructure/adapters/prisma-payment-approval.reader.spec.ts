import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaPaymentApprovalReader } from "./prisma-payment-approval.reader.js";
import { widgetPaymentAuthorityFixture } from "../../../payment/domain/widget-checkout-payment.fixture.js";

const merchantId = "synthetic-merchant", sessionId = "synthetic-checkout", id = "synthetic-payment";
const authority = () => ({ version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId,
  checkoutSessionId: sessionId, cartId: "synthetic-cart", buyerId: "synthetic-buyer", reservationBuyerId: null,
  redemptionId: "synthetic-redemption", couponId: "synthetic-coupon", discountCents: 137, basisHash: "ab".repeat(32) });
function fixture() {
  const row = { id, merchantId, sessionId, status: "approved", currency: "BRL", amountCents: 1000, approvedAmountCents: 1000,
    providerPaymentId: "synthetic-provider", acceptedOfferId: null, amountBreakdown: null, method: "pix", creation: {
      state: "complete", couponAuthority: authority(), leaseToken: "PRIVATE_JOURNAL_CANARY",
      input: { intentId: id, merchantId, sessionId, currency: "BRL", amountCents: 1000, method: "pix" } } };
  const queries: unknown[] = []; const controls = { missing: false, fail: false };
  const failure = new Error("synthetic-storage-unknown");
  const prisma = { paymentIntent: { async findFirst(query: unknown) { queries.push(query); if (controls.fail) throw failure;
    return controls.missing ? null : row; } } } as unknown as PrismaClient;
  return { row, queries, controls, failure, reader: new PrismaPaymentApprovalReader(prisma) };
}
const conflict = (work: () => Promise<unknown>) => assert.rejects(work, (error: unknown) => {
  assert.ok(error instanceof Error); assert.equal(error.message, "payment_coupon_authority_conflict");
  assert.equal("cause" in error, false); assert.equal(String(error.stack).includes("PRIVATE_JOURNAL_CANARY"), false); return true;
});

test("approval reader returns detached strict canonical authority without the raw creation journal", async () => {
  const f = fixture(); const result = await f.reader.find(merchantId, sessionId, id);
  assert.deepEqual(Reflect.get(result!, "couponAuthority"), authority());
  const snapshot = structuredClone(result); f.row.creation.couponAuthority.cartId = "changed-after-read";
  assert.deepEqual(result, snapshot);
  for (const key of ["creation", "input", "method", "leaseToken"]) assert.equal(Object.hasOwn(result!, key), false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_JOURNAL_CANARY"), false);
  assert.deepEqual(f.queries, [{ where: { id, merchantId, sessionId }, select: { id: true, merchantId: true, sessionId: true,
    status: true, currency: true, amountCents: true, approvedAmountCents: true, providerPaymentId: true,
    acceptedOfferId: true, amountBreakdown: true, method: true, creation: true } }]);
});

test("legacy approval shape remains exact without an invented optional authority key", async () => {
  const f = fixture(); Reflect.deleteProperty(f.row.creation, "couponAuthority");
  const result = await f.reader.find(merchantId, sessionId, id);
  const { creation: _creation, method: _method, ...expected } = f.row;
  assert.deepEqual(result, expected); assert.equal(Object.hasOwn(result!, "couponAuthority"), false);
});

test("legacy approval without any creation journal remains readable", async () => {
  const f = fixture(); Reflect.set(f.row, "creation", null);
  const result = await f.reader.find(merchantId, sessionId, id);
  assert.equal(Object.hasOwn(result!, "couponAuthority"), false); assert.equal(Object.hasOwn(result!, "creation"), false);
});

test("amount breakdown is detached along with the authority projection", async () => {
  const f = fixture(); const breakdown = { version: 1, currency: "BRL", itemsSubtotalCents: 1137, discountCents: 137,
    shippingCents: 0, platformFeeCents: 0, totalCents: 1000 };
  Reflect.set(f.row, "amountBreakdown", breakdown);
  const result = await f.reader.find(merchantId, sessionId, id); breakdown.discountCents = 999;
  assert.equal(result!.amountBreakdown!.discountCents, 137);
});

test("missing approval remains null and does not reconstruct authority", async () => {
  const f = fixture(); f.controls.missing = true; assert.equal(await f.reader.find(merchantId, sessionId, id), null);
});

for (const key of ["id", "merchantId", "sessionId"] as const) test(`wrong persisted ${key} cannot cross the internal port`, async () => {
  const f = fixture(); f.row[key] = "foreign"; await conflict(() => f.reader.find(merchantId, sessionId, id));
});

for (const value of [null, undefined, {}, { ...authority(), extra: true }, { ...authority(), discountCents: "137" },
  { ...authority(), version: 2 }, { ...authority(), merchantId: "foreign" }, { ...authority(), checkoutSessionId: "foreign" }]) {
  test(`present malformed authority ${JSON.stringify(value)} never becomes legacy approval`, async () => {
    const f = fixture(); Reflect.set(f.row.creation, "couponAuthority", value);
    await conflict(() => f.reader.find(merchantId, sessionId, id));
  });
}

for (const key of ["intentId", "merchantId", "sessionId", "amountCents", "currency", "method"] as const) test(`journal input ${key} must match its canonical payment`, async () => {
  const f = fixture(); Reflect.set(f.row.creation.input, key, key === "amountCents" ? 999 : "foreign");
  await conflict(() => f.reader.find(merchantId, sessionId, id));
});

test("unknown method cannot gain validity from a matching journal string", async () => {
  const f = fixture(); f.row.method = f.row.creation.input.method = "unknown";
  await conflict(() => f.reader.find(merchantId, sessionId, id));
});

test("legacy journal cannot hide private authority inside provider input", async () => {
  const f = fixture(); Reflect.deleteProperty(f.row.creation, "couponAuthority");
  Reflect.set(f.row.creation.input, "coupon_authority", authority());
  await conflict(() => f.reader.find(merchantId, sessionId, id));
});

test("database failure is not sanitized into absence, swallowed or retried", async () => {
  const f = fixture(); f.controls.fail = true;
  await assert.rejects(f.reader.find(merchantId, sessionId, id), error => error === f.failure); assert.equal(f.queries.length, 1);
});

test("empty lookup identity preserves no-query null behavior", async () => {
  const f = fixture(); for (const [merchant, session, payment] of [["", sessionId, id], [merchantId, "", id], [merchantId, sessionId, ""]])
    assert.equal(await f.reader.find(merchant, session, payment), null);
  assert.deepEqual(f.queries, []);
});

test("widget approval returns only detached frozen sibling, never provider journal or private input", async () => {
  const f = widgetPaymentAuthorityFixture(), row = { ...f.scope, status: "approved", approvedAmountCents: f.authority.amountCents,
    providerPaymentId: "synthetic-provider", acceptedOfferId: null };
  const reader = new PrismaPaymentApprovalReader({ paymentIntent: { async findFirst() { return row; } } } as unknown as PrismaClient);
  const approval = await reader.find("merchant", "checkout", "payment");
  assert.deepEqual(approval!.widgetCheckoutAuthority, f.authority);
  for (const key of ["creation", "input", "method", "leaseToken"]) assert.equal(key in approval!, false);
  row.creation.widgetCheckoutAuthority.frozenProjection.cart.items[1]!.price = 999;
  assert.equal(approval!.widgetCheckoutAuthority!.frozenProjection.cart.items[1]!.price, 18);
});
for (const fault of ["null", "undefined", "buyer", "amount", "scope", "input"] as const)
  test(`widget persisted ${fault} cannot become legacy approval`, async () => {
    const f = widgetPaymentAuthorityFixture(), row = { ...f.scope, status: "approved", approvedAmountCents: 12849,
      providerPaymentId: "synthetic-provider", acceptedOfferId: null };
    if (fault === "null") Reflect.set(row.creation, "widgetCheckoutAuthority", null);
    if (fault === "undefined") Reflect.set(row.creation, "widgetCheckoutAuthority", undefined);
    if (fault === "buyer") row.creation.widgetCheckoutAuthority.buyerId = "foreign";
    if (fault === "amount") row.amountCents++;
    if (fault === "scope") row.creation.widgetCheckoutAuthority.merchantId = "foreign";
    if (fault === "input") row.creation.input.intentId = "foreign";
    const reader = new PrismaPaymentApprovalReader({ paymentIntent: { async findFirst() { return row; } } } as unknown as PrismaClient);
    await assert.rejects(reader.find("merchant", "checkout", "payment"), /payment_widget_checkout_authority_conflict/);
  });
