import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { Queue, QueueEvents } from "bullmq";
import { WeeklyAnalysisJob, WEEKLY_ANALYSIS_QUEUE } from "../infrastructure/jobs/weekly-analysis.job.js";
import { WeeklyAnalysisService } from "../infrastructure/weekly-analysis.service.js";
import { StrategyReviewService } from "./strategy-review.service.js";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { PrismaHypothesisRepository } from "../infrastructure/prisma-hypothesis.repository.js";
import { PrismaObservationRepository } from "../infrastructure/prisma-observation.repository.js";
import { PrismaHypothesisMerchantContext } from "../infrastructure/hypothesis-merchant-context.adapter.js";
import { RevenueAiBudgetService } from "../infrastructure/revenue-ai-budget.service.js";
import { LLMHypothesisGenerator } from "../infrastructure/hypothesis-generator.adapter.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";

// Destructive setup is strictly restricted to this dedicated local fixture DB.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const env = { ...process.env };
const baseline = "Explique o checkout com os dados verificados do carrinho.";
const context = new PrismaHypothesisMerchantContext(prisma);
const billing = { getEffectivePlan: async () => "scale" };
const recommendation = (prompt = "Pergunte qual etapa precisa de ajuda.") => ({
  hypothesis_text: "Testar uma pergunta contextual para ajudar na etapa atual", reasoning: "Comparar com o controle usando as sessões observadas",
  expected_lift_percent: 1, template: { name: "Ajuda contextual", description: "Mudar a forma de explicar a etapa atual",
    variant_a: { name: "Controle", system_prompt: baseline, weight: 50, is_control: true },
    variant_b: { name: "Ajuda", system_prompt: baseline + "\n" + prompt, weight: 50, is_control: false } } });
const service = (generate: (request: HypothesisGenerationRequest) => Promise<any> = async () => recommendation("Explique os próximos passos."),
  currentPrompt: () => Promise<string | undefined> = async () => baseline) => new StrategyReviewService(prisma,
    { getRules: id => context.getRules(id), getCurrentPrompt: currentPrompt }, { generate }, billing as never);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; });
