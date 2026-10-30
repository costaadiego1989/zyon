import test from "node:test";
import assert from "node:assert/strict";
import { projectPaidOrderReceipt, exactMajorCents, type ReceiptOrderSnapshot, type ReceiptPaymentSnapshot } from "./paid-order-receipt.js";

const order: ReceiptOrderSnapshot = { merchantId: "m1", sessionId: "s1", externalOrderId: "185874", currency: "BRL", status: "approved",
  orderTotal: "12.8600", shippingCents: 1016, lineItemsJson: [{ unitPriceCents: 300, quantity: 1 }] };
const payment: ReceiptPaymentSnapshot = { merchantId: "m1", sessionId: "s1", providerPaymentId: "185874", status: "approved", currency: "BRL",
  amountCents: 1385, approvedAmountCents: 1385, amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 300, discountCents: 30,
    shippingCents: 1016, platformFeeCents: 99, totalCents: 1385 } };

test("approved charge reconciles to1385 while merchant order remains1286 and inputs remain unchanged", () => {
  const before = JSON.stringify({ order, payment });
  assert.deepEqual(projectPaidOrderReceipt(order, payment), { status: "itemized", currency: "BRL", itemsSubtotalCents: 300,
    discountCents: 30, shippingCents: 1016, platformFeeCents: 99, merchantOrderTotalCents: 1286, totalPaidCents: 1385 });
  assert.equal(JSON.stringify({ order, payment }), before);
});

for (const key of ["merchantId", "sessionId", "providerPaymentId", "currency", "status"] as const) {
  test(`a different payment ${key} cannot become the order's paid receipt`, () => {
    assert.equal(projectPaidOrderReceipt(order, { ...payment, [key]: "other" }), null);
  });
}
for (const amount of [-1, 0, 13.85, Number.MAX_SAFE_INTEGER + 1, 1286]) {
  test(`unconfirmed or invalid charge amount ${amount} cannot be labelled paid`, () => {
    assert.equal(projectPaidOrderReceipt(order, { ...payment, amountCents: amount }), null);
  });
}
test("non-approved orders and missing approved amount do not produce payment receipts", () => {
  assert.equal(projectPaidOrderReceipt({ ...order, status: "cancelled" }, payment), null);
  assert.equal(projectPaidOrderReceipt(order, { ...payment, approvedAmountCents: null }), null);
});

for (const [key, values] of Object.entries({ itemsSubtotalCents: [301, -1, 3.0 / 100], discountCents: [31, -1, 301],
  shippingCents: [1015, -1, null], platformFeeCents: [98, -1, undefined], totalCents: [1286, -1, 1386], version: [2], currency: ["USD"] })) {
  for (const value of values) test(`unreconciled breakdown ${key}=${String(value)} preserves only confirmed paid total`, () => {
    const amountBreakdown = { ...(payment.amountBreakdown as object), [key]: value };
    assert.deepEqual(projectPaidOrderReceipt(order, { ...payment, amountBreakdown }), {
      status: "total_only", currency: "BRL", totalPaidCents: 1385, reason: "breakdown_unavailable" });
  });
}
for (const mutation of [
  { orderTotal: "12.85" }, { orderTotal: "12.8601" }, { shippingCents: null }, { shippingCents: -1 },
  { lineItemsJson: [{ unitPriceCents: 1000, quantity: 1 }] }, { lineItemsJson: [{ unitPriceCents: 300, quantity: 2 }] },
  { lineItemsJson: [{ unitPriceCents: 300, quantity: -1 }] }, { lineItemsJson: null },
]) test(`inconsistent completed order snapshot falls back honestly ${JSON.stringify(mutation)}`, () => {
  assert.equal(projectPaidOrderReceipt({ ...order, ...mutation }, payment)?.status, "total_only");
});
test("legacy charge without a breakdown never assumes zero fee", () => {
  const result = projectPaidOrderReceipt(order, { ...payment, amountBreakdown: null });
  assert.equal(result?.status, "total_only"); assert.equal("platformFeeCents" in result!, false);
});
test("decimal conversion never rounds incompatible accounting amounts", () => {
  assert.equal(exactMajorCents("12.8600"), 1286); assert.equal(exactMajorCents("12.8601"), null);
  assert.equal(exactMajorCents("0.99"), 99); assert.equal(exactMajorCents("NaN"), null);
});
