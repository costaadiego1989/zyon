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
import { GenerateHypothesisUseCase } from "./use-cases/generate-hypothesis.use-case.js";
import { checkoutBaselineReference, renderCheckoutChatBaseline, type CheckoutChatBaseline } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { ChatLlmGatewayService } from "../../checkout/application/services/chat-llm-gateway.service.js";
import { readCheckoutBaseline, lockCheckoutBaselineRows } from "../infrastructure/checkout-baseline.reader.js";
import { prepareStrategyMeasurement } from "../infrastructure/strategy-measurement-planning.js";
import { MeasurementBaselineUnavailable, type StrategyExperimentReview } from "../domain/strategy-measurement.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { StrategyExecutionLedger } from "../infrastructure/strategy-execution-ledger.js";
import { StrategyMetricsService } from "./strategy-metrics.service.js";
import { ExperimentMeasurementService } from "../../experiments/application/experiment-measurement.service.js";
import { DiscountRuleHypothesisService } from "../domain/services/discount-rule-hypothesis.service.js";
import { loadDiscountCohorts } from "../infrastructure/discount-cohort.reader.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";

// Destructive setup is strictly restricted to this dedicated local fixture DB.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } },
  transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
const env = { ...process.env };
const baseline = "Explique o checkout com os dados verificados do carrinho.";
const context = new PrismaHypothesisMerchantContext(prisma);
const billing = { getEffectivePlan: async () => "scale" };

async function configureRealBaseline(merchantId = "store") {
  Object.assign(process.env, { REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40),
    CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", OPENAI_MODEL: "fixture-model" });
  delete process.env.LOCAL_LLM_BASE_URL; delete process.env.OLLAMA_BASE_URL;
  await prisma.checkoutSetting.create({ data: { merchantId, mode: "conversational", widgetBehavior: {}, triggerRules: {},
    suppressionRules: {}, handoff: {}, interventionPolicy: {}, advancedRules: [{ enabled: true, priority: 1,
      conditions: [{ field: "cart_total", operator: "gt", value: 0 }], action: { type: "show_message", params: { message: "Explique os dados verificados." } } }] } });
  return (await context.getCheckoutBaseline(merchantId))!;
}

function recipeResponse(request: HypothesisGenerationRequest) {
  const response = recommendation();
  response.template.variant_a.system_prompt = request.current_prompt;
  response.template.variant_b.system_prompt = "Pergunte qual etapa precisa de explicação e use somente dados verificados.";
  return response;
}

function realGeneration(generate = async (request: HypothesisGenerationRequest) => recipeResponse(request)) {
  return new GenerateHypothesisUseCase(new PrismaObservationRepository(prisma), new PrismaHypothesisRepository(prisma),
    { findByMerchant: async () => { throw new Error("LEGACY_LESSONS_MUST_NOT_LOAD"); } } as never, { generate }, context);
}
const recommendation = (prompt = "Pergunte qual etapa precisa de ajuda.") => ({
  hypothesis_text: "Testar uma pergunta contextual para ajudar na etapa atual", reasoning: "Comparar com o controle usando as sessões observadas",
  expected_lift_percent: 1, template: { name: "Ajuda contextual", description: "Mudar a forma de explicar a etapa atual",
    variant_a: { name: "Controle", system_prompt: baseline, weight: 50, is_control: true },
    variant_b: { name: "Ajuda", system_prompt: baseline + "\n" + prompt, weight: 50, is_control: false } } });
const service = (generate: (request: HypothesisGenerationRequest) => Promise<any> = async () => recommendation("Explique os próximos passos."),
  currentPrompt: () => Promise<string | undefined> = async () => baseline) => new StrategyReviewService(prisma,
    { getRules: id => context.getRules(id), getCurrentPrompt: currentPrompt }, { generate }, billing as never);

function discountDraft(f: { merchantId: string; observation: { id: string } }) {
  const candidate = new DiscountRuleHypothesisService().generate([{ intent: "price_sensitive", sampleSize: 30,
    conversionRate: .05, carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL",
      items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }],
    { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 10, minimumMarginPercent: 30 })!;
  return HypothesisEntity.create({ merchant_id: f.merchantId, observation_id: f.observation.id,
    ...recommendation(), hypothesis_text: candidate.rationale, expected_lift_percent: 0, risk_level: "medium",
    approval_strategy: "manual", hypothesis_type: "discount_rule", discount_rule_json: candidate.rule,
    discount_simulation: candidate.simulation });
}

test("discount simulation persists once across replicas and exposes the same frozen report", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  const drafts = Array.from({ length: 6 }, () => discountDraft(f));
  await Promise.all(drafts.map(draft => new PrismaHypothesisRepository(prisma).save(draft)));
  const stored = await f.repo.findByObservation(f.observation.id);
  assert.equal(stored.length, 1); assert.equal(stored[0].status, "pending_review");
  assert.deepEqual(stored[0].snapshot().discount_simulation, drafts[0].snapshot().discount_simulation);
  assert.equal(await prisma.merchantNotification.count({ where: { merchantId: "store" } }), 1);
  assert.equal(await prisma.revenueStrategy.count(), 0);
  assert.equal(await prisma.promptExperiment.count(), 0);
});

