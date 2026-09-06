import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RefundPaymentService } from "./refund-payment.service.js";

function serviceFor(status: "succeeded" | "pending" | "failed" | "manual_required") {
  const payments = {
    findApprovedBySessionId: async () => ({
      snapshot: () => ({ providerPaymentId: "pi_approved", amountCents: 1_250, approvedAmountCents: 1_250 }),
    }),
  };
  const provider = { refundPayment: async () => ({ refundId: "refund_1", status }) };
  const orders = {
    findCompletedOrderByExternalOrderId: async () => ({ sessionId: "session_1", lineItems: [], shippingCents: 0 }),
  };
  return new RefundPaymentService(payments as any, provider as any, orders as any);
}

describe("RefundPaymentService provider settlement", () => {
  it("treats only a succeeded provider response as a completed refund", async () => {
    const result = await serviceFor("succeeded").refundOrderPayment({ merchantId: "merchant", externalOrderId: "order" });
    assert.equal(result.refunded, true);
    assert.equal(result.reason, undefined);
  });

  for (const status of ["pending", "manual_required", "failed"] as const) {
    it(`keeps ${status} refunds unresolved`, async () => {
      const result = await serviceFor(status).refundOrderPayment({ merchantId: "merchant", externalOrderId: "order" });
      assert.equal(result.refunded, false);
      assert.equal(result.reason, `provider_refund_${status}`);
    });
  }
});
