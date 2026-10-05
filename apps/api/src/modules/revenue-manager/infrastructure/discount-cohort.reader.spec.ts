import test from "node:test";
import assert from "node:assert/strict";
import { discountCohorts, incentivePlanningBaseline, loadDiscountCohorts, loadDiscountHistory } from "./discount-cohort.reader.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { commercialDiscountStudy, discountStudy } from "../domain/strategy-discount-study.js";
import { commercialIncentiveRecommendation, incentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { incentivePolicySnapshot } from "../domain/incentive-policy.js";

const now = new Date("2026-09-29T00:00:00Z"), createdAt = new Date("2026-09-20T00:00:00Z");
const session = (buyer = "buyer") => ({ globalUserId: buyer, createdAt,
  cart: { currency: "BRL", total: 999, items: [{ variantId: "variant", price: 999, cost: 0, quantity: 1 }] },
  completedOrders: [] as { completedAt: Date }[] });
const intent = (buyer = "buyer") => ({ globalUserId: buyer, primaryIntent: "price_sensitive", generatedAt: new Date("2026-09-19T00:00:00Z") });
const price = { variantId: "variant", basePriceInCents: 10000, costInCents: 4000 };
function db(sessions = [session()], intents = [intent()], prices: any[] = [price]) {
  return { checkoutSession: { findMany: async (args: any) => {
    assert.deepEqual(args.where.createdAt, { gte: new Date("2026-08-23T00:00:00Z"), lt: new Date("2026-09-22T00:00:00Z") });
    assert.equal(args.where.merchantId, "store");
    assert.deepEqual(args.select.completedOrders.where, { merchantId: "store", status: "approved", currency: "BRL" });
    return sessions;
  } }, customerIntentRecord: { findMany: async (args: any) => {
    assert.equal(args.where.merchantId, "store");
    assert.deepEqual(args.where.consent.is, { optedIn: true, expiresAt: { gt: now } }); return intents;
  } }, productPrice: { findMany: async (args: any) => {
    assert.equal(args.where.currency, "BRL");
    assert.deepEqual(args.where.variant, { isActive: true, product: { merchantId: "store", isActive: true, deletedAt: null } }); return prices;
  } } } as any;
}

test("discount cohort reprices from the owned catalog and returns no buyer identifiers", async () => {
  const stats = await loadDiscountCohorts(db(), "store", now, 30);
  assert.equal(stats[0].sampleSize, 1);
  assert.equal(stats[0].carts[0].total, 100);
  assert.equal(stats[0].carts[0].items[0].cost, 40);
  assert.equal(JSON.stringify(stats).includes('"buyer"'), false);
});

test("discount cohort uses only the first session per buyer and intent available at that time", async () => {
  const a = session(), repeat = session(); repeat.completedOrders = [{ completedAt: createdAt }];
  const later = { ...intent(), generatedAt: new Date("2026-09-21T00:00:00Z"), primaryIntent: "returning" };
  const stats = await loadDiscountCohorts(db([a, repeat], [later, intent()]), "store", now, 30);
  assert.equal(stats[0].intent, "price_sensitive"); assert.equal(stats[0].sampleSize, 1); assert.equal(stats[0].conversionRate, 0);
  assert.deepEqual(await loadDiscountCohorts(db([a], [later]), "store", now, 30), []);
});

test("discount cohort counts one conversion within the half-open seven-day window", async () => {
  const sessions = [session("a"), session("b"), session("c")];
  sessions[0].completedOrders = [{ completedAt: createdAt }, { completedAt: new Date("2026-09-21T00:00:00Z") }];
  sessions[1].completedOrders = [{ completedAt: new Date("2026-09-19T23:59:59Z") }];
  sessions[2].completedOrders = [{ completedAt: new Date("2026-09-27T00:00:00Z") }];
  const stats = await loadDiscountCohorts(db(sessions, [intent("a"), intent("b"), intent("c")]), "store", now, 30);
  assert.equal(stats[0].conversionRate, 1 / 3);
});

for (const [label, prices] of [["missing", []], ["null", [{ ...price, costInCents: null }]],
  ["negative", [{ ...price, costInCents: -1 }]], ["fractional", [{ ...price, costInCents: .1 }]] ] as const) {
  test(`discount cohort rejects ${label} catalog cost instead of trusting snapshot cost`, async () => {
    assert.deepEqual(await loadDiscountCohorts(db([session()], [intent()], [...prices]), "store", now, 30), []);
  });
}

for (const [label, patch] of [["currency", { currency: "USD" }], ["stacking", { currentDiscount: 1 }],
  ["options", { items: [{ variantId: "variant", quantity: 1, selected_options: [{}] }] }],
  ["fractional quantity", { items: [{ variantId: "variant", quantity: .5 }] }],
  ["foreign cart", { crossStoreItems: [{}] }], ["missing variant", { items: [{ quantity: 1 }] }]] as const) {
  test(`discount cohort excludes ${label}`, async () => {
    const s = session(); s.cart = { ...s.cart, ...patch } as any;
    assert.deepEqual(await loadDiscountCohorts(db([s]), "store", now, 30), []);
  });
}

test("discount cohort refuses truncated samples and unknown consent instead of extrapolating", async () => {
  assert.deepEqual(await loadDiscountCohorts(db(Array.from({ length: 10001 }, () => session())), "store", now, 30), []);
  assert.deepEqual(await loadDiscountCohorts(db([session()], Array.from({ length: 10001 }, () => intent())), "store", now, 30), []);
  assert.deepEqual(await loadDiscountCohorts(db([session()], []), "store", now, 30), []);
});

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 5, minimumMarginPercent: 30 };
function recommendation() {
  const study = discountStudy({ merchantId: "store", runId: "run", observationId: "obs", asOf: now.toISOString(), capturedAt: now.toISOString(), rules,
    cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1, carts: Array.from({ length: 30 }, () => ({
      currency: "BRL", total: 100, items: [{ sku: "sku", name: "Produto", quantity: 1, price: 100, cost: 40 }] })) }] });
  return incentiveRecommendation(study, rules, incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 10000, maxDiscountCents: 400, maxRedemptions: 25 }));
}
test("incentive baseline counts eligible non-buyers, excludes holdout/unknown cohorts and carries exact conversions", async () => {
  const sessions = Array.from({ length: 5 }, (_, i) => ({ ...session(`buyer-${i}`), cohort: i < 3 ? "treatment" : i === 3 ? "holdout" : null }));
  sessions[0].completedOrders = [{ completedAt: createdAt }, { completedAt: createdAt }];
  sessions[3].completedOrders = [{ completedAt: createdAt }];
  const repeat = { ...sessions[1], completedOrders: [{ completedAt: createdAt }] };
  const history = await loadDiscountHistory(db([...sessions, repeat], sessions.map(s => intent(s.globalUserId))), "store", now, 30);
  const b = incentivePlanningBaseline(history, now, recommendation(), rules)!;
  assert.deepEqual(b, { buyers: 3, conversions: 1, complete: true,
    windowStart: "2026-08-25T00:00:00.000Z", windowEnd: "2026-09-22T00:00:00.000Z" });
  assert.equal(JSON.stringify(b).includes("buyer-"), false);
});