test("discount simulation dedup is isolated by merchant and observation and survives rejection", { skip: !enabled }, async () => {
  const a = await fixture("store", { publish: false }), b = await fixture("other", { publish: false });
  await a.repo.save(discountDraft(a)); await b.repo.save(discountDraft(b));
  const [saved] = await a.repo.findByObservation(a.observation.id);
  await a.repo.save(saved.reject("Prefiro aguardar")); await a.repo.save(discountDraft(a));
  assert.equal((await a.repo.findByObservation(a.observation.id)).length, 1);
  assert.equal((await a.repo.findByObservation(a.observation.id))[0].status, "rejected");
  const { id: _, ...observation } = await prisma.revenueManagerObservation.findUniqueOrThrow({ where: { id: a.observation.id } });
  const next = await prisma.revenueManagerObservation.create({ data: { ...observation, fingerprint: "next-observation" } });
  await a.repo.save(discountDraft({ merchantId: "store", observation: next }));
  assert.equal(await prisma.revenueManagerHypothesis.count(), 3);
  assert.equal(await prisma.merchantNotification.count({ where: { merchantId: "store", read: false } }), 1);
  assert.equal(await b.repo.findById(saved.id, "other"), null);
});

test("discount simulation report and suggestion roll back when notification persistence fails", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  const broken = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (fn: any) => target.$transaction(tx => fn(new Proxy(tx, { get(inner, field) {
      if (field === "merchantNotification") return { upsert: async () => { throw new Error("notice unavailable"); } };
      return Reflect.get(inner, field);
    } })));
  } });
  const draft = discountDraft(f);
  await assert.rejects(new PrismaHypothesisRepository(broken).save(draft), /notice unavailable/);
  assert.equal(await prisma.revenueManagerHypothesis.count(), 0);
  assert.equal(await prisma.merchantNotification.count(), 0);
  await f.repo.save(draft);
  assert.equal(await prisma.revenueManagerHypothesis.count(), 1);
});

