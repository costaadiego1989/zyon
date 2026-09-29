import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { discountStudy } from "../domain/strategy-discount-study.js";
import { incentiveBudgetTerms } from "../domain/incentive-budget.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import { PrismaHypothesisRepository } from "./prisma-hypothesis.repository.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { registerReviewedIncentiveBudget, reserveIncentiveBudget, resolveIncentiveBudget,
  closeIncentiveBudget, readIncentiveBudget } from "./incentive-budget-ledger.js";

// Shared disposable review database: never run concurrently with its other suites.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, transactionOptions: { maxWait: 10000, timeout: 30000 } });
const env = { ...process.env };
const tx = <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work);
const spec = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled }, fn);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { process.env = env; await prisma.$disconnect(); });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*",
    REVENUE_INCENTIVE_BUDGET_ENABLED: "true", REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS: "store,other",
    REVENUE_DISCOUNT_STUDY_ENABLED: "false", REVENUE_STRATEGY_MEASUREMENT_ENABLED: "false" };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_analysis_runs, revenue_analysis_schedules,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, checkout_settings,
    merchants, checkout_sessions, completed_orders, prompt_experiments, coupons CASCADE`);
});

async function fixture(merchantId = "store", caps = { limitCents: 1000, maxDiscountCents: 500, maxRedemptions: 10 }) {
  const now = new Date();
  await prisma.merchant.create({ data: { id: merchantId, name: "Fixture" } });
  const rules = merchantRulesSnapshot(await prisma.merchantRule.create({ data: { merchantId,
    maxDiscountPercent: 5, minimumMarginPercent: 30, allowFreeShipping: false, allowShippingDiscount: false,
    allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: true, autonomousEngineEnabled: true,
    freeShippingMinCartValue: 200, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0, offerExpirationMinutes: 15,
    blockedRegions: [], brandVoice: "consultative" } }));
  const observation = ObservationEntity.create({ merchant_id: merchantId,
    observation_window_start: new Date(now.getTime() - 28 * 86400000), observation_window_end: now,
    funnel: { total_sessions: 100, started_checkout: 100, reached_shipping: 80, reached_payment: 40, completed_order: 10, conversion_rate: .1 },
    abandonment: { abandoned_at_shipping: 40, abandoned_at_payment: 30, abandonment_rate: .9, top_abandonment_objection: "unknown" },
    objections: { shipping_cost_count: 0, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 90 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { new_customers_rate: 1, returning_customers_rate: 0, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_orders: 10, total_revenue_cents: 100000, avg_order_value_cents: 10000 }, ai_costs_cents: 0 });
  await new PrismaObservationRepository(prisma).save(observation);
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId, cycle: 1, status: "running", leaseToken: 1,
    leaseUntil: new Date(now.getTime() + 600000), observationId: observation.id, asOf: now } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId, group: 0, nextDueAt: now, currentRunId: run.id } });
  const study = discountStudy({ merchantId, runId: run.id, observationId: observation.id, rules,
    asOf: now.toISOString(), capturedAt: now.toISOString(), cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
      carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL", items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { discountStudyJson: study } });
  const hypothesis = HypothesisEntity.create({ merchant_id: merchantId, observation_id: observation.id,
    hypothesis_text: "Testar uma explicação das etapas", reasoning: "Comparar as sessões observadas", expected_lift_percent: 1,
    template: { name: "Explicação", description: "Explicar as próximas etapas",
      variant_a: { name: "Controle", system_prompt: "Explique os dados verificados.", weight: 50, is_control: true },
      variant_b: { name: "Teste", system_prompt: "Pergunte qual etapa precisa de explicação.", weight: 50, is_control: false } },
    risk_level: "low", approval_strategy: "manual" });
  await new PrismaHypothesisRepository(prisma).save(hypothesis, { runId: run.id, leaseToken: 1, discountStudy: study });
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: hypothesis.id } });
  const terms = incentiveBudgetTerms({ merchantId, strategyId: hypothesis.id, version: 1, proposalHash: version.proposalHash, study, rules },
    { ...caps, startsAt: new Date(Date.now() + 400).toISOString() });
  const input = { merchantId, terms, termsHash: digest(terms), actorId: "owner", requestKey: "budget-review" };
  return { merchantId, input, terms, version, run, hypothesis };
}
async function ready(caps?: { limitCents: number; maxDiscountCents: number; maxRedemptions: number }) {
  const f = await fixture("store", caps);
  const budget = await tx(t => registerReviewedIncentiveBudget(t, f.input));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, budget.startsAt.getTime() - Date.now() + 5)));
  return { ...f, budget };
}
async function session(merchantId = "store", sessionId = randomUUID(), buyerId = sessionId, cohort = "treatment", currency = "BRL") {
  const now = new Date();
  await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerId, conversationId: sessionId,
    cart: { currency, total: 100 }, cohort, createdAt: now, updatedAt: now } });
  return { merchantId, sessionId, buyerId };
}
async function reserve(f: Awaited<ReturnType<typeof ready>>, amountCents = 500, requestKey = randomUUID(), buyer?: Awaited<ReturnType<typeof session>>) {
  const input = { ...(buyer ?? await session()), budgetId: f.budget.id, amountCents, requestKey };
  return { input, row: await tx(t => reserveIncentiveBudget(t, input)) };
}
const totals = (f: Awaited<ReturnType<typeof ready>>) => tx(t => readIncentiveBudget(t, f.merchantId, f.budget.id));
const resolution = (id: string, status: "spent" | "released" = "spent", spentCents = 500) => ({
  merchantId: "store", reservationId: id, status, spentCents, evidenceKey: `commerce:${id}` });

spec("funding approval is separate, exact, idempotent and creates no coupon or active experiment", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => tx(t => registerReviewedIncentiveBudget(t, f.input))));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 1);
  assert.equal(await prisma.strategyExecution.count(), 0); assert.equal(await prisma.coupon.count(), 0);
  assert.equal((await prisma.revenueStrategy.findUniqueOrThrow({ where: { id: f.hypothesis.id } })).status, "pending_review");
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, actorId: "other-owner" })), /APPROVAL_KEY_CONFLICT/);
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, requestKey: "duplicate" })), /ALREADY_REVIEWED/);
});

spec("funding requires an explicit store flag and exact terms, actor and source proposal", async () => {
  const f = await fixture();
  for (const allowed of ["", "*", "other"]) {
    process.env.REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS = allowed;
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /BUDGET_DISABLED/);
  }
  process.env.REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS = "store";
  for (const input of [{ ...f.input, termsHash: "b".repeat(64) }, { ...f.input, actorId: " " }, { ...f.input, merchantId: "other" }]) {
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, input)), /INVALID_APPROVAL/);
  }
  const terms = { ...f.terms, proposalHash: "b".repeat(64) };
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) })), /PROPOSAL_CHANGED/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("approval rejects changed policy, stale versions, past start and an already active communication strategy", async () => {
  const f = await fixture();
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { maxDiscountPercent: 4 } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /INVALID_DISCOUNT_STUDY/);
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { maxDiscountPercent: 5 } });
  for (const status of ["rejected", "active", "revision_pending"]) {
    await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { status } });
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /PROPOSAL_CHANGED/);
  }
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { status: "pending_review", currentVersion: 2 } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /PROPOSAL_CHANGED/);
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 1 } });
  const terms = { ...f.terms, startsAt: new Date(Date.now() - 10).toISOString() };
  terms.endsAt = new Date(Date.parse(terms.startsAt) + 7 * 86400000).toISOString();
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) })), /APPROVAL_EXPIRED/);
});

spec("parallel reservations cannot exceed the strategy monetary ceiling", async () => {
  const f = await ready();
  const inputs = await Promise.all(Array.from({ length: 12 }, async () => ({ ...await session(), budgetId: f.budget.id,
    requestKey: randomUUID(), amountCents: 400 })));
  const attempts = await Promise.allSettled(inputs.map(input => tx(t => reserveIncentiveBudget(t, input))));
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 2);
  const sum = await totals(f);
  assert.equal(sum.reservedCents, 800); assert.equal(sum.uncommittedCents, 200); assert.equal(sum.spentCents, 0);
});

spec("redemption slots and one use per buyer hold across concurrent different sessions", async () => {
  const f = await ready({ limitCents: 10000, maxDiscountCents: 500, maxRedemptions: 2 });
  const buyers = await Promise.all(Array.from({ length: 6 }, () => session("store", randomUUID(), "same-buyer")));
  const attempts = await Promise.allSettled(buyers.map(b => reserve(f, 100, randomUUID(), b)));
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
  await reserve(f, 100);
  await assert.rejects(reserve(f, 1), /budget unavailable or exhausted/);
  assert.equal((await totals(f)).reservedCount, 2);
});

spec("exact retry is stable and conflicting retry cannot alter money, session or buyer", async () => {
  const f = await ready(), r = await reserve(f);
  const rows = await Promise.all(Array.from({ length: 6 }, () => tx(t => reserveIncentiveBudget(t, r.input))));
  assert.equal(new Set(rows.map(row => row.id)).size, 1);
  for (const patch of [{ amountCents: 1 }, { buyerId: "other" }, { sessionId: "other" }]) {
    await assert.rejects(tx(t => reserveIncentiveBudget(t, { ...r.input, ...patch })), /RESERVATION_KEY_CONFLICT/);
  }
  assert.equal((await totals(f)).reservedCents, 500);
});

spec("tenant, buyer, currency, holdout and per-offer cap are enforced before committing a reservation", async () => {
  const f = await ready();
  await assert.rejects(reserve(f, 501), /budget unavailable or exhausted/);
  await assert.rejects(reserve(f, 10, randomUUID(), await session("store", "holdout", "holdout", "holdout")), /context invalid/);
  await assert.rejects(reserve(f, 10, randomUUID(), await session("store", "usd", "usd", "treatment", "USD")), /context invalid/);
  const own = await session();
  await assert.rejects(reserve(f, 10, randomUUID(), { ...own, buyerId: "forged" }), /context invalid/);
  await assert.rejects(reserve(f, 10, randomUUID(), { ...own, merchantId: "other" }), /BUDGET_NOT_FOUND/);
  await assert.rejects(tx(t => readIncentiveBudget(t, "other", f.budget.id)), /BUDGET_NOT_FOUND/);
  assert.equal((await totals(f)).reservedCents, 0);
});

spec("unknown reservations retain funds after closure, and resolution works with the feature disabled", async () => {
  const f = await ready(), r = await reserve(f);
  await tx(t => closeIncentiveBudget(t, { merchantId: "store", budgetId: f.budget.id, actorId: "owner", reason: "Pausar novos incentivos" }));
  await assert.rejects(reserve(f), /budget unavailable or exhausted/);
  assert.equal((await totals(f)).reservedCents, 500);
  process.env.REVENUE_INCENTIVE_BUDGET_ENABLED = "false";
  assert.equal((await tx(t => reserveIncentiveBudget(t, r.input))).id, r.row.id);
  const input = resolution(r.row.id, "released", 0);
  await tx(t => resolveIncentiveBudget(t, input));
  await tx(t => resolveIncentiveBudget(t, input));
  const sum = await totals(f);
  assert.equal(sum.status, "closed"); assert.equal(sum.reservedCents, 0); assert.equal(sum.uncommittedCents, 1000);
  assert.equal((await tx(t => registerReviewedIncentiveBudget(t, f.input))).id, f.budget.id);
});

spec("partial consumption charges actual cents and releases the unused amount exactly once", async () => {
  const f = await ready(), r = await reserve(f);
  const input = resolution(r.row.id, "spent", 350);
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => tx(t => resolveIncentiveBudget(t, input))));
  assert.equal(new Set(outcomes.map(row => row.id)).size, 1);
  const sum = await totals(f);
  assert.equal(sum.reservedCents, 0); assert.equal(sum.spentCents, 350); assert.equal(sum.spentCount, 1);
  assert.equal(sum.uncommittedCents, 650);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(r.row.id, "released", 0))), /RESOLUTION_CONFLICT/);
  await assert.rejects(reserve(f, 100, randomUUID(), r.input), /unique constraint/i);
});

spec("cancellation frees capacity but retrying its original request never reopens the reservation", async () => {
  const f = await ready(), r = await reserve(f);
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id, "released", 0)));
  assert.equal((await tx(t => reserveIncentiveBudget(t, r.input))).status, "released");
  await reserve(f, 500, "replacement", r.input);
  assert.equal((await totals(f)).reservedCount, 1); assert.equal(await prisma.strategyIncentiveReservation.count(), 2);
});

spec("reserve, cancellation and consumption roll back with the enclosing commerce transaction", async () => {
  const f = await ready(), buyer = await session();
  await assert.rejects(tx(async t => {
    await reserveIncentiveBudget(t, { ...buyer, budgetId: f.budget.id, requestKey: "rollback", amountCents: 500 });
    throw new Error("checkout save failed");
  }), /checkout save failed/);
  assert.equal((await totals(f)).reservedCents, 0); assert.equal(await prisma.strategyIncentiveReservation.count(), 0);
  const r = await reserve(f);
  for (const input of [resolution(r.row.id), resolution(r.row.id, "released", 0)]) {
    await assert.rejects(tx(async t => { await resolveIncentiveBudget(t, input); throw new Error("commerce failed"); }), /commerce failed/);
    assert.equal((await totals(f)).reservedCents, 500); assert.equal((await totals(f)).spentCents, 0);
  }
});

spec("conflicting consume/cancel commands have a single terminal outcome", async () => {
  const f = await ready(), r = await reserve(f);
  const attempts = await Promise.allSettled([resolution(r.row.id), resolution(r.row.id, "released", 0)]
    .map(input => tx(t => resolveIncentiveBudget(t, input))));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  const row = await prisma.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: r.row.id } });
  const sum = await totals(f);
  assert.equal(sum.reservedCents, 0); assert.equal(sum.spentCents, row.status === "spent" ? 500 : 0);
});

spec("invalid amounts and duplicate commerce evidence cannot release or overspend reservations", async () => {
  const f = await ready(), a = await reserve(f), b = await reserve(f);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(a.row.id, "spent", 501))), /RESERVATION_EXCEEDED/);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(a.row.id, "spent", 0))), /INVALID_RESOLUTION/);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(a.row.id, "released", 10))), /INVALID_RESOLUTION/);
  await tx(t => resolveIncentiveBudget(t, resolution(a.row.id)));
  await assert.rejects(tx(t => resolveIncentiveBudget(t, { ...resolution(b.row.id), evidenceKey: resolution(a.row.id).evidenceKey })), /unique constraint/i);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, { ...resolution(b.row.id), merchantId: "other" })), /RESERVATION_NOT_FOUND/);
  assert.equal((await totals(f)).reservedCents, 500); assert.equal((await totals(f)).spentCents, 500);
});

spec("database denies rewritten terms, fabricated counters, reopened reservations and erased evidence", async () => {
  const f = await ready(), r = await reserve(f);
  await assert.rejects(prisma.strategyIncentiveBudget.update({ where: { id: f.budget.id }, data: { limitCents: 100000 } }), /immutable/);
  await assert.rejects(prisma.strategyIncentiveBudget.update({ where: { id: f.budget.id }, data: { reservedCents: 0 } }), /reservation evidence/);
  await assert.rejects(prisma.strategyIncentiveBudget.delete({ where: { id: f.budget.id } }), /durable/);
  await assert.rejects(prisma.strategyIncentiveReservation.update({ where: { id: r.row.id }, data: { amountCents: 1 } }), /invalid or final/);
  await assert.rejects(prisma.strategyIncentiveReservation.delete({ where: { id: r.row.id } }), /durable/);
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id)));
  await assert.rejects(prisma.strategyIncentiveReservation.update({ where: { id: r.row.id }, data: { status: "reserved" } }), /invalid or final/);
  await tx(t => closeIncentiveBudget(t, { merchantId: "store", budgetId: f.budget.id, actorId: "owner", reason: "Fim" }));
  await assert.rejects(prisma.strategyIncentiveBudget.update({ where: { id: f.budget.id }, data: { closedAt: null, closedBy: null, closeReason: null } }), /closure is final/);
});

spec("raw concurrent inserts cannot bypass the accounting ceiling", async () => {
  const f = await ready();
  const inputs = await Promise.all(Array.from({ length: 10 }, async () => ({ ...await session(), id: randomUUID(),
    budgetId: f.budget.id, requestKey: randomUUID(), requestHash: "a".repeat(64), amountCents: 400, reservedAt: new Date() })));
  const attempts = await Promise.allSettled(inputs.map(input => prisma.strategyIncentiveReservation.create({ data: input })));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 2);
  assert.equal((await totals(f)).reservedCents, 800);
});

spec("repeatable-read snapshots are fenced rather than silently overspending", async () => {
  const f = await ready({ limitCents: 500, maxDiscountCents: 500, maxRedemptions: 2 });
  const buyers = await Promise.all([session(), session()]);
  let arrived = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const attempts = await Promise.allSettled(buyers.map(buyer => prisma.$transaction(async t => {
    await t.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: f.budget.id } });
    if (++arrived === 2) release();
    await gate;
    return t.strategyIncentiveReservation.create({ data: { ...buyer, id: randomUUID(), budgetId: f.budget.id,
      requestKey: randomUUID(), requestHash: "a".repeat(64), amountCents: 500, reservedAt: new Date() } });
  }, { isolationLevel: "RepeatableRead" })));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  assert.equal((await totals(f)).reservedCents, 500);
});

spec("a changed policy or superseded proposal blocks new reservations but leaves settlement possible", async () => {
  const f = await ready(), r = await reserve(f);
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { autonomousEngineEnabled: false } });
  await assert.rejects(reserve(f), /INVALID_DISCOUNT_STUDY/);
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { autonomousEngineEnabled: true } });
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 2 } });
  await assert.rejects(reserve(f), /PROPOSAL_CHANGED/);
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id)));
  assert.equal((await totals(f)).spentCents, 500);
});

spec("funding approval rolls back with its enclosing review transaction", async () => {
  const f = await fixture();
  await assert.rejects(tx(async t => { await registerReviewedIncentiveBudget(t, f.input); throw new Error("review failed"); }), /review failed/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
  await tx(t => registerReviewedIncentiveBudget(t, f.input));
  assert.equal(await prisma.strategyIncentiveBudget.count(), 1);
});

spec("no reservation can spend scheduled capacity before the reviewed start", async () => {
  const f = await fixture();
  const terms = { ...f.terms, startsAt: new Date(Date.now() + 60000).toISOString(), endsAt: new Date(Date.now() + 60000 + 7 * 86400000).toISOString() };
  terms.endsAt = new Date(Date.parse(terms.startsAt) + 7 * 86400000).toISOString();
  const budget = await tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) }));
  const buyer = await session();
  await assert.rejects(tx(t => reserveIncentiveBudget(t, { ...buyer, budgetId: budget.id, amountCents: 100, requestKey: "early" })), /budget unavailable or exhausted/);
  const sum = await tx(t => readIncentiveBudget(t, "store", budget.id));
  assert.equal(sum.status, "scheduled"); assert.equal(sum.reservedCents, 0);
});

spec("independent stores have separate caps and cannot consume each other's balances", async () => {
  const a = await ready(), other = await fixture("other");
  const b = await tx(t => registerReviewedIncentiveBudget(t, other.input));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, b.startsAt.getTime() - Date.now() + 5)));
  const r = await reserve(a);
  const buyer = await session("other");
  const own = { ...buyer, budgetId: b.id, amountCents: 500, requestKey: "other-reservation" };
  await assert.rejects(tx(t => reserveIncentiveBudget(t, { ...own, budgetId: a.budget.id })), /BUDGET_NOT_FOUND/);
  await tx(t => reserveIncentiveBudget(t, own));
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id)));
  assert.equal((await totals(a)).spentCents, 500);
  const summary = await tx(t => readIncentiveBudget(t, "other", b.id));
  assert.equal(summary.reservedCents, 500); assert.equal(summary.spentCents, 0);
});

spec("raw inserts cannot invent pre-spent or pre-released receipts", async () => {
  const f = await ready(), buyer = await session();
  for (const status of ["spent", "released"]) {
    await assert.rejects(prisma.strategyIncentiveReservation.create({ data: { ...buyer, id: randomUUID(), budgetId: f.budget.id,
      requestKey: randomUUID(), requestHash: "a".repeat(64), amountCents: 500, reservedAt: new Date(), status,
      spentCents: status === "spent" ? 500 : 0, resolvedAt: new Date(), evidenceKey: randomUUID(), resolutionHash: "a".repeat(64) } }), /context invalid/);
  }
  assert.equal((await totals(f)).reservedCents, 0); assert.equal((await totals(f)).spentCents, 0);
});

spec("stopping and reserving concurrently preserves any admitted funds for explicit reconciliation", async () => {
  const f = await ready(), buyer = await session();
  const attempts = await Promise.allSettled([
    tx(t => reserveIncentiveBudget(t, { ...buyer, budgetId: f.budget.id, amountCents: 500, requestKey: "racing" })),
    tx(t => closeIncentiveBudget(t, { merchantId: "store", budgetId: f.budget.id, actorId: "owner", reason: "Parar" })),
  ]);
  assert.equal(attempts[1].status, "fulfilled");
  const sum = await totals(f);
  assert.equal(sum.status, "closed"); assert.equal(sum.reservedCents, attempts[0].status === "fulfilled" ? 500 : 0);
  await assert.rejects(reserve(f), /budget unavailable or exhausted/);
});

spec("removing weekly enrollment prevents new funding", async () => {
  const f = await fixture();
  await prisma.revenueAnalysisSchedule.delete({ where: { merchantId: "store" } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /WEEKLY_OWNERSHIP_REQUIRED/);
});

spec("financial timestamps keep the same UTC horizon under different database session timezones", async () => {
  for (const [merchantId, zone] of [["store", "America/Sao_Paulo"], ["other", "Asia/Tokyo"]]) {
    const f = await fixture(merchantId);
    const zoned = <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => tx(async t => {
      await t.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
      return work(t);
    });
    const budget = await zoned(t => registerReviewedIncentiveBudget(t, f.input));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, budget.startsAt.getTime() - Date.now() + 5)));
    const buyer = await session(merchantId);
    const row = await zoned(t => reserveIncentiveBudget(t, { ...buyer, budgetId: budget.id, requestKey: "zoned", amountCents: 500 }));
    await zoned(t => closeIncentiveBudget(t, { merchantId, budgetId: budget.id, actorId: "owner", reason: "Fim" }));
    await zoned(t => resolveIncentiveBudget(t, { ...resolution(row.id), merchantId }));
    const sum = await zoned(t => readIncentiveBudget(t, merchantId, budget.id));
    assert.equal(sum.status, "closed"); assert.equal(sum.spentCents, 500); assert.equal(sum.reservedCents, 0);
  }
});
