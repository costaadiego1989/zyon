import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import { paymentProviderRoute } from "../domain/payment-provider-route.js";

const input = { merchantId: "merchant-original", provider: "stripe" as const, providerPaymentId: "pi_original",
  providerRefundId: "pending:return:r", stripeChargeMode: "direct_v2" as const, stripeConnectAccountId: "acct_original",
  refundReference: "return:r", amountCents: 3089, currency: "BRL" };
const proof = { id: "re_original", payment_intent: "pi_original", amount: 3089, currency: "brl", livemode: true,
  status: "succeeded", metadata: { merchant_id: "merchant-original", refund_reference: "return:r" } };
function setup(pages: any[] = [{ data: [proof], has_more: false }]) {
  const calls: Array<{ operation: string; args: any[] }> = [];
  const adapter = new StripePaymentAdapter("sk_live_fixture", undefined);
  (adapter as any).stripe = { paymentIntents: { retrieve: async () => ({ id: "pi_original", livemode: true, status: "succeeded", currency: "brl", amount_received: 3089, metadata: { merchant_id: "merchant-original" } }) }, refunds: {
    list: async (...args: any[]) => { calls.push({ operation: "list", args }); return pages.shift(); },
    retrieve: async (...args: any[]) => { calls.push({ operation: "retrieve", args }); return proof; },
    create: async (...args: any[]) => { calls.push({ operation: "create", args }); return proof; },
  } };
  return { adapter, calls };
}
describe("Stripe original-account refund recovery", () => {
  it("preserves the frozen direct-charge route without using current store settings", () => {
    const route = paymentProviderRoute({ ...input, providerAccountFingerprint: "frozen" } as any);
    assert.equal(route.stripeConnectAccountId, "acct_original"); assert.equal(route.stripeChargeMode, "direct_v2");
  });
  it("submits to the original account with a stable recovery reference and idempotency key", async () => {
    const { adapter, calls } = setup();
    await adapter.refundPayment({ ...input, idempotencyKey: "return:r" });
    assert.equal(calls[0].operation, "create");
    assert.deepEqual(calls[0].args[1], { stripeAccount: "acct_original", idempotencyKey: "return:r" });
    assert.deepEqual(calls[0].args[0].metadata, proof.metadata);
  });
  it("recovers a lost response by GET and returns the real refund id", async () => {
    const { adapter, calls } = setup();
    assert.deepEqual(await adapter.fetchRefundStatus(input), { state: "succeeded", providerRefundId: "re_original" });
    assert.deepEqual(calls.map(call => call.operation), ["list"]);
    assert.deepEqual(calls[0].args[0], { payment_intent: "pi_original", limit: 100 });
    assert.deepEqual(calls[0].args[1], { stripeAccount: "acct_original" });
  });
  it("reads a known refund in the same connected account", async () => {
    const { adapter, calls } = setup();
    await adapter.fetchRefundStatus({ ...input, providerRefundId: "re_original" });
    assert.equal(calls[0].operation, "retrieve"); assert.equal(calls[0].args[2].stripeAccount, "acct_original");
  });
  it("empty, unrelated, duplicate or metadata-free results remain uncertain without another POST", async () => {
    for (const rows of [[], [{ ...proof, metadata: {} }], [{ ...proof, amount: 1000 }],
      [{ ...proof, metadata: { ...proof.metadata, merchant_id: "another-merchant" } }], [proof, proof]]) {
      const { adapter, calls } = setup([{ data: rows, has_more: false }]);
      assert.deepEqual(await adapter.fetchRefundStatus(input), { state: "unknown" });
      assert.ok(calls.every(call => call.operation === "list"));
    }
  });
  it("validates original payment, environment, currency and amount for known refund ids", async () => {
    for (const patch of [{ providerPaymentId: "pi_other" }, { currency: "USD" }, { amountCents: 1000 }]) {
      const { adapter } = setup();
      await assert.rejects(adapter.fetchRefundStatus({ ...input, providerRefundId: "re_original", ...patch }), /refund_original_payment_mismatch/);
    }
    const { adapter } = setup(); (adapter as any).secretKey = "sk_test_fixture";
    await assert.rejects(adapter.fetchRefundStatus({ ...input, providerRefundId: "re_original" }), /refund_original_payment_mismatch/);
  });
  it("checks all pages before selecting a unique attempt", async () => {
    const { adapter, calls } = setup([{ data: [{ ...proof, id: "re_unrelated", metadata: {} }], has_more: true }, { data: [proof], has_more: false }]);
    assert.equal((await adapter.fetchRefundStatus(input)).providerRefundId, "re_original");
    assert.equal(calls[1].args[0].starting_after, "re_unrelated");
  });
  it("never falls back to the platform when direct-charge account identity is missing", async () => {
    const { adapter, calls } = setup();
    await assert.rejects(adapter.fetchRefundStatus({ ...input, stripeConnectAccountId: undefined }), /stripe_original_account_unproven/);
    await assert.rejects(adapter.refundPayment({ ...input, stripeConnectAccountId: undefined }), /stripe_original_account_unproven/);
    assert.equal(calls.length, 0);
  });
});

it("recovery eligibility is GET-only and requires a full original charge with no refunds", async () => {
  const valid = setup([{ data: [], has_more: false }]);
  assert.equal(await valid.adapter.readRefundRecoveryEligibility({ ...input, idempotencyKey: "return:r" }), true);
  assert.ok(valid.calls.every(call => call.operation === "list"));
  for (const pages of [[{ data: [proof], has_more: false }], [{ data: [], has_more: true }]]) {
    const { adapter } = setup(pages);
    assert.equal(await adapter.readRefundRecoveryEligibility({ ...input, idempotencyKey: "return:r" }), false);
  }
  const partial = setup(); assert.equal(await partial.adapter.readRefundRecoveryEligibility({ ...input, amountCents: 1000, idempotencyKey: "return:r" }), false);
});
