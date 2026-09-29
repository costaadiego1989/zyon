import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { discountStudy } from "./strategy-discount-study.js";
import { assertIncentiveBudgetTerms, incentiveBudgetTerms, assertRecommendedIncentiveBudgetTerms, recommendedIncentiveBudgetTerms } from "./incentive-budget.js";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { incentiveRecommendation, plannedIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 10, minimumMarginPercent: 30 };
const study = discountStudy({ merchantId: "store", runId: "run", observationId: "observation", rules,
  asOf: "2026-09-29T00:00:00.000Z", capturedAt: "2026-09-29T00:00:00.000Z",
  cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
    carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL", items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
const policy = incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 10000, maxDiscountCents: 1000, maxRedemptions: 100 });
const source = { merchantId: "store", strategyId: "strategy", version: 1, proposalHash: "a".repeat(64), study, rules, policy };
const limits = { limitCents: 3000, maxDiscountCents: 500, maxRedemptions: 10, startsAt: "2026-09-30T03:00:00.000Z" };

test("funding requires explicit merchant limits rather than the historical replay total", () => {
  const terms = incentiveBudgetTerms(source, limits);
  assert.equal(terms.scope, "funding_only");
  assert.equal(terms.limitCents, 3000);
  assert.equal(terms.endsAt, "2026-10-07T03:00:00.000Z");
  assert.equal("rule" in terms, false);
  assert.throws(() => incentiveBudgetTerms(source, { ...limits, limitCents: undefined as never }), /INVALID_BUDGET_TERMS/);
});

for (const [label, mutate] of [
  ["fractional cent", (v: any) => v.limitCents = .5],
  ["negative limit", (v: any) => v.limitCents = -1],
  ["zero limit", (v: any) => v.limitCents = 0],
  ["overflow", (v: any) => v.limitCents = 2147483648],
  ["NaN", (v: any) => v.limitCents = NaN],
  ["numeric string", (v: any) => v.limitCents = "3000"],
  ["per-offer above sample cap", (v: any) => v.maxDiscountCents = 1001],
  ["per-offer above total", (v: any) => v.limitCents = 400],
  ["unlimited redemptions", (v: any) => v.maxRedemptions = 0],
  ["fractional redemptions", (v: any) => v.maxRedemptions = 2.5],
  ["buyer reuse", (v: any) => v.maxPerBuyer = 2],
  ["currency conversion", (v: any) => v.currency = "USD"],
  ["other merchant", (v: any) => v.merchantId = "other"],
  ["other proposal", (v: any) => v.proposalHash = "b".repeat(64)],
  ["other version", (v: any) => v.version = 2],
  ["other study", (v: any) => v.studyHash = "b".repeat(64)],
  ["other financial policy", (v: any) => v.policyHash = "b".repeat(64)],
  ["old financial version", (v: any) => v.policyVersion = 0],
  ["invalid start", (v: any) => v.startsAt = "tomorrow"],
  ["longer spending horizon", (v: any) => v.endsAt = "2026-10-08T03:00:00.000Z"],
  ["executable authorization", (v: any) => v.scope = "discount"],
  ["injected coupon", (v: any) => v.coupon = { enabled: true }],
] as const) test(`funding rejects ${label}`, () => {
  const terms = incentiveBudgetTerms(source, limits); mutate(terms);
  assert.throws(() => assertIncentiveBudgetTerms(terms, source), /INVALID_BUDGET_TERMS/);
});

test("a study without a safe candidate cannot support a funding envelope", () => {
  const empty = { ...study, status: "no_safe_candidate" as const }; delete (empty as any).candidate;
  assert.throws(() => incentiveBudgetTerms({ ...source, study: empty }, limits), /INVALID_BUDGET_TERMS/);
});