beforeEach(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_strategy_versions, revenue_strategy_actions, revenue_strategy_revisions,
    revenue_analysis_runs, revenue_analysis_schedules, revenue_ai_reservations, ai_usage_events, ai_price_versions,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, merchants CASCADE`);
  Object.assign(process.env, { REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*", REVENUE_STRATEGY_REVISIONS_ENABLED: "true",
    REVENUE_AI_MAX_REVISIONS_PER_CYCLE: "3", REVENUE_AI_MAX_INPUT_TOKENS: "20000", REVENUE_AI_MAX_OUTPUT_TOKENS: "1000",
    REVENUE_AI_DAILY_LIMIT_MICROS: "50000", REVENUE_AI_MONTHLY_LIMIT_MICROS: "50000", REVENUE_AI_CYCLE_LIMIT_MICROS: "50000",
    REVENUE_AI_MAX_CALLS_PER_CYCLE: "2", REVENUE_AI_PROVIDER_RPM: "100", REVENUE_AI_PROVIDER_TPM: "1000000",
    REVENUE_AI_PROVIDER_CONCURRENCY: "10", REVENUE_AI_REVISION_RESERVE_PERCENT: "50", REVENUE_AI_BUDGET_CURRENCY: "USD" });
});

async function fixture(merchantId = "store", options: { expired?: boolean; publish?: boolean } = {}) {
  const now = new Date();
  await prisma.merchant.create({ data: { id: merchantId, name: "Fixture" } });
  await prisma.merchantRule.create({ data: { merchantId, maxDiscountPercent: 5, minimumMarginPercent: 30,
    allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
    couponBoxEnabled: true, autonomousEngineEnabled: true, freeShippingMinCartValue: 200, maxShippingSubsidy: 0,
    maxPartialShippingDiscount: 0, offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative" } });
  const observation = ObservationEntity.create({ merchant_id: merchantId,
    observation_window_start: new Date(now.getTime() - 7 * 86_400_000), observation_window_end: now,
    funnel: { total_sessions: 100, started_checkout: 100, reached_shipping: 80, reached_payment: 40, completed_order: 20, conversion_rate: .2 },
    abandonment: { abandoned_at_shipping: 40, abandoned_at_payment: 20, abandonment_rate: .8, top_abandonment_objection: "unknown" },
    objections: { shipping_cost_count: 0, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 80 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { new_customers_rate: 1, returning_customers_rate: 0, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_orders: 20, total_revenue_cents: 20000, avg_order_value_cents: 1000 }, ai_costs_cents: 0 });
  await new PrismaObservationRepository(prisma).save(observation);
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId, cycle: 1, status: "running", leaseToken: 1,
    leaseUntil: new Date(now.getTime() + 600_000), observationId: observation.id,
    asOf: options.expired ? new Date(now.getTime() - 8 * 86_400_000) : now } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId, group: 0, nextDueAt: now, currentRunId: run.id } });
  const hypothesis = HypothesisEntity.create({ merchant_id: merchantId, observation_id: observation.id,
    ...recommendation(), risk_level: "low", approval_strategy: "manual" });
  const repo = new PrismaHypothesisRepository(prisma);
  if (options.publish !== false) {
    await repo.save(hypothesis, { runId: run.id, leaseToken: 1 });
    await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { status: "completed", hypothesisId: hypothesis.id } });
  }
  const version = options.publish === false ? null : await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: hypothesis.id } });
  return { merchantId, run, hypothesis, observation, repo, version, id: hypothesis.id,
    input: { version: 1, proposal_hash: version?.proposalHash ?? "", request_key: "request-1", feedback: "Prefiro uma explicação mais curta." } };
}

test("weekly publication persists immutable proposal, evidence and notification exactly once", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await Promise.all(Array.from({ length: 8 }, () => f.repo.save(f.hypothesis, { runId: f.run.id, leaseToken: 1 })));
  assert.equal(await prisma.revenueStrategy.count(), 1);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  assert.equal(await prisma.merchantNotification.count(), 1);
  const read = await service().read(f.merchantId, f.id);
  assert.equal(read.versions[0].proposalHash, digest(read.versions[0].proposal));
  assert.equal(read.approval_available, false);
  assert.equal(read.activation_available, false);
  await assert.rejects(prisma.revenueStrategyVersion.updateMany({ data: { proposalHash: "forged" } }), /IMMUTABLE/);
  await assert.rejects(prisma.revenueStrategyVersion.deleteMany(), /IMMUTABLE/);
  const notice = await prisma.merchantNotification.findFirstOrThrow();
  assert.equal((notice.metadata as any).strategyId, f.id);
});

test("foreign tenants cannot read, decide or link evidence to another store", { skip: !enabled }, async () => {
  const f = await fixture();
  await assert.rejects(service().read("foreign", f.id), /STRATEGY_NOT_FOUND/);
  await assert.rejects(service().decide("foreign", "actor", f.id, "reject", f.input), /STRATEGY_NOT_FOUND/);
  assert.deepEqual((await service().list("foreign")).items, []);
  await assert.rejects(prisma.revenueStrategyVersion.create({ data: { strategyId: f.id, merchantId: "foreign", version: 2,
    proposal: {}, proposalHash: "fake", expiresAt: new Date() } }), /Foreign key/);
  await assert.rejects(prisma.revenueStrategy.create({ data: { id: "cross-store-run", merchantId: "foreign", runId: f.run.id } }), /Foreign key/);
});

test("failed publication rolls back source hypothesis and notification with its version", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { autonomousEngineEnabled: false } });
  await assert.rejects(f.repo.save(f.hypothesis, { runId: f.run.id, leaseToken: 1 }), /ENGINE_DISABLED/);
  assert.equal(await prisma.revenueManagerHypothesis.count(), 0);
  assert.equal(await prisma.revenueStrategyVersion.count(), 0);
  assert.equal(await prisma.merchantNotification.count(), 0);
});

test("concurrent rejection retries persist one actor-bound receipt and cannot reuse a key with different content", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service();
  const results = await Promise.all(Array.from({ length: 12 }, () => s.decide("store", "owner", f.id, "reject", f.input)));
  assert.ok(results.every(r => digest(r) === digest(results[0])));
  assert.equal(await prisma.revenueStrategyAction.count(), 1);
  assert.equal((await prisma.revenueManagerHypothesis.findUniqueOrThrow({ where: { id: f.id } })).status, "rejected");
  await assert.rejects(s.decide("store", "other-actor", f.id, "reject", f.input), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(s.decide("store", "owner", f.id, "revision", f.input), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(s.decide("store", "owner", f.id, "reject", { ...f.input, feedback: "other" }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(prisma.revenueStrategyAction.updateMany({ data: { actorId: "forged" } }), /IMMUTABLE/);
  await assert.rejects(prisma.revenueStrategyAction.deleteMany(), /IMMUTABLE/);
  assert.equal(await prisma.promptExperiment.count(), 0);
});

test("rejection versus revision has one winning decision and no orphan task", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service();
  const result = await Promise.allSettled([s.decide("store", "owner", f.id, "reject", { ...f.input, request_key: "reject-1" }),
    s.decide("store", "owner", f.id, "revision", { ...f.input, request_key: "revise-1" })]);
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.revenueStrategyAction.count(), 1);
  const action = await prisma.revenueStrategyAction.findFirstOrThrow();
  assert.equal(await prisma.revenueStrategyRevision.count(), action.kind === "revision" ? 1 : 0);
});

test("approval checks the exact version and policy and refuses missing checkout/measurement artifacts", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service();
  await assert.rejects(s.decide("store", "owner", f.id, "approve", { ...f.input, version: 2 }), /VERSION_CONFLICT/);
  await assert.rejects(s.decide("store", "owner", f.id, "approve", { ...f.input, proposal_hash: "b".repeat(64) }), /PROPOSAL_CONFLICT/);
  await assert.rejects(s.decide("store", "owner", f.id, "approve", f.input), (e: any) => e.getResponse().code === "STRATEGY_APPROVAL_PREREQUISITES_REQUIRED");
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { minimumMarginPercent: 45 } });
  await assert.rejects(s.decide("store", "owner", f.id, "approve", f.input), /POLICY_CHANGED/);
  await assert.rejects(s.decide("store", "owner", f.id, "revision", f.input), /POLICY_CHANGED/);
  assert.equal(await prisma.revenueStrategyAction.count(), 0);
  assert.equal(await prisma.promptExperiment.count(), 0);
});

test("expired versions can be rejected but cannot be revised or approved", { skip: !enabled }, async () => {
  const f = await fixture("store", { expired: true });
  const s = service();
  await assert.rejects(s.decide("store", "owner", f.id, "approve", f.input), /PROPOSAL_EXPIRED/);
  await assert.rejects(s.decide("store", "owner", f.id, "revision", f.input), /PROPOSAL_EXPIRED/);
  await s.decide("store", "owner", f.id, "reject", f.input);
});

test("an expired strategy no longer suppresses the next weekly analysis; legacy pending decisions still do", { skip: !enabled }, async () => {
  const f = await fixture("store", { expired: true });
  const weekly = new WeeklyAnalysisService(prisma, {} as never, {} as never, {} as never);
  assert.equal(await weekly.pendingDecisions("store"), 0);
  await fixture("active-store");
  assert.equal(await weekly.pendingDecisions("active-store"), 1);
  assert.equal(await weekly.pendingDecisions("foreign"), 0);
  const legacy = HypothesisEntity.create({ merchant_id: "store", observation_id: f.observation.id, ...recommendation(),
    risk_level: "low", approval_strategy: "manual" });
  await f.repo.save(legacy);
  assert.equal(await weekly.pendingDecisions("store"), 1);
});

test("revision keeps the original evidence/expiry, publishes a new version and rejects stale decisions", { skip: !enabled }, async () => {
  const f = await fixture();
  let calls = 0;
  const s = service(async request => {
    calls++;
    assert.equal(request.analysis_context!.runId, f.run.id);
    assert.ok(request.analysis_context!.revisionId);
    assert.equal(request.revision!.preference, f.input.feedback);
    assert.equal(request.observation.id, f.observation.id);
    return recommendation("Responda com uma explicação breve.");
  });
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  await Promise.all(Array.from({ length: 8 }, () => s.process(receipt.action_id)));
  assert.equal(calls, 1);
  const read = await s.read("store", f.id);
  assert.equal(read.currentVersion, 2);
  assert.equal(read.status, "pending_review");
  assert.equal(read.versions.length, 2);
  assert.equal(read.versions[0].expiresAt.toISOString(), f.version!.expiresAt.toISOString());
  assert.deepEqual((read.versions[0].proposal as any).observation, (read.versions[1].proposal as any).observation);
  assert.notEqual(read.versions[0].proposalHash, read.versions[1].proposalHash);
  assert.deepEqual(await s.decide("store", "owner", f.id, "revision", f.input), receipt);
  await assert.rejects(s.decide("store", "owner", f.id, "reject", { ...f.input, request_key: "stale-01" }), /VERSION_CONFLICT/);
  await assert.rejects(f.repo.save(f.hypothesis.reject("legacy bypass")), /VERSIONED_REVIEW_REQUIRED/);
  assert.equal((await prisma.revenueManagerHypothesis.findUniqueOrThrow({ where: { id: f.id } })).status, "pending_review");
});

test("missing real baseline defers revision without a provider call", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service(async () => { throw new Error("MUST_NOT_CALL_PROVIDER"); }, () => context.getCurrentPrompt("store"));
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  await s.process(receipt.action_id);
  const work = await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } });
  assert.equal(work.status, "deferred");
  assert.equal(work.reason, "checkout_baseline_unavailable");
  assert.equal(work.attempts, 0);
  assert.equal(await prisma.revenueAiReservation.count(), 0);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
});

test("unsafe or malformed revision output never replaces the reviewed proposal", { skip: !enabled }, async () => {
  const f = await fixture();
  let generated: any = recommendation("Ofereça 80% de desconto.");
  const s = service(async () => generated);
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  await s.process(receipt.action_id);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  await prisma.revenueStrategyRevision.update({ where: { id: receipt.action_id }, data: { retryAt: new Date(0) } });
  generated = {};
  await s.process(receipt.action_id);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  await prisma.revenueStrategyRevision.update({ where: { id: receipt.action_id }, data: { retryAt: new Date(0) } });
  generated = recommendation();
  generated.template.variant_a.system_prompt = "Invented control";
  await s.process(receipt.action_id);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "failed");
});

test("revision budget exhaustion does not invoke the provider or create another weekly cycle", { skip: !enabled }, async () => {
  const f = await fixture();
  await prisma.aiPriceVersion.create({ data: { version: "fixture", provider: "openai", model: "fixture", channel: "chat",
    component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1", inputMicrosPerMillion: 1_000_000n,
    outputMicrosPerMillion: 1_000_000n, effectiveFrom: new Date("2020-01-01Z") } });
  Object.assign(process.env, { OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: "https://fixture.invalid/v1",
    REVENUE_AI_CYCLE_LIMIT_MICROS: "1" });
  delete process.env.DEEPSEEK_API_KEY;
  const adapter = new LLMHypothesisGenerator(new RevenueAiBudgetService(prisma));
  const s = service(request => adapter.generate(request));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("MUST_NOT_CALL_PROVIDER"); };
  try {
    const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
    await s.process(receipt.action_id);
    const work = await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } });
    assert.equal(work.reason, "budget_exhausted");
    assert.equal(work.status, "deferred");
    assert.equal(calls, 0);
    assert.equal(await prisma.revenueAiReservation.count(), 0);
    assert.equal(await prisma.revenueAnalysisRun.count(), 1);
    assert.equal((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } })).status, "completed");
  } finally { globalThis.fetch = originalFetch; }
});

test("policy changed while generating prevents publication and preserves reviewed evidence", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service(async () => {
    await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { maxDiscountPercent: 0 } });
    return recommendation();
  });
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  await s.process(receipt.action_id);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "failed");
  assert.equal((await s.read("store", f.id)).status, "pending_review");
});

test("restart discovers durable tasks; a worker with a stale lease cannot publish", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service(async request => {
    await prisma.revenueStrategyRevision.update({ where: { id: request.analysis_context!.revisionId }, data: { leaseToken: { increment: 1 } } });
    return recommendation();
  });
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  const discovered: string[] = [];
  await service().dispatch(async id => { discovered.push(id); });
  assert.deepEqual(discovered, [receipt.action_id]);
  await s.process(receipt.action_id);
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "running");
});

test("revision limits and disabled generation refuse new tasks without side effects", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service();
  process.env.REVENUE_STRATEGY_REVISIONS_ENABLED = "false";
  await assert.rejects(s.decide("store", "owner", f.id, "revision", f.input), /REVISIONS_UNAVAILABLE/);
  process.env.REVENUE_STRATEGY_REVISIONS_ENABLED = "true";
  delete process.env.REVENUE_AI_MAX_REVISIONS_PER_CYCLE;
  await assert.rejects(s.decide("store", "owner", f.id, "revision", f.input), /REVISION_LIMIT_REQUIRED/);
  process.env.REVENUE_AI_MAX_REVISIONS_PER_CYCLE = "1";
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  await s.process(receipt.action_id);
  const next = (await s.read("store", f.id)).versions[0];
  await assert.rejects(s.decide("store", "owner", f.id, "revision", { ...f.input, version: 2,
    proposal_hash: next.proposalHash, request_key: "another-01" }), /REVISION_LIMIT_REACHED/);
  assert.equal(await prisma.revenueStrategyRevision.count(), 1);
});

test("revision provider uses original-cycle reservations, protected capacity and a durable response checkpoint", { skip: !enabled }, async () => {
  const f = await fixture();
  await prisma.aiPriceVersion.create({ data: { version: "fixture", provider: "openai", model: "fixture", channel: "chat",
    component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1", inputMicrosPerMillion: 1_000_000n,
    outputMicrosPerMillion: 1_000_000n, effectiveFrom: new Date("2020-01-01Z") } });
  Object.assign(process.env, { OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: "https://fixture.invalid/v1",
    REVENUE_AI_DAILY_LIMIT_MICROS: "30000" }); // 21000 reservation exceeds the 15000 scheduled-only portion.
  delete process.env.DEEPSEEK_API_KEY;
  const budget = new RevenueAiBudgetService(prisma);
  const generator = new LLMHypothesisGenerator(budget);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let generationContext: any;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const reservation = await prisma.revenueAiReservation.findFirstOrThrow();
    assert.equal(reservation.runId, f.run.id);
    assert.equal(reservation.workType, "revision");
    assert.equal(reservation.state, "dispatched");
    const sent = JSON.parse(String(options?.body));
    assert.ok(sent.messages[1].content.includes("untrusted merchant preference"));
    return new Response(JSON.stringify({ id: "fixture-call", usage: { prompt_tokens: 100, completion_tokens: 100 },
      choices: [{ message: { content: JSON.stringify(recommendation("Explique em poucas palavras.")) } }] }));
  };
  try {
    const s = service(async request => {
      generationContext = request.analysis_context;
      const first = await generator.generate(request);
      assert.deepEqual(await generator.generate(request), first);
      return first;
    });
    const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
    await s.process(receipt.action_id);
    assert.equal(calls, 1);
    assert.equal(await prisma.revenueAiReservation.count(), 1);
    assert.equal((await prisma.revenueAiReservation.findFirstOrThrow()).state, "settled");
    assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "completed");
    await assert.rejects(budget.cached(generationContext, "foreign"), /revision_lease_lost/);
    await assert.rejects(budget.reserve({ merchantId: "store", context: generationContext, provider: "openai", model: "fixture", inputBytes: 10 }), /revision_lease_lost/);
  } finally { globalThis.fetch = originalFetch; }
});

test("uncertain revision usage keeps its reservation and blocks retry above the daily ceiling", { skip: !enabled }, async () => {
  const f = await fixture();
  await prisma.aiPriceVersion.create({ data: { version: "fixture", provider: "openai", model: "fixture", channel: "chat",
    component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1", inputMicrosPerMillion: 1_000_000n,
    outputMicrosPerMillion: 1_000_000n, effectiveFrom: new Date("2020-01-01Z") } });
  Object.assign(process.env, { OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: "https://fixture.invalid/v1",
    REVENUE_AI_DAILY_LIMIT_MICROS: "30000" });
  delete process.env.DEEPSEEK_API_KEY;
  const adapter = new LLMHypothesisGenerator(new RevenueAiBudgetService(prisma));
  const s = service(request => adapter.generate(request));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("synthetic timeout after dispatch"); };
  try {
    const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
    await s.process(receipt.action_id);
    const reservation = await prisma.revenueAiReservation.findFirstOrThrow();
    assert.equal(reservation.state, "unknown");
    assert.equal(reservation.amountMicros, 21000n);
    await prisma.revenueStrategyRevision.update({ where: { id: receipt.action_id }, data: { retryAt: new Date(0) } });
    await s.process(receipt.action_id);
    assert.equal(calls, 1);
    assert.equal(await prisma.revenueAiReservation.count(), 1);
    assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).reason, "budget_exhausted");
    assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("the actual weekly job recovers a durable revision and executes it through local Redis", { skip: !enabled }, async () => {
  const f = await fixture();
  const s = service();
  const receipt: any = await s.decide("store", "owner", f.id, "revision", f.input);
  // DB 15 and this queue name are reserved for this suite in the dedicated fixture container.
  const connection = { host: "127.0.0.1", port: 6397, db: 15 };
  const queue = new Queue(WEEKLY_ANALYSIS_QUEUE, { connection });
  const events = new QueueEvents(WEEKLY_ANALYSIS_QUEUE, { connection });
  const job = new WeeklyAnalysisJob({ dispatch: async () => 0 } as never, s);
  const previousRedis = process.env.REDIS_URL;
  const previousEnabled = process.env.REDIS_ENABLED;
  process.env.REDIS_URL = "redis://127.0.0.1:6397/15";
  process.env.REDIS_ENABLED = "true";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await events.waitUntilReady();
    const completed = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("revision fixture queue deadline")), 20_000);
      events.on("completed", ({ jobId }) => { if (jobId === `revision-${receipt.action_id}`) resolve(); });
    });
    await job.onModuleInit();
    await completed;
    assert.equal((await s.read("store", f.id)).currentVersion, 2);
    assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "completed");
  } finally {
    clearTimeout(timer);
    await job.onModuleDestroy();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    if (previousRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedis;
    if (previousEnabled === undefined) delete process.env.REDIS_ENABLED; else process.env.REDIS_ENABLED = previousEnabled;
  }
});
