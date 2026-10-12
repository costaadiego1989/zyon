import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { readBuyerIncentiveBenefits } from "./buyer-incentive-benefits.reader.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { incentiveAssignmentArm, incentiveCartHash } from "./incentive-execution-ledger.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { discountStudy, commercialDiscountStudy, plannerDiscountStudy } from "../domain/strategy-discount-study.js";
import { incentivePolicySnapshot } from "../domain/incentive-policy.js";
import { plannedCommercialIncentiveRecommendation, plannedIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { recommendedIncentiveBudgetTerms } from "../domain/incentive-budget.js";
import { revenueIncentiveOptions } from "../domain/revenue-incentive-options.js";
import { orchestrationDecision } from "../domain/strategy-orchestration.js";
import { assessExecutableIncentive } from "../domain/executable-incentive.js";
import { strategyIncentiveCouponTerms } from "../../coupons/infrastructure/strategy-incentive-coupon.js";

const originalEnv = { ...process.env };
beforeEach(() => { process.env = { ...originalEnv,
  REVENUE_INCENTIVE_EXECUTION_ENABLED: "true", REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: "store",
  REVENUE_INCENTIVE_BUDGET_ENABLED: "true", REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS: "store",
  REVENUE_COMMERCIAL_MODES_ENABLED: "true", REVENUE_COMMERCIAL_MODES_MERCHANT_IDS: "store" }; });
after(() => { process.env = originalEnv; });

const now = new Date("2026-10-05T12:00:00.000Z");
function fixture(mode: "percentage" | "coupon" | "progressive" = "percentage", stageIndex: 0 | 1 = 0) {
  const rules = merchantRulesSnapshot({ ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true,
    maxDiscountPercent: 5, minimumMarginPercent: 30, couponBoxEnabled: true } as never);
  const policy = incentivePolicySnapshot("store", 1, { enabled: true, maxDiscountCents: 400, maxRedemptions: 1000, limitCents: 400000 });
  const asOf = "2026-10-04T00:00:00.000Z";
  const study = (mode === "progressive" ? plannerDiscountStudy : mode === "coupon" ? commercialDiscountStudy : discountStudy)({
    merchantId: "store", runId: "run", observationId: "observation", asOf, capturedAt: asOf, rules,
    cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .01,
      carts: Array.from({ length: 30 }, () => ({ currency: "BRL", total: 100,
        items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
  const baseline = { buyers: 10000, conversions: 10, complete: true,
    windowStart: "2026-08-30T00:00:00.000Z", windowEnd: "2026-09-27T00:00:00.000Z" };
  const options = mode === "progressive" ? revenueIncentiveOptions(study, rules, { snapshot: policy, mode: "manual" }, () => baseline) : undefined;
  const option = options?.options.find(o => o.recommendation.selectedCandidateKey === "progressive");
  const orchestration = options && option ? orchestrationDecision(options, option.id, "Comparar os dois patamares autorizados.") : undefined;
  const recommendation = option?.recommendation ?? (mode === "coupon" ? plannedCommercialIncentiveRecommendation : plannedIncentiveRecommendation)(study, rules, policy, baseline);
  assert.equal(recommendation.status, "recommended");
  assert.equal(recommendation.planning?.status, "estimated_feasible");
  const proposal = { rules, observation: { id: "observation" }, discountStudy: study, incentiveRecommendation: recommendation,
    ...(orchestration ? { orchestration } : {}) };
  const terms = recommendedIncentiveBudgetTerms({ merchantId: "store", strategyId: "strategy", version: 1,
    proposalHash: digest(proposal), study, rules, policy, recommendation }, "2026-10-04T12:00:00.000Z");
  const execution = { id: "execution", merchantId: "store", strategyId: "strategy", version: 1, reviewId: "review", budgetId: "budget",
    startedAt: new Date(terms.startsAt), endsAt: new Date(terms.endsAt), recommendation, recommendationHash: digest(recommendation) };
  const buyerId = Array.from({ length: 100 }, (_, i) => `buyer-${i}`).find(id => incentiveAssignmentArm(execution.id, id) === "treatment")!;
  const shipping = { customerPrice: 10, realCost: 10 };
  const cart = { total: 100, currency: "BRL", items: [{ sku: "sku", variantId: "variant", name: "Produto", quantity: 1, price: 100, cost: 40 }] };
  const maximum = assessExecutableIncentive(cart, rules, recommendation, shipping)!;
  const granted = assessExecutableIncentive(cart, rules, recommendation, shipping, mode === "progressive" ? stageIndex : 1)!;
  assert.ok(maximum); assert.ok(granted);
  const assignment = { id: "assignment", merchantId: "store", executionId: "execution", buyerId, sessionId: "session",
    arm: "treatment", assignedAt: new Date("2026-10-04T12:02:00.000Z"), reservationId: "reservation",
    cartHash: mode === "percentage" ? incentiveCartHash(cart) : digest({ cart: incentiveCartHash(cart), shipping }),
    amountCents: maximum.amountCents, costCents: maximum.costCents };
  const coupon = strategyIncentiveCouponTerms(execution as never);
  const state: any = {
    executions: [execution], assignments: [assignment],
    consent: { merchantId: "store", globalUserId: buyerId, optedIn: true, expiresAt: new Date("2026-10-20T00:00:00.000Z") },
    intent: { merchantId: "store", globalUserId: buyerId, primaryIntent: "price_sensitive", generatedAt: new Date("2026-10-04T12:01:00.000Z") },
    holdout: null, ruleRow: { ...rules, merchantId: "store" }, policy,
    budget: { id: "budget", merchantId: "store", strategyId: "strategy", version: 1, reviewId: "review", closedAt: null,
      startsAt: execution.startedAt, endsAt: execution.endsAt, terms, termsHash: digest(terms), proposalHash: digest(proposal),
      limitCents: terms.limitCents, maxDiscountCents: terms.maxDiscountCents, maxRedemptions: terms.maxRedemptions,
      reservedCents: maximum.amountCents, reservedCount: 1, spentCents: 0, spentCount: 0 },
    reservation: { id: "reservation", merchantId: "store", budgetId: "budget", sessionId: "session", buyerId,
      status: "reserved", amountCents: maximum.amountCents, resolvedAt: null, spentCents: null },
    session: { id: "row", sessionId: "session", merchantId: "store", globalUserId: buyerId, cohort: "treatment", promptVariantId: null,
      createdAt: new Date("2026-10-04T12:01:00.000Z"), updatedAt: now, shipping, cart: { ...cart,
        currentDiscount: granted.amountCents / 100, commercialNudge: { kind: "coupon", ruleId: "assignment", ...(coupon ? { couponCode: coupon.code } : {}) } } },
    version: { merchantId: "store", version: 1, proposalHash: digest(proposal), proposal,
      strategy: { merchantId: "store", currentVersion: 1, status: "pending_review", runId: "run" } },
    run: { merchantId: "store", id: "run", status: "completed", asOf: new Date(asOf), discountStudyJson: study,
      incentiveRecommendationJson: options ? null : recommendation, incentiveOptionsJson: options ?? null },
    review: { id: "review", sequence: 1, kind: "approve", proposalHash: digest(proposal), recommendationHash: digest(recommendation),
      policyVersion: 1, policyHash: policy.policyHash, createdAt: new Date("2026-10-04T01:00:00.000Z"), expiresAt: new Date("2026-10-11T01:00:00.000Z") },
    head: { currentSequence: 1 }, schedule: { merchantId: "store" },
    prices: [{ variantId: "variant", currency: "BRL", basePriceInCents: 10000, costInCents: 4000 }],
    coupon: coupon ? { ...coupon, status: "active" } : null,
    grant: mode === "progressive" ? { merchantId: "store", assignmentId: "assignment", stageIndex, amountCents: granted.amountCents,
      trigger: stageIndex === 0 ? "enrollment" : "checkout_payment_ready", createdAt: now } : null,
    counts: {},
  };
  const reads: Array<{ model: string; args: any }> = [];
  const names: Record<string, string> = { buyerIntentMemoryConsent: "consent", customerIntentRecord: "intent", holdoutGroupAssignment: "holdout",
    strategyIncentiveExecution: "executions", strategyIncentiveAssignment: "assignments", strategyIncentiveBudget: "budget",
    strategyIncentiveReservation: "reservation", checkoutSession: "session", revenueStrategyVersion: "version", merchantRule: "ruleRow",
    merchantIncentivePolicy: "policy", revenueAnalysisSchedule: "schedule", revenueAnalysisRun: "run", strategyIncentiveReview: "review",
    strategyIncentiveReviewHead: "head", strategyIncentiveStageGrant: "grant", productPrice: "prices", coupon: "coupon" };
  const client = new Proxy({}, { get(_target, model: string) {
    if (model === "$executeRaw") return async (sql: TemplateStringsArray) => {
      assert.equal(sql.join(""), "SET TRANSACTION READ ONLY"); reads.push({ model, args: sql }); return 0;
    };
    if (model === "$queryRaw") return async (sql: TemplateStringsArray) => {
      assert.equal(sql.join(""), "SELECT clock_timestamp() AS now", "no row locks, writes or enrolling SQL");
      return [{ now }];
    };
    return new Proxy({}, { get(_delegate, operation: string) {
      assert.ok(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "count"].includes(operation), `forbidden ${model}.${operation}`);
      return async (args: any) => {
        reads.push({ model, args });
        assert.ok(JSON.stringify(args.where).includes('"merchantId":"store"'), `${model} must scope the merchant`);
        if (operation === "count") return state.counts[model] ?? 0;
        return state[names[model]];
      };
    } });
  } });
  const prisma = { async $transaction(work: (tx: any) => Promise<unknown>, options: unknown) {
    assert.deepEqual(options, { isolationLevel: "RepeatableRead", timeout: 10000 }); return work(client);
  } } as unknown as PrismaClient;
  return { state, reads, buyerId, prisma, read: () => readBuyerIncentiveBenefits(prisma, "store", buyerId) };
}

test("buyer benefits show only the existing capped amount with exact tenant/buyer reads and no writes", async () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const result = await f.read();
  assert.equal(result.length, 1);
  assert.deepEqual({ amount: result[0].amountCents, cap: result[0].maxDiscountCents, percent: result[0].discountPercent,
    status: result[0].status, session: result[0].sessionId }, { amount: 400, cap: 400, percent: 5, status: "applied", session: "session" });
  assert.match(result[0].description, /5%.*400|5%.*4,00/);
  assert.deepEqual(f.state, before);
  const query = f.reads.find(r => r.model === "strategyIncentiveAssignment")!.args;
  assert.deepEqual(query.where, { merchantId: "store", buyerId: f.buyerId, arm: "treatment", reservationId: { not: null }, executionId: { in: ["execution"] } });
  assert.equal(query.take, 20);
});

test("an already reserved benefit remains visible when every budget slot is committed", async () => {
  const f = fixture();
  f.state.budget.reservedCents = f.state.budget.limitCents;
  f.state.budget.reservedCount = f.state.budget.maxRedemptions;
  assert.equal((await f.read()).length, 1);
});

test("personalized coupon terms and code come from the current approved execution", async () => {
  const f = fixture("coupon");
  const [offer] = await f.read();
  assert.ok(offer); assert.equal(offer.deliveryMode, "coupon_code");
  assert.equal(offer.couponCode, f.state.coupon.code); assert.equal(offer.kind, "fixed");
  assert.doesNotMatch(offer.description, /%/);
});

for (const stage of [0, 1] as const) test(`progressive buyer benefit exposes only granted stage ${stage}`, async () => {
  const f = fixture("progressive", stage);
  const [offer] = await f.read(); assert.ok(offer);
  const expected = f.state.executions[0].recommendation.test.stages[stage];
  assert.equal(offer.kind, "progressive"); assert.equal(offer.amountCents, f.state.grant.amountCents);
  assert.equal(offer.discountPercent, expected.discountPercent); assert.equal(offer.maxDiscountCents, expected.maxDiscountCents);
  assert.match(offer.description, new RegExp(`Etapa ${stage + 1} de 2`));
});

test("benefit expiry cannot outlive the buyer's current consent", async () => {
  const f = fixture(); f.state.consent.expiresAt = new Date(+now + 60000);
  assert.equal((await f.read())[0].expiresAt, f.state.consent.expiresAt.toISOString());
});

for (const [label, mutate] of [
  ["control", (s: any) => s.assignments[0].arm = "control"],
  ["foreign buyer", (s: any) => s.assignments[0].buyerId = "other"],
  ["foreign tenant", (s: any) => s.executions[0].merchantId = "other"],
  ["unassigned", (s: any) => s.assignments = []],
  ["session holdout", (s: any) => s.session.cohort = "holdout"],
  ["current holdout", (s: any) => s.holdout = { cohort: "holdout" }],
  ["revoked consent", (s: any) => s.consent.optedIn = false],
  ["expired consent", (s: any) => s.consent.expiresAt = now],
  ["new intent", (s: any) => s.intent.primaryIntent = "ready_to_buy"],
  ["future intent", (s: any) => s.intent.generatedAt = new Date(+now + 1)],
  ["ended execution", (s: any) => s.executions[0].endsAt = now],
  ["scheduled execution", (s: any) => s.executions[0].startedAt = new Date(+now + 1)],
  ["old session", (s: any) => s.session.createdAt = new Date("2026-10-01")],
  ["closed budget", (s: any) => s.budget.closedAt = now],
  ["spent reservation", (s: any) => s.reservation.status = "spent"],
  ["released reservation", (s: any) => s.reservation.status = "released"],
  ["foreign reservation", (s: any) => s.reservation.buyerId = "other"],
  ["over budget", (s: any) => s.budget.spentCents = s.budget.limitCents],
  ["over redemptions", (s: any) => s.budget.spentCount = s.budget.maxRedemptions],
  ["forged current discount", (s: any) => s.session.cart.currentDiscount = 5],
  ["changed cart", (s: any) => s.session.cart.items[0].quantity = 2],
  ["unknown cost", (s: any) => s.prices[0].costInCents = null],
  ["margin erosion", (s: any) => s.prices[0].costInCents = 9800],
  ["changed catalog price", (s: any) => s.prices[0].basePriceInCents = 11000],
  ["inactive catalog product", (s: any) => s.prices = []],
  ["subsidized freight", (s: any) => s.session.shipping.realCost = 11],
  ["unknown freight cost", (s: any) => s.session.shipping.realCost = null],
  ["customized product", (s: any) => s.session.cart.items[0].selected_options = [{ id: "extra" }]],
  ["foreign nudge", (s: any) => s.session.cart.commercialNudge.ruleId = "other"],
  ["changed rules", (s: any) => s.ruleRow.maxDiscountPercent = 4],
  ["changed policy", (s: any) => s.policy.version++],
  ["superseded version", (s: any) => s.version.strategy.currentVersion++],
  ["withdrawn approval", (s: any) => s.review.kind = "withdraw"],
  ["stale review head", (s: any) => s.head.currentSequence++],
  ["corrupt terms", (s: any) => s.budget.termsHash = "changed"],
  ["corrupt recommendation", (s: any) => s.executions[0].recommendationHash = "changed"],
  ["another communication assignment", (s: any) => s.counts.strategyAssignment = 1],
  ["running communication", (s: any) => s.counts.strategyExecution = 1],
  ["other prompt experiment", (s: any) => s.counts.promptExperiment = 1],
  ["completed order", (s: any) => s.counts.completedOrder = 1],
  ["provider attempt", (s: any) => s.counts.paymentIntent = 1],
  ["other offer", (s: any) => s.counts.acceptedOffer = 1],
  ["other coupon", (s: any) => s.counts.couponRedemption = 1],
] as const) test(`buyer benefits exclude ${label} without mutating records`, async () => {
  const f = fixture(); mutate(f.state);
  const before = structuredClone(f.state);
  assert.deepEqual(await f.read(), []); assert.deepEqual(f.state, before);
});

for (const [label, mutate] of [
  ["inactive code", (s: any) => s.coupon.status = "paused"],
  ["foreign coupon", (s: any) => s.coupon.merchantId = "other"],
  ["changed code", (s: any) => s.coupon.code = "OTHER"],
  ["changed coupon amount", (s: any) => s.coupon.discountValue = 100],
  ["changed shipping quote", (s: any) => s.session.shipping.customerPrice = 12],
] as const) test(`personalized coupon excludes ${label}`, async () => {
  const f = fixture("coupon"); mutate(f.state); assert.deepEqual(await f.read(), []);
});

for (const flag of ["REVENUE_INCENTIVE_EXECUTION_ENABLED", "REVENUE_INCENTIVE_BUDGET_ENABLED",
  "REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS", "REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS"]) test(`buyer benefits require ${flag}`, async () => {
  const f = fixture(); process.env[flag] = "false";
  assert.deepEqual(await f.read(), []); assert.equal(f.reads.length, 0);
});

test("commercial benefits respect rollback and absent progressive grant cannot advertise future value", async () => {
  const f = fixture("progressive"); f.state.grant = null;
  assert.deepEqual(await f.read(), []);
  process.env.REVENUE_COMMERCIAL_MODES_ENABLED = "false";
  assert.deepEqual(await fixture("coupon").read(), []);
});

test("global or malformed identity cannot query personalized offers", async () => {
  const f = fixture();
  for (const merchantId of ["", " store", "other"]) assert.deepEqual(await readBuyerIncentiveBenefits(f.prisma, merchantId, f.buyerId), []);
  assert.deepEqual(await readBuyerIncentiveBenefits(f.prisma, "store", ""), []);
  assert.equal(f.reads.length, 0);
});