test("incentive planning rechecks audience, cart range and capped offer margin against the captured catalog", () => {
  const cart = { currency: "BRL", total: 100, items: [{ sku: "sku", name: "Produto", quantity: 1, price: 100, cost: 40 }] };
  const buyer = { intent: "price_sensitive", cart, converted: false, cohort: "treatment" };
  const history = { complete: true, buyers: [buyer, { ...buyer, intent: "returning" }, { ...buyer, cart: { ...cart, total: 200 } },
    { ...buyer, cart: { ...cart, items: [{ ...cart.items[0], cost: 99 }] } }] };
  const b = incentivePlanningBaseline(history, now, recommendation(), rules)!;
  assert.equal(b.buyers, 1); assert.equal(b.conversions, 0);
});

test("incentive planning refuses partial histories and distinguishes them from an empty complete history", async () => {
  const h = await loadDiscountHistory(db(Array.from({ length: 10001 }, () => session())), "store", now, 30);
  const b = incentivePlanningBaseline(h, now, recommendation(), rules)!;
  assert.equal(b.complete, false); assert.equal(b.buyers, 0);
  assert.equal(incentivePlanningBaseline({ complete: true, buyers: [] }, now, recommendation(), rules)!.complete, true);
});

test("commercial reader carries recorded carrier costs into mode selection and the same A/B planning population", async () => {
  const shippingRules = { ...rules, allowShippingDiscount: true, maxPartialShippingDiscount: 5, maxShippingSubsidy: 5 };
  const sessions = Array.from({ length: 30 }, (_, i) => ({ ...session(`buyer-${i}`), cohort: i === 0 ? "holdout" : "treatment",
    shipping: { customerPrice: 20, realCost: 20, region: "SP", destinationZip: "private-address", carrier: "private-carrier" } }));
  sessions[1].completedOrders = [{ completedAt: createdAt }];
  const history = await loadDiscountHistory(db(sessions, sessions.map(s => intent(s.globalUserId))), "store", now, 30);
  const study = commercialDiscountStudy({ merchantId: "store", runId: "run", observationId: "obs", rules: shippingRules,
    asOf: now.toISOString(), capturedAt: now.toISOString(), cohorts: discountCohorts(history) });
  const recommendation = commercialIncentiveRecommendation(study, shippingRules,
    incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 10000, maxDiscountCents: 400, maxRedemptions: 25 }));
  assert.ok(recommendation.status === "recommended" && recommendation.test.kind === "capped_shipping_discount");
  assert.deepEqual(study.commercialCandidate?.evidence, { basis: "observed_shipping_burden", sampleSize: 30,
    minShippingCents: 2000, maxShippingCents: 2000, maxShippingCostCents: 2000 });
  const baseline = incentivePlanningBaseline(history, now, recommendation, shippingRules)!;
  assert.equal(baseline.buyers, 29); assert.equal(baseline.conversions, 1);
  assert.equal(JSON.stringify(history).includes("private-address"), false);
  assert.equal(JSON.stringify(study).includes('"buyer-0"'), false);
});

