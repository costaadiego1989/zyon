import test from "node:test";
import assert from "node:assert/strict";
import { PrismaPaidOrderReceiptReader } from "./prisma-paid-order-receipt.reader.js";

const original = { type: "ORDER_CONFIRMATION", merchantId: "m1", orderId: "185874", orderNumber: "185874", merchantName: "Loja",
  buyerEmail: "historic@example.test", buyerPhone: "+5521993001883", items: [{ name: "Historical", price: "3.00", quantity: 1 }], total: "12.86" };
const order = { merchantId: "m1", sessionId: "s1", externalOrderId: "185874", status: "approved", currency: "BRL", orderTotal: "12.86", shippingCents: 1016,
  lineItemsJson: [{ name: "Snapshot product", productType: "physical", quantity: 1, unitPriceCents: 300 }] };
const payment = { merchantId: "m1", sessionId: "s1", providerPaymentId: "185874", status: "approved", amountCents: 1385, approvedAmountCents: 1385,
  currency: "BRL", amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 300, discountCents: 30, shippingCents: 1016, platformFeeCents: 99, totalCents: 1385 } };
function harness(changes: { order?: unknown; notification?: unknown; payment?: unknown } = {}) {
  const reads: any[] = [];
  const value = (key: keyof typeof changes, fallback: unknown) => Object.hasOwn(changes, key) ? changes[key] : fallback;
  const prisma = { completedOrder: { findFirst: async (input: any) => { reads.push(["order", input]); return value("order", order); } },
    outboxMessage: { findFirst: async (input: any) => { reads.push(["outbox", input]); return value("notification", { payload: original }); } },
    paymentIntent: { findFirst: async (input: any) => { reads.push(["payment", input]); return value("payment", payment); } } };
  return { reader: new PrismaPaidOrderReceiptReader(prisma as any), reads };
}

test("receipt resolves only scoped immutable approved snapshots and never reads current catalog, cart or customer", async () => {
  const { reader, reads } = harness();
  const event = await reader.read({ merchantId: "m1", externalOrderId: "185874" });
  assert.equal(event?.paidReceipt?.totalPaidCents, 1385); assert.equal(event?.total, "12.86");
  assert.equal(event?.buyerEmail, "historic@example.test"); assert.equal(event?.items[0].price, "3.00");
  assert.equal(event?.items[0].name, "Snapshot product"); assert.equal(event?.items[0].productType, "physical");
  assert.deepEqual(reads[0][1].where, { merchantId: "m1", externalOrderId: "185874", status: "approved" });
  assert.deepEqual(reads[2][1].where, { merchantId: "m1", sessionId: "s1", providerPaymentId: "185874", status: "approved" });
  assert.equal(reads[1][1].where.causationId, "185874"); assert.equal(reads[1][1].where.merchantId, "m1");
});
for (const change of [{ order: { ...order, merchantId: "other" } }, { order: { ...order, externalOrderId: "other" } },
  { order: null }, { notification: { payload: { ...original, merchantId: "other" } } },
  { notification: { payload: { ...original, orderId: "other" } } }, { notification: null }]) {
  test(`scope mismatch never returns another buyer's receipt ${JSON.stringify(change)}`, async () => {
    assert.equal(await harness(change).reader.read({ merchantId: "m1", externalOrderId: "185874" }), null);
  });
}
test("invalid or missing approved payment cannot inherit a forged receipt from an event", async () => {
  const { reader } = harness({ payment: { ...payment, sessionId: "other" },
    notification: { payload: { ...original, paidReceipt: { status: "itemized", totalPaidCents: 999999 } } } });
  const event = await reader.read({ merchantId: "m1", externalOrderId: "185874" });
  assert.equal(event?.paidReceipt, undefined); assert.equal(event?.total, "12.86");
});
