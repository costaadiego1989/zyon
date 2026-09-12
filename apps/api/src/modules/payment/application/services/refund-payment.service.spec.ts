import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RefundPaymentService } from "./refund-payment.service.js";

function serviceFor(
  status: "succeeded" | "pending" | "failed" | "manual_required",
  overrides: {
    capturedCents?: number;
    order?: { lineItems?: Array<{ variantId?: string; unitPriceCents: number; quantity: number }>; shippingCents?: number };
    route?: { provider: "asaas" | "stripe" | "mercadopago" | "crypto"; providerAccountFingerprint?: string; settlementMode?: "immediate_split" | "delayed_merchant_payout" };
  } = {},
) {
  const capturedCents = overrides.capturedCents ?? 1_250;
  const providerInputs: Array<{ idempotencyKey?: string; amountCents?: number }> = [];
  const payments = {
    findApprovedBySessionId: async () => ({
      snapshot: () => ({
        providerPaymentId: "pi_approved",
        amountCents: capturedCents,
        approvedAmountCents: capturedCents,
        ...(overrides.route ? { creation: { input: overrides.route } } : {}),
      }),
    }),
  };
  const provider = { refundPayment: async (input: { idempotencyKey?: string }) => {
    providerInputs.push(input);
    return { refundId: "refund_1", status };
  } };
  const orders = {
    findCompletedOrderByExternalOrderId: async () => ({ sessionId: "session_1", lineItems: [], shippingCents: 0, ...overrides.order }),
  };
  return { service: new RefundPaymentService(payments as any, provider as any, orders as any), providerInputs };
}

describe("RefundPaymentService provider settlement", () => {
  it("treats only a succeeded provider response as a completed refund", async () => {
    const result = await serviceFor("succeeded").service.refundOrderPayment({ merchantId: "merchant", externalOrderId: "order" });
    assert.equal(result.refunded, true);
    assert.equal(result.reason, undefined);
  });

  for (const status of ["pending", "manual_required", "failed"] as const) {
    it(`keeps ${status} refunds unresolved`, async () => {
      const result = await serviceFor(status).service.refundOrderPayment({ merchantId: "merchant", externalOrderId: "order" });
      assert.equal(result.refunded, false);
      assert.equal(result.reason, `provider_refund_${status}`);
    });
  }

  it("forwards the stable return key to the payment provider", async () => {
    const { service, providerInputs } = serviceFor("succeeded");

    await service.refundOrderPayment({
      merchantId: "merchant",
      externalOrderId: "order",
      idempotencyKey: "return:return_1",
    });

    assert.equal(providerInputs[0]?.idempotencyKey, "return:return_1");
  });

  it("forwards the account frozen at payment creation to the refund provider", async () => {
    const { service, providerInputs } = serviceFor("succeeded", {
      route: { provider: "asaas", providerAccountFingerprint: "frozen-account", settlementMode: "delayed_merchant_payout" },
    });

    await service.refundOrderPayment({ merchantId: "merchant", externalOrderId: "order" });

    assert.deepEqual(providerInputs[0], {
      merchantId: "merchant",
      providerPaymentId: "pi_approved",
      amountCents: 1_250,
      provider: "asaas",
      providerAccountFingerprint: "frozen-account",
      settlementMode: "delayed_merchant_payout",
      reason: undefined,
      idempotencyKey: undefined,
    });
  });

  it("refunds the entire captured charge when every order line is returned", async () => {
    const { service, providerInputs } = serviceFor("succeeded", {
      capturedCents: 3_089,
      order: { lineItems: [{ variantId: "variant_1", unitPriceCents: 1_000, quantity: 1 }], shippingCents: 1_990 },
    });

    const result = await service.refundOrderPayment({
      merchantId: "merchant",
      externalOrderId: "order",
      returnedItems: [{ variantId: "variant_1", quantity: 1 }],
    });

    assert.equal(result.amountCents, 3_089);
    assert.equal(providerInputs[0]?.amountCents, 3_089);
  });

  it("reconciles with the persisted payment id after a webhook has marked it refunded", async () => {
    let resolvedIntentId: string | undefined;
    let providerInput: any;
    const payments = {
      findApprovedBySessionId: async () => {
        throw new Error("should_not_require_approved_intent");
      },
      getIntentById: async (_merchantId: string, intentId: string) => {
        resolvedIntentId = intentId;
        return { snapshot: () => ({ id: intentId, providerPaymentId: "pi_refunded", status: "refunded" }) };
      },
    };
    const provider = {
      fetchRefundStatus: async (input: unknown) => {
        providerInput = input;
        return { state: "succeeded" as const };
      },
    };
    const orders = {
      findCompletedOrderByExternalOrderId: async () => ({ sessionId: "session_1", lineItems: [], shippingCents: 0 }),
    };
    const service = new RefundPaymentService(payments as any, provider as any, orders as any);

    const result = await service.reconcileRefundPayment({
      merchantId: "merchant",
      externalOrderId: "order",
      paymentIntentId: "intent_refunded",
      providerRefundId: "refund_1",
      refundReference: "return:return_1",
    });

    assert.equal(result.state, "succeeded");
    assert.equal(resolvedIntentId, "intent_refunded");
    assert.deepEqual(providerInput, {
      merchantId: "merchant",
      providerPaymentId: "pi_refunded",
      providerRefundId: "refund_1",
      refundReference: "return:return_1",
      provider: undefined,
      providerAccountFingerprint: undefined,
      settlementMode: undefined,
    });
  });
});