test("commercial reader does not infer absent freight costs and planning excludes existing freight subsidies", async () => {
  const sessions = [{ ...session("missing"), cohort: "treatment", shipping: { customerPrice: 20 } },
    { ...session("subsidized"), cohort: "treatment", shipping: { customerPrice: 0, realCost: 10 } },
    { ...session("known"), cohort: "treatment", shipping: { customerPrice: 20, realCost: 20 } }];
  const history = await loadDiscountHistory(db(sessions, sessions.map(s => intent(s.globalUserId))), "store", now, 30);
  assert.equal(history.buyers[0].shipping, undefined);
  assert.deepEqual(history.buyers[1].shipping, { customerPrice: 0, realCost: 10 });
  const cohorts = [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
    carts: Array.from({ length: 30 }, () => history.buyers[0].cart) }];
  const study = commercialDiscountStudy({ merchantId: "store", runId: "run", observationId: "obs", rules,
    asOf: now.toISOString(), capturedAt: now.toISOString(), cohorts });
  const recommendation = commercialIncentiveRecommendation(study, rules,
    incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 10000, maxDiscountCents: 400, maxRedemptions: 25 }));
  const baseline = incentivePlanningBaseline(history, now, recommendation, rules)!;
  // Product discounts may be evaluated without a shipping quote, but a known
  // existing subsidy must never be counted as eligible for another incentive.
  assert.equal(baseline.buyers, 2);
});
