import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES, type Cart } from "@zyon/shared-types";
import { DiscountRuleHypothesisService } from "./services/discount-rule-hypothesis.service.js";
import { assertDiscountStudy, discountStudy } from "./strategy-discount-study.js";
import { incentiveRecommendation, type StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { assessExecutableIncentive } from "./executable-incentive.js";
import { assertIncentiveRecommendation } from "./strategy-incentive-recommendation.js";
import { readAuthoritativeIncentiveCart } from "../infrastructure/incentive-execution-ledger.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 99 };
const cart = (cost?: number): Cart => ({ total: 100, currency: "BRL", items: [{ sku: "p", name: "Product", price: 100, quantity: 1,
  ...(cost === undefined ? {} : { cost }) }] });
const cohort = (cost?: number) => ({ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
  carts: Array.from({ length: 30 }, () => cart(cost)) });
const study = (cost?: number) => discountStudy({ merchantId: "store", runId: "run", observationId: "obs",
  asOf: "2026-10-19T00:00:00.000Z", capturedAt: "2026-10-19T00:00:00.000Z", rules, cohorts: [cohort(cost)] });
const recommendation = (cost?: number) => incentiveRecommendation(study(cost), rules,
  incentivePolicySnapshot("store", 1, { enabled: true, maxDiscountCents: 1000, maxRedemptions: 10, limitCents: 10000 }));

for (const [label, cost] of [["unknown", undefined], ["high", 120], ["known", 40]] as const) {
  test(`experimental replay authorizes ${label} cost by company ceiling, not margin`, () => {
    const result = new DiscountRuleHypothesisService().generate([cohort(cost)], rules)!;
    assert.ok(result);
    assert.equal(result.rule.action.params.percent, 20);
    assert.equal(result.simulation.definition, "discount-catalog-replay-v2");
    assert.equal(result.simulation.minimumProjectedMarginPercent === null, cost === undefined);
    assert.doesNotMatch(result.rationale, /preserva a margem/);
    assertDiscountStudy(study(cost), "store", "run", "obs", rules);
  });
  test(`experimental execution carries ${label} cost honestly without using it as eligibility`, () => {
    const r = recommendation(cost);
    assert.equal(r.status, "recommended");
    const result = assessExecutableIncentive(cart(cost), { ...rules, minimumMarginPercent: 5 }, r);
    assert.deepEqual(result, { amountCents: 1000, costCents: cost === undefined ? null : cost * 100 });
  });
}
test("experimental immutable authority records the ceiling policy, without inventing margin guardrails", () => {
  const r = recommendation();
  assert.equal(r.status, "recommended");
  if (r.status !== "recommended") assert.fail();
  assert.equal(r.test.authorizationPolicy, "company_ceiling_without_margin_v1");
  assert.deepEqual(r.test.measurement.guardrails, ["discount_spend", "company_discount_ceiling", "refunds"]);
});
test("unavailable or low cost does not change company ceiling or nonstacking checks", () => {
  const r = recommendation();
  assert.equal(assessExecutableIncentive(cart(), { ...rules, maxDiscountPercent: 5 }, r), null);
  assert.equal(assessExecutableIncentive({ ...cart(), currentDiscount: 1 }, rules, r), null);
  assert.equal(assessExecutableIncentive({ ...cart(), total: 101 }, rules, r), null);
  assert.equal(assessExecutableIncentive({ ...cart(), currency: "USD" }, rules, r), null);
});
test("legacy executable recommendation no longer treats a changed margin setting as authority", () => {
  const r = { status: "recommended", definition: "weekly-incentive-recommendation-v1", test: {
    kind: "capped_percentage_discount", discountPercent: 20, maxDiscountCents: 1000, minimumMarginPercent: 35,
    audience: { minCartTotalCents: 10000, maxCartTotalCents: 10000 },
  } } as unknown as StrategyIncentiveRecommendation;
  assert.deepEqual(assessExecutableIncentive(cart(), rules, r), { amountCents: 1000, costCents: null });
});

test("legacy replay/recommendation stays byte reproducible while v2 metadata is authenticated", () => {
  const current = study(40);
  assert.equal(current.status, "candidate_available");
  if (current.status !== "candidate_available") assert.fail();
  const legacy = structuredClone(current);
  legacy.candidate.simulation.definition = "discount-catalog-replay-v1";
  const policy = incentivePolicySnapshot("store", 1, { enabled: true, maxDiscountCents: 1000, maxRedemptions: 10, limitCents: 10000 });
  const old = incentiveRecommendation(legacy, rules, policy);
  assert.equal(old.status, "recommended");
  if (old.status !== "recommended") assert.fail();
  assert.equal("authorizationPolicy" in old.test, false);
  assert.deepEqual(old.test.measurement.guardrails, ["discount_spend", "configured_product_margin", "refunds"]);
  assertIncentiveRecommendation(old, legacy, rules);
  const next = incentiveRecommendation(current, rules, policy);
  assertIncentiveRecommendation(next, current, rules);
  if (next.status !== "recommended") assert.fail();
  delete next.test.authorizationPolicy;
  assert.throws(() => assertIncentiveRecommendation(next, current, rules), /INVALID_INCENTIVE_RECOMMENDATION/);
  legacy.candidate.simulation.minimumProjectedMarginPercent = null;
  assert.throws(() => assertDiscountStudy(legacy, "store", "run", "obs", rules), /INVALID_DISCOUNT_STUDY/);
});

test("aggregate cost exceeding ledger storage range remains null without blocking discount", () => {
  assert.deepEqual(assessExecutableIncentive(cart(30_000_000), rules, recommendation()), { amountCents: 1000, costCents: null });
});

for (const costInCents of [null, -1, .1, 12000]) test(`canonical execution reader does not require catalog cost ${costInCents} or trust snapshot cost`, async () => {
  let reads = 0;
  const tx = { productPrice: { async findMany(args: any) {
    reads++;
    assert.equal(args.where.variant.product.merchantId, "store");
    assert.equal(args.where.currency, "BRL");
    return [{ variantId: "variant", basePriceInCents: 10000, costInCents }];
  } } };
  const session = { merchantId: "store", cart: { ...cart(0), items: [{ ...cart(0).items[0], variantId: "variant" }] },
    createdAt: new Date(), updatedAt: new Date() };
  const result = await readAuthoritativeIncentiveCart(tx as never, session as never);
  assert.equal(reads, 1);
  assert.ok(result);
  assert.equal(result.items[0].cost, costInCents !== null && costInCents >= 0 && Number.isSafeInteger(costInCents) ? 120 : undefined);
  assert.equal(result.total, 100);
});

test("nullable-cost migration is mirrored across review/deploy without backfill or bypassing guards", () => {
  const review = readFileSync(resolve("prisma/migrations/20261019100000_incentive_optional_cost/migration.sql"), "utf8");
  const deploy = readFileSync(resolve("prisma/deploy-migrations/20261019100000_incentive_optional_cost/migration.sql"), "utf8");
  assert.equal(review, deploy);
  const statements = review.split("\n").filter(line => line.trim() && !line.startsWith("--"));
  assert.deepEqual(statements, ['ALTER TABLE "strategy_incentive_assignments" ALTER COLUMN "cost_cents" DROP NOT NULL;']);
});
