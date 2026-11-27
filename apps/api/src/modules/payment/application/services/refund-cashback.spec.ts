import { test } from "node:test";
import assert from "node:assert/strict";
import { RefundPaymentService } from "./refund-payment.service.js";

function fixture(status = "succeeded", localFailure = false) {
  const snapshot = { id: "pi", currency: "BRL", providerPaymentId: "psp", amountCents: 9600, approvedAmountCents: 9600,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0,
      cashbackCents: 2000, cashbackReservationId: "r", cashbackEarningQuoteId: "q", shippingCents: 1500,
      platformFeeCents: 100, totalCents: 9600 } };
  const posts: any[] = []; const restored: any[] = [];
  const core = { previewRefundOrder: async () => ({ externalRefundCents: 4750 }),
    claimRefundOrder: async () => ({ claimed: true }), refundProviderFailed: async () => undefined,
    processRefundOrder: async (input: any) => { if (localFailure) throw new Error("db_unavailable"); restored.push(input); } };
  const service = new RefundPaymentService({ findApprovedBySessionId: async () => ({ snapshot: () => snapshot }),
    getIntentById: async () => ({ snapshot: () => snapshot }) } as any,
  { refundPayment: async (input: any) => { posts.push(input); return { refundId: "rf", status }; },
    fetchRefundStatus: async () => ({ state: "succeeded" }) } as any,
  { findCompletedOrderByExternalOrderId: async () => ({ sessionId: "s", shippingCents: 1500,
    lineItems: [{ variantId: "v", unitPriceCents: 5000, quantity: 2 }] }) } as any, undefined, core as any);
  const input = { merchantId: "m", externalOrderId: "o", returnedItems: [{ variantId: "v", quantity: 1 }], idempotencyKey: "return:r1" };
  return { service, posts, restored, input };
}

test("CB-11 cashback partial refund sends only external paid allocation and restores credit after success", async () => {
  const { service, posts, restored, input } = fixture();
  const prepared = await service.prepareOrderRefund(input);
  assert.equal(prepared.amountCents, 4750); assert.equal(posts.length, 0); assert.equal(restored.length, 0);
  const result = await service.refundPreparedPayment(prepared);
  assert.equal(result.refunded, true); assert.equal(posts[0].amountCents, 4750);
  assert.deepEqual(restored, [{ merchantId: "m", orderId: "o", returnedItems: input.returnedItems, commandKey: "return:r1" }]);
  assert.equal("cashbackContext" in result, false);
});

test("CB-14 pending provider refund never restores cashback", async () => {
  const { service, restored, input } = fixture("pending");
  const result = await service.refundOrderPayment(input);
  assert.equal(result.refunded, false); assert.equal(result.providerRefundId, "rf"); assert.deepEqual(restored, []);
});

test("CB-23 confirmed refund with local failure preserves provider proof for reconciliation", async () => {
  const { service, posts, input } = fixture("succeeded", true);
  const result = await service.refundOrderPayment(input);
  assert.deepEqual(result, { refunded: false, amountCents: 4750, paymentIntentId: "pi", providerRefundId: "rf",
    reason: "cashback_refund_reconciliation_required" });
  const pending = await service.reconcileRefundPayment({ ...input, providerRefundId: "rf", refundReference: "return:r1" });
  assert.equal(pending.state, "pending"); assert.equal(posts.length, 1);
});

test("CB-11 provider reconciliation restores original items with the same durable return command", async () => {
  const { service, posts, restored, input } = fixture("pending");
  await service.refundOrderPayment(input);
  const result = await service.reconcileRefundPayment({ merchantId: "m", externalOrderId: "o", providerRefundId: "rf",
    paymentIntentId: "pi", refundReference: "return:r1", returnedItems: input.returnedItems });
  assert.equal(result.state, "succeeded"); assert.equal(posts.length, 1);
  assert.deepEqual(restored, [{ merchantId: "m", orderId: "o", commandKey: "return:r1", returnedItems: input.returnedItems }]);
});
