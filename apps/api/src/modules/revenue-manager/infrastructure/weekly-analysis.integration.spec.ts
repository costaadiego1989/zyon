import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { ObserveMetricsUseCase } from "../application/use-cases/observe-metrics.use-case.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import { WeeklyAnalysisService } from "./weekly-analysis.service.js";
import { RevenueAiBudgetService } from "./revenue-ai-budget.service.js";
import { LEASE_MS, WEEK_MS, nextNight } from "../domain/weekly-analysis-policy.js";

// This suite is destructive ONLY to its dedicated local fixture database.
const url = new URL(process.env.REVENUE_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_weekly";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const environment = { ...process.env };
const at = (value: string) => new Date(value);
const clock = at("2030-09-01T06:00:00Z");
const observe = new ObserveMetricsUseCase(prisma, new PrismaObservationRepository(prisma));
const service = () => {
  const s = new WeeklyAnalysisService(prisma, {} as never, observe, {} as never);
  // Eligibility is tested separately; these fixtures exercise scheduling at scale.
  (s as any).eligible = async () => true;
  return s;
};
const budget = new RevenueAiBudgetService(prisma);

before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = environment; });
beforeEach(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_ai_reservations, ai_usage_events, ai_price_versions,
    revenue_analysis_runs, revenue_analysis_schedules, merchant_notifications,
    revenue_manager_observations, checkout_sessions, merchants CASCADE`);
  Object.assign(process.env, { REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*", REVENUE_ANALYSIS_DAILY_LIMIT: "1000",
    REVENUE_AI_MAX_INPUT_TOKENS: "1000", REVENUE_AI_MAX_OUTPUT_TOKENS: "1000",
    REVENUE_AI_DAILY_LIMIT_MICROS: "5000", REVENUE_AI_MONTHLY_LIMIT_MICROS: "5000", REVENUE_AI_CYCLE_LIMIT_MICROS: "5000",
    REVENUE_AI_MAX_CALLS_PER_CYCLE: "100", REVENUE_AI_PROVIDER_RPM: "100", REVENUE_AI_PROVIDER_TPM: "1000000",
    REVENUE_AI_PROVIDER_CONCURRENCY: "100", REVENUE_AI_REVISION_RESERVE_PERCENT: "0", REVENUE_AI_BUDGET_CURRENCY: "USD" });
});

async function runFixture(id = "store-a", now = clock) {
  await prisma.merchant.create({ data: { id, name: id } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId: id, group: 0, nextDueAt: now } });
  const s = service();
  await s.request(id, now);
  const status = await s.status(id, now);
  return (await s.claim(status.run!.id, now))!;
}

async function price() {
  await prisma.aiPriceVersion.create({ data: { version: "fixture-price", provider: "fixture", model: "fixture",
    channel: "chat", component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1",
    inputMicrosPerMillion: 1_000_000n, outputMicrosPerMillion: 1_000_000n, effectiveFrom: at("2020-01-01Z") } });
}

test("cohort query separates pending buyers, deduplicates events and excludes other tenants/old sessions", { skip: !enabled }, async () => {
  const created = at("2026-09-01T00:00Z");
  const end = at("2026-09-03T00:00Z");
  await prisma.checkoutSession.createMany({ data: Array.from({ length: 32 }, (_, i) => ({ id: `s-${i}`, merchantId: "cohort",
    sessionId: `s-${i}`, globalUserId: `b-${i}`, conversationId: `c-${i}`, cart: {},
    createdAt: i === 31 ? at("2026-09-02T20:00Z") : created, updatedAt: created })) });
  await prisma.checkoutSession.createMany({ data: [
    { id: "old", merchantId: "cohort", sessionId: "old", globalUserId: "b-0", conversationId: "old", cart: {}, createdAt: at("2026-08-01Z"), updatedAt: created },
    { id: "foreign", merchantId: "other", sessionId: "s-0", globalUserId: "b-0", conversationId: "foreign", cart: {}, createdAt: created, updatedAt: created },
    { id: "boundary", merchantId: "cohort", sessionId: "boundary", globalUserId: "x", conversationId: "x", cart: {}, createdAt: end, updatedAt: end },
  ] });
  await prisma.checkoutEvent.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ merchantId: "cohort", sessionId: `s-${i}`,
    eventName: "checkout_started", occurredAt: created })).concat(Array.from({ length: 90 }, () => ({ merchantId: "cohort", sessionId: "s-0",
      eventName: "payment_failed", occurredAt: at("2026-09-01T01:00Z") }))) });
  for (const [sessionId, eventName] of [["s-0", "payment_method_selected"], ["s-1", "shipping_option_selected"],
    ["s-1", "shipping_objection_detected"], ["s-2", "payment_method_selected"]]) {
    await prisma.checkoutEvent.create({ data: { merchantId: "cohort", sessionId, eventName, occurredAt: created } });
  }
  await prisma.completedOrder.createMany({ data: [
    { id: "o1", merchantId: "cohort", sessionId: "s-0", completedAt: at("2026-09-01T02:00Z") },
    { id: "o2", merchantId: "cohort", sessionId: "s-0", completedAt: at("2026-09-01T03:00Z") },
    { id: "pending", merchantId: "cohort", sessionId: "s-31", completedAt: at("2026-09-02T21:00Z") },
    { id: "old-now", merchantId: "cohort", sessionId: "old", completedAt: at("2026-09-01T02:00Z") },
    { id: "prior", merchantId: "cohort", sessionId: "old", completedAt: at("2026-08-01T02:00Z") },
    { id: "other", merchantId: "other", sessionId: "s-0", completedAt: at("2026-09-01T02:00Z") },
    { id: "too-late", merchantId: "cohort", sessionId: "s-2", completedAt: at("2026-09-02T01:00Z") },
  ].map(o => ({ ...o, externalOrderId: o.id, currency: "BRL", orderTotal: 100 })) });
  const input = { merchant_id: "cohort", window_start: created, window_end: end };
  const result = await observe.execute(input);
  const snapshot = (await new PrismaObservationRepository(prisma).findById(result.observation_id, "cohort"))!.snapshot();
  assert.equal(snapshot.funnel.total_sessions, 32);
  assert.equal(snapshot.data_quality.mature_sessions, 31);
  assert.equal(snapshot.data_quality.pending_sessions, 1);
  assert.equal(snapshot.data_quality.provisional_converted_sessions, 1);
  assert.equal(snapshot.funnel.completed_order, 1);
  assert.equal(snapshot.funnel.conversion_rate, 1 / 31);
  assert.equal(snapshot.abandonment.abandonment_rate, 30 / 31);
  assert.equal(snapshot.objections.payment_count, 0); // Failed then paid, 90 duplicate failures.
  assert.equal(snapshot.abandonment.abandoned_at_payment, 1);
  assert.equal(snapshot.abandonment.abandoned_at_shipping, 1);
  assert.equal(snapshot.revenue.total_orders, 2);
  assert.equal(snapshot.revenue.total_revenue_cents, 20_000);
  assert.equal(snapshot.cohorts.returning_customers_rate, 1 / 32);
  assert.equal((await observe.execute(input)).observation_id, result.observation_id);
  assert.equal(await new PrismaObservationRepository(prisma).findById(result.observation_id, "other"), null);
});

test("700 shops are spread over seven nights, including shops beyond the first page", { skip: !enabled }, async () => {
  const s = service();
  await prisma.merchant.createMany({ data: Array.from({ length: 700 }, (_, i) => ({ id: `store-${String(i).padStart(4, "0")}`, name: "fixture" })) });
  await s.enroll(clock);
  assert.equal(await prisma.revenueAnalysisSchedule.count(), 700);
  const days = new Set((await prisma.revenueAnalysisSchedule.findMany()).map(s => s.nextDueAt.toISOString().slice(0, 10)));
  assert.equal(days.size, 7);
  const visited = new Set<string>();
  for (let day = 0; day < 7; day++) {
    const now = new Date(clock.getTime() + day * 86_400_000);
    const ids: string[] = [];
    await s.dispatch(async id => { ids.push(id); }, now);
    for (const id of ids) {
      const run = (await s.claim(id, now))!;
      assert.ok(run);
      assert.ok(!visited.has(run.merchantId));
      visited.add(run.merchantId);
      await s.complete(run, "insufficient_data", undefined, now);
      await s.request(run.merchantId, new Date(now.getTime() + 1_000));
    }
  }
  assert.equal(visited.size, 700);
  assert.equal(await prisma.revenueAnalysisRun.count(), 700);
  assert.equal(await prisma.merchantNotification.count(), 700);
});

test("concurrent claims, stale worker and restart preserve one weekly cycle", { skip: !enabled }, async () => {
  const first = await runFixture();
  const s = service();
  assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => s.claim(first.id, clock))), Array(10).fill(null));
  const later = new Date(clock.getTime() + LEASE_MS + 1);
  const recovered = (await s.claim(first.id, later))!;
  assert.equal(recovered.leaseToken, first.leaseToken + 1);
  assert.equal(recovered.asOf?.toISOString(), first.asOf?.toISOString());
  await assert.rejects(s.complete(first, "keep_current", undefined, later), /analysis_lease_lost/);
  await s.complete(recovered, "keep_current", undefined, later);
  await s.request(first.merchantId, new Date(later.getTime() + WEEK_MS - 1));
  assert.equal(await prisma.revenueAnalysisRun.count(), 1);
  const state = await s.status(first.merchantId, later);
  assert.ok(new Date(state.next_eligible_at!).getTime() >= later.getTime() + WEEK_MS);
  process.env.REVENUE_WEEKLY_ENABLED = "false";
  assert.equal(await s.owns(first.merchantId), true);
  assert.equal(await s.claim(first.id, later), null);
});

test("persisted cycles recover after enqueue fails and Redis delivers duplicates safely", { skip: !enabled }, async () => {
  const first = await runFixture();
  await prisma.revenueAnalysisRun.update({ where: { id: first.id }, data: { status: "queued", attempts: 0 } });
  const s = service();
  await assert.rejects(s.dispatch(async () => { throw new Error("enqueue down"); }, clock), /enqueue down/);
  const ids: string[] = [];
  await service().dispatch(async id => { ids.push(id); }, clock);
  assert.deepEqual(ids, [first.id]);
  const name = `revenue-test-${Date.now()}`;
  const connection = { host: "127.0.0.1", port: 6397, maxRetriesPerRequest: null };
  const queue = new Queue(name, { connection });
  let claimed = 0;
  const worker = new Worker(name, async job => { if (await s.claim(job.data.id, clock)) claimed++; }, { connection, concurrency: 2 });
  try {
    const done = new Promise<void>((resolve, reject) => {
      let completed = 0;
      const timer = setTimeout(() => reject(new Error("queue timeout")), 10_000);
      worker.on("completed", () => { if (++completed === 2) { clearTimeout(timer); resolve(); } });
    });
    await queue.add("analyze", { id: first.id });
    await queue.add("analyze", { id: first.id });
    await done;
    assert.equal(claimed, 1);
  } finally { await worker.close(); await queue.obliterate({ force: true }); await queue.close(); }
});

test("concurrent reservations cannot overspend; unknown attempts survive day/month rollover", { skip: !enabled }, async () => {
  const run = await runFixture();
  await price();
  const input = { merchantId: run.merchantId, context: { runId: run.id, leaseToken: run.leaseToken }, provider: "fixture", model: "fixture", inputBytes: 100 };
  const responses = await Promise.allSettled(Array.from({ length: 20 }, () => budget.reserve(input, clock)));
  const accepted = responses.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof budget.reserve>>> => r.status === "fulfilled").map(r => r.value);
  assert.equal(accepted.length, 2);
  await budget.settle(accepted[0], undefined, undefined, clock);
  const nextMonth = at("2030-10-01T06:00:00Z");
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { leaseUntil: at("2031-01-01Z") } });
  await assert.rejects(budget.reserve(input, nextMonth), /budget_exhausted/);
  await budget.settle(accepted[0], { prompt_tokens: 100, completion_tokens: 100 }, "fixture-call", nextMonth);
  await budget.settle(accepted[0], { prompt_tokens: 100, completion_tokens: 100 }, "fixture-call", nextMonth);
  assert.equal(await prisma.aiUsageEvent.count(), 1);
  assert.equal((await prisma.aiUsageEvent.findFirst())!.costMicros, 200n);
  assert.ok(await budget.reserve(input, nextMonth));
});

test("missing price, oversized context, provider capacity and foreign lease fail closed", { skip: !enabled }, async () => {
  const run = await runFixture();
  const input = { merchantId: run.merchantId, context: { runId: run.id, leaseToken: run.leaseToken }, provider: "fixture", model: "fixture", inputBytes: 100 };
  await assert.rejects(budget.reserve(input, clock), /pricing_required/);
  await price();
  await assert.rejects(budget.reserve({ ...input, merchantId: "foreign" }, clock), /analysis_lease_lost/);
  await assert.rejects(budget.reserve({ ...input, inputBytes: 1000 }, clock), /context_limit_exceeded/);
  process.env.REVENUE_AI_PROVIDER_CONCURRENCY = "1";
  await budget.reserve(input, clock);
  await assert.rejects(budget.reserve(input, clock), /provider_capacity/);
});

test("interactive reserve stays inside the global ceiling and overrun blocks further calls", { skip: !enabled }, async () => {
  const run = await runFixture();
  await price();
  process.env.REVENUE_AI_REVISION_RESERVE_PERCENT = "50";
  const input = { merchantId: run.merchantId, context: { runId: run.id, leaseToken: run.leaseToken }, provider: "fixture", model: "fixture", inputBytes: 100 };
  const first = await budget.reserve(input, clock);
  await assert.rejects(budget.reserve(input, clock), /budget_exhausted/);
  await budget.reserve({ ...input, workType: "revision" }, clock);
  await assert.rejects(budget.reserve({ ...input, workType: "revision" }, clock), /budget_exhausted/);
  await budget.settle(first, { prompt_tokens: 4000, completion_tokens: 1000 }, "overrun", clock);
  await assert.rejects(budget.reserve(input, clock), /cost_reconciliation_required/);
});

test("IANA scheduling handles daylight saving and preserves seven full days", () => {
  const now = at("2026-03-01T08:30:00Z");
  const due = nextNight(new Date(now.getTime() + WEEK_MS), "America/New_York");
  assert.ok(due.getTime() >= now.getTime() + WEEK_MS);
  assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(due), "03");
});

test("full worker cycle records insufficient data without generation and restarts idempotently", { skip: !enabled }, async () => {
  const run = await runFixture();
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { status: "queued", attempts: 0 } });
  const s = service();
  s.clock = () => clock;
  await s.process(run.id);
  await s.process(run.id);
  const state = await s.status(run.merchantId, clock);
  assert.equal(state.run?.status, "completed");
  assert.equal(state.run?.result, "insufficient_data");
  assert.equal(await prisma.revenueManagerObservation.count(), 1);
  assert.equal(await prisma.aiUsageEvent.count(), 0);
  assert.equal(await prisma.merchantNotification.count(), 1);
});

test("daily cycle cap, missing configuration and closed local window never dispatch new analysis", { skip: !enabled }, async () => {
  const first = await runFixture();
  process.env.REVENUE_ANALYSIS_DAILY_LIMIT = "1";
  const second = await runFixture("store-b");
  assert.equal(second, null);
  const s = service();
  assert.equal((await s.status("store-b", clock)).run?.reason, "daily_analysis_limit");
  const closed = at("2030-09-01T15:00:00Z");
  const ids: string[] = [];
  await s.dispatch(async id => { ids.push(id); }, closed);
  assert.deepEqual(ids, []);
  delete process.env.REVENUE_ANALYSIS_DAILY_LIMIT;
  await assert.rejects(s.claim(first.id, clock), /budget_configuration_required/);
});

test("production eligibility checks plan, operator pilot and merchant switch before enrollment", { skip: !enabled }, async () => {
  await prisma.merchant.create({ data: { id: "denied", name: "denied" } });
  let calls = 0;
  const s = new WeeklyAnalysisService(prisma, { getEffectivePlan: async () => { calls++; return "starter"; } } as never, observe, {} as never);
  process.env.REVENUE_WEEKLY_MERCHANT_IDS = "pilot-only";
  await s.enroll(clock);
  assert.equal(calls, 0);
  process.env.REVENUE_WEEKLY_MERCHANT_IDS = "*";
  await s.enroll(clock);
  assert.ok(calls > 0);
  assert.equal(await prisma.revenueAnalysisSchedule.count(), 0);
});
