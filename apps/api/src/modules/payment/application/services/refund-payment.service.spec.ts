import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RefundPaymentService } from "./refund-payment.service.js";

function serviceFor(
  status: "succeeded" | "pending" | "failed" | "manual_required",
  overrides: {
    capturedCents?: number;
    breakdown?: any;
    order?: { lineItems?: Array<{ variantId?: string; unitPriceCents: number; quantity: number }>; shippingCents?: number };
    route?: { provider: "asaas" | "stripe" | "mercadopago" | "crypto"; providerAccountFingerprint?: string; settlementMode?: "immediate_split" | "delayed_merchant_payout" };
  } = {},
) {
  const capturedCents = overrides.capturedCents ?? 1_250;
  const providerInputs: Array<{ idempotencyKey?: string; amountCents?: number }> = [];
  const payments = {
    findApprovedBySessionId: async () => ({
      snapshot: () => ({
        id: "intent_1",
        currency: "BRL",
        amountBreakdown: overrides.breakdown,
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
  it("partial refunds preserve the buyer's original checkout discount", async () => {
    const { service } = serviceFor("succeeded", { capturedCents: 2700, order: {
      lineItems: [{ variantId: "v", unitPriceCents: 1000, quantity: 2 }], shippingCents: 1000 },
      breakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 2000, discountCents: 400, shippingCents: 1000, platformFeeCents: 100, totalCents: 2700 } });
    const partial = await service.prepareOrderRefund({ merchantId: "m", externalOrderId: "o", returnedItems: [{ variantId: "v", quantity: 1 }] });
    assert.equal(partial.amountCents, 1300);
    const full = await service.prepareOrderRefund({ merchantId: "m", externalOrderId: "o", returnedItems: [{ variantId: "v", quantity: 2 }] });
    assert.equal(full.amountCents, 2700);
  });
  it("includes only proportional original freight in a partial refund", async () => {
    const { service, providerInputs } = serviceFor("succeeded", { capturedCents: 4000,
      order: { lineItems: [{ variantId: "v", unitPriceCents: 1000, quantity: 3 }], shippingCents: 1000 } });
    const prepared = await service.prepareOrderRefund({ merchantId: "merchant", externalOrderId: "order", returnedItems: [{ variantId: "v", quantity: 1 }] });
    assert.equal(prepared.amountCents, 1333); assert.equal(prepared.fullOrderReturn, false);
    assert.equal(providerInputs.length, 0);
    await service.refundPreparedPayment(prepared);
    assert.equal(providerInputs[0].amountCents, 1333);
  });
  it("unpriced, duplicate, empty or invalid returned items never become a full refund", async () => {
    for (const items of [[], [{ variantId: "unknown", quantity: 1 }], [{ variantId: "v", quantity: 4 }],
      [{ variantId: "v", quantity: 1 }, { variantId: "v", quantity: 2 }], [{ variantId: "v", quantity: 0.5 }]]) {
      const { service, providerInputs } = serviceFor("succeeded", { order: { lineItems: [{ variantId: "v", unitPriceCents: 100, quantity: 3 }] } });
      const result = await service.refundOrderPayment({ merchantId: "m", externalOrderId: "o", returnedItems: items });
      assert.equal(result.reason, "refund_items_unproven"); assert.equal(providerInputs.length, 0);
    }
  });
  it("zero, negative and excessive explicit amounts do not fall back to the capture", async () => {
    for (const amountCents of [0, -1, 1251, 1.5]) {
      const { service, providerInputs } = serviceFor("succeeded");
      assert.equal((await service.refundOrderPayment({ merchantId: "m", externalOrderId: "o", amountCents })).reason, "refund_amount_invalid");
      assert.equal(providerInputs.length, 0);
    }
  });
  it("leaves marketplace refund reconciliation to its allocation journal without querying a generic provider", async () => {
    let queried = false;
    const service = new RefundPaymentService({ getIntentById: async () => ({ snapshot: () => ({ id: "intent", providerPaymentId: "pay_original", creation: { input: {
      provider: "asaas", providerAccountFingerprint: "original", marketplaceFunding: { provider: "asaas", environment: "test", accountFingerprint: "original" },
    } } }) }) } as any, { fetchRefundStatus: async (input: any) => {
      queried = true; return { state: "succeeded" };
    } } as any, { findCompletedOrderByExternalOrderId: async () => ({ sessionId: "checkout" }) } as any);
    const result = await service.reconcileRefundPayment({ merchantId: "host", externalOrderId: "order", paymentIntentId: "intent", providerRefundId: "refund" });
    assert.equal(queried, false); assert.equal(result.state, "unknown");
    assert.equal(result.reason, "marketplace_refund_allocation_required");
  });
  it("does not submit a generic refund before marketplace allocation reversals are ready", async () => {
    const { service, providerInputs } = serviceFor("succeeded", { route: { provider: "asaas", marketplaceFunding: { provider: "asaas" } } as any });
    const result = await service.refundOrderPayment({ merchantId: "merchant", externalOrderId: "order", amountCents: 100 });
    assert.equal(result.reason, "marketplace_refund_allocation_required"); assert.equal(providerInputs.length, 0);
  });
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

it("refund submission preserves the original Stripe direct charge account", async () => {
  const { service, providerInputs } = serviceFor("succeeded", { route: { provider: "stripe", stripeConnectAccountId: "acct_original", stripeChargeMode: "direct_v2" } as any });
  await service.refundOrderPayment({ merchantId: "merchant", externalOrderId: "order" });
  assert.equal((providerInputs[0] as any).stripeConnectAccountId, "acct_original");
  assert.equal((providerInputs[0] as any).stripeChargeMode, "direct_v2");
});
