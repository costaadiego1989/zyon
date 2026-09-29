import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { discountStudy } from "./strategy-discount-study.js";
import { assertIncentiveBudgetTerms, incentiveBudgetTerms } from "./incentive-budget.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 10, minimumMarginPercent: 30 };
const study = discountStudy({ merchantId: "store", runId: "run", observationId: "observation", rules,
  asOf: "2026-09-29T00:00:00.000Z", capturedAt: "2026-09-29T00:00:00.000Z",
  cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
    carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL", items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
const source = { merchantId: "store", strategyId: "strategy", version: 1, proposalHash: "a".repeat(64), study, rules };
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
