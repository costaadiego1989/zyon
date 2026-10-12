import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { discountStudy } from "./strategy-discount-study.js";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { assertIncentiveRecommendation, incentiveRecommendation } from "./strategy-incentive-recommendation.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 35 };
const study = (empty = false) => discountStudy({ merchantId: "store", runId: "run", observationId: "obs",
  asOf: "2026-09-29T00:00:00.000Z", capturedAt: "2026-09-29T01:00:00.000Z", rules,
  cohorts: empty ? [] : [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
    carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL",
      items: [{ sku: "private-variant", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
const policy = (overrides = {}) => incentivePolicySnapshot("store", 1,
  { enabled: true, limitCents: 10500, maxDiscountCents: 800, maxRedemptions: 20, ...overrides });

test("motor plans complete worst-case slots inside both simulation and merchant caps without inventing outcomes", () => {
  const s = study(), result = incentiveRecommendation(s, rules, policy());
  assert.equal(result.status, "recommended");
  if (result.status !== "recommended") return;
  assert.equal(result.test.discountPercent, 20);
  assert.equal(result.test.maxDiscountCents, 800);
  assert.equal(result.test.maxRedemptions, 13);
  assert.equal(result.test.limitCents, 10400);
  assert.equal(result.test.minimumMarginPercent, 35);
  assert.equal(result.test.durationDays, 7);
  assert.equal(result.test.measurement.result, "not_measured");
  assert.equal(result.test.measurement.samplePlanning, "required_before_activation");
  assert.equal(result.budgetStatus, "not_reserved");
  assert.equal(result.execution, "unavailable");
  assert.equal(JSON.stringify(result).includes("private-variant"), false);
  assertIncentiveRecommendation(result, s, rules);
});

for (const [name, limits, expected] of [
  ["redemptions", { maxRedemptions: 3 }, [800, 3, 2400]],
  ["simulation", { maxDiscountCents: 5000 }, [2000, 5, 10000]],
  ["one cent", { limitCents: 1, maxDiscountCents: 1 }, [1, 1, 1]],
  ["large integer", { limitCents: 2147483647, maxDiscountCents: 2147483647, maxRedemptions: 1000000 }, [2000, 1000000, 2000000000]],
] as const) test(`motor respects ${name} cap in integer cents`, () => {
  const result = incentiveRecommendation(study(), rules, policy(limits));
  assert.equal(result.status, "recommended");
  if (result.status !== "recommended") return;
  assert.deepEqual([result.test.maxDiscountCents, result.test.maxRedemptions, result.test.limitCents], expected);
});

test("missing safe data and disabled financial policy remain separate non-recommendation outcomes", () => {
  const disabled = incentivePolicySnapshot("store", 0, { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 });
  for (const [s, p, reason] of [[study(true), policy(), "no_safe_candidate"], [study(), disabled, "financial_policy_disabled"]] as const) {
    const result = incentiveRecommendation(s, rules, p);
    assert.equal(result.status, "not_recommended");
    assert.equal((result as any).reason, reason);
    assert.equal("test" in result, false);
    assertIncentiveRecommendation(result, s, rules);
  }
});

for (const [label, change] of [
  ["merchant", (r: any) => r.merchantId = "foreign"],
  ["run", (r: any) => r.runId = "foreign"],
  ["observation", (r: any) => r.observationId = "foreign"],
  ["study hash", (r: any) => r.studyHash = "f".repeat(64)],
  ["policy hash", (r: any) => r.financialPolicy.policyHash = "f".repeat(64)],
  ["policy version", (r: any) => r.financialPolicy.version++],
  ["policy extension", (r: any) => r.financialPolicy.buyerId = "private"],
  ["discount", (r: any) => r.test.discountPercent++],
  ["offer cap", (r: any) => r.test.maxDiscountCents++],
  ["budget", (r: any) => r.test.limitCents++],
  ["uses", (r: any) => r.test.maxRedemptions++],
  ["buyer cap", (r: any) => r.test.maxPerBuyer++],
  ["margin", (r: any) => r.test.minimumMarginPercent--],
  ["allocation", (r: any) => r.test.allocation = "0/100"],
  ["holdout", (r: any) => r.test.audience.holdout = "included"],
  ["cart range", (r: any) => r.test.audience.maxCartTotalCents++],
  ["consent", (r: any) => r.test.audience.consent = "optional"],
  ["stacking", (r: any) => r.test.stacking = "allowed"],
  ["duration", (r: any) => r.test.durationDays = 1],
  ["window", (r: any) => r.test.measurement.conversionWindowHours = 24],
  ["fictional measurement", (r: any) => r.test.measurement.result = "positive"],
  ["spend authority", (r: any) => r.execution = "available"],
  ["approval", (r: any) => r.approval = "communication_approval_sufficient"],
  ["reservation", (r: any) => r.budgetStatus = "reserved"],
  ["extra fields", (r: any) => r.expectedLift = 5],
] as const) test(`recommendation rejects modified ${label}`, () => {
  const s = study(), result = incentiveRecommendation(s, rules, policy()); change(result);
  assert.throws(() => assertIncentiveRecommendation(result, s, rules), /INVALID_INCENTIVE/);
});

test("recommendation refuses foreign, unhashed or unversioned enabled financial policies", () => {
  const limits = { enabled: true, limitCents: 1000, maxDiscountCents: 100, maxRedemptions: 10 };
  for (const p of [incentivePolicySnapshot("other", 1, limits), incentivePolicySnapshot("store", 0, limits), { ...policy(), policyHash: "" }]) {
    assert.throws(() => incentiveRecommendation(study(), rules, p), /STRATEGY_INVALID_INCENTIVE_POLICY/);
  }
});