test("merchant financial caps constrain each dimension and cannot enable themselves", () => {
  for (const limitsOverride of [{ enabled: false }, { limitCents: 2500 }, { maxDiscountCents: 400 }, { maxRedemptions: 9 }]) {
    const restricted = incentivePolicySnapshot("store", 2, { ...policy, ...limitsOverride });
    assert.throws(() => incentiveBudgetTerms({ ...source, policy: restricted }, limits), /INVALID_BUDGET_TERMS/);
  }
  assert.throws(() => incentiveBudgetTerms({ ...source, policy: { ...policy, merchantId: "other" } }, limits), /INVALID_BUDGET_TERMS/);
});

const fundedPolicy = incentivePolicySnapshot("store", 2, { enabled: true, limitCents: 1000500,
  maxDiscountCents: 1000, maxRedemptions: 2000 });
const baseline = { buyers: 10000, conversions: 10, complete: true,
  windowStart: "2026-08-25T00:00:00.000Z", windowEnd: "2026-09-22T00:00:00.000Z" };
const planned = { ...source, policy: fundedPolicy, recommendation: plannedIncentiveRecommendation(study, rules, fundedPolicy, baseline) };

test("new funding takes the exact suggested envelope without merchant budget inputs", () => {
  const terms = recommendedIncentiveBudgetTerms(planned, limits.startsAt);
  assert.equal(terms.limitCents, 1000000); // unused 500 cents are not silently funded
  assert.equal(terms.maxDiscountCents, 1000); assert.equal(terms.maxRedemptions, 1000);
  assert.equal(terms.scope, "funding_only");
  assertRecommendedIncentiveBudgetTerms(terms, planned);
});

for (const patch of [{ limitCents: 999000 }, { maxDiscountCents: 999 }, { maxRedemptions: 999 },
  { limitCents: 1000500 }, { maxRedemptions: 1001 }, { scope: "discount" }, { execution: "running" }]) {
  test(`new funding refuses a changed envelope ${JSON.stringify(patch)}`, () => {
    const terms = { ...recommendedIncentiveBudgetTerms(planned, limits.startsAt), ...patch };
    assert.throws(() => assertRecommendedIncentiveBudgetTerms(terms as never, planned), /RECOMMENDED_TERMS_CHANGED/);
  });
}
test("a valid old envelope and a v1 recommendation cannot open new funding", () => {
  const legacy = incentiveBudgetTerms(source, limits);
  assertIncentiveBudgetTerms(legacy, source); // historical receipts stay readable
  for (const recommendation of [undefined, incentiveRecommendation(study, rules, fundedPolicy)]) {
    assert.throws(() => recommendedIncentiveBudgetTerms({ ...planned, recommendation }, limits.startsAt), /PLANNED_RECOMMENDATION_REQUIRED/);
  }
});
test("canonical but insufficient history or funding cannot be approved by changing the requested envelope", () => {
  for (const [financial, history] of [[fundedPolicy, { ...baseline, buyers: 1000, conversions: 100 }],
    [policy, baseline], [fundedPolicy, { ...baseline, buyers: 0, conversions: 0, complete: false }]] as const) {
    const recommendation = plannedIncentiveRecommendation(study, rules, financial, history);
    assert.throws(() => recommendedIncentiveBudgetTerms({ ...source, policy: financial, recommendation }, limits.startsAt), /MEASUREMENT_BLOCKED/);
  }
});
test("a manually cleared planning blocker never becomes a funding permission", () => {
  const recommendation = plannedIncentiveRecommendation(study, rules, policy, baseline);
  recommendation.planning!.status = "estimated_feasible"; recommendation.planning!.blockers = [];
  assert.throws(() => recommendedIncentiveBudgetTerms({ ...source, recommendation }, limits.startsAt), /INVALID_INCENTIVE_RECOMMENDATION/);
});
test("a new financial version requires a new recommendation even when limits did not change", () => {
  const policy = incentivePolicySnapshot("store", 3, fundedPolicy);
  assert.throws(() => recommendedIncentiveBudgetTerms({ ...planned, policy }, limits.startsAt), /POLICY_CHANGED/);
});
