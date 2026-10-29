import test from "node:test";
import assert from "node:assert/strict";
import { readMerchantRetentionPolicy, retainedMerchantAllocation, merchantRetentionDate } from "./merchant-retention-policy.js";

const policy = { mode: "delayed_merchant_payout", holdDays: 7, startsAt: "fulfillment", providerFeePayer: "merchant" };

test("the split is due exactly seven days after fulfillment, with no additional delay; other stores keep their mode", () => {
  assert.equal(readMerchantRetentionPolicy({ paymentRouting: { card: "stripe" } }), undefined);
  const frozen = readMerchantRetentionPolicy({ paymentRetention: policy })!;
  assert.equal(merchantRetentionDate(frozen, new Date("2026-10-13T20:00:00Z")).toISOString(), "2026-10-20T20:00:00.000Z");
});

test("a five-real sale allocates buyer/merchant fees and the exact observed provider fee without losing a cent", () => {
  const allocation = retainedMerchantAllocation(599, 198, 61);
  assert.equal(allocation.merchantNetCents, 340);
  assert.equal(allocation.platformFeeCents + allocation.providerFeeCents + allocation.merchantNetCents, 599);
  assert.equal(retainedMerchantAllocation(599, 198, 0).merchantNetCents, 401);
  assert.throws(() => retainedMerchantAllocation(599, 198, 402), /net_nonpositive/);
  assert.throws(() => retainedMerchantAllocation(599, 198, Number.NaN), /amount_invalid/);
});

test("unsupported rails and incomplete or excessive windows cannot opt a store into retained payments", () => {
  for (const change of [{ holdDays: 0 }, { holdDays: 30 }, { payoutDelayDays: 14 }, { startsAt: "payment" }, { providerFeePayer: "buyer" }]) {
    assert.throws(() => readMerchantRetentionPolicy({ paymentRetention: { ...policy, ...change } }), /policy_invalid/);
  }
});