test("discount simulation reader uses mature buyers, consent, paid windows and tenant catalog in PostgreSQL", { skip: !enabled }, async () => {
  await fixture("store", { publish: false }); await fixture("other", { publish: false });
  await prisma.$executeRawUnsafe("TRUNCATE customer_intent_records, buyer_intent_memory_consents");
  const now = new Date("2026-09-29T00:00:00Z"), createdAt = new Date("2026-09-20T00:00:00Z");
  const variants: string[] = [];
  for (const [merchantId, costInCents] of [["store", 4000], ["other", 0], ["store", null]] as const) {
    const product = await prisma.product.create({ data: { merchantId, name: "Produto" } });
    const v = await prisma.productVariant.create({ data: { productId: product.id, sku: `sku-${variants.length}` } });
    await prisma.productPrice.create({ data: { variantId: v.id, basePriceInCents: 10000, costInCents, currency: "BRL" } });
    variants.push(v.id);
  }
  for (let i = 0; i < 35; i++) {
    const buyer = `simulation-buyer-${i}`;
    await prisma.buyerIntentMemoryConsent.create({ data: { merchantId: "store", globalUserId: buyer,
      optedIn: i !== 31, expiresAt: new Date(i === 34 ? "2026-09-28" : "2026-10-30") } });
    await prisma.customerIntentRecord.create({ data: { merchantId: "store", globalUserId: buyer,
      primaryIntent: "price_sensitive", urgency: "low", budgetTier: "standard", categoryFocus: [], painPoints: [],
      conversionLikelihoodPct: 5, behavioralSignalsJson: {}, generatedAt: new Date("2026-09-19") } });
    await prisma.checkoutSession.create({ data: { id: `simulation-${i}`, merchantId: "store", sessionId: `simulation-${i}`,
      globalUserId: buyer, conversationId: `simulation-${i}`, cohort: "treatment",
      createdAt: i === 30 ? new Date("2026-09-25") : createdAt, updatedAt: createdAt,
      cart: { currency: "BRL", total: 999, items: [{ variantId: variants[i === 32 ? 1 : i === 33 ? 2 : 0],
        price: 999, cost: 0, quantity: 1 }] } } });
  }
  await prisma.checkoutSession.create({ data: { id: "simulation-repeat", merchantId: "store", sessionId: "simulation-repeat",
    globalUserId: "simulation-buyer-0", conversationId: "repeat", createdAt: new Date(createdAt.getTime() + 1000), updatedAt: createdAt,
    cart: { currency: "BRL", items: [{ variantId: variants[0], quantity: 1 }] } } });
  for (let i = 0; i < 3; i++) await prisma.completedOrder.create({ data: { merchantId: "store", sessionId: `simulation-${i}`,
    externalOrderId: `simulation-order-${i}`, currency: "BRL", orderTotal: 100, status: i === 1 ? "pending" : "approved",
    completedAt: i === 2 ? new Date("2026-09-27") : new Date("2026-09-21") } });
  const stats = await prisma.$transaction(tx => loadDiscountCohorts(tx, "store", now, 30), { isolationLevel: "RepeatableRead" });
  assert.equal(stats.length, 1); assert.equal(stats[0].sampleSize, 30); assert.equal(stats[0].conversionRate, 1 / 30);
  assert.ok(stats[0].carts.every(cart => cart.total === 100 && cart.items[0].cost === 40));
  assert.ok(new DiscountRuleHypothesisService().generate(stats, { ...DEFAULT_MERCHANT_RULES,
    autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 35 }));
});
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_strategy_versions, revenue_strategy_actions, revenue_strategy_revisions,
    revenue_analysis_runs, revenue_analysis_schedules, revenue_ai_reservations, ai_usage_events, ai_price_versions,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, checkout_settings, merchants CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE checkout_sessions, completed_orders, prompt_experiments CASCADE`);
  Object.assign(process.env, { REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*", REVENUE_STRATEGY_REVISIONS_ENABLED: "true",
    REVENUE_AI_MAX_REVISIONS_PER_CYCLE: "3", REVENUE_AI_MAX_INPUT_TOKENS: "20000", REVENUE_AI_MAX_OUTPUT_TOKENS: "1000",
    REVENUE_AI_DAILY_LIMIT_MICROS: "50000", REVENUE_AI_MONTHLY_LIMIT_MICROS: "50000", REVENUE_AI_CYCLE_LIMIT_MICROS: "50000",
    REVENUE_AI_MAX_CALLS_PER_CYCLE: "2", REVENUE_AI_PROVIDER_RPM: "100", REVENUE_AI_PROVIDER_TPM: "1000000",
    REVENUE_AI_PROVIDER_CONCURRENCY: "10", REVENUE_AI_REVISION_RESERVE_PERCENT: "50", REVENUE_AI_BUDGET_CURRENCY: "USD" });
});

async function configureMeasurement(f: Awaited<ReturnType<typeof fixture>>, sessions = 1000) {
  Object.assign(process.env, { REVENUE_STRATEGY_MEASUREMENT_ENABLED: "true", REVENUE_EXPERIMENT_DURATION_DAYS: "7",
    REVENUE_EXPERIMENT_CONVERSION_WINDOW_HOURS: "24", REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS: "500" });
  const createdAt = new Date(f.run.asOf!.getTime() - 7 * 86_400_000);
  await prisma.checkoutSession.createMany({ data: Array.from({ length: sessions }, (_, i) => ({
    id: `history-${f.merchantId}-${i}`, merchantId: f.merchantId, sessionId: `history-${i}`, globalUserId: `buyer-${i}`,
    conversationId: `history-${i}`, cart: { currency: "BRL" }, cohort: "treatment", createdAt, updatedAt: createdAt,
  })) });
  await prisma.completedOrder.createMany({ data: Array.from({ length: Math.floor(sessions / 10) }, (_, i) => ({
    id: `history-order-${f.merchantId}-${i}`, merchantId: f.merchantId, sessionId: `history-${i}`,
    externalOrderId: `history-order-${i}`, currency: "BRL", orderTotal: 100, completedAt: new Date(createdAt.getTime() + 1000),
  })) });
}

async function measuredProposal() {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  await configureMeasurement(f);
  const output = await realGeneration().execute({ merchant_id: "store", observation_id: f.observation.id,
    analysis_context: { runId: f.run.id, leaseToken: 1 } });
  const s = new StrategyReviewService(prisma, context, { generate: async request => recipeResponse(request) }, billing as never);
  const read = await s.read("store", output.hypothesis_id);
  const review = (read.versions[0].proposal as any).experimentReview as StrategyExperimentReview;
  return { f, s, read, review, id: output.hypothesis_id, input: { ...f.input, proposal_hash: read.versions[0].proposalHash } };
}

async function approvableProposal() {
  const f = await measuredProposal();
  Object.assign(process.env, { REVENUE_STRATEGY_APPROVAL_ENABLED: "true", REVENUE_STRATEGY_EXECUTION_ENABLED: "true",
    REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS: "store", REVENUE_STRATEGY_MAIN_CHAT_ENABLED: "true",
    REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED: "true", REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED: "true",
    REVENUE_STRATEGY_MONITOR_ENABLED: "true", CHECKOUT_CHAT_REQUESTS_ENABLED: "true", CHECKOUT_CHAT_REQUEST_MERCHANT_IDS: "store",
    CHECKOUT_CHAT_RECOVERY_ENABLED: "true", CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS: "store",
    CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED: "true", CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED: "true",
    REVENUE_STRATEGY_AI_EXECUTION_LIMIT_MICROS: "50000", REVENUE_STRATEGY_AI_SESSION_MAX_CALLS: "10",
    REDIS_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:6397/15" }); // Configuration only; no queue/provider I/O in approval.
  await prisma.aiPriceVersion.create({ data: { version: "approval-price", provider: "openai", model: "fixture-model",
    channel: "chat", component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1",
    inputMicrosPerMillion: 1000, outputMicrosPerMillion: 2000, effectiveFrom: new Date("2020-01-01T00:00:00Z") } });
  await prisma.revenueAnalysisRun.update({ where: { id: f.f.run.id }, data: { status: "completed" } });
  return f;
}

test("human approval starts the exact reviewed experiment, notification, enrollment and metrics atomically", { skip: !enabled }, async () => {
  const f = await approvableProposal();
  const ready = await f.s.read("store", f.id);
  assert.equal(ready.approval_available, true); assert.deepEqual(ready.activation_blockers, []);
  const receipt = await f.s.decide("store", "owner", f.id, "approve", f.input) as any;
  assert.equal(receipt.status, "active"); assert.equal(receipt.proposal_hash, f.input.proposal_hash);
  assert.equal((await f.s.read("store", f.id)).status, "active");
  assert.equal((await prisma.experimentMeasurementPlan.findUniqueOrThrow({ where: { experimentId: receipt.experiment_id } })).planHash, f.review.planHash);
  assert.equal((await prisma.promptVariant.findFirstOrThrow({ where: { experimentId: receipt.experiment_id, isControl: true } })).systemPrompt,
    f.review.variants[0].systemPrompt);
  assert.equal(await prisma.merchantNotification.count({ where: { id: `strategy-activation:${receipt.action_id}`, read: false } }), 1);
  assert.equal((await prisma.revenueManagerHypothesis.findUniqueOrThrow({ where: { id: f.id } })).createdExperimentId, receipt.experiment_id);
  const sessions = new PrismaCheckoutRepository(prisma);
  const stamp = new Date().toISOString();
  await sessions.createSessionIfAbsent({ merchantId: "store", sessionId: "after-approval", globalUserId: "new-buyer",
    conversationId: "new-conversation", cohort: "treatment", cart: { currency: "BRL", total: 100, items: [] },
    chatHistory: [], abandonmentScore: 0, triggerAgent: false, createdAt: stamp, updatedAt: stamp });
  assert.equal(await prisma.strategyAssignment.count({ where: { executionId: receipt.execution_id } }), 1);
  assert.equal(await prisma.strategyAssignment.count({ where: { sessionId: { startsWith: "history-" } } }), 0);
  const metrics = await new StrategyMetricsService(prisma, new ExperimentMeasurementService(prisma)).read("store", f.id, 1, true);
  assert.equal(metrics.execution?.id, receipt.execution_id); assert.ok(metrics.measurement);
  assert.equal(await prisma.revenueAiReservation.count(), 0);
});

test("human approval retry keeps one receipt and never restarts after flags change or a stop", { skip: !enabled }, async () => {
  const f = await approvableProposal();
  const replies = await Promise.all(Array.from({ length: 4 }, () => f.s.decide("store", "owner", f.id, "approve", f.input)));
  assert.equal(new Set(replies.map(digest)).size, 1);
  const first = replies[0] as any;
  await new StrategyExecutionLedger(prisma).stop({ merchantId: "store", executionId: first.execution_id, actorId: "owner", kind: "stopped", requestKey: "stop" });
  process.env.REVENUE_STRATEGY_APPROVAL_ENABLED = "false";
  assert.deepEqual(await f.s.decide("store", "owner", f.id, "approve", f.input), first);
  assert.equal((await prisma.strategyExecution.findUniqueOrThrow({ where: { id: first.execution_id } })).status, "stopped");
  assert.equal(await prisma.promptExperiment.count(), 1); assert.equal(await prisma.revenueStrategyAction.count(), 1);
  assert.equal(await prisma.merchantNotification.count({ where: { id: { startsWith: "strategy-activation:" } } }), 1);
  await assert.rejects(f.s.decide("store", "other-actor", f.id, "approve", f.input), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.s.decide("store", "owner", f.id, "reject", f.input), /IDEMPOTENCY_CONFLICT/);
});

for (const [setting, value] of [
  ["REVENUE_STRATEGY_APPROVAL_ENABLED", "false"], ["REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS", "*"],
  ["REVENUE_STRATEGY_MAIN_CHAT_ENABLED", "false"], ["REVENUE_STRATEGY_MONITOR_ENABLED", "false"],
  ["CHECKOUT_CHAT_REQUEST_MERCHANT_IDS", "*"], ["CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED", "false"],
  ["CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED", "false"], ["REVENUE_AI_DAILY_LIMIT_MICROS", ""],
  ["REVENUE_AI_REVISION_RESERVE_PERCENT", "100"], ["REVENUE_EXPERIMENT_DURATION_DAYS", "14"],
  ["REDIS_ENABLED", "false"], ["REDIS_URL", ""],
] as const) test(`human approval refuses unavailable ${setting} without any activation writes`, { skip: !enabled }, async () => {
  const f = await approvableProposal(); process.env[setting] = value;
  assert.equal((await f.s.read("store", f.id)).approval_available, false);
  await assert.rejects(f.s.decide("store", "owner", f.id, "approve", f.input), (e: any) => e.getResponse().code === "STRATEGY_APPROVAL_PREREQUISITES_REQUIRED");
  assert.equal(await prisma.revenueStrategyAction.count(), 0); assert.equal(await prisma.promptExperiment.count(), 0);
});

test("human approval rejects absent pricing, changed baseline, unfinished analysis and ineligible plan", { skip: !enabled }, async () => {
  const f = await approvableProposal();
  await prisma.aiPriceVersion.deleteMany();
  assert.ok((await f.s.read("store", f.id)).activation_blockers.includes("ai_pricing_required"));
  await prisma.merchant.update({ where: { id: "store" }, data: { name: "Changed" } });
  await prisma.revenueAnalysisRun.update({ where: { id: f.f.run.id }, data: { status: "running" } });
  const denied = new StrategyReviewService(prisma, context, {} as never, { getEffectivePlan: async () => "starter" } as never);
  const read = await denied.read("store", f.id);
  for (const reason of ["checkout_baseline_changed", "weekly_analysis_required", "merchant_ineligible"]) assert.ok(read.activation_blockers.includes(reason));
  await assert.rejects(denied.decide("store", "owner", f.id, "approve", f.input));
  assert.equal(await prisma.strategyExecution.count(), 0); assert.equal(await prisma.revenueStrategyAction.count(), 0);
});

for (const competing of ["reject", "revision"] as const) test(`human approval versus ${competing} has one winner and no orphan execution`, { skip: !enabled }, async () => {
  const f = await approvableProposal();
  const responses = await Promise.allSettled([
    f.s.decide("store", "owner", f.id, "approve", f.input),
    f.s.decide("store", "owner", f.id, competing, { ...f.input, request_key: "other-decision" }),
  ]);
  assert.equal(responses.filter(r => r.status === "fulfilled").length, 1);
  const action = await prisma.revenueStrategyAction.findFirstOrThrow();
  assert.equal(await prisma.strategyExecution.count(), action.kind === "approve" ? 1 : 0);
  assert.equal(await prisma.revenueStrategyRevision.count(), action.kind === "revision" ? 1 : 0);
});

test("human approval notification failure rolls back receipt experiment and strategy, allowing safe retry", { skip: !enabled }, async () => {
  const f = await approvableProposal();
  const broken = new Proxy(prisma, { get(target, key) {
    if (key === "$transaction") return (work: (tx: any) => Promise<unknown>) => target.$transaction(tx => work(new Proxy(tx, {
      get(inner, name) {
        if (name === "merchantNotification") return { ...inner.merchantNotification, create: async () => { throw new Error("NOTICE_FAILED"); } };
        const v = Reflect.get(inner, name); return typeof v === "function" ? v.bind(inner) : v;
      },
    })));
    const v = Reflect.get(target, key); return typeof v === "function" ? v.bind(target) : v;
  } });
  await assert.rejects(new StrategyReviewService(broken, context, {} as never, billing as never).decide("store", "owner", f.id, "approve", f.input), /NOTICE_FAILED/);
  assert.equal(await prisma.revenueStrategyAction.count(), 0); assert.equal(await prisma.promptExperiment.count(), 0);
  assert.equal(await prisma.strategyExecutionEvent.count(), 0);
  assert.equal((await f.s.read("store", f.id)).status, "pending_review");
  assert.equal((await f.s.decide("store", "owner", f.id, "approve", f.input) as any).status, "active");
});

test("human approval rechecks experiment ownership and policy after a ready dashboard read", { skip: !enabled }, async () => {
  const f = await approvableProposal();
  assert.equal((await f.s.read("store", f.id)).approval_available, true);
  await prisma.promptExperiment.create({ data: { id: "existing-test", merchantId: "store", name: "Existing", status: "running" } });
  assert.ok((await f.s.read("store", f.id)).activation_blockers.includes("experiment_already_active"));
  await assert.rejects(f.s.decide("store", "owner", f.id, "approve", f.input), (e: any) => e.getResponse().blockers.includes("experiment_already_active"));
  await prisma.promptExperiment.update({ where: { id: "existing-test" }, data: { status: "completed" } });
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { minimumMarginPercent: 45 } });
  await assert.rejects(f.s.decide("store", "owner", f.id, "approve", f.input), /POLICY_CHANGED/);
  assert.equal(await prisma.revenueStrategyAction.count(), 0); assert.equal(await prisma.strategyExecution.count(), 0);
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

test("discovery summaries show the latest immutable proposal without crossing stores or exposing its context", { skip: !enabled }, async () => {
  const f = await fixture("store");
  const other = await fixture("other");
  const reviewer = service(async () => ({ ...recommendation(), hypothesis_text: "Nova proposta para revisar", expected_lift_percent: 3 }));
  assert.equal((await reviewer.summaries("store", [])).size, 0);
  const result = await reviewer.decide("store", "owner", f.id, "revision", f.input) as { action_id: string };
  assert.equal((await reviewer.summaries("store", [f.id])).get(f.id)?.status, "revision_pending");
  await reviewer.process(result.action_id);
  const summaries = await reviewer.summaries("store", [f.id, other.id, "missing"]);
  assert.equal(summaries.size, 1);
  assert.deepEqual(summaries.get(f.id), { version: 2, status: "pending_review", title: "Nova proposta para revisar",
    expected_lift_percent: 3, expires_at: f.version!.expiresAt });
  assert.equal(await prisma.revenueStrategyAction.count({ where: { strategyId: f.id } }), 1);
  assert.equal(await prisma.promptExperiment.count(), 0);
});

test("measurement preparation is fenced, concurrent, immutable and keeps the original historical snapshot", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureMeasurement(f);
  const request = { runId: f.run.id, leaseToken: 1 };
  const plans = await Promise.all(Array.from({ length: 8 }, () => prepareStrategyMeasurement(prisma, "store", request)));
  assert.equal(new Set(plans.map(digest)).size, 1);
  assert.equal(plans[0]!.baseline.sessions, 1000);
  assert.equal(plans[0]!.baseline.conversions, 100);
  await prisma.completedOrder.deleteMany();
  assert.deepEqual(await prepareStrategyMeasurement(prisma, "store", request), plans[0]);
  process.env.REVENUE_STRATEGY_MEASUREMENT_ENABLED = "false";
  await assert.rejects(prepareStrategyMeasurement(prisma, "store", request), /strategy_measurement_disabled/);
  process.env.REVENUE_STRATEGY_MEASUREMENT_ENABLED = "true";
  for (const data of [{ measurementPlanningJson: {} }, { merchantId: "foreign" }, { cycle: 2 },
    { asOf: new Date() }, { observationId: "other" }]) {
    await assert.rejects(prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data }), /REVENUE_MEASUREMENT_CONTEXT_IMMUTABLE/);
  }
  await assert.rejects(prisma.revenueAnalysisRun.delete({ where: { id: f.run.id } }), /REVENUE_MEASUREMENT_CONTEXT_IMMUTABLE/);
  await assert.rejects(prepareStrategyMeasurement(prisma, "foreign", request), /analysis_lease_lost/);
  await assert.rejects(prepareStrategyMeasurement(prisma, "store", { ...request, leaseToken: 2 }), /analysis_lease_lost/);
  process.env.REVENUE_EXPERIMENT_DURATION_DAYS = "14";
  await assert.rejects(prepareStrategyMeasurement(prisma, "store", request), /STRATEGY_MEASUREMENT_POLICY_CHANGED/);
});

test("planning cohort excludes holdout, unknown currency/identity, repeated buyers, late orders and other tenants", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureMeasurement(f);
  const asOf = f.run.asOf!;
  const windowEnd = new Date(asOf.getTime() - 86_400_000);
  const windowStart = new Date(windowEnd.getTime() - 28 * 86_400_000);
  const createdAt = new Date(asOf.getTime() - 7 * 86_400_000);
  const row = (id: string) => ({ id, merchantId: "store", sessionId: id, globalUserId: id, conversationId: id,
    cohort: "treatment", cart: { currency: "BRL" }, createdAt, updatedAt: createdAt });
  await prisma.checkoutSession.createMany({ data: [
    { ...row("holdout"), cohort: "holdout" }, { ...row("unknown-cohort"), cohort: null },
    { ...row("empty-identity"), globalUserId: " " }, { ...row("currency"), cart: {} },
    { ...row("usd"), cart: { currency: "USD" } }, { ...row("foreign"), merchantId: "foreign", sessionId: "history-201" },
    { ...row("repeat"), globalUserId: "buyer-200", createdAt: new Date(createdAt.getTime() + 1000) },
    { ...row("at-start"), createdAt: windowStart }, { ...row("at-end"), createdAt: windowEnd },
    { ...row("before-start"), createdAt: new Date(windowStart.getTime() - 1) },
  ] });
  await prisma.completedOrder.createMany({ data: [
    { id: "duplicate", sessionId: "history-0", completedAt: createdAt },
    { id: "late", sessionId: "history-200", completedAt: new Date(createdAt.getTime() + 86_400_000) },
    { id: "repeat-order", sessionId: "repeat", completedAt: new Date(createdAt.getTime() + 2000) },
    { id: "foreign-order", sessionId: "history-201", merchantId: "foreign", completedAt: createdAt },
    { id: "early", sessionId: "history-202", completedAt: new Date(createdAt.getTime() - 1) },
  ].map(o => ({ merchantId: "store", externalOrderId: o.id, currency: "BRL", orderTotal: 100, ...o })) });
  const planning = await prepareStrategyMeasurement(prisma, "store", { runId: f.run.id, leaseToken: 1 });
  assert.equal(planning!.baseline.sessions, 1001);
  assert.equal(planning!.baseline.conversions, 100);
  assert.equal(planning!.baseline.windowStart, windowStart.toISOString());
  assert.equal(await prisma.promptVariantResult.count(), 0);
});

test("published proposal contains exact experiment and measurement definitions without activating anything", { skip: !enabled }, async () => {
  const { f, read, review, s, id, input } = await measuredProposal();
  const saved = await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } });
  assert.equal(review.planningHash, digest(saved.measurementPlanningJson));
  assert.equal(review.planHash, digest(review.plan));
  assert.equal(review.version, 1);
  assert.equal(review.strategyId, id);
  assert.equal(review.plan.controlVariantId, review.variants[0].id);
  assert.equal(read.measurement_status, "included_in_proposal");
  assert.ok(!read.activation_blockers.includes("reviewed_measurement_plan_required"));
  assert.ok(read.measurement_warnings.includes("planned_sample_capacity_insufficient"));
  assert.ok(!read.activation_blockers.includes("planned_sample_capacity_insufficient"));
  assert.equal(await prisma.promptExperiment.count(), 0);
  assert.equal(await prisma.experimentMeasurementPlan.count(), 0);
  assert.equal(await prisma.revenueStrategyAction.count(), 0);
  await assert.rejects(s.decide("store", "owner", id, "approve", input), (e: any) => e.getStatus() === 409);
  assert.equal(await prisma.revenueStrategyAction.count(), 0);
  assert.equal(read.approval_available, false);
});

test("missing configuration and insufficient planning data stop before model generation", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  await configureMeasurement(f, 50);
  let calls = 0;
  const useCase = realGeneration(async request => { calls++; return recipeResponse(request); });
  const input = { merchant_id: "store", observation_id: f.observation.id, analysis_context: { runId: f.run.id, leaseToken: 1 } };
  delete process.env.REVENUE_EXPERIMENT_DURATION_DAYS;
  await assert.rejects(useCase.execute(input), /measurement_not_configured/);
  process.env.REVENUE_EXPERIMENT_DURATION_DAYS = "7";
  await assert.rejects(useCase.execute(input), MeasurementBaselineUnavailable);
  assert.equal(calls, 0);
  assert.equal(await prisma.revenueAiReservation.count(), 0);
  assert.equal(await prisma.revenueStrategy.count(), 0);
  assert.equal((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } })).measurementPlanningJson, null);
});

test("weekly worker completes an insufficient measurement cycle and waits seven days without generation", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  await configureMeasurement(f, 50);
  Object.assign(process.env, { REVENUE_WEEKLY_GENERATION_ENABLED: "true" });
  const worker = new WeeklyAnalysisService(prisma, billing as never, {} as never,
    realGeneration(async () => { throw new Error("MUST_NOT_CALL"); }));
  // The fixture already owns a live lease. Exercise actual processing, completion,
  // schedule and notice writes without depending on the host's current night hour.
  worker.claim = async () => f.run;
  await worker.process(f.run.id);
  const run = await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } });
  assert.equal(run.status, "completed"); assert.equal(run.result, "insufficient_data");
  const schedule = await prisma.revenueAnalysisSchedule.findUniqueOrThrow({ where: { merchantId: "store" } });
  assert.ok(schedule.nextDueAt.getTime() >= run.completedAt!.getTime() + 7 * 86_400_000);
  assert.equal(await prisma.revenueAiReservation.count(), 0);
  assert.equal((await prisma.merchantNotification.findUniqueOrThrow({ where: { id: `analysis:${f.run.id}` } })).type, "ai_analysis_update");
});

test("measurement policy changed during generation rolls back proposal and notice and cannot be silently replanned", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  await configureMeasurement(f);
  let calls = 0;
  const useCase = realGeneration(async request => {
    calls++; process.env.REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS = "1000"; return recipeResponse(request);
  });
  const input = { merchant_id: "store", observation_id: f.observation.id, analysis_context: { runId: f.run.id, leaseToken: 1 } };
  await assert.rejects(useCase.execute(input), /STRATEGY_MEASUREMENT_POLICY_CHANGED/);
  assert.equal(await prisma.revenueManagerHypothesis.count(), 0);
  assert.equal(await prisma.revenueStrategy.count(), 0);
  assert.equal(await prisma.merchantNotification.count(), 0);
  await assert.rejects(useCase.execute(input), /STRATEGY_MEASUREMENT_POLICY_CHANGED/);
  assert.equal(calls, 1);
});

test("revision preserves frozen measurement evidence and expires with the original proposal", { skip: !enabled }, async () => {
  const { s, id, input, review, read } = await measuredProposal();
  const receipt: any = await s.decide("store", "owner", id, "revision", input);
  await prisma.completedOrder.deleteMany();
  await s.process(receipt.action_id);
  const next = await s.read("store", id);
  assert.equal(next.currentVersion, 2);
  const revised = (next.versions[0].proposal as any).experimentReview as StrategyExperimentReview;
  assert.deepEqual(revised.planning, review.planning);
  assert.equal(revised.plan.minimumSessionsPerArm, review.plan.minimumSessionsPerArm);
  assert.notEqual(revised.plan.controlVariantId, review.plan.controlVariantId);
  assert.equal(next.versions[0].expiresAt.toISOString(), read.versions[0].expiresAt.toISOString());
  assert.equal(next.versions[1].proposalHash, read.versions[0].proposalHash);
  assert.equal((await prisma.merchantNotification.findUniqueOrThrow({ where: { id: `strategy-revision:${receipt.action_id}` } })).read, false);
});

test("revision cannot alter measurement policy after the model call or discard it when the flag is disabled", { skip: !enabled }, async () => {
  const { id, input } = await measuredProposal();
  let calls = 0;
  const s = new StrategyReviewService(prisma, context, { generate: async request => {
    calls++; process.env.REVENUE_EXPERIMENT_DURATION_DAYS = "14"; return recipeResponse(request);
  } }, billing as never);
  const receipt: any = await s.decide("store", "owner", id, "revision", input);
  await s.process(receipt.action_id);
  assert.equal(calls, 1);
  assert.equal((await s.read("store", id)).currentVersion, 1);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "failed");
  process.env.REVENUE_EXPERIMENT_DURATION_DAYS = "7";
  const second: any = await s.decide("store", "owner", id, "revision", { ...input, request_key: "revision-second" });
  process.env.REVENUE_STRATEGY_MEASUREMENT_ENABLED = "false";
  await s.process(second.action_id);
  assert.equal(calls, 1);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: second.action_id } })).reason, "strategy_measurement_disabled");
  assert.equal((await s.read("store", id)).currentVersion, 1);
});

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

test("real merchant context generates and freezes a replayable primary-chat control", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  const captured = await configureRealBaseline();
  let calls = 0;
  const output = await realGeneration(async request => {
    calls++;
    assert.deepEqual(request.checkout_baseline, captured);
    assert.equal(request.current_prompt, checkoutBaselineReference(captured));
    assert.deepEqual(request.past_lessons, []);
    return recipeResponse(request);
  }).execute({ merchant_id: "store", observation_id: f.observation.id, analysis_context: { runId: f.run.id, leaseToken: 1 } });
  const stored = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: output.hypothesis_id } });
  const proposal = stored.proposal as any;
  assert.equal(calls, 1);
  assert.equal(proposal.baselineStatus, "primary_chat_contract_captured");
  assert.deepEqual(proposal.checkoutBaseline, captured);
  assert.equal(proposal.execution, "unavailable");
  assert.equal(stored.proposalHash, digest(proposal));
  const turn = { cartInfo: "Carrinho: R$42.50", stage: "payment", paymentJustFailed: true };
  assert.equal(renderCheckoutChatBaseline(proposal.checkoutBaseline, "store", turn), new ChatLlmGatewayService().buildSystemPrompt({
    ...turn, merchantName: "Fixture", merchantRules: captured.rules.paymentFailed }));
  const read = await service().read("store", output.hypothesis_id);
  assert.equal(read.approval_available, false);
  assert.equal(read.activation_available, false);
});

test("missing settings, unknown tenant and malformed settings cannot produce a control", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  assert.equal(await context.getCheckoutBaseline("another-store"), undefined);
  await prisma.checkoutSetting.update({ where: { merchantId: "store" }, data: { advancedRules: [{ enabled: true }] } });
  assert.equal(await context.getCheckoutBaseline("store"), undefined);
  await prisma.checkoutSetting.delete({ where: { merchantId: "store" } });
  await assert.rejects(realGeneration(async () => { throw new Error("MUST_NOT_CALL"); }).execute({ merchant_id: "store",
    observation_id: f.observation.id, analysis_context: { runId: f.run.id, leaseToken: 1 } }), /HYPOTHESIS_BASELINE_UNAVAILABLE/);
  assert.equal(await prisma.revenueStrategy.count(), 0);
});

test("settings change during generation prevents proposal publication", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  await assert.rejects(realGeneration(async request => {
    await prisma.checkoutSetting.update({ where: { merchantId: "store" }, data: { advancedRules: [] } });
    return recipeResponse(request);
  }).execute({ merchant_id: "store", observation_id: f.observation.id, analysis_context: { runId: f.run.id, leaseToken: 1 } }), /HYPOTHESIS_BASELINE_CHANGED/);
  assert.equal(await prisma.revenueStrategy.count(), 0);
  assert.equal(await prisma.merchantNotification.count(), 0);
});

test("publication rechecks the frozen recipe under locks and rolls back stale source and notice", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  const captured = await configureRealBaseline();
  const snapshot = f.hypothesis.snapshot();
  snapshot.template.variant_a.system_prompt = checkoutBaselineReference(captured);
  snapshot.template.variant_b.system_prompt = "Ofereça ajuda com a etapa atual.";
  await prisma.merchant.update({ where: { id: "store" }, data: { name: "Renamed" } });
  await assert.rejects(f.repo.save(HypothesisEntity.rehydrate(snapshot), { runId: f.run.id, leaseToken: 1, checkoutBaseline: captured }), /STRATEGY_BASELINE_CHANGED/);
  assert.equal(await prisma.revenueManagerHypothesis.count(), 0);
  assert.equal(await prisma.revenueStrategyVersion.count(), 0);
  assert.equal(await prisma.merchantNotification.count(), 0);
});

test("revision with real baseline reader preserves original recipe and creates an immutable new version", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  const captured = await configureRealBaseline();
  const generated = await realGeneration().execute({ merchant_id: "store", observation_id: f.observation.id,
    analysis_context: { runId: f.run.id, leaseToken: 1 } });
  await prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data: { status: "completed" } });
  const s = new StrategyReviewService(prisma, context, { generate: async request => recipeResponse(request) }, billing as never);
  const before = await s.read("store", generated.hypothesis_id);
  const receipt = await s.decide("store", "owner", generated.hypothesis_id, "revision", {
    ...f.input, proposal_hash: before.versions[0].proposalHash }) as any;
  await s.process(receipt.action_id);
  const read = await s.read("store", generated.hypothesis_id);
  assert.equal(read.currentVersion, 2);
  assert.deepEqual((read.versions[0].proposal as any).checkoutBaseline, captured);
  assert.equal(read.versions[0].expiresAt.getTime(), before.versions[0].expiresAt.getTime());
  assert.deepEqual(read.versions[1], before.versions[0]);
});

test("provider model drift during revision refuses publication", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  await configureRealBaseline();
  const generated = await realGeneration().execute({ merchant_id: "store", observation_id: f.observation.id,
    analysis_context: { runId: f.run.id, leaseToken: 1 } });
  await prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data: { status: "completed" } });
  const s = new StrategyReviewService(prisma, context, { generate: async request => {
    process.env.OPENAI_MODEL = "changed"; return recipeResponse(request);
  } }, billing as never);
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow();
  const receipt = await s.decide("store", "owner", generated.hypothesis_id, "revision", { ...f.input, proposal_hash: version.proposalHash }) as any;
  await s.process(receipt.action_id);
  assert.equal((await s.read("store", generated.hypothesis_id)).currentVersion, 1);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "failed");
});

test("publication locks prevent concurrent merchant, policy and settings changes", { skip: !enabled }, async () => {
  await fixture("store", { publish: false });
  const captured = await configureRealBaseline();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let locked!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const holding = prisma.$transaction(async tx => {
    await lockCheckoutBaselineRows(tx, "store");
    locked();
    await wait;
    assert.deepEqual(await readCheckoutBaseline(tx, "store"), captured);
  });
  await ready;
  try {
    for (const table of ["merchants", "merchant_rules", "checkout_settings"]) {
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        await tx.$executeRawUnsafe(table === "merchants" ? "UPDATE merchants SET name = 'Changed' WHERE id = 'store'"
          : `UPDATE ${table} SET updated_at = now() WHERE merchant_id = 'store'`);
      }), /lock timeout/);
    }
  } finally { release(); await holding; }
});

test("budgeted generation binds provider checkpoint to the real recipe and evidence", { skip: !enabled }, async () => {
  const f = await fixture("store", { publish: false });
  const captured = await configureRealBaseline();
  await configureMeasurement(f);
  const planning = await prepareStrategyMeasurement(prisma, "store", { runId: f.run.id, leaseToken: 1 });
  delete process.env.DEEPSEEK_API_KEY;
  await prisma.aiPriceVersion.create({ data: { version: "fixture", provider: "openai", model: "fixture-model", channel: "chat",
    component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1", inputMicrosPerMillion: 1_000_000n,
    outputMicrosPerMillion: 1_000_000n, effectiveFrom: new Date("2020-01-01Z") } });
  const generator = new LLMHypothesisGenerator(new RevenueAiBudgetService(prisma));
  const request: HypothesisGenerationRequest = { merchant_id: "store", analysis_context: { runId: f.run.id, leaseToken: 1 },
    current_prompt: checkoutBaselineReference(captured), checkout_baseline: captured, measurement_planning: planning,
    observation: f.observation.snapshot(), past_lessons: [],
    constraints: { max_discount_percent: 5, allow_free_shipping: false, max_running_experiments: 1, merchant_rules: (await context.getRules("store"))! } };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const reservation = await prisma.revenueAiReservation.findFirstOrThrow();
    assert.equal(reservation.runId, f.run.id);
    assert.equal(reservation.state, "dispatched");
    const sent = JSON.parse(String(options?.body));
    assert.match(sent.messages[1].content, /SERVER CHECKOUT RECIPE/);
    assert.match(sent.messages[1].content, /SERVER MEASUREMENT CONTEXT/);
    assert.doesNotMatch(sent.messages[1].content, /fixture-only/);
    const response = recipeResponse(request);
    response.template.variant_a.system_prompt = "Model tried to rewrite control";
    return Response.json({ id: "fixture", usage: { prompt_tokens: 100, completion_tokens: 100 },
      choices: [{ message: { content: JSON.stringify(response) } }] });
  };
  try {
    const first = await generator.generate(request);
    assert.equal(first.template.variant_a.system_prompt, request.current_prompt);
    assert.deepEqual(await generator.generate(request), first);
    const otherEvidence = structuredClone(request);
    otherEvidence.observation.funnel.total_sessions++;
    await assert.rejects(generator.generate(otherEvidence), /HYPOTHESIS_BASELINE_CHANGED/);
    const otherMeasurement = structuredClone(request);
    otherMeasurement.measurement_planning!.policy.minimumEffectBps = 1000;
    await assert.rejects(generator.generate(otherMeasurement), /HYPOTHESIS_BASELINE_CHANGED/);
    const changed = structuredClone(captured); changed.merchantName = "Changed";
    await assert.rejects(generator.generate({ ...request, checkout_baseline: changed, current_prompt: checkoutBaselineReference(changed) }), /HYPOTHESIS_BASELINE_CHANGED/);
    assert.equal(calls, 1);
    assert.equal(await prisma.revenueAiReservation.count(), 1);
    assert.equal((await prisma.revenueAiReservation.findFirstOrThrow()).state, "settled");
  } finally { globalThis.fetch = originalFetch; }
});
