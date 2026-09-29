import test, { before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_MERCHANT_RULES, type CheckoutSession, type MerchantRules } from "@zyon/shared-types";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { CheckoutBootstrapService } from "../../checkout/application/services/checkout-bootstrap.service.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { strategyProposal } from "../domain/strategy-proposal.js";
import { measurementPlanning, strategyExperimentReview } from "../domain/strategy-measurement.js";
import { executionContract, renderStrategyTurn, strategyArm, strategyExecutionEnabled } from "../domain/strategy-execution.js";
import { checkoutBaselineReference, renderCheckoutChatBaseline } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { PrismaHypothesisMerchantContext } from "../infrastructure/hypothesis-merchant-context.adapter.js";
import { enrollCreatedStrategySession, lockExecutionMerchant, registerApprovedExecution, StrategyExecutionLedger } from "../infrastructure/strategy-execution-ledger.js";
import { ChatLlmGatewayService } from "../../checkout/application/services/chat-llm-gateway.service.js";
import { StrategyChatDispatcher } from "./strategy-chat-dispatcher.js";
import { StrategyChatPublisher } from "../infrastructure/strategy-chat-publisher.js";
import { CheckoutChatRequestService } from "../../checkout/infrastructure/prisma/checkout-chat-request.service.js";
import { chatMessageIdentity, chatMessageTextHash } from "../../checkout/domain/services/chat-message-identity.js";
import { createSendChatUseCase } from "../../checkout/application/use-cases/send-chat-message.fixture.js";
import { StrategyCheckoutChatService } from "../../checkout/application/services/strategy-checkout-chat.service.js";
import { SafeAuthorizedOffer } from "../../checkout/domain/types/safe-authorized-offer.js";
import { registerTenantMiddleware } from "../../../shared/persistence/tenant.middleware.js";
import { Body, Controller, HttpCode, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ProblemDetailsFilter } from "../../../shared/http/problem-details.filter.js";
import { ReconcileChatMessageUseCase } from "../../checkout/application/use-cases/reconcile-chat-message.use-case.js";
import { deriveChatStage } from "../../checkout/domain/services/customer-extraction.service.js";
import { ExperimentMeasurementService } from "../../experiments/application/experiment-measurement.service.js";
import { StrategyMetricsService } from "./strategy-metrics.service.js";
import { StrategyAiBudget } from "../infrastructure/strategy-ai-budget.js";
import { RevenueAiBudgetService } from "../infrastructure/revenue-ai-budget.service.js";
import { StrategyMonitorService } from "../infrastructure/strategy-monitor.service.js";
import { ChatToolExecutorService } from "../../checkout/application/services/chat-tool-executor.service.js";
import { CheckoutCustomerService } from "../../checkout/application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../checkout/application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../checkout/application/services/checkout-offer.service.js";
import { BuyerRecognitionService } from "../../checkout/application/services/buyer-recognition.service.js";
import { OtpService } from "../../checkout/application/services/otp.service.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { PrismaPaymentSettlementLedgerRepository } from "../../payment/infrastructure/prisma-payment-settlement-ledger.repository.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { PrismaPaymentApprovalReader } from "../../checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { checkoutNavigationContext, navigationToolNames, MAIN_CHAT_PUBLICATION_POLICY } from "../../checkout/domain/services/checkout-chat-navigation.js";

// Only these disposable local databases can be truncated by this suite.
const url = new URL(process.env.REVENUE_EXECUTION_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557"
  && ["/revenue_recovery_final_0924", "/revenue_release_0928"].includes(url.pathname);
// Disposable Docker storage may serialize concurrent writers beyond Prisma's
// default five seconds. This fixture allowance does not change product limits.
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } },
  transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
const env = { ...process.env };
const repo = new PrismaCheckoutRepository(prisma);
const ledger = new StrategyExecutionLedger(prisma);
const originalFetch = globalThis.fetch;
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; });
afterEach(() => { globalThis.fetch = originalFetch; });
beforeEach(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`TRUNCATE merchants, merchant_rules, checkout_settings, checkout_sessions, payment_intents,
    revenue_analysis_runs, revenue_analysis_schedules, revenue_manager_observations, revenue_strategies, prompt_experiments,
    revenue_ai_reservations, ai_usage_events, ai_price_versions, merchant_notifications CASCADE`);
  process.env = { ...env, REVENUE_STRATEGY_EXECUTION_ENABLED: "true", REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS: "store,other",
    REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED: "true",
    REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED: "true",
    REVENUE_STRATEGY_MAIN_CHAT_ENABLED: "false",
    CHECKOUT_CHAT_RECOVERY_ENABLED: "false", CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS: "store,other",
    CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED: "false",
    CHECKOUT_CHAT_REQUESTS_ENABLED: "true", CHECKOUT_CHAT_REQUEST_MERCHANT_IDS: "store,other",
    REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40),
    CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", OPENAI_MODEL: "fixture-model",
    REVENUE_AI_MAX_INPUT_TOKENS: "200000", REVENUE_AI_MAX_OUTPUT_TOKENS: "1000",
    REVENUE_AI_DAILY_LIMIT_MICROS: "1000000000", REVENUE_AI_MONTHLY_LIMIT_MICROS: "10000000000",
    REVENUE_AI_CYCLE_LIMIT_MICROS: "1000000000", REVENUE_AI_MAX_CALLS_PER_CYCLE: "1000",
    REVENUE_STRATEGY_AI_EXECUTION_LIMIT_MICROS: "1000000000", REVENUE_STRATEGY_AI_SESSION_MAX_CALLS: "1000",
    REVENUE_AI_PROVIDER_RPM: "10000", REVENUE_AI_PROVIDER_TPM: "1000000000", REVENUE_AI_PROVIDER_CONCURRENCY: "1000",
    REVENUE_AI_REVISION_RESERVE_PERCENT: "0", REVENUE_AI_BUDGET_CURRENCY: "BRL" };
  await prisma.aiPriceVersion.create({ data: { version: "strategy-fixture-price", provider: "openai", model: "fixture-model",
    channel: "chat", component: "text_generation", currency: "BRL", source: "revenue-upper-bound-v1",
    inputMicrosPerMillion: 1000, outputMicrosPerMillion: 2000, effectiveFrom: new Date("2020-01-01T00:00:00Z") } });
  delete process.env.LOCAL_LLM_BASE_URL; delete process.env.OLLAMA_BASE_URL;
  // Every dispatch test supplies a controlled transport; never call a provider.
  globalThis.fetch = (async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN_IN_FIXTURE"); }) as typeof fetch;
});

async function proposalFixture(merchantId = "store", suffix = "one", rulesOverride: Partial<MerchantRules> = {}) {
  const now = new Date();
  await prisma.merchant.upsert({ where: { id: merchantId }, create: { id: merchantId, name: "Fixture" }, update: {} });
  await repo.getRules(merchantId);
  await repo.setRules(merchantId, { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 5, minimumMarginPercent: 30, ...rulesOverride });
  await prisma.checkoutSetting.upsert({ where: { merchantId }, update: {}, create: { merchantId, mode: "conversational",
    widgetBehavior: {}, triggerRules: {}, suppressionRules: {}, handoff: {}, interventionPolicy: {}, advancedRules: [] } });
  const context = new PrismaHypothesisMerchantContext(prisma);
  const baseline = (await context.getCheckoutBaseline(merchantId))!;
  const rules = (await context.getRules(merchantId))!;
  const observation = ObservationEntity.create({ merchant_id: merchantId,
    observation_window_start: new Date(now.getTime() - 7 * 86_400_000), observation_window_end: now,
    funnel: { total_sessions: 100, started_checkout: 100, reached_shipping: 80, reached_payment: 40, completed_order: 20, conversion_rate: .2 },
    abandonment: { abandoned_at_shipping: 40, abandoned_at_payment: 20, abandonment_rate: .8, top_abandonment_objection: "unknown" },
    objections: { shipping_cost_count: 0, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 80 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { new_customers_rate: 1, returning_customers_rate: 0, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_orders: 20, total_revenue_cents: 20000, avg_order_value_cents: 1000 }, ai_costs_cents: 0 }).snapshot();
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId, cycle: suffix === "one" ? 1 : 2, status: "completed", asOf: now } });
  await prisma.revenueAnalysisSchedule.upsert({ where: { merchantId }, update: {}, create: { merchantId, group: 0, nextDueAt: now, currentRunId: run.id } });
  const id = `${merchantId}-${suffix}`;
  const recommendation = { hypothesis_text: "Testar uma pergunta contextual para ajudar na etapa atual", reasoning: "Comparar com o controle usando as sessões observadas",
    expected_lift_percent: 1, template: { name: "Ajuda contextual", description: "Mudar a forma de explicar a etapa atual",
      variant_a: { name: "Controle", system_prompt: checkoutBaselineReference(baseline), weight: 50, is_control: true },
      variant_b: { name: "Ajuda", system_prompt: "Pergunte qual etapa precisa de explicação e use somente dados verificados.", weight: 50, is_control: false } } };
  const planning = measurementPlanning({ merchantId, runId: run.id, asOf: now.toISOString(), capturedAt: now.toISOString(),
    policy: { durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 500 }, baseline: { sessions: 1000, conversions: 100,
      windowStart: new Date(now.getTime() - 29 * 86_400_000).toISOString(), windowEnd: new Date(now.getTime() - 86_400_000).toISOString() } });
  const review = strategyExperimentReview(id, 1, recommendation, planning);
  const proposal = strategyProposal(recommendation, observation, rules, baseline, review);
  await prisma.revenueStrategy.create({ data: { id, merchantId, runId: run.id, status: "activation_pending",
    versions: { create: { version: 1, proposalHash: digest(proposal), proposal: proposal as any,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000) } } } });
  const approvalId = `${id}-approval`;
  await prisma.revenueStrategyAction.create({ data: { id: approvalId, merchantId, strategyId: id, version: 1, kind: "approve",
    requestKey: "approve", requestHash: digest({ id }), actorId: "fixture-operator", result: { action_id: approvalId,
      strategy_id: id, version: 1, proposal_hash: digest(proposal), status: "activation_pending" } } });
  return { id, merchantId, approvalId, proposal, review, baseline, run };
}
async function activate(merchantId = "store", rulesOverride: Partial<MerchantRules> = {}) {
  const f = await proposalFixture(merchantId, "one", rulesOverride);
  const execution = await prisma.$transaction(tx => registerApprovedExecution(tx, merchantId, f.approvalId));
  return { ...f, execution };
}
function session(sessionId: string, overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  const now = new Date().toISOString();
  return { merchantId: "store", sessionId, globalUserId: `buyer-${sessionId}`, conversationId: `conversation-${sessionId}`,
    cart: { currency: "BRL", total: 100, items: [], source: "storefront" }, cohort: "treatment", chatHistory: [],
    abandonmentScore: 0, triggerAgent: false, createdAt: now, updatedAt: now, ...overrides };
}
const turn = (sessionId: string, requestKey = "request-one", merchantId = "store") => ({ merchantId, sessionId, requestKey,
  inputHash: digest("buyer message fixture"), route: "primary_llm" as const, turn: { cartInfo: "Carrinho: R$100.00", stage: "payment" } });
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled }, fn);

async function measuredPopulation() {
  const f = await activate();
  for (const arm of ["control", "treatment"] as const) {
    const buyers = Array.from({ length: 100 }, (_, i) => `metrics-buyer-${i}`)
      .filter(id => strategyArm(f.execution.contract as any, id) === arm).slice(0, 2);
    for (const [i, globalUserId] of buyers.entries()) await repo.createSessionIfAbsent(session(`${arm}-${i}`, { globalUserId }));
  }
  return { ...f, metrics: new ExperimentMeasurementService(prisma) };
}
async function measuredOrder(sessionId: string, id: string, amount = 100.25, completedAt = new Date()) {
  return prisma.completedOrder.create({ data: { id, merchantId: "store", sessionId, externalOrderId: id,
    currency: "BRL", orderTotal: amount, completedAt, status: "approved" } });
}

function monitor(metrics = new ExperimentMeasurementService(prisma), client = prisma) {
  process.env.REVENUE_STRATEGY_MONITOR_ENABLED = "true";
  process.env.REVENUE_STRATEGY_MONITOR_BATCH_LIMIT = "100";
  return new StrategyMonitorService(client, metrics);
}

integration("strategy monitor is opt-in and rejects an invalid batch before reading executions", async () => {
  const service = new StrategyMonitorService({ $queryRaw() { assert.fail("disabled monitor must not read"); } } as any, {} as any);
  delete process.env.REVENUE_STRATEGY_MONITOR_ENABLED;
  assert.deepEqual(await service.run(), { processed: 0, failed: 0 });
  process.env.REVENUE_STRATEGY_MONITOR_ENABLED = "true";
  process.env.REVENUE_STRATEGY_MONITOR_BATCH_LIMIT = "501";
  await assert.rejects(service.run(), /LIMIT_INVALID/);
});

integration("strategy monitor shares hourly evidence with the dashboard and concurrent workers without AI", async () => {
  const f = await measuredPopulation(), service = monitor(f.metrics);
  const now = new Date();
  const key = `strategy-hour-${now.toISOString().slice(0, 13).replace(/\D/g, "")}`;
  await Promise.all([service.run(now), service.run(now), f.metrics.capture("store", f.execution.experimentId, key, now)]);
  assert.equal(await prisma.experimentMeasurementReview.count(), 1);
  assert.deepEqual(await service.run(now), { processed: 0, failed: 0 });
  assert.equal(await prisma.merchantNotification.count(), 0);
  assert.equal(await prisma.strategyExecution.count({ where: { status: "running" } }), 1);
  assert.equal(await prisma.aiUsageEvent.count(), 0);
  assert.equal(await prisma.strategyAiReservation.count(), 0);
});

integration("strategy monitor stops at the fixed horizon and collects through conversion maturity", async () => {
  const f = await measuredPopulation(), service = monitor(f.metrics);
  const horizon = new Date(f.execution.endsAt.getTime());
  // Simulate a dashboard read in the same hour before the stop.
  const key = `strategy-hour-${horizon.toISOString().slice(0, 13).replace(/\D/g, "")}`;
  await f.metrics.capture("store", f.execution.experimentId, key, new Date(horizon.getTime() - 1));
  const runs = await Promise.all([service.run(horizon), service.run(horizon)]);
  assert.ok(runs.every(r => r.failed === 0));
  const execution = await prisma.strategyExecution.findUniqueOrThrow({ where: { id: f.execution.id } });
  assert.equal(execution.status, "stopped"); assert.equal(execution.stoppedAt!.getTime(), horizon.getTime());
  assert.equal(await prisma.strategyExecutionEvent.count({ where: { executionId: execution.id, kind: "stopped" } }), 1);
  const read = await new StrategyMetricsService(prisma, f.metrics).read("store", f.id, 1);
  assert.equal((read.measurement!.result as any).state, "awaiting_maturity");
  assert.equal(await prisma.merchantNotification.count(), 0);
  const mature = new Date(horizon.getTime() + 24 * 3_600_000);
  assert.deepEqual(await service.run(mature), { processed: 1, failed: 0 });
  const notice = await prisma.merchantNotification.findFirstOrThrow();
  assert.equal(notice.merchantId, "store"); assert.equal((notice.metadata as any).strategyId, f.id);
  assert.equal((notice.metadata as any).state, "inconclusive");
  assert.equal((notice.metadata as any).version, 1);
  assert.deepEqual(await service.run(new Date(mature.getTime() + 2 * 3_600_000)), { processed: 0, failed: 0 });
  assert.equal(await prisma.merchantNotification.count(), 1);
  assert.equal(await prisma.aiUsageEvent.count(), 0);
});

integration("strategy monitor retries a lost final notification without duplicating evidence or notices", async () => {
  const f = await measuredPopulation(); let attempted = 0;
  const client = new Proxy(prisma, { get(target, property) {
    if (property === "merchantNotification") return { createMany: async () => { attempted++; throw new Error("NOTICE_UNAVAILABLE"); } };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const now = new Date(f.execution.endsAt.getTime() + 25 * 3_600_000);
  assert.deepEqual(await monitor(f.metrics, client).run(now), { processed: 0, failed: 1 });
  assert.equal(attempted, 1); assert.equal(await prisma.experimentMeasurementReview.count(), 1);
  const service = monitor(f.metrics);
  const retries = await Promise.all([service.run(now), service.run(now)]);
  assert.ok(retries.every(r => r.failed === 0));
  assert.equal(await prisma.experimentMeasurementReview.count(), 1);
  assert.equal(await prisma.merchantNotification.count(), 1);
  assert.deepEqual(await service.run(now), { processed: 0, failed: 0 });
});

integration("strategy monitor stops invalid evidence before the horizon and preserves both snapshots", async () => {
  const f = await measuredPopulation();
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "control-0" } },
    data: { cart: { currency: "USD", total: 100 } } });
  const now = new Date();
  assert.deepEqual(await monitor(f.metrics).run(now), { processed: 1, failed: 0 });
  const execution = await prisma.strategyExecution.findFirstOrThrow();
  assert.equal(execution.status, "stopped"); assert.ok(execution.stoppedAt! < execution.endsAt);
  const reviews = await prisma.experimentMeasurementReview.findMany({ orderBy: { collectedAt: "asc" } });
  assert.equal(reviews.length, 2); assert.ok(reviews[0].collectedAt < reviews[1].collectedAt);
  assert.ok(!(reviews[0].result as any).reasons.includes("stopped_before_fixed_horizon"));
  assert.ok((reviews[1].result as any).reasons.includes("stopped_before_fixed_horizon"));
  assert.equal((reviews[1].result as any).promotionAllowed, false);
  assert.equal((await prisma.merchantNotification.findFirstOrThrow()).title, "O teste precisa de revisão");
});

integration("strategy monitor stops an AI overrun and never promotes a partial result", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const costly = { ...meteredReply(), usage: { prompt_tokens: 200001, completion_tokens: 301, total_tokens: 200302 } };
  await new StrategyChatDispatcher(ledger, { async callPinned() { return costly; } }).dispatch(meteredInput());
  assert.deepEqual(await monitor().run(), { processed: 1, failed: 0 });
  assert.equal((await prisma.strategyExecution.findFirstOrThrow()).status, "stopped");
  assert.ok(await prisma.strategyExecutionEvent.findFirst({ where: { requestKey: `monitor:ai-overrun:${f.execution.id}` } }));
  const review = await prisma.experimentMeasurementReview.findFirstOrThrow({ orderBy: { collectedAt: "desc" } });
  assert.equal((review.result as any).state, "invalid"); assert.equal((review.result as any).promotionAllowed, false);
  assert.equal(await prisma.aiUsageEvent.count(), 1);
});

integration("strategy monitor processes bounded batches across stores without starving uncollected results", async () => {
  const first = await activate(), second = await activate("other"), service = monitor();
  process.env.REVENUE_STRATEGY_MONITOR_BATCH_LIMIT = "1";
  const now = new Date();
  assert.deepEqual(await service.run(now), { processed: 1, failed: 0 });
  assert.deepEqual(await service.run(now), { processed: 1, failed: 0 });
  assert.deepEqual(await service.run(now), { processed: 0, failed: 0 });
  const rows = await prisma.experimentMeasurementReview.findMany();
  assert.deepEqual(rows.map(r => r.merchantId).sort(), [first.merchantId, second.merchantId].sort());
  assert.equal(await prisma.merchantNotification.count(), 0);
});

integration("strategy monitor preserves an earlier merchant pause when closing at the horizon", async () => {
  const f = await measuredPopulation();
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "merchant-actor", requestKey: "merchant-pause", kind: "paused" });
  const paused = await prisma.strategyExecution.findFirstOrThrow();
  assert.deepEqual(await monitor(f.metrics).run(new Date(f.execution.endsAt.getTime() + 1)), { processed: 1, failed: 0 });
  const stopped = await prisma.strategyExecution.findFirstOrThrow();
  assert.equal(stopped.status, "stopped"); assert.deepEqual(stopped.stoppedAt, paused.stoppedAt);
  const review = await prisma.experimentMeasurementReview.findFirstOrThrow({ orderBy: { collectedAt: "desc" } });
  assert.ok((review.result as any).reasons.includes("stopped_before_fixed_horizon"));
  assert.equal((review.result as any).promotionAllowed, false);
});

integration("strategy metrics include immutable participants without chat or purchase and preserve conversion boundaries", async () => {
  const f = await measuredPopulation();
  await repo.createSessionIfAbsent(session("excluded", { cohort: "holdout" }));
  await repo.createSessionIfAbsent(session("legacy", { promptVariantId: f.review.plan.treatmentVariantId }));
  await repo.createSessionIfAbsent(session("control-0", { merchantId: "other" }));
  const original = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "control-0" } } });
  await measuredOrder("control-0", "first"); await measuredOrder("control-0", "second", 25.25);
  await measuredOrder("control-0", "too-late", 800, new Date(original.createdAt.getTime() + 24 * 3_600_000));
  await measuredOrder("control-0", "before-entry", 800, new Date(original.createdAt.getTime() - 1));
  await measuredOrder("excluded", "holdout-order"); await measuredOrder("legacy", "legacy-order");
  await prisma.completedOrder.create({ data: { id: "foreign", merchantId: "other", sessionId: "control-0", externalOrderId: "foreign",
    currency: "BRL", orderTotal: 999, completedAt: new Date() } });
  assert.equal(await prisma.checkoutSession.count({ where: { merchantId: "store", promptVariantId: null } }), 5);
  const now = new Date(Date.now() + 25 * 3_600_000);
  const snapshot = await f.metrics.capture("store", f.execution.experimentId, "metrics-population", now);
  const result = snapshot.result as any;
  assert.equal(result.state, "collecting");
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.control, { assigned: 2, mature: 2, converted: 1, orders: 2, revenueCents: 12550 });
  assert.deepEqual(result.treatment, { assigned: 2, mature: 2, converted: 0, orders: 0, revenueCents: 0 });
  assert.equal(result.delivery.control.sessionsWithTurn, 0);
  assert.equal(result.delivery.control.sessionsWithDisplay, 0);
  assert.equal(result.proposalHash, f.execution.proposalHash);
  assert.equal(result.contributionCents, null); assert.equal(result.aiCostCents, null);
  const final = (await f.metrics.capture("store", f.execution.experimentId, "metrics-final", new Date(Date.now() + 9 * 86_400_000))).result as any;
  assert.equal(final.state, "inconclusive"); assert.ok(final.reasons.includes("planned_sample_not_reached"));
});

integration("strategy metrics separate pending buyers and preserve snapshots across corrections and concurrent retries", async () => {
  const f = await measuredPopulation();
  await measuredOrder("treatment-0", "pending-order");
  const key = "metrics-pending", now = new Date();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.metrics.capture("store", f.execution.experimentId, key, now)));
  assert.equal(new Set(results.map(row => row.id)).size, 1);
  const pending = results[0].result as any;
  assert.equal(pending.treatment.assigned, 2); assert.equal(pending.treatment.mature, 0);
  assert.equal(pending.treatment.converted, 0); assert.equal(pending.treatment.revenueCents, 0);
  assert.equal(pending.delivery.treatment.pendingConvertedSessions, 1);
  assert.equal(pending.delivery.treatment.pendingRevenueCents, 10025);
  const matureAt = new Date(Date.now() + 25 * 3_600_000);
  const mature = await f.metrics.capture("store", f.execution.experimentId, "metrics-mature", matureAt);
  assert.equal((mature.result as any).treatment.converted, 1);
  await prisma.completedOrder.update({ where: { id: "pending-order" }, data: { status: "refunded" } });
  assert.deepEqual(await f.metrics.capture("store", f.execution.experimentId, "metrics-mature", matureAt), mature);
  const corrected = await f.metrics.capture("store", f.execution.experimentId, "metrics-corrected", matureAt);
  assert.equal((corrected.result as any).treatment.converted, 0);
  assert.notEqual(corrected.evidenceHash, mature.evidenceHash);
  assert.equal(await prisma.experimentMeasurementReview.count(), 3);
  await assert.rejects(prisma.experimentMeasurementReview.update({ where: { id: mature.id }, data: { result: {} } }), /immutable/i);
});

integration("strategy metrics distinguish saved text, client visibility and unresolved provider turns", async () => {
  const f = await recoveryFixture(), requests = new CheckoutChatRequestService(prisma);
  const execution = await prisma.strategyExecution.findFirstOrThrow();
  const assigned = await prisma.strategyAssignment.findFirstOrThrow();
  const metrics = new ExperimentMeasurementService(prisma);
  await repo.createSessionIfAbsent(session("silent"));
  await repo.createSessionIfAbsent(session("uncertain"));
  const unresolved = await ledger.admitTurn(turn("uncertain"));
  assert.equal(unresolved.status, "admitted");
  const first = (await metrics.capture("store", execution.experimentId, "metrics-saved-only")).result as any;
  assert.equal(first.delivery[assigned.arm].publishedTurns, 1);
  assert.equal(first.delivery[assigned.arm].displayedTurns, 0);
  assert.equal(first.control.assigned + first.treatment.assigned, 3);
  assert.equal(first.delivery.control.unresolvedProviderTurns + first.delivery.treatment.unresolvedProviderTurns, 1);
  await requests.reconcile(f.input);
  await requests.recordDisplay("store", { session_id: "one", conversation_id: "conversation-one",
    display_ref: { turn_id: f.candidate.turnId, text_hash: chatMessageTextHash(completed.result.content) }, definition: "widget-visible-text-v1" });
  const second = (await metrics.capture("store", execution.experimentId, "metrics-visible")).result as any;
  assert.equal(second.delivery[assigned.arm].sessionsWithDisplay, 1);
  assert.equal(second.delivery[assigned.arm].displayedTurns, 1);
  assert.equal(second.delivery.displayBasis, "authenticated_client_report_not_attention");
  assert.deepEqual((await metrics.capture("store", execution.experimentId, "metrics-saved-only")).result, first);
});

integration("strategy metrics flag corrupted session context and early stopping without rewriting assignment", async () => {
  const f = await measuredPopulation();
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "control-0" } },
    data: { cart: { currency: "USD", total: 100 } } });
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "metrics-stop", kind: "stopped" });
  const result = (await f.metrics.capture("store", f.execution.experimentId, "metrics-invalid", new Date(Date.now() + 9 * 86_400_000))).result as any;
  assert.equal(result.state, "invalid");
  assert.ok(result.reasons.includes("participant_currency_changed"));
  assert.ok(result.reasons.includes("stopped_before_fixed_horizon"));
  assert.equal(result.control.assigned, 2); assert.equal(result.promotionAllowed, false);
});

integration("strategy metrics API service scopes exact versions and bounds repeated collection to a server hour", async () => {
  const f = await measuredPopulation();
  const service = new StrategyMetricsService(prisma, f.metrics);
  await assert.rejects(service.read("other", f.id, 1, true), /VERSION_NOT_FOUND/);
  await assert.rejects(service.read("store", f.id, 2, true), /VERSION_NOT_FOUND/);
  const initial = await service.read("store", f.id, 1);
  assert.equal(initial.measurement, null);
  const results = await Promise.all(Array.from({ length: 6 }, () => service.read("store", f.id, 1, true)));
  assert.equal(await prisma.experimentMeasurementReview.count(), 1);
  assert.ok(results.every(row => row.execution?.id === f.execution.id && row.version === 1));
  assert.equal((results[0].execution as any).contract, undefined);
  const serialized = JSON.stringify(results[0]);
  for (const secret of ["metrics-buyer-", "conversation-control", "requestHash"]) assert.ok(!serialized.includes(secret));
  const proposal = await proposalFixture("other");
  assert.deepEqual(await service.read("other", proposal.id, 1, true), { strategyId: proposal.id, version: 1, execution: null, measurement: null });
});

integration("strategy metrics cannot mature sessions by rewriting their entry time", async () => {
  const f = await measuredPopulation();
  await assert.rejects(prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "control-0" } },
    data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } }), /creation time is immutable/);
  const result = (await f.metrics.capture("store", f.execution.experimentId, "metrics-entry-drift")).result as any;
  assert.equal(result.control.mature, 0);
  assert.equal(result.state, "collecting");
  assert.deepEqual(result.reasons, []);
});

async function costCatalog(costInCents: number | null = 2500, merchantId = "store", currency = "BRL") {
  const id = randomUUID();
  const product = await prisma.product.create({ data: { id: `product-${id}`, merchantId, name: "Cost fixture",
    variants: { create: { id, sku: `sku-${id}`, price: { create: { basePriceInCents: 5000, costInCents, currency, taxPercent: 5 } } } } },
    include: { variants: { include: { price: true } } } });
  return product.variants[0];
}
const costLine = (variant: { id: string; sku: string }, quantity = 2) => ({ variantId: variant.id, sku: variant.sku,
  name: "Cost fixture", unitPriceCents: 5000, quantity });
async function costOrder(id: string, lines: unknown, sessionId = "one") {
  return prisma.completedOrder.create({ data: { id, merchantId: "store", sessionId, externalOrderId: id, currency: "BRL",
    orderTotal: 100, completedAt: new Date(), lineItemsJson: lines as any } });
}

integration("catalog cost is captured with the order and cannot be rewritten by price changes or retries", async () => {
  await activate(); const variant = await costCatalog();
  await repo.createSessionIfAbsent(session("one", { cart: { ...session("one").cart,
    items: [{ sku: variant.sku, variantId: variant.id, name: "Fixture", quantity: 2, price: 50, cost: .01 }] } }));
  const input = { merchantId: "store", sessionId: "one", externalOrderId: "cost-one", orderTotal: 100, currency: "BRL" as const,
    status: "approved" as const, completedAt: new Date().toISOString(), lineItems: [costLine(variant)] };
  assert.equal((await repo.transaction(tx => tx.saveCompletedOrder(input))).idempotent, false);
  const original = await prisma.strategyOrderCostSnapshot.findFirstOrThrow();
  assert.equal(original.productCostCents, 5000n); assert.deepEqual(original.issues, []);
  assert.equal((original.lineCosts as any)[0].priceId, variant.price!.id);
  assert.equal((original.lineCosts as any)[0].unitCostCents, 2500);
  await prisma.productPrice.update({ where: { variantId: variant.id }, data: { costInCents: 9000 } });
  assert.equal((await repo.transaction(tx => tx.saveCompletedOrder(input))).idempotent, true);
  assert.deepEqual(await prisma.strategyOrderCostSnapshot.findFirstOrThrow(), original);
  await assert.rejects(prisma.completedOrder.update({ where: { id: original.orderId }, data: { lineItemsJson: [costLine(variant, 1)] } }), /CONTEXT_IMMUTABLE/);
  await assert.rejects(prisma.completedOrder.update({ where: { id: original.orderId }, data: { completedAt: new Date(Date.now() + 86_400_000) } }), /CONTEXT_IMMUTABLE/);
  await prisma.completedOrder.update({ where: { id: original.orderId }, data: { status: "refunded", trackingCode: "updated" } });
  assert.deepEqual(await prisma.strategyOrderCostSnapshot.findFirstOrThrow(), original);
  await assert.rejects(prisma.strategyOrderCostSnapshot.update({ where: { orderId: original.orderId }, data: { productCostCents: 1 } }), /IMMUTABLE/);
  await assert.rejects(prisma.strategyOrderCostSnapshot.delete({ where: { orderId: original.orderId } }), /IMMUTABLE/);
  await assert.rejects(prisma.strategyOrderCostSnapshot.create({ data: { ...original, orderId: "forged", productCostCents: 1 } }), /IMMUTABLE/);
  const scoped = registerTenantMiddleware(prisma, { get: () => ({ merchantId: "other" }) } as any);
  assert.equal(await scoped.strategyOrderCostSnapshot.count({ where: { merchantId: "store" } }), 0);
});

integration("catalog cost missing, foreign, mismatched and invalid lines stay unknown without blocking orders", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const valid = await costCatalog(), missing = await costCatalog(null), foreign = await costCatalog(1, "other"), usd = await costCatalog(1, "store", "USD");
  const cases = [ ["missing", [costLine(missing)], "catalog_cost_missing"],
    ["foreign", [costLine(foreign)], "catalog_price_missing"], ["currency", [costLine(usd)], "catalog_currency_mismatch"],
    ["quantity", [costLine(valid, 0)], "order_line_invalid"], ["empty", [], "order_items_missing"],
    ["not-array", {}, "order_items_missing"], ["partial", [costLine(valid), costLine(missing)], "catalog_cost_missing"] ] as const;
  for (const [id, lines, issue] of cases) {
    await costOrder(id, lines);
    const snapshot = await prisma.strategyOrderCostSnapshot.findUniqueOrThrow({ where: { orderId: id } });
    assert.equal(snapshot.productCostCents, null); assert.ok(snapshot.issues.includes(issue));
  }
  assert.equal(await prisma.completedOrder.count(), cases.length);
});

integration("catalog cost does not infer option costs or expose unsafe monetary totals", async () => {
  await activate(); const variant = await costCatalog();
  await repo.createSessionIfAbsent(session("one", { cart: { ...session("one").cart, items: [{ sku: variant.sku, variantId: variant.id,
    quantity: 2, price: 50, name: "Fixture", selected_options: [{ group_name: "Extra", item_name: "Extra", price_modifier: 10 }] }] } }));
  await costOrder("option-order", [costLine(variant)]);
  assert.ok((await prisma.strategyOrderCostSnapshot.findUniqueOrThrow({ where: { orderId: "option-order" } })).issues.includes("option_cost_unverified"));
  await repo.createSessionIfAbsent(session("plain"));
  const expensive = await costCatalog(2_000_000_000);
  await costOrder("overflow-order", [costLine(expensive, 999_999_999)], "plain");
  const overflow = await prisma.strategyOrderCostSnapshot.findUniqueOrThrow({ where: { orderId: "overflow-order" } });
  assert.equal(overflow.productCostCents, null); assert.ok(overflow.issues.includes("line_product_cost_overflow"));
  assert.equal((overflow.lineCosts as any)[0].costCents, null);
});

integration("catalog cost snapshots roll back with the order and never backfill historical or holdout orders", async () => {
  const variant = await costCatalog();
  await repo.createSessionIfAbsent(session("one"));
  await costOrder("historic", [costLine(variant)]);
  await activate(); await repo.createSessionIfAbsent(session("assigned"));
  await repo.createSessionIfAbsent(session("holdout", { cohort: "holdout" }));
  await costOrder("holdout", [costLine(variant)], "holdout");
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.completedOrder.create({ data: { id: "rolled-back", merchantId: "store", sessionId: "assigned", externalOrderId: "rolled-back",
      currency: "BRL", orderTotal: 100, completedAt: new Date(), lineItemsJson: [costLine(variant)] } });
    assert.equal(await tx.strategyOrderCostSnapshot.count(), 1);
    throw new Error("SIMULATED_ORDER_ROLLBACK");
  }), /ORDER_ROLLBACK/);
  assert.equal(await prisma.strategyOrderCostSnapshot.count(), 0);
  assert.equal(await prisma.completedOrder.count(), 2);
});

integration("catalog cost coverage in strategy results uses frozen costs and never presents partial cost as complete", async () => {
  const f = await measuredPopulation(), variant = await costCatalog();
  await costOrder("covered", [costLine(variant)], "control-0");
  await prisma.productPrice.update({ where: { variantId: variant.id }, data: { costInCents: 9999 } });
  const when = new Date(Date.now() + 25 * 3_600_000);
  const first = (await f.metrics.capture("store", f.execution.experimentId, "catalog-covered", when)).result as any;
  assert.deepEqual(first.economics.control, { orders: 1, capturedOrders: 1, coveredOrders: 1,
    configuredProductCostCents: 5000, knownConfiguredProductCostCents: 5000 });
  assert.equal(first.economics.treatment.configuredProductCostCents, null);
  await costOrder("uncovered", [], "control-1");
  const partial = (await f.metrics.capture("store", f.execution.experimentId, "catalog-partial", when)).result as any;
  assert.equal(partial.economics.control.orders, 2); assert.equal(partial.economics.control.coveredOrders, 1);
  assert.equal(partial.economics.control.configuredProductCostCents, null);
  assert.equal(partial.economics.control.knownConfiguredProductCostCents, 5000);
  assert.equal(partial.contributionCents, null); assert.equal(partial.aiCostCents, null);
});

async function feePayment(id: string, sessionId = "control-0", overrides: Record<string, unknown> = {}) {
  const payment = await prisma.paymentIntent.create({ data: { id: `fee-${id}`, merchantId: "store", sessionId,
    idempotencyKey: id, amountCents: 10000, approvedAmountCents: 10000, currency: "BRL", method: "pix",
    status: "approved", providerPaymentId: id, ...overrides } });
  const settlementLedger = new PrismaPaymentSettlementLedgerRepository(prisma);
  await settlementLedger.appendPlanned({ merchantId: payment.merchantId, paymentIntentId: payment.id,
    provider: "fixture", currency: payment.currency, occurredAt: new Date(), plannedGrossCents: 10000,
    plannedPlatformFeeCents: 100, plannedProviderFeeCents: 0, plannedMerchantNetCents: 9900,
    entries: [{ entryKey: "platform_fee", entryType: "platform_fee", direction: "credit", recipientType: "platform", plannedAmountCents: 100 },
      { entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", plannedAmountCents: 9900 }] });
  const confirm = () => settlementLedger.appendObservation({ merchantId: payment.merchantId, paymentIntentId: payment.id,
    provider: "fixture", currency: payment.currency, providerPaymentId: id, providerSettlementId: `confirmed-${id}`,
    status: "confirmed", occurredAt: new Date(), confirmedAt: new Date(), confirmedGrossCents: 10000,
    confirmedPlatformFeeCents: 120, confirmedProviderFeeCents: 280, confirmedMerchantNetCents: 9600, entries: [] });
  return { payment, confirm };
}

// Malformed/incomplete facts already in the ledger: no provider call and no
// editing append-only snapshots. The normal confirmation uses the real adapter.
async function feeObservation(paymentId: string, overrides: Record<string, unknown> = {}) {
  const prior = await prisma.paymentSettlement.findFirstOrThrow({ where: { paymentIntentId: paymentId }, orderBy: { sequence: "desc" } });
  return prisma.paymentSettlement.create({ data: { merchantId: prior.merchantId, paymentIntentId: paymentId,
    sequence: prior.sequence + 1, provider: "fixture", providerPaymentId: paymentId.replace(/^fee-/, ""),
    providerSettlementId: randomUUID(), status: "confirmed", currency: "BRL", occurredAt: new Date(), confirmedAt: new Date(),
    plannedGrossCents: 10000, plannedPlatformFeeCents: 100, plannedProviderFeeCents: 0, plannedMerchantNetCents: 9900,
    confirmedGrossCents: 10000, confirmedPlatformFeeCents: 120, confirmedProviderFeeCents: 280, confirmedMerchantNetCents: 9600,
    ...overrides } });
}

integration("payment cost coverage uses confirmed fees once and keeps prior measurements immutable", async () => {
  const f = await measuredPopulation(), p = await feePayment("paid");
  await measuredOrder("control-0", "paid", 100); await p.confirm(); await p.confirm();
  const when = new Date(Date.now() + 25 * 3_600_000);
  const first = await f.metrics.capture("store", f.execution.experimentId, "fees-first", when);
  assert.deepEqual((first.result as any).paymentCosts.control, { orders: 1, linkedOrders: 1, coveredOrders: 1,
    confirmedPlatformFeeCents: 120, confirmedProviderFeeCents: 280, confirmedPaymentFeesCents: 400, knownConfirmedPaymentFeesCents: 400 });
  assert.equal(await prisma.paymentSettlement.count(), 2);
  await feeObservation(p.payment.id, { confirmedPlatformFeeCents: 200, confirmedProviderFeeCents: 300, confirmedMerchantNetCents: 9500 });
  const second = await f.metrics.capture("store", f.execution.experimentId, "fees-next", when);
  assert.equal((second.result as any).paymentCosts.control.confirmedPaymentFeesCents, 500);
  assert.notEqual(first.evidenceHash, second.evidenceHash);
  assert.deepEqual(await f.metrics.capture("store", f.execution.experimentId, "fees-first", when), first);
  assert.equal((second.result as any).contributionCents, null);
  assert.equal((second.result as any).promotionAllowed, false);
  for (const secret of [p.payment.id, "confirmed-paid", "metrics-buyer-"]) assert.ok(!JSON.stringify(second.result).includes(secret));
});

integration("payment cost coverage leaves plans and partial groups unavailable and accepts confirmed zero", async () => {
  const f = await measuredPopulation(), one = await feePayment("plan-only");
  await measuredOrder("control-0", "plan-only", 100);
  const when = new Date(Date.now() + 25 * 3_600_000);
  const planned = (await f.metrics.capture("store", f.execution.experimentId, "fees-planned", when)).result as any;
  assert.equal(planned.paymentCosts.control.coveredOrders, 0);
  assert.equal(planned.paymentCosts.control.confirmedPaymentFeesCents, null);
  assert.equal(planned.paymentCosts.control.knownConfirmedPaymentFeesCents, null);
  assert.equal(planned.paymentCosts.treatment.confirmedPaymentFeesCents, null);
  await one.confirm(); await measuredOrder("control-1", "missing-payment", 100);
  const partial = (await f.metrics.capture("store", f.execution.experimentId, "fees-partial", when)).result as any;
  assert.deepEqual(partial.paymentCosts.control, { orders: 2, linkedOrders: 1, coveredOrders: 1,
    confirmedPlatformFeeCents: null, confirmedProviderFeeCents: null, confirmedPaymentFeesCents: null, knownConfirmedPaymentFeesCents: 400 });
  const zero = await feePayment("zero", "treatment-0"); await measuredOrder("treatment-0", "zero", 100);
  await feeObservation(zero.payment.id, { confirmedPlatformFeeCents: 0, confirmedProviderFeeCents: 0, confirmedMerchantNetCents: 10000 });
  const confirmedZero = (await f.metrics.capture("store", f.execution.experimentId, "fees-zero", when)).result as any;
  assert.equal(confirmedZero.paymentCosts.treatment.confirmedPaymentFeesCents, 0);
});

integration("payment cost coverage never falls back past a later incomplete or inconsistent observation", async () => {
  const f = await measuredPopulation(), p = await feePayment("bad-latest");
  await measuredOrder("control-0", "bad-latest", 100); await p.confirm();
  const when = new Date(Date.now() + 25 * 3_600_000);
  const cases = [ { status: "blocked" }, { confirmedProviderFeeCents: null }, { confirmedPlatformFeeCents: null },
    { confirmedMerchantNetCents: null }, { confirmedAt: null }, { confirmedGrossCents: 9999 },
    { confirmedMerchantNetCents: 9500 }, { plannedGrossCents: 9999 }, { currency: "USD" },
    { providerPaymentId: "another-payment" }, { provider: "another-provider" }, { occurredAt: new Date(when.getTime() + 1) },
    { confirmedAt: new Date(when.getTime() + 1) } ];
  for (const [index, change] of cases.entries()) {
    await feeObservation(p.payment.id, change);
    const result = (await f.metrics.capture("store", f.execution.experimentId, `fees-invalid-${index}`, when)).result as any;
    assert.equal(result.paymentCosts.control.coveredOrders, 0, JSON.stringify(change));
    assert.equal(result.paymentCosts.control.confirmedPaymentFeesCents, null, JSON.stringify(change));
  }
});

integration("payment cost coverage binds store session amount currency and current approval", async () => {
  const f = await measuredPopulation();
  const cases = [ { merchantId: "other" }, { sessionId: "different-session" }, { currency: "USD" },
    { amountCents: 10001 }, { approvedAmountCents: 9999 }, { approvedAmountCents: null }, { status: "refunded" } ];
  for (const [index, overrides] of cases.entries()) {
    const id = `identity-${index}`, p = await feePayment(id, "control-0", overrides);
    await p.confirm(); await measuredOrder("control-0", id, 100);
  }
  const result = (await f.metrics.capture("store", f.execution.experimentId, "fees-identities", new Date(Date.now() + 25 * 3_600_000))).result as any;
  assert.equal(result.paymentCosts.control.orders, cases.length);
  assert.equal(result.paymentCosts.control.linkedOrders, cases.length - 2);
  assert.equal(result.paymentCosts.control.coveredOrders, 0);
  assert.equal(result.paymentCosts.control.confirmedPaymentFeesCents, null);
});

integration("payment cost coverage respects recording time maturity and approved order scope", async () => {
  const f = await measuredPopulation(), p = await feePayment("timed");
  await measuredOrder("control-0", "timed", 100); await p.confirm();
  const pending = (await f.metrics.capture("store", f.execution.experimentId, "fees-pending")).result as any;
  assert.equal(pending.paymentCosts.control.orders, 0); assert.equal(pending.paymentCosts.control.confirmedPaymentFeesCents, null);
  const when = new Date(Date.now() + 25 * 3_600_000);
  await feeObservation(p.payment.id, { createdAt: new Date(when.getTime() + 3_600_000), confirmedProviderFeeCents: null });
  const before = (await f.metrics.capture("store", f.execution.experimentId, "fees-before-recording", when)).result as any;
  assert.equal(before.paymentCosts.control.confirmedPaymentFeesCents, 400);
  const after = (await f.metrics.capture("store", f.execution.experimentId, "fees-after-recording", new Date(when.getTime() + 7_200_000))).result as any;
  assert.equal(after.paymentCosts.control.confirmedPaymentFeesCents, null);
  await prisma.completedOrder.update({ where: { id: "timed" }, data: { status: "refunded" } });
  const refunded = (await f.metrics.capture("store", f.execution.experimentId, "fees-refunded", when)).result as any;
  assert.equal(refunded.paymentCosts.control.orders, 0);
  assert.equal(refunded.paymentCosts.control.confirmedPaymentFeesCents, null);
});

const meteredReply = () => ({ outcome: "provider_completed" as const, result: { content: "Posso explicar esta etapa.", toolCalls: [] },
  usage: { prompt_tokens: 12000, completion_tokens: 40, total_tokens: 12040 }, providerEventId: "fixture-usage-event" });
const meteredInput = (id = "one", requestKey = "request-one", merchantId = "store") => ({
  ...turn(id, requestKey, merchantId), userMessage: "buyer message fixture" });
async function plannerRun(now = new Date()) {
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId: "store", cycle: 99, status: "running",
    leaseToken: 1, leaseUntil: new Date(now.getTime() + 600_000), asOf: now } });
  return { runId: run.id, leaseToken: 1 };
}

integration("strategy AI budget reserves before I/O, freezes its tariff and writes one immutable usage event", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one")); let calls = 0;
  const dispatcher = new StrategyChatDispatcher(ledger, { async callPinned() {
    calls++;
    const reservation = await prisma.strategyAiReservation.findFirstOrThrow();
    assert.equal(reservation.state, "dispatched"); assert.equal(reservation.amountMicros, 201n);
    assert.equal(await prisma.aiUsageEvent.count(), 0);
    await prisma.aiPriceVersion.update({ where: { version: "strategy-fixture-price" }, data: { inputMicrosPerMillion: 9000 } });
    return meteredReply();
  } });
  const result = await dispatcher.dispatch(meteredInput()); assert.equal(result.status, "candidate");
  const reservation = await prisma.strategyAiReservation.findFirstOrThrow(), usage = await prisma.aiUsageEvent.findFirstOrThrow();
  assert.equal(reservation.state, "settled"); assert.equal(reservation.inputRate, 1000n);
  assert.equal(usage.costMicros, 13n); assert.equal(usage.costStatus, "estimated");
  assert.equal(usage.source, "checkout_strategy"); assert.equal(usage.providerEventId, "fixture-usage-event");
  assert.equal((await dispatcher.dispatch(meteredInput())).status, "already_admitted"); assert.equal(calls, 1);
  await ledger.settleAi("store", reservation.turnId, meteredReply());
  assert.equal(await prisma.aiUsageEvent.count(), 1);
  await assert.rejects(prisma.strategyAiReservation.update({ where: { turnId: reservation.turnId }, data: { amountMicros: 1 } }), /IMMUTABLE/);
  await assert.rejects(prisma.aiUsageEvent.update({ where: { id: usage.id }, data: { costMicros: 0 } }), /IMMUTABLE/);
  await assert.rejects(prisma.aiUsageEvent.delete({ where: { id: usage.id } }), /IMMUTABLE/);
  const scoped = registerTenantMiddleware(prisma, { get: () => ({ merchantId: "other" }) } as any);
  assert.equal(await scoped.strategyAiReservation.count({ where: { merchantId: "store" } }), 0);
});

integration("strategy AI budget admits only one simultaneous store when the shared daily ceiling is exhausted", async () => {
  await activate(); await activate("other");
  await repo.createSessionIfAbsent(session("one")); await repo.createSessionIfAbsent(session("one", { merchantId: "other" }));
  process.env.REVENUE_AI_DAILY_LIMIT_MICROS = "201"; let calls = 0;
  const dispatcher = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return meteredReply(); } });
  const results = await Promise.all([dispatcher.dispatch(meteredInput()), dispatcher.dispatch(meteredInput("one", "request-one", "other"))]);
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === "candidate").length, 1);
  assert.equal(await prisma.strategyAiReservation.count(), 1);
  assert.equal(await prisma.strategyTurnOutcome.count({ where: { outcome: "provider_not_dispatched" } }), 1);
});

integration("strategy AI budget and the weekly planner share spending in both directions", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const planner = new RevenueAiBudgetService(prisma), context = await plannerRun();
  process.env.REVENUE_AI_DAILY_LIMIT_MICROS = "402";
  const held = await planner.reserve({ merchantId: "store", context, provider: "openai", model: "fixture-model", inputBytes: 10 });
  assert.equal(held.amountMicros, 202n);
  const first = await new StrategyChatDispatcher(ledger, { async callPinned() { assert.fail("planner reservation consumes capacity"); } }).dispatch(meteredInput());
  assert.equal(first.status, "suppressed"); assert.equal(await prisma.strategyAiReservation.count(), 0);
  await planner.settle(held, { prompt_tokens: 0, completion_tokens: 0 });
  process.env.REVENUE_AI_DAILY_LIMIT_MICROS = "210";
  const next = await new StrategyChatDispatcher(ledger, { async callPinned() { return meteredReply(); } }).dispatch(meteredInput("one", "request-two"));
  assert.equal(next.status, "candidate");
  await assert.rejects(planner.reserve({ merchantId: "store", context, provider: "openai", model: "fixture-model", inputBytes: 10 }), /budget_exhausted/);
});

integration("strategy AI budget keeps unreported usage reserved across periods and never turns it into zero", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const missing = { outcome: "provider_completed" as const, result: meteredReply().result };
  assert.equal((await new StrategyChatDispatcher(ledger, { async callPinned() { return missing; } }).dispatch(meteredInput())).status, "candidate");
  const reservation = await prisma.strategyAiReservation.findFirstOrThrow();
  assert.equal(reservation.state, "unknown");
  assert.equal((await prisma.aiUsageEvent.findFirstOrThrow()).costMicros, null);
  const tomorrow = new Date(Date.now() + 2 * 86_400_000), context = await plannerRun(tomorrow);
  process.env.REVENUE_AI_DAILY_LIMIT_MICROS = "402";
  await assert.rejects(new RevenueAiBudgetService(prisma).reserve({ merchantId: "store", context,
    provider: "openai", model: "fixture-model", inputBytes: 10 }, tomorrow), /budget_exhausted/);
  await ledger.settleAi("store", reservation.turnId, meteredReply());
  assert.equal((await prisma.strategyAiReservation.findFirstOrThrow()).state, "settled");
  assert.equal((await prisma.aiUsageEvent.findFirstOrThrow()).costMicros, 13n);
  assert.equal(await prisma.strategyTurn.count(), 1);
});

integration("strategy AI budget denies missing prices and changed scope before any provider request", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  assert.equal(admission.status, "admitted"); if (admission.status !== "admitted") assert.fail("missing admission");
  const budget = new StrategyAiBudget(prisma);
  await assert.rejects(budget.reserve("other", admission.turnId, admission.systemPrompt, "buyer message fixture"), /TURN_NOT_AVAILABLE/);
  await assert.rejects(budget.reserve("store", admission.turnId, "forged prompt", "buyer message fixture"), /CONTEXT_CHANGED/);
  await prisma.aiPriceVersion.deleteMany();
  const result = await new StrategyChatDispatcher(ledger, { async callPinned() { assert.fail("no tariff, no request"); } })
    .dispatch(meteredInput("one", "request-two"));
  assert.equal(result.status, "suppressed"); assert.equal(await prisma.strategyAiReservation.count(), 0);
});

integration("strategy AI budget enforces per-session limits and blocks after an overrun", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  process.env.REVENUE_STRATEGY_AI_SESSION_MAX_CALLS = "1";
  let calls = 0;
  const dispatcher = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return meteredReply(); } });
  assert.equal((await dispatcher.dispatch(meteredInput())).status, "candidate");
  assert.equal((await dispatcher.dispatch(meteredInput("one", "request-two"))).status, "suppressed"); assert.equal(calls, 1);
  await repo.createSessionIfAbsent(session("overrun"));
  const costly = { ...meteredReply(), usage: { prompt_tokens: 200001, completion_tokens: 301, total_tokens: 200302 } };
  await new StrategyChatDispatcher(ledger, { async callPinned() { return costly; } }).dispatch(meteredInput("overrun"));
  assert.equal(await prisma.strategyAiReservation.count({ where: { state: "overrun" } }), 1);
  await repo.createSessionIfAbsent(session("blocked"));
  assert.equal((await new StrategyChatDispatcher(ledger, { async callPinned() { assert.fail("overrun requires reconciliation"); } })
    .dispatch(meteredInput("blocked"))).status, "suppressed");
});

integration("strategy AI budget releases a lost reservation acknowledgement only when no provider was invoked", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const worker = new StrategyExecutionLedger(prisma), reserve = worker.reserveAi.bind(worker);
  worker.reserveAi = async (...args) => { await reserve(...args); throw new Error("RESERVATION_ACK_LOST"); };
  const dispatcher = new StrategyChatDispatcher(worker, { async callPinned() { assert.fail("not dispatched"); } });
  assert.equal((await dispatcher.dispatch(meteredInput())).status, "suppressed");
  assert.equal((await prisma.strategyAiReservation.findFirstOrThrow()).state, "released");
  const usage = await prisma.aiUsageEvent.findFirstOrThrow();
  assert.equal(usage.costMicros, 0n); assert.equal(usage.executionStatus, "not_dispatched");
  assert.equal((await dispatcher.dispatch(meteredInput())).status, "already_admitted");
});

integration("strategy AI budget settlement failure releases no candidate and never repeats the provider", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const worker = new StrategyExecutionLedger(prisma); let calls = 0;
  worker.settleAi = async () => { throw new Error("SETTLEMENT_UNAVAILABLE"); };
  const dispatcher = new StrategyChatDispatcher(worker, { async callPinned() { calls++; return meteredReply(); } });
  await assert.rejects(dispatcher.dispatch(meteredInput()), /SETTLEMENT_UNAVAILABLE/);
  assert.equal((await prisma.strategyAiReservation.findFirstOrThrow()).state, "dispatched");
  assert.equal(await prisma.aiUsageEvent.count(), 0); assert.equal(await prisma.strategyTurnCompletion.count(), 0);
  assert.equal((await dispatcher.dispatch(meteredInput())).status, "already_admitted"); assert.equal(calls, 1);
});

integration("strategy AI usage measures nonbuyers, unresolved calls and later reconciliation without rewriting results", async () => {
  const f = await measuredPopulation();
  const dispatcher = new StrategyChatDispatcher(ledger, { async callPinned() { return meteredReply(); } });
  await dispatcher.dispatch(meteredInput("control-0"));
  const uncertain = await new StrategyChatDispatcher(ledger, { async callPinned() { return { outcome: "provider_unknown" }; } })
    .dispatch(meteredInput("control-1"));
  assert.equal(uncertain.status, "suppressed"); if (!("turnId" in uncertain)) assert.fail("turn required");
  // Missing configuration is proven no-I/O, not an inferred zero for uncertainty.
  process.env.REVENUE_STRATEGY_AI_SESSION_MAX_CALLS = "";
  await dispatcher.dispatch(meteredInput("treatment-0"));
  const asOf = new Date();
  const first = await f.metrics.capture("store", f.execution.experimentId, "ai-usage-before", asOf);
  const result = first.result as any;
  assert.equal(result.control.converted, 0); assert.equal(result.control.mature, 0);
  assert.deepEqual(result.aiUsage.control, { admittedTurns: 2, pricedTurns: 1, notDispatchedTurns: 0, unknownTurns: 1,
    currencies: ["BRL"], currency: "BRL", estimatedCostMicros: null, knownEstimatedCostMicros: 13, heldUpperBoundMicros: 201, overrunTurns: 0 });
  assert.equal(result.aiUsage.treatment.notDispatchedTurns, 1); assert.equal(result.aiUsage.treatment.unknownTurns, 0);
  assert.equal(result.aiCostCents, null); assert.equal(result.contributionCents, null);
  assert.equal(result.delivery.control.publishedTurns, 0);
  await ledger.settleAi("store", uncertain.turnId!, meteredReply());
  assert.deepEqual(await f.metrics.capture("store", f.execution.experimentId, "ai-usage-before", new Date()), first);
  const historical = await f.metrics.capture("store", f.execution.experimentId, "ai-usage-historical", asOf);
  assert.deepEqual((historical.result as any).aiUsage, result.aiUsage);
  const final = (await f.metrics.capture("store", f.execution.experimentId, "ai-usage-after", new Date())).result as any;
  assert.equal(final.aiUsage.control.estimatedCostMicros, 26); assert.equal(final.aiUsage.control.heldUpperBoundMicros, 0);
  assert.equal(final.aiUsage.control.unknownTurns, 0); assert.notEqual(digest(final.aiUsage), digest(result.aiUsage));
});

integration("strategy AI usage never combines native currencies or reads another store's charges", async () => {
  const f = await measuredPopulation();
  const dispatcher = new StrategyChatDispatcher(ledger, { async callPinned() { return meteredReply(); } });
  await dispatcher.dispatch(meteredInput("control-0"));
  await prisma.aiPriceVersion.create({ data: { version: "usd-fixture", provider: "openai", model: "fixture-model",
    channel: "chat", component: "text_generation", currency: "USD", source: "revenue-upper-bound-v1",
    inputMicrosPerMillion: 1000, outputMicrosPerMillion: 2000, effectiveFrom: new Date("2020-01-01Z") } });
  process.env.REVENUE_AI_BUDGET_CURRENCY = "USD";
  await dispatcher.dispatch(meteredInput("control-0", "request-two"));
  await activate("other"); await repo.createSessionIfAbsent(session("control-0", { merchantId: "other" }));
  await dispatcher.dispatch(meteredInput("control-0", "request-one", "other"));
  const result = (await f.metrics.capture("store", f.execution.experimentId, "ai-usage-currencies", new Date())).result as any;
  assert.equal(result.aiUsage.control.admittedTurns, 2); assert.equal(result.aiUsage.control.pricedTurns, 2);
  assert.deepEqual(result.aiUsage.control.currencies, ["BRL", "USD"]);
  assert.equal(result.aiUsage.control.currency, null); assert.equal(result.aiUsage.control.estimatedCostMicros, null);
  assert.equal(result.aiUsage.control.knownEstimatedCostMicros, null); assert.equal(result.aiUsage.control.heldUpperBoundMicros, null);
});

integration("strategy AI budget respects revision reserve, execution ceilings, provider capacity and context caps", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const cases = [
    { REVENUE_AI_DAILY_LIMIT_MICROS: "400", REVENUE_AI_REVISION_RESERVE_PERCENT: "50" },
    { REVENUE_STRATEGY_AI_EXECUTION_LIMIT_MICROS: "200" },
    { REVENUE_AI_PROVIDER_TPM: "200299" },
    { REVENUE_AI_MAX_INPUT_TOKENS: "100" },
    { REVENUE_AI_MAX_OUTPUT_TOKENS: "299" },
  ];
  const original = { ...process.env };
  const dispatcher = new StrategyChatDispatcher(ledger, { async callPinned() { assert.fail("capacity denied before I/O"); } });
  for (const [index, limits] of cases.entries()) {
    Object.assign(process.env, limits);
    assert.equal((await dispatcher.dispatch(meteredInput("one", `limited-${index}`))).status, "suppressed");
    process.env = { ...original };
  }
  assert.equal(await prisma.strategyAiReservation.count(), 0);
});

integration("activation copies the exact reviewed plan and is idempotent under concurrency", async () => {
  const f = await proposalFixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => prisma.$transaction(tx => registerApprovedExecution(tx, "store", f.approvalId))));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(await prisma.promptExperiment.count(), 1);
  const plan = await prisma.experimentMeasurementPlan.findUniqueOrThrow({ where: { experimentId: f.review.experimentId } });
  assert.deepEqual(plan.plan, f.review.plan);
  assert.equal(plan.planHash, f.review.planHash);
  assert.equal(await prisma.strategyExecutionEvent.count(), 1);
  assert.equal(await prisma.strategyAssignment.count(), 0);
});
integration("missing, foreign, wrong or expired approval cannot publish", async () => {
  const f = await proposalFixture();
  await assert.rejects(prisma.$transaction(tx => registerApprovedExecution(tx, "other", f.approvalId)), /APPROVAL_REQUIRED/);
  await assert.rejects(prisma.$transaction(tx => registerApprovedExecution(tx, "store", "missing")), /APPROVAL_REQUIRED/);
  await prisma.revenueStrategyAction.create({ data: { id: "rejected", strategyId: f.id, merchantId: "store", version: 1,
    kind: "reject", actorId: "operator", requestKey: "reject", requestHash: digest("reject"), result: {} } });
  await assert.rejects(prisma.$transaction(tx => registerApprovedExecution(tx, "store", "rejected")), /APPROVAL_REQUIRED/);
  const future = new Date(Date.now() + 8 * 86_400_000);
  await assert.rejects(prisma.$transaction(tx => registerApprovedExecution(tx, "store", f.approvalId, async () => future)), /ACTIVATION_CONFLICT/);
  assert.equal(await prisma.strategyExecution.count(), 0);
});
integration("baseline or model drift blocks activation before rows are published", async () => {
  const f = await proposalFixture();
  process.env.OPENAI_MODEL = "changed-model";
  await assert.rejects(prisma.$transaction(tx => registerApprovedExecution(tx, "store", f.approvalId)), /BASELINE_CHANGED/);
  assert.equal(await prisma.promptExperiment.count(), 0);
});
integration("one live execution per store includes paused executions", async () => {
  const f = await activate();
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" });
  const second = await proposalFixture("store", "two");
  await assert.rejects(prisma.$transaction(tx => registerApprovedExecution(tx, "store", second.approvalId)), /ALREADY_ACTIVE/);
  assert.equal(await prisma.strategyExecution.count(), 1);
});
integration("new checkout enrollment is atomic and includes sessions without chat or purchase", async () => {
  await activate();
  const result = await repo.createSessionIfAbsent(session("one"));
  assert.equal(result.created, true);
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  assert.equal(assignment.sessionId, "one");
  assert.equal(assignment.assignedAt.toISOString(), result.session.createdAt);
  assert.equal(await prisma.strategyTurn.count(), 0);
  assert.equal(await prisma.completedOrder.count(), 0);
  assert.equal(result.session.promptVariantId ?? null, null);
});
integration("transaction rollback removes session and assignment together", async () => {
  await activate();
  await assert.rejects(prisma.$transaction(async tx => {
    const transactional = new PrismaCheckoutRepository(tx, true);
    await transactional.createSessionIfAbsent(session("rollback"));
    assert.equal(await tx.strategyAssignment.count(), 1);
    throw new Error("SIMULATED_CHECKOUT_FAILURE");
  }), /SIMULATED_CHECKOUT_FAILURE/);
  assert.equal(await prisma.checkoutSession.count(), 0);
  assert.equal(await prisma.strategyAssignment.count(), 0);
});
integration("concurrent starts enroll only the first eligible session for a buyer", async () => {
  await activate();
  await Promise.all(Array.from({ length: 12 }, (_, i) => repo.createSessionIfAbsent(session(`s-${i}`, { globalUserId: "same-buyer" }))));
  assert.equal(await prisma.checkoutSession.count(), 12);
  assert.equal(await prisma.strategyAssignment.count(), 1);
  const first = await prisma.checkoutSession.findFirstOrThrow({ orderBy: [{ createdAt: "asc" }, { sessionId: "asc" }] });
  assert.equal((await prisma.strategyAssignment.findFirstOrThrow()).sessionId, first.sessionId);
});
integration("concurrent identical starts are one session and one immutable assignment", async () => {
  await activate();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.createSessionIfAbsent(session("same", { conversationId: `c-${i}` }))));
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(await prisma.strategyAssignment.count(), 1);
  const original = await prisma.strategyAssignment.findFirstOrThrow();
  await repo.createSessionIfAbsent(session("same", { globalUserId: "forged" }));
  assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), original);
});
integration("holdout, missing identity, foreign currency, existing chat and legacy variant never enroll", async () => {
  await activate();
  const excluded = [{ cohort: "holdout" as const }, { globalUserId: " " }, { cart: { ...session("x").cart, currency: "USD" as const } },
    { chatHistory: [{ role: "buyer" as const, text: "hello", occurredAt: new Date().toISOString() }] }, { promptVariantId: "legacy" }];
  for (const [i, value] of excluded.entries()) await repo.createSessionIfAbsent(session(`excluded-${i}`, value));
  assert.equal(await prisma.strategyAssignment.count(), 0);
});
integration("old and missed sessions are not retroactively enrolled on repeat start or later chat", async () => {
  await repo.createSessionIfAbsent(session("old"));
  await activate();
  await repo.createSessionIfAbsent(session("old"));
  await repo.saveSession(session("missed", { globalUserId: "same-buyer" }));
  await repo.createSessionIfAbsent(session("later", { globalUserId: "same-buyer" }));
  assert.equal(await prisma.strategyAssignment.count(), 0);
  assert.equal((await ledger.admitTurn(turn("old"))).status, "unavailable");
});
integration("bootstrap persists holdout before the initial insert, and preserves it on resume", async () => {
  await activate();
  let holdout = true;
  const bootstrap = new CheckoutBootstrapService(repo, { appendOutbox: async () => {} } as any, undefined,
    { assignCohort: () => holdout ? "holdout" : "treatment" } as any);
  const input = { merchant_id: "store", session_id: "holdout", cart: session("x").cart };
  const first = await bootstrap.bootstrap(input, "buyer-holdout", true);
  assert.equal(first.session.cohort, "holdout");
  holdout = false;
  const repeated = await bootstrap.bootstrap(input, "buyer-holdout", true);
  assert.equal(repeated.session.cohort, "holdout");
  assert.equal(await prisma.strategyAssignment.count(), 0);
});
integration("stores are isolated even with the same session and buyer IDs", async () => {
  await activate(); await activate("other");
  await repo.createSessionIfAbsent(session("shared", { globalUserId: "shared-buyer" }));
  await repo.createSessionIfAbsent(session("shared", { merchantId: "other", globalUserId: "shared-buyer" }));
  assert.equal(await prisma.strategyAssignment.count(), 2);
  const a = await ledger.admitTurn(turn("shared"));
  const b = await ledger.admitTurn(turn("shared", "request-one", "other"));
  assert.equal(a.status, "admitted"); assert.equal(b.status, "admitted");
  if (a.status !== "admitted") throw new Error("missing admission");
  await assert.rejects(ledger.recordProviderOutcome("other", a.turnId, "provider_completed"), /TURN_NOT_FOUND/);
});
integration("only one concurrent turn claim returns instructions; retry cannot resend to provider", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const results = await Promise.all(Array.from({ length: 8 }, () => ledger.admitTurn(turn("one"))));
  assert.equal(results.filter(r => r.status === "admitted").length, 1);
  assert.equal(results.filter(r => r.status === "already_admitted").length, 7);
  assert.equal(await prisma.strategyTurn.count(), 1);
  assert.equal(await prisma.strategyTurnOutcome.count(), 0);
  await assert.rejects(ledger.admitTurn({ ...turn("one"), inputHash: digest("different message") }), /TURN_KEY_CONFLICT/);
});
integration("provider completion is immutable, tenant scoped and never means buyer delivery", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const first = await ledger.recordProviderOutcome("store", admission.turnId, "provider_completed");
  assert.deepEqual(await ledger.recordProviderOutcome("store", admission.turnId, "provider_completed"), first);
  await assert.rejects(ledger.recordProviderOutcome("store", admission.turnId, "provider_failed"), /OUTCOME_CONFLICT/);
  await assert.rejects(ledger.recordProviderOutcome("store", admission.turnId, "buyer_delivered" as any), /INVALID_TURN_OUTCOME/);
  assert.equal(await prisma.strategyAssignment.count(), 1);
  await assert.rejects(prisma.strategyTurn.update({ where: { id: admission.turnId }, data: { promptHash: "changed" } }));
  await assert.rejects(prisma.strategyTurnOutcome.delete({ where: { turnId: admission.turnId } }));
});
integration("deterministic and fallback routes never produce admission or exposure", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  for (const route of ["deterministic", "fallback"] as const) assert.equal((await ledger.admitTurn({ ...turn("one"), route })).status, "unavailable");
  assert.equal(await prisma.strategyTurn.count(), 0);
});
integration("configuration drift blocks new instructions while keeping assignment evidence", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  await prisma.merchant.update({ where: { id: "store" }, data: { name: "Changed" } });
  assert.equal((await ledger.admitTurn(turn("one"))).status, "unavailable");
  assert.equal(await prisma.strategyAssignment.count(), 1);
  assert.equal(await prisma.strategyTurn.count(), 0);
});
integration("pause wins subsequent admissions and enrollment; late provider outcome remains recordable", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const admitted = await ledger.admitTurn(turn("one"));
  if (admitted.status !== "admitted") throw new Error("missing admission");
  const command = { merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" as const };
  const paused = await ledger.stop(command);
  assert.deepEqual(await ledger.stop(command), paused);
  await assert.rejects(ledger.stop({ ...command, actorId: "other-operator" }), /STOP_KEY_CONFLICT/);
  await repo.createSessionIfAbsent(session("two"));
  assert.equal((await ledger.admitTurn(turn("one", "next"))).status, "unavailable");
  await ledger.recordProviderOutcome("store", admitted.turnId, "provider_unknown");
  assert.equal(await prisma.strategyAssignment.count(), 1);
  assert.equal((await prisma.strategyExecution.findFirstOrThrow()).endsAt.toISOString(), f.execution.endsAt.toISOString());
});
integration("end boundary is exclusive and cannot be extended; stop is terminal", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const afterDeadline = new StrategyExecutionLedger(prisma, async () => f.execution.endsAt);
  assert.equal((await afterDeadline.admitTurn(turn("one"))).status, "unavailable");
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "stop", kind: "stopped" });
  await assert.rejects(ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" }), /STOP_CONFLICT/);
  await assert.rejects(prisma.strategyExecution.update({ where: { id: f.execution.id }, data: { endsAt: new Date(f.execution.endsAt.getTime() + 1) } }));
});
integration("pause and turn admission serialize; stopping later preserves the first stop time", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const [admission, paused] = await Promise.all([ledger.admitTurn(turn("one")), ledger.stop({ merchantId: "store",
    executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" })]);
  if (admission.status === "admitted") {
    const recorded = await prisma.strategyTurn.findUniqueOrThrow({ where: { id: admission.turnId } });
    assert.ok(recorded.admittedAt <= paused.occurredAt);
  } else assert.equal(admission.status, "unavailable");
  assert.equal((await ledger.admitTurn(turn("one", "later"))).status, "unavailable");
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "stop", kind: "stopped" });
  assert.equal((await prisma.strategyExecution.findFirstOrThrow()).stoppedAt?.toISOString(), paused.occurredAt.toISOString());
  assert.equal((await prisma.promptExperiment.findFirstOrThrow()).completedAt?.toISOString(), paused.occurredAt.toISOString());
});
integration("raw inserts cannot replace approval or the registered plan", async () => {
  const f = await proposalFixture();
  const contract = executionContract({ merchantId: "store", strategyId: f.id, version: 1, runId: f.run.id,
    proposalHash: digest(f.proposal), proposal: f.proposal });
  await prisma.promptExperiment.create({ data: { id: f.review.experimentId, merchantId: "store", name: "Raw fixture", status: "draft",
    measurementPlan: { create: { planHash: "wrong-plan", plan: {} } } } });
  const now = new Date();
  await assert.rejects(prisma.strategyExecution.create({ data: { id: "forged", merchantId: "store", strategyId: f.id, version: 1,
    approvalActionId: f.approvalId, experimentId: f.review.experimentId, proposalHash: digest(f.proposal), contractHash: digest(contract),
    contract: contract as any, status: "running", startedAt: now, endsAt: new Date(now.getTime() + 7 * 86_400_000) } }));
  assert.equal(await prisma.strategyExecution.count(), 0);
});
integration("new session reaching the exact enrollment deadline is not assigned", async () => {
  const f = await activate();
  await prisma.$transaction(async tx => {
    await lockExecutionMerchant(tx, "store");
    const row = await tx.checkoutSession.create({ data: { merchantId: "store", sessionId: "boundary", globalUserId: "buyer",
      conversationId: "conversation", cart: { currency: "BRL" }, cohort: "treatment", chatHistory: [],
      createdAt: new Date(), updatedAt: new Date() } });
    await enrollCreatedStrategySession(tx, row, f.execution.endsAt);
  });
  assert.equal(await prisma.strategyAssignment.count(), 0);
});
integration("flags stop admissions and assignments, preserve outcomes and allow stopping", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false";
  await repo.createSessionIfAbsent(session("two"));
  assert.equal((await ledger.admitTurn(turn("one", "next"))).status, "unavailable");
  await ledger.recordProviderOutcome("store", admission.turnId, "provider_failed");
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "stop", kind: "stopped" });
  assert.equal(await prisma.strategyAssignment.count(), 1);
});
integration("legacy experiment completion also blocks new admissions and enrollments", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  await prisma.promptExperiment.update({ where: { id: f.execution.experimentId }, data: { status: "completed", completedAt: new Date() } });
  await repo.createSessionIfAbsent(session("two"));
  assert.equal((await ledger.admitTurn(turn("one"))).status, "unavailable");
  assert.equal(await prisma.strategyAssignment.count(), 1);
});
integration("database rejects assignment, approval binding, contract and session identity tampering", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  await assert.rejects(prisma.strategyAssignment.update({ where: { id: assignment.id }, data: { arm: "control" } }));
  await assert.rejects(prisma.strategyAssignment.delete({ where: { id: assignment.id } }));
  await assert.rejects(prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "one" } }, data: { createdAt: new Date(0) } }));
  await assert.rejects(prisma.strategyExecution.update({ where: { id: f.execution.id }, data: { proposalHash: "changed" } }));
  await assert.rejects(prisma.strategyExecution.delete({ where: { id: f.execution.id } }));
  await assert.rejects(prisma.strategyAssignment.create({ data: { ...assignment, id: "foreign-assignment", merchantId: "other" } }));
});
integration("identity verification or correction keeps checkout working and permanently stops that assignment", async () => {
  await activate(); const created = await repo.createSessionIfAbsent(session("one"));
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  await repo.saveSession({ ...created.session, globalUserId: "verified-buyer" });
  assert.equal((await repo.getSession("store", "one"))?.globalUserId, "verified-buyer");
  assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
  const stopped = await prisma.strategyAssignmentStop.findFirstOrThrow();
  assert.equal(stopped.reason, "session_context_changed");
  assert.equal((await ledger.admitTurn(turn("one"))).status, "unavailable");
  await repo.saveSession(created.session);
  assert.equal((await ledger.admitTurn(turn("one", "after-restore"))).status, "unavailable");
  assert.equal(await prisma.strategyAssignment.count(), 1);
  assert.equal(await prisma.strategyAssignmentStop.count(), 1);
  await assert.rejects(prisma.strategyAssignmentStop.delete({ where: { assignmentId: assignment.id } }));
});
integration("control is exactly the captured baseline and treatment only appends communication", async () => {
  const f = await activate();
  const contract = executionContract({ merchantId: "store", strategyId: f.id, version: 1, runId: f.run.id,
    proposalHash: digest(f.proposal), proposal: f.proposal });
  const context = { cartInfo: "Carrinho verificado", stage: "payment", buyerIntent: { primary_intent: "gift" }, paymentJustFailed: true };
  const baseline = renderCheckoutChatBaseline(f.baseline, "store", context);
  assert.equal(renderStrategyTurn(contract, f.baseline, "control", context), baseline);
  const treatment = renderStrategyTurn(contract, f.baseline, "treatment", context);
  assert.ok(treatment.startsWith(baseline + "\n\n"));
  assert.ok(treatment.endsWith(f.proposal.recommendation.template.variant_b.system_prompt));
  assert.equal(treatment.includes("checkout-chat-baseline-v1:"), false);
  assert.equal(strategyArm(contract, "buyer"), strategyArm(contract, "buyer"));
  const controlCount = Array.from({ length: 1000 }, (_, i) => strategyArm(contract, `buyer-${i}`)).filter(a => a === "control").length;
  assert.ok(controlCount > 430 && controlCount < 570);
  assert.throws(() => executionContract({ merchantId: "other", strategyId: f.id, version: 1, runId: f.run.id,
    proposalHash: digest(f.proposal), proposal: f.proposal }), /INVALID_PROPOSAL/);
});
test("execution requires explicit store opt-in; missing flag and wildcard do not enable it", () => {
  assert.equal(strategyExecutionEnabled("store", {}), false);
  assert.equal(strategyExecutionEnabled("store", { REVENUE_STRATEGY_EXECUTION_ENABLED: "true", REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS: "*" }), false);
  assert.equal(strategyExecutionEnabled("store", { REVENUE_STRATEGY_EXECUTION_ENABLED: "true", REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS: "store, another" }), true);
});

const completed = { outcome: "provider_completed" as const, result: { content: "Posso explicar a etapa atual.", toolCalls: [] } };
const dispatchInput = (key = "message-one") => ({ ...turn("one", key), userMessage: "Como funciona esta etapa?" });
const dispatcher = () => new StrategyChatDispatcher(ledger, new ChatLlmGatewayService());
function providerResponse() {
  return Response.json({ model: "fixture-model", choices: [{ finish_reason: "stop",
    message: { role: "assistant", content: completed.result.content } }] });
}

integration("pinned gateway and PostgreSQL completion keep exact control/treatment and do not invent exposure", async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(await providerResponse().text());
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENAI_BASE_URL = endpoint;
  globalThis.fetch = ((url, init) => {
    assert.equal(String(url), `${endpoint}/chat/completions`);
    return originalFetch(url, init);
  }) as typeof fetch;
  try {
    const f = await activate();
    const contract = f.execution.contract as any;
    for (const arm of ["control", "treatment"] as const) {
      const buyerId = Array.from({ length: 100 }, (_, i) => `arm-buyer-${i}`).find(id => strategyArm(contract, id) === arm)!;
      await repo.createSessionIfAbsent(session(arm, { globalUserId: buyerId }));
      const input = { ...dispatchInput(), sessionId: arm };
      const result = await dispatcher().dispatch(input);
      assert.equal(result.status, "candidate");
      if (result.status !== "candidate") throw new Error("missing candidate");
      assert.equal(result.completion.decision, "eligible_at_recording");
      assert.equal(result.completion.responseHash, digest(completed.result));
      assert.deepEqual(requests.at(-1), { model: "fixture-model", tools: f.baseline.tools, ...f.baseline.sampling,
        messages: [{ role: "system", content: renderStrategyTurn(contract, f.baseline, arm, input.turn) },
          { role: "user", content: input.userMessage }] });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(await prisma.strategyTurnOutcome.count(), 2);
  assert.equal(await prisma.strategyTurnCompletion.count(), 2);
  for (const s of await prisma.checkoutSession.findMany()) { assert.deepEqual(s.chatHistory, []); assert.equal(s.promptVariantId, null); }
  assert.equal(await prisma.completedOrder.count(), 0);
  assert.equal(JSON.stringify(await prisma.strategyTurnCompletion.findMany()).includes(completed.result.content), false);
});

integration("concurrent and repeated dispatch uses one provider attempt and never replays the candidate", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  const worker = dispatcher();
  const results = await Promise.all(Array.from({ length: 8 }, () => worker.dispatch(dispatchInput())));
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === "candidate").length, 1);
  assert.equal(results.filter(r => r.status === "already_admitted").length, 7);
  assert.equal((await worker.dispatch(dispatchInput())).status, "already_admitted");
  await assert.rejects(worker.dispatch({ ...dispatchInput(), userMessage: "different" }), /TURN_KEY_CONFLICT/);
  assert.equal(calls, 1);
});

integration("provider timeout or crash is durable uncertainty and retry cannot spend again", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("provider connection lost after send"); }) as typeof fetch;
  const result = await dispatcher().dispatch(dispatchInput());
  assert.equal(result.status, "suppressed");
  const receipt = await prisma.strategyTurnCompletion.findFirstOrThrow();
  assert.equal(receipt.reason, "provider_unknown"); assert.equal(receipt.responseHash, null);
  assert.equal((await dispatcher().dispatch(dispatchInput())).status, "already_admitted");
  assert.equal(calls, 1);
  await assert.rejects(ledger.completeTurn("store", receipt.turnId, completed), /OUTCOME_CONFLICT/);
});

integration("crash after admission but before provider call never blindly redispatches", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const input = dispatchInput();
  await ledger.admitTurn({ ...input, inputHash: digest(input.userMessage) });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  assert.equal((await dispatcher().dispatch(input)).status, "already_admitted");
  assert.equal(calls, 0); assert.equal(await prisma.strategyTurnOutcome.count(), 0);
});

integration("deterministic, fallback, holdout and disabled dispatch never create a provider claim", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  await repo.createSessionIfAbsent(session("holdout", { cohort: "holdout" }));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  for (const route of ["deterministic", "fallback"] as const) assert.equal((await dispatcher().dispatch({ ...dispatchInput(), route })).status, "unavailable");
  assert.equal((await dispatcher().dispatch({ ...dispatchInput(), sessionId: "holdout" })).status, "unavailable");
  process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED = "false";
  assert.equal((await dispatcher().dispatch(dispatchInput())).status, "unavailable");
  assert.equal(calls, 0); assert.equal(await prisma.strategyTurn.count(), 0);
});

const interruptions: Array<[string, (f: Awaited<ReturnType<typeof activate>>) => Promise<void>]> = [
  ["execution_stopped", async f => { await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" }); }],
  ["assignment_stopped", async () => { await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "one" } }, data: { globalUserId: "corrected-buyer" } }); }],
  ["session_changed", async () => { await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: "one" } }, data: { cart: { ...session("one").cart, total: 200 } } }); }],
  ["baseline_changed", async () => { await prisma.merchant.update({ where: { id: "store" }, data: { name: "Changed store" } }); }],
  ["experiment_stopped", async f => { await prisma.promptExperiment.update({ where: { id: f.execution.experimentId }, data: { status: "completed", completedAt: new Date() } }); }],
  ["execution_disabled", async () => { process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false"; }],
  ["dispatch_disabled", async () => { process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED = "false"; }],
];
for (const [reason, interrupt] of interruptions) integration(`in-flight provider result is suppressed after ${reason}`, async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  globalThis.fetch = (async () => { await interrupt(f); return providerResponse(); }) as typeof fetch;
  const result = await dispatcher().dispatch(dispatchInput());
  assert.equal(result.status, "suppressed");
  if (result.status !== "suppressed") throw new Error("unexpected candidate");
  assert.equal(result.completion.reason, reason); assert.equal("result" in result, false);
  assert.equal((await prisma.strategyTurnOutcome.findFirstOrThrow()).outcome, "provider_completed");
  assert.deepEqual((await prisma.checkoutSession.findFirstOrThrow()).chatHistory, []);
});

integration("completion at the fixed deadline is suppressed and keeps provider evidence", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const atDeadline = new StrategyExecutionLedger(prisma, async () => f.execution.endsAt);
  const result = await atDeadline.completeTurn("store", admission.turnId, completed);
  assert.equal(result.decision, "suppressed"); assert.equal(result.reason, "outside_horizon");
});

integration("completions are immutable, tenant bound and idempotent by exact response", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const results = await Promise.all(Array.from({ length: 6 }, () => ledger.completeTurn("store", admission.turnId, completed)));
  assert.ok(results.every(r => r.recordedAt.toISOString() === results[0].recordedAt.toISOString()));
  assert.equal(await prisma.strategyTurnCompletion.count(), 1);
  await assert.rejects(ledger.completeTurn("other", admission.turnId, completed), /NOT_FOUND/);
  await assert.rejects(ledger.completeTurn("store", admission.turnId, { ...completed, result: { ...completed.result, content: "changed" } }), /RESPONSE_CONFLICT/);
  await assert.rejects(prisma.strategyTurnCompletion.update({ where: { turnId: admission.turnId }, data: { reason: "changed" } }));
  await assert.rejects(prisma.strategyTurnCompletion.delete({ where: { turnId: admission.turnId } }));
  await assert.rejects(prisma.strategyTurn.update({ where: { id: admission.turnId }, data: { sessionContextHash: "f".repeat(64) } }));
});

integration("completed provider plus completion receipt roll back atomically on insertion failure", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const beforeAdmission = new StrategyExecutionLedger(prisma, async () => new Date(0));
  await assert.rejects(beforeAdmission.completeTurn("store", admission.turnId, completed));
  assert.equal(await prisma.strategyTurnOutcome.count(), 0);
  assert.equal(await prisma.strategyTurnCompletion.count(), 0);
  const good = await ledger.completeTurn("store", admission.turnId, completed);
  assert.equal(good.decision, "eligible_at_recording");
});

integration("database rejects completion without matching provider evidence or after pause", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const data = { turnId: admission.turnId, merchantId: "store", responseHash: digest(completed.result),
    decision: "eligible_at_recording", reason: "current_at_recording", recordedAt: new Date() };
  await assert.rejects(prisma.strategyTurnCompletion.create({ data }));
  await ledger.recordProviderOutcome("store", admission.turnId, "provider_completed");
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" });
  await assert.rejects(prisma.strategyTurnCompletion.create({ data: { ...data, recordedAt: new Date() } }));
  assert.equal(await prisma.strategyTurnCompletion.count(), 0);
});

integration("pause racing completion serializes and the receipt never claims delivery", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const [completion, paused] = await Promise.all([ledger.completeTurn("store", admission.turnId, completed),
    ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" })]);
  if (completion.decision === "eligible_at_recording") assert.ok(completion.recordedAt <= paused.occurredAt);
  else assert.equal(completion.reason, "execution_stopped");
  assert.deepEqual((await prisma.checkoutSession.findFirstOrThrow()).chatHistory, []);
});

integration("changing and restoring the cart cannot restore eligibility for an in-flight turn", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const admission = await ledger.admitTurn(turn("one"));
  if (admission.status !== "admitted") throw new Error("missing admission");
  const original = await prisma.checkoutSession.findFirstOrThrow();
  const where = { merchantId_sessionId: { merchantId: "store", sessionId: "one" } };
  await prisma.checkoutSession.update({ where, data: { cart: { ...session("one").cart, total: 200 } } });
  await prisma.checkoutSession.update({ where, data: { cart: original.cart!, updatedAt: original.updatedAt,
    strategyContextVersion: original.strategyContextVersion, version: original.version } });
  const restored = await prisma.checkoutSession.findFirstOrThrow();
  assert.equal(restored.strategyContextVersion, original.strategyContextVersion + 2);
  assert.equal((await ledger.completeTurn("store", admission.turnId, completed)).reason, "session_changed");
});

integration("historical admissions without a frozen session never become eligible", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  const historical = await prisma.strategyTurn.create({ data: { id: "historical", merchantId: "store", assignmentId: assignment.id,
    requestKey: "old-message", inputHash: digest("old"), promptHash: digest("old-prompt"), admittedAt: new Date() } });
  assert.equal((await ledger.completeTurn("store", historical.id, completed)).reason, "session_changed");
});

integration("model drift after admission is recorded as not dispatched with zero provider requests", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  const wrapped = { admitTurn: async (...args: Parameters<StrategyExecutionLedger["admitTurn"]>) => {
    const admission = await ledger.admitTurn(...args); process.env.OPENAI_MODEL = "changed"; return admission;
  }, reserveAi: ledger.reserveAi.bind(ledger), settleAi: ledger.settleAi.bind(ledger),
  completeTurn: ledger.completeTurn.bind(ledger) } as StrategyExecutionLedger;
  const result = await new StrategyChatDispatcher(wrapped, new ChatLlmGatewayService()).dispatch(dispatchInput());
  assert.equal(result.status, "suppressed");
  assert.equal((await prisma.strategyTurnOutcome.findFirstOrThrow()).outcome, "provider_not_dispatched");
  assert.equal((await prisma.strategyTurnCompletion.findFirstOrThrow()).responseHash, null);
  assert.equal(calls, 0);
});

integration("failure to persist a completion releases no candidate and retry cannot send again", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  const wrapped = { admitTurn: ledger.admitTurn.bind(ledger), reserveAi: ledger.reserveAi.bind(ledger), settleAi: ledger.settleAi.bind(ledger),
    completeTurn: async () => { throw new Error("SIMULATED_DATABASE_OUTAGE"); } } as unknown as StrategyExecutionLedger;
  await assert.rejects(new StrategyChatDispatcher(wrapped, new ChatLlmGatewayService()).dispatch(dispatchInput()), /DATABASE_OUTAGE/);
  assert.equal((await dispatcher().dispatch(dispatchInput())).status, "already_admitted");
  assert.equal(await prisma.strategyTurnOutcome.count(), 0);
  assert.equal(calls, 1);
});

function primarySession(sessionId: string, overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return session(sessionId, { customer: { fullName: "Fixture Buyer", email: "fixture@example.invalid", email_verified: true,
    cpf: "52998224725", phone: "11987654321", address_verified: true,
    address: { zip: "01001000", street: "Fixture Street", city: "Sao Paulo", state: "SP", number: "1", complement: "" } },
    shipping: { customerPrice: 10, realCost: 12, region: "SP" }, ...overrides });
}
const boundTurn = (sessionId: string, claim: { requestId: string; requestHash: string }, userMessage: string) => ({
  merchantId: "store", sessionId, requestKey: claim.requestId, chatRequest: claim, userMessage, route: "primary_llm" as const,
});
const buyerRequest = (sessionId = "one") => ({ merchant_id: "store", session_id: sessionId,
  conversation_id: `conversation-${sessionId}`, message_id: randomUUID(), user_message: "Como funciona esta etapa?" });
async function claimFixture(sessionId = "one") {
  const input = buyerRequest(sessionId);
  const { requestHash } = chatMessageIdentity(input);
  const row = await prisma.checkoutChatRequest.create({ data: { id: randomUUID(), merchantId: "store", sessionId,
    conversationId: input.conversation_id, messageId: input.message_id, requestHash,
    buyerMessageHash: chatMessageTextHash(input.user_message), protocolVersion: 2, status: "processing", startedAt: new Date() } });
  return { input, claim: { requestId: row.id, requestHash } };
}
async function boundCandidate(result = completed.result, sessionId = "one") {
  const f = await claimFixture(sessionId);
  const dispatcherInput = boundTurn(sessionId, f.claim, f.input.user_message);
  const dispatched = await new StrategyChatDispatcher(ledger, { async callPinned() { return { outcome: "provider_completed", result }; } }).dispatch(dispatcherInput);
  assert.equal(dispatched.status, "candidate");
  if (dispatched.status !== "candidate") throw new Error("candidate missing");
  return { merchantId: "store", sessionId, turnId: dispatched.turnId, claim: f.claim,
    userMessage: f.input.user_message, result: dispatched.result };
}

integration("durable request, pinned gateway and publication persist the exact control and treatment response", async () => {
  const f = await activate();
  let calls = 0;
  const sent: any[] = [];
  globalThis.fetch = (async (_url: unknown, options: any) => { calls++; sent.push(JSON.parse(options.body)); return providerResponse(); }) as typeof fetch;
  const publisher = new StrategyChatPublisher(prisma), requests = new CheckoutChatRequestService(prisma);
  for (const arm of ["control", "treatment"] as const) {
    const buyer = Array.from({ length: 100 }, (_, i) => `publication-buyer-${i}`)
      .find(id => strategyArm(f.execution.contract as any, id) === arm)!;
    await repo.createSessionIfAbsent(primarySession(arm, { globalUserId: buyer }));
    const response = await requests.run(buyerRequest(arm), async () => {}, async (message, claim) => {
      assert.ok(claim);
      const candidate = await dispatcher().dispatch(boundTurn(arm, claim, message.user_message));
      assert.equal(candidate.status, "candidate");
      if (candidate.status !== "candidate") throw new Error("candidate missing");
      const publication = await publisher.publish({ merchantId: "store", sessionId: arm, turnId: candidate.turnId,
        claim, userMessage: message.user_message, result: candidate.result });
      if (publication.status !== "persisted") throw new Error("publication missing");
      return { message: publication.message, objection: "unknown", actions: [], turns: publication.session.chatHistory };
    });
    assert.equal(sent.at(-1).messages[0].content, renderStrategyTurn(f.execution.contract as any, f.baseline, arm,
      { cartInfo: "Carrinho: R$100.00", stage: "payment", paymentJustFailed: false }));
    assert.doesNotMatch(sent.at(-1).messages[0].content, /fixture@example|52998224725|Fixture Street/);
    assert.equal(response.chat_request?.status, "completed");
    assert.equal(response.message, completed.result.content);
    assert.equal(response.turns.length, 2);
  }
  assert.equal(calls, 2); assert.equal(await prisma.strategyTurnPublication.count(), 2);
  assert.equal(await prisma.checkoutChatExchange.count(), 2); assert.equal(await prisma.completedOrder.count(), 0);
  assert.equal(JSON.stringify(await prisma.strategyTurnPublication.findMany()).includes(completed.result.content), false);
});

integration("bound admission rejects another request, text, key, tenant and personalized context before provider I/O", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const f = await claimFixture();
  const original = boundTurn("one", f.claim, f.input.user_message);
  let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return completed; } });
  for (const patch of [{ requestKey: "wrong" }, { userMessage: "changed" },
    { chatRequest: { ...f.claim, requestHash: "f".repeat(64) } },
    { turn: { cartInfo: "Forged", buyerIntent: { primary_intent: "discount" } } },
    { turn: { cartInfo: "Carrinho: R$0.01" } }, { turn: { stage: "completed" } },
    { turn: { paymentJustFailed: true } }, { turn: {} }]) {
    await assert.rejects(worker.dispatch({ ...original, ...patch } as any), /CHAT_REQUEST_CONFLICT|CALLER_CONTEXT_UNSUPPORTED/);
  }
  await activate("other"); await repo.createSessionIfAbsent(primarySession("one", { merchantId: "other" }));
  await assert.rejects(worker.dispatch({ ...original, merchantId: "other" }), /CHAT_REQUEST_CONFLICT/);
  assert.equal(calls, 0); assert.equal(await prisma.strategyTurn.count(), 0);
});

integration("simultaneous publications append once and return only receipts on repeats", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const candidate = await boundCandidate();
  const publisher = new StrategyChatPublisher(prisma);
  const results = await Promise.all(Array.from({ length: 6 }, () => publisher.publish(candidate)));
  assert.equal(results.filter(r => r.status === "persisted").length, 1);
  for (const result of results.filter(r => r.status === "already_decided")) {
    assert.equal("message" in result, false); assert.equal("session" in result, false);
  }
  assert.equal(await prisma.strategyTurnPublication.count(), 1);
  assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 2);
});

integration("bound dispatch uses the current persisted cart and last-agent signal instead of request fields", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const stored = (await repo.getSession("store", "one"))!;
  await repo.saveSession({ ...stored, cart: { ...stored.cart, total: 199.99 } });
  await repo.appendChatTurn("store", "one", { role: "agent", text: "Pagamento falhou. Escolha outra forma.", occurredAt: new Date().toISOString() });
  const request = await claimFixture();
  let prompt = "";
  const worker = new StrategyChatDispatcher(ledger, { async callPinned(_merchant, _baseline, messages) {
    prompt = messages[0].content; return completed;
  } });
  const result = await worker.dispatch({ ...boundTurn("one", request.claim, request.input.user_message),
    cartInfo: "FORGED_PRICE", stage: "completed", paymentJustFailed: false, buyerIntent: { primary_intent: "FORGED_INTENT" } } as any);
  assert.equal(result.status, "candidate");
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  assert.equal(prompt, renderStrategyTurn(f.execution.contract as any, f.baseline, assignment.arm as any,
    { cartInfo: "Carrinho: R$199.99", stage: "payment", paymentJustFailed: true }));
  assert.doesNotMatch(prompt, /FORGED_PRICE|FORGED_INTENT|fixture@example/);
});

integration("bound requests cannot dispatch from a persisted deterministic stage", async () => {
  await activate();
  let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return completed; } });
  for (const [id, overrides] of [
    ["no-customer", { customer: undefined }],
    ["unverified", { customer: { ...primarySession("x").customer!, email_verified: false } }],
    ["no-shipping", { shipping: undefined }],
  ] as const) {
    await repo.createSessionIfAbsent(primarySession(id, overrides));
    const request = await claimFixture(id);
    assert.equal((await worker.dispatch(boundTurn(id, request.claim, request.input.user_message))).status, "unavailable");
  }
  assert.equal(calls, 0); assert.equal(await prisma.strategyTurn.count(), 0);
});

integration("persisted malformed BRL totals block bound admission without spending a provider call", async () => {
  await activate();
  let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return completed; } });
  for (const [index, total] of [-1, 1.001, "100", null, Number.MAX_SAFE_INTEGER].entries()) {
    const id = `invalid-${index}`;
    await repo.createSessionIfAbsent(primarySession(id, { cart: { ...session(id).cart, total: total as any } }));
    const request = await claimFixture(id);
    assert.equal((await worker.dispatch(boundTurn(id, request.claim, request.input.user_message))).status, "unavailable");
  }
  assert.equal(calls, 0); assert.equal(await prisma.strategyTurn.count(), 0);
});

integration("retry after a changed bound session returns only admission receipt without re-rendering or re-sending", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const request = await claimFixture();
  let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return { outcome: "provider_unknown" }; } });
  const input = boundTurn("one", request.claim, request.input.user_message);
  assert.equal((await worker.dispatch(input)).status, "suppressed");
  const original = await prisma.strategyTurn.findFirstOrThrow();
  const stored = (await repo.getSession("store", "one"))!;
  await repo.saveSession({ ...stored, cart: { ...stored.cart, total: 200 } });
  assert.deepEqual(await worker.dispatch(input), { status: "already_admitted", turnId: original.id });
  assert.deepEqual(await prisma.strategyTurn.findFirstOrThrow(), original);
  assert.equal(calls, 1);
});

for (const scenario of ["pause", "cart_restore", "identity", "baseline", "publication_flag", "dispatch_flag", "execution_flag", "horizon"] as const) {
  integration(`publication revalidates ${scenario} after eligible completion`, async () => {
    const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
    const candidate = await boundCandidate();
    let expected: string;
    if (scenario === "pause") {
      await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" });
      expected = "execution_stopped";
    } else if (scenario === "cart_restore") {
      const before = await prisma.checkoutSession.findFirstOrThrow();
      await prisma.checkoutSession.update({ where: { id: before.id }, data: { cart: { currency: "BRL", total: 500 } } });
      await prisma.checkoutSession.update({ where: { id: before.id }, data: { cart: before.cart!, updatedAt: before.updatedAt } });
      expected = "session_changed";
    } else if (scenario === "identity") {
      await prisma.checkoutSession.updateMany({ data: { globalUserId: "changed" } }); expected = "assignment_stopped";
    } else if (scenario === "baseline") {
      await repo.setRules("store", { minimumMarginPercent: 40 }); expected = "baseline_changed";
    } else if (scenario === "publication_flag") {
      process.env.REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED = "false"; expected = "publication_disabled";
    } else if (scenario === "dispatch_flag") {
      process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED = "false"; expected = "dispatch_disabled";
    } else if (scenario === "execution_flag") {
      process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false"; expected = "execution_disabled";
    } else expected = "outside_horizon";
    const publisher = new StrategyChatPublisher(prisma, scenario === "horizon" ? async () => f.execution.endsAt : undefined);
    const result = await publisher.publish(candidate);
    assert.equal(result.status, "suppressed"); assert.equal(result.publication.reason, expected);
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
    assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 0);
    process.env.REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED = "true";
    assert.equal((await publisher.publish(candidate)).status, "already_decided");
  });
}

for (const [name, result, reason] of [
  ["tool call", { content: "Vou ajudar.", toolCalls: [{ function: { name: "apply_discount", arguments: "{\"percent\":10}" } }] }, "unsupported_response"],
  ["empty response", { content: " ", toolCalls: [] }, "unsupported_response"],
  ["unauthorized claim", { content: "Vou aplicar um desconto de 10%.", toolCalls: [] }, "unsafe_message"],
] as const) {
  integration(`publication suppresses ${name} without tool or commercial effects`, async () => {
    await activate(); await repo.createSessionIfAbsent(primarySession("one"));
    const before = (await repo.getSession("store", "one"))!.cart;
    const candidate = await boundCandidate(structuredClone(result) as any);
    const decision = await new StrategyChatPublisher(prisma).publish(candidate);
    assert.equal(decision.status, "suppressed"); assert.equal(decision.publication.reason, reason);
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
    assert.deepEqual((await repo.getSession("store", "one"))!.cart, before);
    assert.equal(await prisma.completedOrder.count(), 0);
  });
}

integration("altered candidate, foreign publication and unbound legacy admission cannot publish", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const publisher = new StrategyChatPublisher(prisma), candidate = await boundCandidate();
  await assert.rejects(publisher.publish({ ...candidate, result: { ...candidate.result, content: "changed" } }), /RESPONSE_CONFLICT/);
  await assert.rejects(publisher.publish({ ...candidate, merchantId: "other" }), /REQUEST_CONFLICT/);
  await assert.rejects(publisher.publish({ ...candidate, userMessage: "changed" }), /REQUEST_CONFLICT/);
  await repo.createSessionIfAbsent(primarySession("legacy"));
  const f = await claimFixture("legacy");
  const old = await new StrategyChatDispatcher(ledger, { async callPinned() { return completed; } })
    .dispatch({ ...turn("legacy"), userMessage: f.input.user_message });
  if (old.status !== "candidate") throw new Error("candidate missing");
  await assert.rejects(publisher.publish({ ...candidate, sessionId: "legacy", claim: f.claim, turnId: old.turnId }), /REQUEST_CONFLICT/);
  assert.equal(await prisma.checkoutChatExchange.count(), 0); assert.equal(await prisma.strategyTurnPublication.count(), 0);
});

integration("a bound exchange cannot bypass publication through the normal repository", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const candidate = await boundCandidate();
  await assert.rejects(repo.appendChatExchange({ merchantId: "store", sessionId: "one", claim: candidate.claim,
    expectedSession: await repo.getSession("store", "one"),
    buyer: { role: "buyer", text: candidate.userMessage, occurredAt: new Date().toISOString() },
    agent: { role: "agent", text: completed.result.content, occurredAt: new Date().toISOString() } }), /PUBLICATION_REQUIRED/);
  assert.equal(await prisma.checkoutChatExchange.count(), 0);
  assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 0);
});

integration("failure after publication insertion rolls back pair, exchange and decision together", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const candidate = await boundCandidate();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "strategyTurnPublication") return Reflect.get(transaction, key);
      return new Proxy(transaction.strategyTurnPublication, { get(delegate, method) {
        if (method !== "create") return Reflect.get(delegate, method);
        return async (args: any) => { await delegate.create(args); throw new Error("AFTER_PUBLICATION_INSERT"); };
      } });
    } })));
  } }) as PrismaClient;
  await assert.rejects(new StrategyChatPublisher(broken).publish(candidate), /AFTER_PUBLICATION_INSERT/);
  assert.equal(await prisma.strategyTurnPublication.count(), 0); assert.equal(await prisma.checkoutChatExchange.count(), 0);
  assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 0);
  assert.equal(await prisma.strategyTurnCompletion.count(), 1);
});

integration("publication acknowledgement loss cannot duplicate the pair or replay its response", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const candidate = await boundCandidate();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return async (fn: any) => { await target.$transaction(fn); throw new Error("PUBLICATION_ACK_LOST"); };
  } }) as PrismaClient;
  await assert.rejects(new StrategyChatPublisher(broken).publish(candidate), /ACK_LOST/);
  const retry = await new StrategyChatPublisher(prisma).publish(candidate);
  assert.equal(retry.status, "already_decided"); assert.equal("message" in retry, false);
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
  assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 2);
  await assert.rejects(prisma.strategyTurnPublication.deleteMany(), /IMMUTABLE/);
  await assert.rejects(prisma.strategyTurnPublication.updateMany({ data: { reason: "changed" } }), /IMMUTABLE/);
});

integration("database publication guard rejects altered hashes, missing exchange and an extra session update", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const candidate = await boundCandidate();
  await assert.rejects(prisma.strategyTurnPublication.create({ data: { turnId: candidate.turnId, merchantId: "store",
    sessionId: "one", requestId: candidate.claim.requestId, exchangeRequestId: candidate.claim.requestId,
    responseHash: digest(candidate.result), agentTextHash: chatMessageTextHash(completed.result.content),
    decision: "persisted", reason: "current_at_publication", recordedAt: new Date() } }), /NO_CURRENT_EXCHANGE/);
  for (const tamper of ["response_hash", "agent_hash", "session_revision"] as const) {
    const broken = new Proxy(prisma, { get(target, prop) {
      if (prop !== "$transaction") return Reflect.get(target, prop);
      return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
        if (key !== "strategyTurnPublication") return Reflect.get(transaction, key);
        return new Proxy(transaction.strategyTurnPublication, { get(delegate, method) {
          if (method !== "create") return Reflect.get(delegate, method);
          return async (args: any) => {
            if (tamper === "session_revision") await transaction.checkoutSession.updateMany({ data: { updatedAt: new Date() } });
            const data = { ...args.data, ...(tamper === "response_hash" ? { responseHash: "f".repeat(64) } : {}),
              ...(tamper === "agent_hash" ? { agentTextHash: "f".repeat(64) } : {}) };
            return delegate.create({ data });
          };
        } });
      } })));
    } }) as PrismaClient;
    await assert.rejects(new StrategyChatPublisher(broken).publish(candidate), /EVIDENCE_CONFLICT|NO_CURRENT_EXCHANGE/);
    assert.equal(await prisma.checkoutChatExchange.count(), 0); assert.equal(await prisma.strategyTurnPublication.count(), 0);
    assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 0);
  }
});

integration("pause and publication serialize so a persisted response always precedes the pause", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const candidate = await boundCandidate();
  const [publication, paused] = await Promise.all([new StrategyChatPublisher(prisma).publish(candidate),
    ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause-race", kind: "paused" })]);
  if (publication.status === "persisted") assert.ok(publication.publication.recordedAt <= paused.occurredAt);
  else {
    assert.equal(publication.status, "suppressed"); assert.equal(publication.publication.reason, "execution_stopped");
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
  }
});

integration("a suppression in the durable request workflow yields uncertainty, no response and no second dispatch", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const request = buyerRequest(); let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return completed; } });
  const requests = new CheckoutChatRequestService(prisma);
  await assert.rejects(requests.run(request, async () => {}, async (message, claim) => {
    const candidate = await worker.dispatch(boundTurn("one", claim!, message.user_message));
    if (candidate.status !== "candidate") throw new Error("candidate missing");
    await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "operator", requestKey: "pause", kind: "paused" });
    const publication = await new StrategyChatPublisher(prisma).publish({ merchantId: "store", sessionId: "one",
      turnId: candidate.turnId, claim: claim!, userMessage: message.user_message, result: candidate.result });
    assert.equal(publication.status, "suppressed");
    throw new Error("response suppressed");
  }));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  await assert.rejects(requests.run(request, async () => {}, async () => { assert.fail("must not reenter"); }));
  assert.equal(calls, 1); assert.equal(await prisma.checkoutChatExchange.count(), 0);
});

// Real main use case, durable request, gateway, ledger and publication against
// PostgreSQL. Customer/shipping are prepared; no real OTP, payment or delivery.
function mainChatFixture(options: {
  processCustomer?: (value: CheckoutSession) => Promise<CheckoutSession>;
  offer?: SafeAuthorizedOffer;
  requestPrisma?: PrismaClient;
  payment?: (input: any) => Promise<any>;
  clock?: () => Promise<Date>;
  legacy?: () => Promise<{ content: string | null; toolCalls: Array<{ function: { name: string; arguments: string } }> }>;
  tools?: ChatToolExecutorService;
  promptExperiment?: { findRunningExperiment: (merchantId: string) => Promise<any> };
  onOffer?: (options: { skipExperiment?: boolean } | undefined) => void;
  buyerIntent?: Record<string, unknown>;
  cryptoEnabled?: boolean;
  products?: Array<any>;
} = {}) {
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  const calls = { customer: 0, legacy: 0, tools: 0, payments: 0, conversation: 0 };
  const gateway = new ChatLlmGatewayService();
  gateway.call = async () => { calls.legacy++; return options.legacy ? options.legacy() : { content: "Resposta habitual.", toolCalls: [] }; };
  const useCase = createSendChatUseCase(repo, {
    chatRequests: new CheckoutChatRequestService(options.requestPrisma ?? prisma),
    strategyChat: new StrategyCheckoutChatService(prisma, gateway, options.clock),
    promptExperiment: options.promptExperiment,
    buyerContext: options.buyerIntent ? { async load() { return { buyerIntent: options.buyerIntent }; } } as any : undefined,
    productSearch: options.products ? { async execute() { return options.products; } } as any : undefined,
    merchantRepository: options.cryptoEnabled ? { async getRules() { return { ...DEFAULT_MERCHANT_RULES,
      cryptoPayments: { enabled: true } }; }, async getProfile() { return { id: "store", name: "Fixture" }; } } as any : undefined,
    chatLlmGateway: gateway,
    chatToolExecutor: options.tools ?? { async executeToolCalls() { calls.tools++; throw new Error("UNEXPECTED_TOOL"); } } as any,
    createPaymentIntent: { async execute(input: any) {
      calls.payments++; if (options.payment) return options.payment(input); throw new Error("UNEXPECTED_PAYMENT");
    } } as any,
    conversation: { async reply() { calls.conversation++; return { message: "Confira os dados do pedido.", objection: "unknown" }; } } as any,
    customerService: { async correctCustomerInput() {}, async processCustomerInput(value: CheckoutSession) {
      calls.customer++; return options.processCustomer ? options.processCustomer(value) : value;
    } } as any,
    shippingService: { async processShippingState(value: CheckoutSession) { return value; }, summarizeDelivery() {} } as any,
    offerService: { async authorizeOffer(_message: string, value: CheckoutSession, _rules: unknown, _stage: unknown, _missing: unknown,
      offerOptions?: { skipExperiment?: boolean }) {
      options.onOffer?.(offerOptions);
      return options.offer ?? SafeAuthorizedOffer.noOffer(value.merchantId, value.sessionId);
    } } as any,
  });
  return { useCase, calls };
}
const httpStatus = (status: number) => (error: any) => error.getStatus?.() === status;
async function assertNoMainEffects(calls: ReturnType<typeof mainChatFixture>["calls"]) {
  assert.equal(calls.legacy, 0); assert.equal(calls.tools, 0); assert.equal(calls.payments, 0);
  assert.equal(calls.conversation, 0); assert.equal(await prisma.completedOrder.count(), 0);
}

function navigationResponse(names: string[], args = "{}", content: string | null = null) {
  return Response.json({ id: "fixture-navigation", model: "fixture-model",
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content,
      tool_calls: names.map((name, i) => ({ id: `fixture-tool-${i}`, type: "function", function: { name, arguments: args } })) } }] });
}

for (const arm of ["control", "treatment"] as const) for (const name of navigationToolNames) {
  integration(`main navigation ${arm} ${name} publishes server data with normal tool parity and no effects`, async () => {
    const f = await activate();
    const globalUserId = Array.from({ length: 100 }, (_, i) => `navigation-buyer-${i}`)
      .find(buyer => strategyArm(f.execution.contract as any, buyer) === arm)!;
    await repo.createSessionIfAbsent(primarySession("one", { globalUserId,
      shippingOptions: [{ carrier: "Correios", method: "PAC", customerPrice: 12.34, deliveryDays: 5 }] }));
    const before = (await repo.getSession("store", "one"))!;
    const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
    globalThis.fetch = (async () => { providerCalls++; return navigationResponse([name]); }) as typeof fetch;
    const request = buyerRequest();
    const response = await useCase.execute(request);
    const normal = await new ChatToolExecutorService().executeToolCalls([{ function: { name, arguments: "{}" } }],
      { merchantId: "store", ...checkoutNavigationContext(before) });
    assert.deepEqual(response.blocks, normal.blocks); assert.equal(response.blocks?.length, 1);
    if (name === "show_shipping_options") assert.deepEqual(response.blocks[0]!.data, {
      options: [{ key: "chat-shipping-0", label: "Correios PAC", cost: 1234, tag: "5 dias úteis", sub: "5 dias úteis" }], selection_mode: "chat",
    });
    if (name === "show_payment_methods") {
      assert.ok((response.blocks[0]!.data?.methods as any[]).some(method => method.key === "boleto"));
      assert.doesNotMatch(JSON.stringify(response.blocks), /sem taxas|12x/);
    }
    assert.equal(response.message, "Confira as opções no checkout.");
    assert.equal(response.chat_request?.status, "completed"); assert.ok(response.display_ref);
    const publication = await prisma.strategyTurnPublication.findFirstOrThrow();
    assert.deepEqual(publication.navigationTools, [name]);
    assert.equal((await prisma.strategyTurn.findFirstOrThrow()).publicationPolicy, MAIN_CHAT_PUBLICATION_POLICY);
    const saved = (await repo.getSession("store", "one"))!;
    assert.deepEqual(saved.cart, before.cart); assert.deepEqual(saved.shipping, before.shipping);
    assert.equal(saved.paymentMethod, undefined);
    const state = await new CheckoutChatRequestService(prisma).readState("store", "one");
    assert.deepEqual(state.turns.at(-1)?.blocks, response.blocks); assert.equal(state.turns.at(-1)?.checkout_stage, "payment");
    await assert.rejects(useCase.execute(request), httpStatus(409));
    await assert.rejects(prisma.strategyTurnPublication.update({ where: { turnId: publication.turnId }, data: { navigationTools: [] } }), /IMMUTABLE/);
    await repo.saveSession({ ...saved, cart: { ...saved.cart, total: 250 } });
    assert.equal((await new CheckoutChatRequestService(prisma).readState("store", "one")).turns.at(-1)?.blocks, undefined);
    await repo.createSessionIfAbsent(primarySession("one", { merchantId: "other" }));
    assert.equal((await new CheckoutChatRequestService(prisma).readState("other", "one")).turns.length, 0);
    assert.equal(providerCalls, 1); await assertNoMainEffects(calls);
  });
}

for (const name of navigationToolNames) for (const content of [null, "Zyon: Confira os dados disponíveis."]) {
  integration(`navigation response parity ${name} with ${content ? "text" : "tool only"} preserves normal checkout controls`, async () => {
    const f = await activate();
    const globalUserId = Array.from({ length: 100 }, (_, i) => `parity-buyer-${i}`)
      .find(buyer => strategyArm(f.execution.contract as any, buyer) === "control")!;
    const state = { globalUserId, shippingOptions: [{ carrier: "Correios", method: "PAC", customerPrice: 12.34, deliveryDays: 5 }] };
    await repo.createSessionIfAbsent(primarySession("one", state));
    // A second checkout for this buyer is outside the experiment, preserving
    // the same store, rules, address and cart for the normal runtime comparison.
    await repo.createSessionIfAbsent(primarySession("normal", state));
    assert.equal(await prisma.strategyAssignment.count({ where: { sessionId: "normal" } }), 0);
    const normal = mainChatFixture({ legacy: async () => ({ content, toolCalls: [{ function: { name, arguments: "{}" } }] }),
      tools: new ChatToolExecutorService() });
    const usual = await normal.useCase.execute(buyerRequest("normal"));
    globalThis.fetch = (async () => navigationResponse([name], "{}", content)) as typeof fetch;
    const experimental = mainChatFixture();
    const control = await experimental.useCase.execute(buyerRequest());
    assert.deepEqual({ message: control.message, blocks: control.blocks, stage: control.stage, missing: control.missing_fields },
      { message: usual.message, blocks: usual.blocks, stage: usual.stage, missing: usual.missing_fields });
    assert.equal(usual.blocks?.length, 1); assert.equal(usual.chat_request?.status, "completed");
    assert.equal(normal.calls.legacy, 1); assert.equal(normal.calls.conversation, 0); assert.equal(normal.calls.payments, 0);
    await assertNoMainEffects(experimental.calls);
    assert.equal(await prisma.paymentIntent.count(), 0);
  });
}

for (const scenario of ["mixed", "arguments", "duplicate", "unsafe", "cart", "pause"] as const) {
  integration(`main navigation rejects ${scenario} before any publication or tool effect`, async () => {
    const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
    const { useCase, calls } = mainChatFixture();
    globalThis.fetch = (async () => {
      if (scenario === "cart") await repo.saveSession({ ...(await repo.getSession("store", "one"))!, cart: { ...session("one").cart, total: 250 } });
      if (scenario === "pause") await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "navigation-pause", kind: "paused" });
      return navigationResponse(scenario === "mixed" ? ["show_payment_methods", "add_cross_sell_item"]
        : scenario === "duplicate" ? ["show_payment_methods", "show_payment_methods"] : ["show_payment_methods"],
        scenario === "arguments" ? '{"methods":[{"key":"crypto","label":"Inventado"}]}' : "{}",
        scenario === "unsafe" ? "Vou aplicar desconto de 90%." : null);
    }) as typeof fetch;
    await assert.rejects(useCase.execute(buyerRequest()), httpStatus(503));
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
    assert.equal((await new CheckoutChatRequestService(prisma).readState("store", "one")).turns.length, 0);
    await assertNoMainEffects(calls);
  });
}

integration("main navigation recovers a committed tool response without repeating provider or selecting payment", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  const f = await claimFixture(); let providerCalls = 0;
  const result = { content: null, toolCalls: [{ function: { name: "show_payment_methods", arguments: "{}" } }] };
  const candidate = await new StrategyChatDispatcher(ledger, { async callPinned() { providerCalls++; return { outcome: "provider_completed", result }; } })
    .dispatch({ ...boundTurn("one", f.claim, f.input.user_message), mainChat: true, expectedSession: (await repo.getSession("store", "one"))! });
  if (candidate.status !== "candidate") assert.fail("candidate expected");
  const published = await new StrategyChatPublisher(prisma).publish({ merchantId: "store", sessionId: "one", claim: f.claim,
    turnId: candidate.turnId, userMessage: f.input.user_message, result, mainChat: true });
  assert.equal(published.status, "persisted");
  const requests = new CheckoutChatRequestService(prisma);
  assert.equal((await requests.readState("store", "one")).turns.at(-1)?.blocks, undefined);
  const reconciled = await Promise.all([requests.reconcile(f.input), requests.reconcile(f.input)]);
  assert.ok(reconciled.every(value => value.chat_request.status === "reconciled"));
  const state = await requests.readState("store", "one");
  assert.equal(state.turns.at(-1)?.blocks?.[0].type, "payment_methods");
  assert.equal(state.turns.at(-1)?.checkout_stage, "payment");
  assert.equal(await prisma.checkoutChatResolution.count(), 1); assert.equal(providerCalls, 1);
  assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(await prisma.completedOrder.count(), 0);
  assert.equal((await repo.getSession("store", "one"))!.paymentMethod, undefined);
});

for (const scenario of ["exact", "stale", "ambiguous"] as const) integration(`navigation shipping selection ${scenario} uses the current complete server label`, async () => {
  await activate();
  const options = [
    { carrier: "Transportadora", method: "Loja 1", customerPrice: 10, deliveryDays: 5 },
    { carrier: "Transportadora", method: "Loja 2", customerPrice: 12.34, deliveryDays: 3 },
  ];
  if (scenario === "ambiguous") options.push({ ...options[1]!, customerPrice: 50 });
  await repo.createSessionIfAbsent(primarySession("one", { shipping: undefined, shippingOptions: options }));
  const before = (await repo.getSession("store", "one"))!;
  const shipping = new CheckoutShippingService(repo, new CheckoutCustomerService(repo));
  const selected = await shipping.processShippingState(before, scenario === "stale" ? "Entrega · Transportadora Loja 3" : "Entrega · Transportadora Loja 2");
  assert.deepEqual(selected.shipping, scenario === "exact" ? options[1] : undefined);
  assert.deepEqual((await repo.getSession("store", "one"))!.shipping, selected.shipping);
  assert.deepEqual(selected.cart, before.cart);
  assert.equal(await prisma.paymentIntent.count(), 0);
});

// Real customer/OTP, recognition, shipping, offer, payment preparation and order
// application services. Only external transports are controlled; no sends/charges.
function checkoutJourneyFixture() {
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  process.env.PAYMENT_MERCHANT_SETTLEMENT_MODE = "immediate_split";
  const emails: string[] = [], calls = { pinned: 0, legacy: 0, payments: 0, postal: 0 };
  const customer = new CheckoutCustomerService(repo, undefined, new OtpService(), new BuyerRecognitionService(repo), undefined, {
    async send(input) {
      assert.equal(input.requireDelivery, true); assert.match(input.idempotencyKey!, /^checkout-otp:store:/);
      emails.push(input.subject.match(/^\d{6}/)![0]);
      return { status: "sent", messageId: `fixture-email-${emails.length}` };
    },
  });
  const gateway = new ChatLlmGatewayService();
  gateway.call = async () => { calls.legacy++; return { content: "Confira os dados no checkout.", toolCalls: [] }; };
  globalThis.fetch = (async (input, init) => {
    const address = String(input);
    if (address === "https://viacep.com.br/ws/01001000/json/") {
      calls.postal++;
      return Response.json({ logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" });
    }
    assert.equal(address, "https://api.openai.com/v1/chat/completions");
    assert.equal(JSON.parse(String(init?.body)).model, "fixture-model"); calls.pinned++;
    return Response.json({ id: `fixture-chat-${calls.pinned}`, model: "fixture-model",
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Posso explicar esta etapa." } }] });
  }) as typeof fetch;
  const payments = new PrismaPaymentRepository(prisma);
  const merchants = { async getProfile() { return { id: "store", name: "Fixture" }; },
    async getRules(merchantId: string) { return repo.getRules(merchantId); } } as any;
  const payment = new CreatePaymentIntentUseCase(repo, merchants, payments, {
    async createCustomer() { return "cus_journey_fixture"; },
    async createPayment(input) {
      assert.equal(input.merchantId, "store"); assert.equal(input.method, "pix"); calls.payments++;
      return { providerPaymentId: `fixture-payment-${input.intentId}`, status: "requires_action",
        buyerFacingPayload: { qrCodeCopyPaste: "fixture-only-not-payable" } };
    },
  });
  const useCase = createSendChatUseCase(repo, {
    merchantRepository: merchants,
    chatRequests: new CheckoutChatRequestService(prisma), strategyChat: new StrategyCheckoutChatService(prisma, gateway),
    chatLlmGateway: gateway, chatToolExecutor: new ChatToolExecutorService(), createPaymentIntent: payment,
    customerService: customer, shippingService: new CheckoutShippingService(repo, customer), offerService: new CheckoutOfferService(repo),
    conversation: { async reply() { return { message: "Confira os dados do pedido.", objection: "unknown" }; } },
  });
  const orders = new CompleteOrderUseCase(repo, repo, repo, repo, undefined, undefined, undefined, repo,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(prisma));
  return { useCase, calls, emails, payments, orders };
}

for (const arm of ["control", "treatment"] as const) integration(`checkout journey ${arm} persists registration through a measured order after closing the strategy`, async () => {
  const f = await activate("store", { maxDiscountPercent: 0, allowFreeShipping: false });
  const variant = await costCatalog();
  const globalUserId = Array.from({ length: 100 }, (_, i) => `journey-buyer-${i}`)
    .find(buyer => strategyArm(f.execution.contract as any, buyer) === arm)!;
  await repo.createSessionIfAbsent(session("one", { globalUserId, cart: { ...session("one").cart,
    items: [{ sku: variant.sku, variantId: variant.id, name: "Fixture", quantity: 2, price: 50, cost: 25 }] } }));
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  const fixture = checkoutJourneyFixture();
  const send = (user_message: string) => fixture.useCase.execute({ ...buyerRequest(), user_message });
  const phone = await send("(11) 98765-4321"); assert.equal(phone.missing_fields?.[0], "email");
  const email = await send("journey@example.invalid");
  assert.equal(email.missing_fields?.[0], "código de verificação");
  assert.equal(email.experience?.customer?.otp_code, undefined); assert.equal(fixture.emails.length, 1);
  const wrongCode = fixture.emails[0] === "000000" ? "111111" : "000000";
  assert.match((await send(wrongCode)).message, /inválido/i);
  assert.notEqual((await repo.getSession("store", "one"))!.customer?.email_verified, true);
  await send(fixture.emails[0]); await send("Maria Silva"); await send("529.982.247-25");
  const postal = await send("01001-000"); assert.equal(postal.stage, "shipping");
  await send("Sim"); await send("100");
  const options = await send("Sem complemento"); assert.equal(options.missing_fields?.[0], "frete");
  assert.equal(options.experience?.shippingOptions?.length, 3);
  assert.equal((await send("Quero PAC")).stage, "payment");
  assert.equal(fixture.calls.pinned, 0); assert.equal(fixture.calls.legacy, 0);
  const communication = await send("Como funciona esta etapa?");
  assert.equal(communication.chat_request?.status, "completed"); assert.equal(fixture.calls.pinned, 1);
  assert.equal(await prisma.strategyTurnPublication.count({ where: { decision: "persisted" } }), 1);
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "journey-stop", kind: "stopped" });
  const request = { ...buyerRequest(), user_message: "PIX" };
  const pay = await fixture.useCase.execute(request);
  assert.equal(pay.stage, "payment_pending"); assert.equal(pay.experience?.payment_intent?.status, "requires_action");
  assert.equal(fixture.calls.payments, 1); assert.equal(await prisma.completedOrder.count(), 0);
  await assert.rejects(fixture.useCase.execute(request), httpStatus(409));
  assert.equal((await send("Já paguei")).stage, "payment_pending"); assert.equal(fixture.calls.payments, 1);
  const intent = (await fixture.payments.getIntentById("store", pay.experience!.payment_intent!.id))!;
  const snapshot = intent.snapshot(), amount = snapshot.amountBreakdown!;
  const completion = { merchant_id: "store", session_id: "one", external_order_id: snapshot.providerPaymentId!,
    currency: "BRL" as const, order_total: (amount.itemsSubtotalCents - amount.discountCents + amount.shippingCents) / 100 };
  await assert.rejects(fixture.orders.executePaymentApproval(completion, intent.id), /payment_approval_mismatch/);
  // Simulated provider confirmation is persisted, then read by the real order service.
  intent.markApproved({ providerPaymentId: snapshot.providerPaymentId!, approvedAmountCents: snapshot.amountCents });
  await fixture.payments.saveIntent({ intent });
  assert.equal((await fixture.orders.executePaymentApproval(completion, intent.id)).recorded, true);
  assert.equal((await fixture.orders.executePaymentApproval(completion, intent.id)).idempotent, true);
  assert.equal(await prisma.completedOrder.count(), 1);
  assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
  const metrics = (await new ExperimentMeasurementService(prisma).capture("store", f.execution.experimentId,
    "journey-results", new Date(Date.now() + 25 * 3_600_000))).result as any;
  assert.equal(metrics[arm].assigned, 1); assert.equal(metrics[arm].converted, 1);
  assert.equal(metrics[arm].revenueCents, Math.round(completion.order_total * 100));
  assert.equal((await prisma.strategyOrderCostSnapshot.findFirstOrThrow()).productCostCents, 5000n);
  assert.equal(fixture.calls.postal, 1); assert.equal(fixture.calls.pinned, 1); assert.equal(fixture.calls.legacy, 0);
});

integration("checkout journey recognizes a verified returning buyer and continues outside the old assignment", async () => {
  await activate("store", { maxDiscountPercent: 0, allowFreeShipping: false });
  // A previous nonparticipant session supplies the authenticated buyer profile.
  await repo.saveSession(primarySession("previous", { globalUserId: "recognized-buyer" }));
  await repo.createSessionIfAbsent(primarySession("one", { customer: {
    fullName: "Fixture Buyer", email: "fixture@example.invalid", phone: "11987654321", email_verified: false,
  } }));
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  const fixture = checkoutJourneyFixture();
  const send = (user_message: string) => fixture.useCase.execute({ ...buyerRequest(), user_message });
  await send("fixture@example.invalid");
  assert.equal((await repo.getSession("store", "one"))!.globalUserId, assignment.globalUserId);
  const recognized = await send(fixture.emails[0]);
  assert.equal(recognized.chat_request?.status, "completed"); assert.equal(recognized.stage, "payment");
  const saved = (await repo.getSession("store", "one"))!;
  assert.equal(saved.globalUserId, "recognized-buyer"); assert.equal(saved.customer?.email_verified, true);
  assert.equal((await send("Como funciona esta etapa?")).chat_request?.status, "completed");
  assert.equal((await prisma.strategyAssignmentStop.findUniqueOrThrow({ where: { assignmentId: assignment.id } })).reason, "session_context_changed");
  assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
  assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(fixture.calls.pinned, 0);
  assert.ok(fixture.calls.legacy > 0);
});

integration("checkout journey cannot reactivate a stopped assignment by restoring the old identity", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const original = (await repo.getSession("store", "one"))!;
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  await repo.saveSession({ ...original, globalUserId: "verified-other-buyer" });
  await repo.saveSession(original);
  process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false";
  const { useCase, calls } = mainChatFixture();
  assert.equal((await useCase.execute(buyerRequest())).chat_request?.status, "completed");
  assert.equal(calls.legacy, 1); assert.equal(await prisma.strategyTurn.count(), 0);
  assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
  assert.equal(await prisma.strategyAssignmentStop.count(), 1);
});

integration("checkout journey identity change cannot release an uncertain provider attempt", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error("SIMULATED_PROVIDER_TIMEOUT"); }) as typeof fetch;
  const request = buyerRequest();
  await assert.rejects(useCase.execute(request), httpStatus(503));
  const previous = (await repo.getSession("store", "one"))!;
  await repo.saveSession({ ...previous, globalUserId: "verified-other-buyer" });
  await assert.rejects(useCase.execute(request), httpStatus(409));
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
  assert.equal(providerCalls, 1); assert.equal(calls.legacy, 0);
  assert.equal(await prisma.checkoutChatExchange.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
});

for (const stop of ["paused", "stopped", "horizon"] as const) {
  integration(`main continuation after ${stop} preserves assignment and uses normal checkout without another experiment`, async () => {
    const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
    const original = await prisma.strategyAssignment.findFirstOrThrow();
    if (stop !== "horizon") await ledger.stop({ merchantId: "store", executionId: f.execution.id,
      actorId: "fixture", requestKey: `continuation-${stop}`, kind: stop });
    let offerOptions: unknown, prompts = 0;
    const { useCase, calls } = mainChatFixture({ clock: stop === "horizon" ? async () => f.execution.endsAt : undefined,
      promptExperiment: { async findRunningExperiment() { prompts++; throw new Error("CANNOT_REASSIGN_OLD_SESSION"); } },
      onOffer: value => { offerOptions = value; } });
    process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "false";
    process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false";
    const request = buyerRequest(), response = await useCase.execute(request);
    assert.equal(response.message, "Resposta habitual."); assert.equal(response.chat_request?.status, "completed");
    assert.equal(response.stage, "payment"); assert.equal(response.turns.length, 2);
    assert.equal(response.display_ref, undefined); assert.ok(response.experience);
    assert.equal(calls.legacy, 1); assert.equal(calls.tools, 0); assert.equal(calls.payments, 0); assert.equal(prompts, 0);
    assert.deepEqual(offerOptions, { skipExperiment: true });
    assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), original);
    assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(await prisma.strategyAiReservation.count(), 0);
    assert.equal(await prisma.strategyTurnPublication.count(), 0); assert.equal(await prisma.checkoutChatExchange.count(), 1);
    await assert.rejects(useCase.execute(request), httpStatus(409)); assert.equal(calls.legacy, 1);
    const state = await new CheckoutChatRequestService(prisma).readState("store", "one");
    assert.equal(state.turns.length, 2); assert.equal(state.turns[1].text, "Resposta habitual.");
  });
}

integration("main continuation preserves published strategy history and counts late orders without inventing new exposure", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let experimentalCalls = 0;
  globalThis.fetch = (async () => { experimentalCalls++; return providerResponse(); }) as typeof fetch;
  const first = await useCase.execute(buyerRequest()); assert.ok(first.display_ref);
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "stop-after-reply", kind: "stopped" });
  const next = await useCase.execute(buyerRequest());
  assert.equal(next.turns.length, 4); assert.equal(next.display_ref, undefined);
  assert.equal(experimentalCalls, 1); assert.equal(calls.legacy, 1);
  await measuredOrder("one", "late-order");
  const review = await new ExperimentMeasurementService(prisma).capture("store", f.execution.experimentId,
    "continuation-metrics", new Date(Date.now() + 25 * 3_600_000));
  const result = review.result as any;
  assert.equal(result.control.assigned + result.treatment.assigned, 1);
  assert.equal(result.control.converted + result.treatment.converted, 1);
  assert.equal(result.delivery.control.publishedTurns + result.delivery.treatment.publishedTurns, 1);
  assert.equal(await prisma.checkoutChatExchange.count(), 2);
});

integration("main continuation cannot escape an uncertain provider attempt even after the experiment stops", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let experimentalCalls = 0;
  globalThis.fetch = (async () => { experimentalCalls++; throw new Error("UNKNOWN_PROVIDER_RESULT"); }) as typeof fetch;
  const request = buyerRequest(); await assert.rejects(useCase.execute(request), httpStatus(503));
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "stop-unknown", kind: "stopped" });
  await assert.rejects(useCase.execute(request), httpStatus(409));
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
  assert.equal(experimentalCalls, 1); assert.equal(calls.legacy, 0); assert.equal(await prisma.checkoutChatExchange.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
});

integration("main continuation keeps tool discounts under commercial authority and cart mutations outside generated replies", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "stop-tool-policy", kind: "stopped" });
  const original = (await repo.getSession("store", "one"))!.cart;
  const { useCase, calls } = mainChatFixture({ tools: new ChatToolExecutorService(),
    async legacy() { return { content: "", toolCalls: [
      { function: { name: "apply_discount", arguments: '{"percent":90}' } },
      { function: { name: "add_cross_sell_item", arguments: '{"sku":"unverified","quantity":10}' } },
    ] }; } });
  const result = await useCase.execute(buyerRequest());
  assert.equal(result.chat_request?.status, "completed"); assert.doesNotMatch(result.message, /90%|adicionado ao carrinho/);
  assert.equal(result.actions.some(action => action.type === "apply_offer"), false);
  assert.deepEqual((await repo.getSession("store", "one"))!.cart, original);
  assert.equal(calls.payments, 0); assert.equal(await prisma.strategyTurn.count(), 0);
});

integration("main continuation records a coupon request before comparing the snapshot and preserves the authorized nudge", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "stop-coupon-request", kind: "stopped" });
  const offer = SafeAuthorizedOffer.fromRulesEngine({ ...SafeAuthorizedOffer.noOffer("store", "one").toAuthorizedOffer(),
    reason: "advanced_coupon_available", discountCode: "VERIFICADO" });
  const { useCase } = mainChatFixture({ offer });
  const response = await useCase.execute({ ...buyerRequest(), user_message: "Tem algum cupom?" });
  assert.equal(response.chat_request?.status, "completed"); assert.match(response.message, /VERIFICADO/);
  const saved = (await repo.getSession("store", "one"))!;
  assert.equal(saved.cart.commercialNudge?.couponCode, "VERIFICADO"); assert.equal(saved.cart.total, 100);
  assert.equal(saved.cart.currentDiscount ?? 0, 0);
  assert.equal(await prisma.checkoutEvent.count({ where: { merchantId: "store", sessionId: "one", eventName: "coupon_field_clicked" } }), 1);
  assert.equal(await prisma.strategyTurn.count(), 0);
});

integration("main continuation cannot overwrite a cart changed while the normal provider is answering", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "stop-cart-race", kind: "stopped" });
  const { useCase, calls } = mainChatFixture({ async legacy() {
    const current = (await repo.getSession("store", "one"))!;
    await repo.saveSession({ ...current, cart: { ...current.cart, total: 250 } });
    return { content: "Resposta antiga.", toolCalls: [] };
  } });
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(503));
  assert.equal((await repo.getSession("store", "one"))!.cart.total, 250);
  assert.equal(calls.legacy, 1); assert.equal(calls.payments, 0); assert.equal(await prisma.checkoutChatExchange.count(), 0);
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409)); assert.equal(calls.legacy, 1);
});

integration("main continuation requires its own fresh durable request and never reuses a dispatched turn", async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const claimed = await claimFixture();
  await new StrategyChatDispatcher(ledger, { async callPinned() { return completed; } }).dispatch(boundTurn("one", claimed.claim, claimed.input.user_message));
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "stop-bound-turn", kind: "stopped" });
  const service = new StrategyCheckoutChatService(prisma, { async callPinned() { assert.fail("routing must not dispatch"); } });
  await assert.rejects(service.continueWithoutExperiment(claimed.input), /REQUEST_REQUIRED/);
  await assert.rejects(service.continueWithoutExperiment(claimed.input, claimed.claim), /REQUEST_CONFLICT/);
  assert.equal(await service.continueWithoutExperiment({ ...claimed.input, merchant_id: "other" }, claimed.claim), false);
  assert.equal(await prisma.strategyTurn.count(), 1); assert.equal(await prisma.checkoutChatExchange.count(), 0);
});

integration("main continuation serializes simultaneous retries and can proceed after verified recovery of old text", async () => {
  const f = await recoveryFixture();
  const execution = await prisma.strategyExecution.findFirstOrThrow();
  await ledger.stop({ merchantId: "store", executionId: execution.id, actorId: "fixture", requestKey: "stop-recovered-text", kind: "stopped" });
  const requests = new CheckoutChatRequestService(prisma);
  assert.equal((await requests.reconcile(f.input)).chat_request.status, "reconciled");
  const { useCase, calls } = mainChatFixture(), request = buyerRequest();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => useCase.execute(request)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.getStatus(), 409);
  assert.equal(calls.legacy, 1); assert.equal(await prisma.strategyTurn.count(), 1);
  assert.equal(await prisma.checkoutChatExchange.count(), 2);
  const state = await requests.readState("store", "one");
  assert.equal(state.turns.length, 4); assert.ok(state.turns[1].display_ref); assert.equal(state.turns[3].display_ref, undefined);
});

integration("main chat publishes both exact strategy arms without legacy provider, tools or a second session save", async () => {
  const f = await activate();
  const { useCase, calls } = mainChatFixture();
  const sent: any[] = [];
  globalThis.fetch = (async (_url: unknown, options: any) => { sent.push(JSON.parse(options.body)); return providerResponse(); }) as typeof fetch;
  for (const arm of ["control", "treatment"] as const) {
    const buyer = Array.from({ length: 100 }, (_, i) => `main-buyer-${i}`)
      .find(id => strategyArm(f.execution.contract as any, id) === arm)!;
    await repo.createSessionIfAbsent(primarySession(arm, { globalUserId: buyer }));
    const response = await useCase.execute(buyerRequest(arm));
    assert.equal(response.message, completed.result.content); assert.equal(response.turns.length, 2);
    assert.equal(response.chat_request?.status, "completed"); assert.equal(response.stage, "payment");
    assert.deepEqual(response.actions, []); assert.equal(response.experience, undefined);
    assert.equal(response.authorized_offer, undefined); assert.equal(response.blocks, undefined);
    assert.equal(sent.at(-1).messages[0].content, renderStrategyTurn(f.execution.contract as any, f.baseline, arm,
      { cartInfo: "Carrinho: R$100.00", stage: "payment", paymentJustFailed: false }));
    assert.doesNotMatch(sent.at(-1).messages[0].content, /fixture@example|52998224725|Fixture Street/);
    const admitted = await prisma.strategyTurn.findFirstOrThrow({ where: { assignment: { sessionId: arm } } });
    assert.deepEqual(response.display_ref, { turn_id: admitted.id, text_hash: chatMessageTextHash(response.message) });
    const saved = await prisma.checkoutSession.findFirstOrThrow({ where: { sessionId: arm } });
    assert.equal(saved.strategyContextVersion, admitted.sessionContextVersion! + 1);
  }
  assert.equal(sent.length, 2); assert.equal(await prisma.strategyTurnPublication.count(), 2);
  assert.equal(await prisma.checkoutChatExchange.count(), 2); await assertNoMainEffects(calls);
});

integration("main chat serializes duplicate requests, returns receipts on retries and accepts the next new message", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  const request = buyerRequest();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => useCase.execute(request)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.getStatus(), 409);
  await assert.rejects(useCase.execute(request), httpStatus(409));
  assert.equal(providerCalls, 1); assert.equal(calls.customer, 1);
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
  const next = await useCase.execute(buyerRequest());
  assert.equal(next.turns.length, 4); assert.equal(providerCalls, 2);
  await assertNoMainEffects(calls);
});

integration("main chat keeps ownership when disabled and never escapes uncertainty with a fresh message key", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "false";
  const request = buyerRequest();
  await assert.rejects(useCase.execute(request), httpStatus(503));
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  await assert.rejects(useCase.execute(request), httpStatus(409));
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
  assert.equal(providerCalls, 0); assert.equal(calls.customer, 1);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  assert.equal(await prisma.strategyTurn.count(), 0); await assertNoMainEffects(calls);
});

for (const scenario of ["main_flag", "pause", "cart", "payment_method", "tools", "unknown"] as const) {
  integration(`main chat suppresses ${scenario} during provider work without tool, payment or legacy fallback`, async () => {
    const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
    const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
    globalThis.fetch = (async () => {
      providerCalls++;
      if (scenario === "main_flag") process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "false";
      if (scenario === "pause") await ledger.stop({ merchantId: "store", executionId: f.execution.id,
        actorId: "fixture", requestKey: "main-pause", kind: "paused" });
      if (scenario === "cart") {
        const saved = (await repo.getSession("store", "one"))!;
        await repo.saveSession({ ...saved, cart: { ...saved.cart, total: 200 } });
      }
      if (scenario === "payment_method") {
        await repo.saveSession({ ...(await repo.getSession("store", "one"))!, paymentMethod: "pix" });
      }
      if (scenario === "unknown") throw new Error("SIMULATED_CONNECTION_LOSS");
      if (scenario === "tools") return Response.json({ model: "fixture-model", choices: [{ finish_reason: "tool_calls",
        message: { role: "assistant", content: "Posso ajudar.", tool_calls: [
          { id: "fixture-tool", type: "function", function: { name: "apply_discount", arguments: '{"percent":10}' } },
        ] } }] });
      return providerResponse();
    }) as typeof fetch;
    const request = buyerRequest();
    await assert.rejects(useCase.execute(request), httpStatus(503));
    await assert.rejects(useCase.execute(request), httpStatus(409));
    await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
    assert.equal(providerCalls, 1); assert.equal(calls.customer, 1);
    assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
    const saved = (await repo.getSession("store", "one"))!;
    assert.equal(saved.chatHistory.length, 0); assert.equal(saved.cart.total, scenario === "cart" ? 200 : 100);
    if (scenario === "payment_method") assert.equal(saved.paymentMethod, "pix");
    if (scenario === "main_flag" || scenario === "tools") {
      const publication = await prisma.strategyTurnPublication.findFirstOrThrow();
      assert.equal(publication.decision, "suppressed");
      assert.equal(publication.reason, scenario === "main_flag" ? "publication_disabled" : "unsupported_response");
    }
    await assertNoMainEffects(calls);
  });
}

integration("main chat refuses a stale working session before provider I/O and preserves the current cart", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture({ async processCustomer(value) {
    await repo.saveSession({ ...value, cart: { ...value.cart, total: 250 } });
    return value;
  } });
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(503));
  assert.equal(providerCalls, 0); assert.equal(await prisma.strategyTurn.count(), 0);
  assert.equal((await repo.getSession("store", "one"))!.cart.total, 250);
  assert.equal(await prisma.checkoutChatExchange.count(), 0); await assertNoMainEffects(calls);
});

for (const arm of ["control", "treatment"] as const) for (const scenario of ["offer", "discount", "coupon", "intent", "crypto", "catalog"] as const) {
  integration(`context exit ${arm} ${scenario} continues checkout before dispatch and preserves measured membership`, async () => {
    const f = await activate();
    const globalUserId = Array.from({ length: 100 }, (_, i) => `exit-buyer-${i}`)
      .find(buyer => strategyArm(f.execution.contract as any, buyer) === arm)!;
    await repo.createSessionIfAbsent(primarySession("one", { globalUserId,
      cart: { ...session("one").cart, ...(scenario === "discount" ? { currentDiscount: 1 } : {}),
        ...(scenario === "catalog" ? { items: [], total: 0 } : {}) } }));
    const assignment = await prisma.strategyAssignment.findFirstOrThrow();
    const offer = ["offer", "coupon"].includes(scenario) ? SafeAuthorizedOffer.fromRulesEngine({
      ...SafeAuthorizedOffer.noOffer("store", "one").toAuthorizedOffer(), ...(scenario === "offer"
        ? { approved: true, type: "discount" as const, value: 1 }
        : { reason: "advanced_coupon_available", discountCode: "FIXTURE5" }),
    }) : undefined;
    let experimentLookups = 0;
    const { useCase, calls } = mainChatFixture({ offer, cryptoEnabled: scenario === "crypto",
      buyerIntent: scenario === "intent" ? { primary_intent: "ready_to_buy", pain_points: ["price"] } : undefined,
      products: scenario === "catalog" ? [{ sku: "fixture", name: "Produto", price: 100 }] : undefined,
      promptExperiment: { async findRunningExperiment() { experimentLookups++; throw new Error("DO_NOT_REASSIGN"); } } });
    let providerCalls = 0;
    globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
    const request = { ...buyerRequest(), user_message: scenario === "catalog" ? "Quero produto" : "Como funciona esta etapa?" };
    const response = await useCase.execute(request);
    assert.equal(response.chat_request?.status, "completed"); assert.equal(response.display_ref, undefined);
    assert.equal(providerCalls, 0); assert.equal(calls.legacy, 1); assert.equal(calls.payments, 0);
    assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(await prisma.strategyAiReservation.count(), 0);
    assert.equal(await prisma.checkoutChatExchange.count(), 1);
    assert.equal(experimentLookups, 0);
    assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
    const stopped = await prisma.strategyAssignmentStop.findFirstOrThrow();
    const reasons = { offer: "offer", coupon: "offer", discount: "incentive", intent: "personalization", crypto: "crypto", catalog: "catalog" };
    assert.equal(stopped.reason, `checkout_context_${reasons[scenario]}`);
    assert.equal((await prisma.strategyExecution.findUniqueOrThrow({ where: { id: f.execution.id } })).status, "running");
    if (scenario === "coupon") assert.equal((await repo.getSession("store", "one"))!.cart.commercialNudge?.couponCode, "FIXTURE5");
    await assert.rejects(useCase.execute(request), httpStatus(409));
    // Removing the condition does not reactivate the assignment on later turns.
    const next = mainChatFixture();
    assert.equal((await next.useCase.execute(buyerRequest())).chat_request?.status, "completed");
    assert.equal(next.calls.legacy, 1); assert.equal(providerCalls, 0);
    assert.equal(await prisma.strategyAssignmentStop.count(), 1);
    await measuredOrder("one", `after-exit-${scenario}`);
    const metrics = new ExperimentMeasurementService(prisma);
    const beforeExit = await metrics.capture("store", f.execution.experimentId, "before-context-exit", new Date(stopped.stoppedAt.getTime() - 1));
    assert.equal((beforeExit.result as any).participation[arm].contextExitSessions, 0);
    const review = await metrics.capture("store", f.execution.experimentId, "after-context-exit", new Date(Date.now() + 25 * 3_600_000));
    const result = review.result as any;
    assert.equal(result[arm].assigned, 1); assert.equal(result[arm].converted, 1);
    assert.equal(result.participation[arm].contextExitSessions, 1); assert.equal(result.delivery[arm].publishedTurns, 0);
    assert.equal(result.promotionAllowed, false);
    assert.doesNotMatch(JSON.stringify(result.participation), /exit-buyer|fixture@example|FIXTURE5|ready_to_buy/);
    assert.deepEqual(await metrics.capture("store", f.execution.experimentId, "before-context-exit"), beforeExit);
  });
}

integration("context exit preserves prior publication and protects another eligible session", async () => {
  const f = await activate();
  await repo.createSessionIfAbsent(primarySession("one")); await repo.createSessionIfAbsent(primarySession("two"));
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  const first = mainChatFixture(); await first.useCase.execute(buyerRequest());
  const saved = (await repo.getSession("store", "one"))!;
  await repo.saveSession({ ...saved, cart: { ...saved.cart, currentDiscount: 1 } });
  await first.useCase.execute(buyerRequest());
  await first.useCase.execute(buyerRequest("two"));
  assert.equal(providerCalls, 2); assert.equal(first.calls.legacy, 1);
  assert.equal(await prisma.strategyAssignmentStop.count(), 1);
  assert.equal(await prisma.strategyTurnPublication.count({ where: { decision: "persisted" } }), 2);
  await measuredOrder("one", "exit-after-publication");
  const review = await new ExperimentMeasurementService(prisma).capture("store", f.execution.experimentId,
    "published-context-exit", new Date(Date.now() + 25 * 3_600_000));
  const result = review.result as any;
  assert.equal(result.control.assigned + result.treatment.assigned, 2);
  assert.equal(result.control.converted + result.treatment.converted, 1);
  assert.equal(result.delivery.control.publishedTurns + result.delivery.treatment.publishedTurns, 2);
  assert.equal(result.participation.control.contextExitSessions + result.participation.treatment.contextExitSessions, 1);
});

integration("context exit never releases uncertainty or retries after an experimental call", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error("PROVIDER_UNKNOWN"); }) as typeof fetch;
  const request = buyerRequest(); await assert.rejects(useCase.execute(request), httpStatus(503));
  const saved = (await repo.getSession("store", "one"))!;
  await repo.saveSession({ ...saved, cart: { ...saved.cart, currentDiscount: 1 } });
  await assert.rejects(useCase.execute(request), httpStatus(409));
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
  assert.equal(providerCalls, 1); assert.equal(calls.legacy, 0);
  assert.equal(await prisma.strategyAssignmentStop.count(), 0);
  assert.equal(await prisma.strategyAiReservation.count({ where: { state: "unknown" } }), 1);
});

integration("context exit serializes retries and refuses a cart changed before or during normal provider work", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one", { cart: { ...session("one").cart, currentDiscount: 1 } }));
  const { useCase, calls } = mainChatFixture();
  const request = buyerRequest();
  const responses = await Promise.allSettled(Array.from({ length: 6 }, () => useCase.execute(request)));
  assert.equal(responses.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(calls.legacy, 1); assert.equal(await prisma.strategyAssignmentStop.count(), 1);
  for (const r of responses) if (r.status === "rejected") assert.equal(r.reason.getStatus(), 409);
  for (const moment of ["before", "during"] as const) {
    await repo.createSessionIfAbsent(primarySession(moment, { cart: { ...session(moment).cart, currentDiscount: 1 } }));
    const mutate = async () => { const current = (await repo.getSession("store", moment))!;
      await repo.saveSession({ ...current, cart: { ...current.cart, total: 250 } }); };
    const next = mainChatFixture({ processCustomer: async value => { if (moment === "before") await mutate(); return value; },
      legacy: async () => { await mutate(); return { content: "Resposta habitual.", toolCalls: [] }; } });
    await assert.rejects(next.useCase.execute(buyerRequest(moment)), httpStatus(503));
    assert.equal(next.calls.legacy, moment === "before" ? 0 : 1);
    assert.equal((await repo.getSession("store", moment))!.cart.total, 250);
    assert.equal(await prisma.checkoutChatExchange.count({ where: { sessionId: moment } }), 0);
    assert.equal(await prisma.strategyAssignmentStop.count({ where: { assignment: { sessionId: moment } } }), moment === "before" ? 0 : 1);
  }
});

for (const scenario of ["hash", "message", "conversation", "snapshot", "admitted", "disabled"] as const) {
  integration(`context exit rejects ${scenario} without creating a stop or normal-provider permit`, async () => {
    await activate(); await repo.createSessionIfAbsent(primarySession("one"));
    process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
    const claimed = await claimFixture(), saved = (await repo.getSession("store", "one"))!;
    const service = new StrategyCheckoutChatService(prisma, { async callPinned() { assert.fail("must not dispatch"); } });
    const input = { request: claimed.input, claim: claimed.claim, session: saved, beforeOffer: saved,
      stage: "payment" as const, previousStage: "payment" as const, offer: SafeAuthorizedOffer.noOffer("store", "one"),
      hasBuyerIntent: true, hasPreSearchedProducts: false };
    if (scenario === "hash") input.claim = { ...claimed.claim, requestHash: "a".repeat(64) };
    if (scenario === "message") input.request = { ...claimed.input, user_message: "Mensagem diferente" };
    if (scenario === "conversation") input.request = { ...claimed.input, conversation_id: "other-conversation" };
    if (scenario === "snapshot") await repo.saveSession({ ...saved, cart: { ...saved.cart, total: 250 } });
    if (scenario === "admitted") await ledger.admitTurn({ ...boundTurn("one", claimed.claim, claimed.input.user_message),
      inputHash: digest(claimed.input.user_message), mainChat: true, expectedSession: saved });
    if (scenario === "disabled") process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "false";
    await assert.rejects(service.tryReply(input));
    assert.equal(await prisma.strategyAssignmentStop.count(), 0);
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
  });
}

integration("context exit and turn admission cannot both own the same durable message", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  const claimed = await claimFixture(), saved = (await repo.getSession("store", "one"))!;
  const service = new StrategyCheckoutChatService(prisma, { async callPinned() { assert.fail("must not dispatch"); } });
  const [exit, admission] = await Promise.allSettled([
    service.tryReply({ request: claimed.input, claim: claimed.claim, session: saved, beforeOffer: saved,
      stage: "payment", previousStage: "payment", offer: SafeAuthorizedOffer.noOffer("store", "one"),
      hasBuyerIntent: true, hasPreSearchedProducts: false }),
    ledger.admitTurn({ ...boundTurn("one", claimed.claim, claimed.input.user_message), inputHash: digest(claimed.input.user_message),
      mainChat: true, expectedSession: saved }),
  ]);
  assert.equal(admission.status, "fulfilled");
  if (exit.status === "fulfilled") {
    assert.deepEqual(exit.value, { continueWithoutExperiment: true });
    assert.equal((admission as PromiseFulfilledResult<any>).value.status, "unavailable");
    assert.equal(await prisma.strategyTurn.count(), 0);
  } else {
    assert.match(String(exit.reason), /CONTINUATION_REQUEST_CONFLICT/);
    assert.equal((admission as PromiseFulfilledResult<any>).value.status, "admitted");
    assert.equal(await prisma.strategyAssignmentStop.count(), 0);
  }
});

integration("context exit keeps commercial tools under the authorized offer and leaves cart writes to checkout", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one", { cart: { ...session("one").cart, currentDiscount: 1 } }));
  const initial = (await repo.getSession("store", "one"))!;
  const { useCase, calls } = mainChatFixture({ tools: new ChatToolExecutorService(), legacy: async () => ({ content: null,
    toolCalls: [{ function: { name: "apply_discount", arguments: '{"percent":90}' } },
      { function: { name: "add_cross_sell_item", arguments: '{"sku":"other-product","quantity":2}' } }] }) });
  const response = await useCase.execute(buyerRequest());
  assert.equal(response.chat_request?.status, "completed");
  assert.doesNotMatch(response.message, /90%/);
  assert.deepEqual((await repo.getSession("store", "one"))!.cart, initial.cart);
  assert.equal(calls.legacy, 1); assert.equal(calls.payments, 0);
  assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(await prisma.completedOrder.count(), 0);
});

for (const [text, selected, providerMethod] of [
  ["Vou pagar no PIX", "pix", "pix"], ["Cartão de crédito", "credit_card", "card"],
  ["Boleto", "boleto", "boleto"], ["USDC", "crypto", "crypto"],
] as const) integration(`payment selection ${selected} survives reload without calling the strategy or creating a second intent`, async () => {
  const f = await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const assignment = await prisma.strategyAssignment.findFirstOrThrow();
  const { useCase, calls } = mainChatFixture({ payment: async input => {
    const saved = (await new PrismaCheckoutRepository(prisma).getSession("store", "one"))!;
    assert.equal(saved.paymentMethod, selected); assert.equal(saved.chatHistory.length, 2);
    assert.equal(deriveChatStage(saved), "payment_pending");
    assert.equal(input.method, providerMethod);
    const receipt = await prisma.checkoutChatRequest.findFirstOrThrow();
    assert.equal(input.idempotency_key, `chat:${receipt.id}`);
    return { id: "local-fixture-intent", status: "pending", amountCents: 10000, currency: "BRL" };
  } });
  // Pausing a communication test must not prevent a buyer from paying.
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "pause-before-pay", kind: "paused" });
  const request = { ...buyerRequest(), user_message: text };
  const response = await useCase.execute(request);
  assert.equal(response.stage, "payment_pending"); assert.equal(response.experience?.stage, "payment_pending");
  assert.equal(response.experience?.payment_intent?.status, "pending");
  assert.equal(response.chat_request?.status, "completed");
  await assert.rejects(useCase.execute(request), httpStatus(409));
  const next = await useCase.execute({ ...buyerRequest(), user_message: "Já paguei, pode confirmar?" });
  assert.equal(next.stage, "payment_pending"); assert.match(next.message, /Acompanhe a confirmação/);
  const repeatedChoice = await useCase.execute({ ...buyerRequest(), user_message: text });
  assert.equal(repeatedChoice.stage, "payment_pending");
  assert.equal(calls.payments, 1); assert.equal(calls.legacy, 0); assert.equal(calls.tools, 0);
  assert.equal(calls.conversation, 0);
  assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(await prisma.completedOrder.count(), 0);
  assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
  assert.equal((await repo.getSession("store", "one"))!.paymentMethod, selected);
});

for (const arm of ["control", "treatment"] as const) integration(`payment continues after a published ${arm} communication`, async () => {
  const f = await activate();
  const contract = executionContract({ merchantId: "store", strategyId: f.id, version: 1, runId: f.run.id,
    proposalHash: digest(f.proposal), proposal: f.proposal });
  let buyer = "";
  for (let i = 0; !buyer && i < 100; i++) if (strategyArm(contract, `payment-buyer-${i}`) === arm) buyer = `payment-buyer-${i}`;
  assert.ok(buyer);
  await repo.createSessionIfAbsent(primarySession("one", { globalUserId: buyer }));
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  const { useCase, calls } = mainChatFixture({ payment: async () => ({ id: "intent-fixture", status: "pending", amountCents: 10000, currency: "BRL" }) });
  await useCase.execute(buyerRequest());
  assert.equal((await prisma.strategyAssignment.findFirstOrThrow()).arm, arm);
  const response = await useCase.execute({ ...buyerRequest(), user_message: "PIX" });
  assert.equal(response.stage, "payment_pending"); assert.equal(providerCalls, 1); assert.equal(calls.payments, 1);
  assert.equal(await prisma.strategyTurn.count(), 1); assert.equal(await prisma.strategyTurnPublication.count(), 1);
  assert.equal((await repo.getSession("store", "one"))!.chatHistory.length, 4);
});

integration("uncertain payment preparation keeps the durable request blocked and cannot use text-only recovery", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture({ payment: async () => { throw new Error("PROVIDER_TIMEOUT"); } });
  const request = { ...buyerRequest(), user_message: "PIX" };
  await assert.rejects(useCase.execute(request), httpStatus(503));
  const receipt = await prisma.checkoutChatRequest.findFirstOrThrow();
  assert.equal(receipt.status, "unknown");
  assert.equal((await repo.getSession("store", "one"))!.paymentMethod, "pix");
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  await assert.rejects(new CheckoutChatRequestService(prisma).reconcile(request), httpStatus(409));
  await assert.rejects(useCase.execute(request), httpStatus(409));
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
  assert.equal(calls.payments, 1); assert.equal(await prisma.checkoutChatResolution.count(), 0);
  assert.equal(await prisma.completedOrder.count(), 0);
});

integration("concurrent distinct payment messages cannot start a second payment while the first is pending", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const { useCase, calls } = mainChatFixture({ payment: async () => {
    entered(); await finish;
    return { id: "intent-fixture", status: "pending", amountCents: 10000, currency: "BRL" };
  } });
  const first = useCase.execute({ ...buyerRequest(), user_message: "PIX" });
  await started;
  try {
    const others = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
      useCase.execute({ ...buyerRequest(), user_message: i % 2 ? "PIX" : "Cartão" })));
    for (const result of others) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.equal(result.reason.getStatus(), 409);
    }
    assert.equal(calls.payments, 1); assert.equal(calls.customer, 1);
    assert.equal(await prisma.checkoutChatRequest.count(), 1);
    assert.equal(await prisma.checkoutChatExchange.count(), 1);
  } finally { release(); }
  assert.equal((await first).chat_request?.status, "completed");
  assert.equal((await useCase.execute({ ...buyerRequest(), user_message: "Cartão" })).stage, "payment_pending");
  assert.equal((await repo.getSession("store", "one"))!.paymentMethod, "pix");
  assert.equal(calls.payments, 1); assert.equal(calls.legacy, 0); assert.equal(calls.tools, 0); assert.equal(calls.conversation, 0);
});

integration("payment selection rechecks the persisted stage before writing any conversation", async () => {
  await repo.createSessionIfAbsent(session("one"));
  const select = () => repo.appendChatExchange({ merchantId: "store", sessionId: "one", selectedPaymentMethod: "pix",
    buyer: { role: "buyer", text: "PIX", occurredAt: new Date().toISOString() },
    agent: { role: "agent", text: "Continue no checkout.", occurredAt: new Date().toISOString() } });
  await assert.rejects(select(), /CHAT_PAYMENT_SELECTION_CONFLICT/);
  assert.equal((await repo.getSession("store", "one"))!.chatHistory.length, 0);
  await repo.saveSession(primarySession("one", { paymentMethod: "credit_card" }));
  await assert.rejects(select(), /CHAT_PAYMENT_SELECTION_CONFLICT/);
  const saved = (await repo.getSession("store", "one"))!;
  assert.equal(saved.paymentMethod, "credit_card"); assert.equal(saved.chatHistory.length, 0);
});

integration("payment selection and its chat exchange roll back together", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  await assert.rejects(prisma.$transaction(async tx => {
    const transactional = new PrismaCheckoutRepository(tx, true);
    await transactional.appendChatExchange({ merchantId: "store", sessionId: "one", selectedPaymentMethod: "pix",
      buyer: { role: "buyer", text: "PIX", occurredAt: new Date().toISOString() },
      agent: { role: "agent", text: "Acompanhe seu pagamento.", occurredAt: new Date().toISOString() } });
    assert.equal((await transactional.getSession("store", "one"))!.paymentMethod, "pix");
    throw new Error("SIMULATED_COMMIT_FAILURE");
  }), /SIMULATED_COMMIT_FAILURE/);
  const saved = (await repo.getSession("store", "one"))!;
  assert.equal(saved.paymentMethod, undefined); assert.equal(saved.chatHistory.length, 0);
});

integration("payment state preserves explicit resets, tenant isolation and rejects unsupported stored methods", async () => {
  await repo.createSessionIfAbsent(primarySession("one", { paymentMethod: "pix" }));
  await prisma.merchant.create({ data: { id: "other", name: "Other" } });
  await repo.createSessionIfAbsent(primarySession("one", { merchantId: "other" }));
  const saved = (await repo.getSession("store", "one"))!;
  assert.equal(deriveChatStage(saved), "payment_pending");
  assert.equal(deriveChatStage({ ...saved, paymentConfirmed: true } as any), "payment_pending");
  assert.equal((await repo.getSession("other", "one"))!.paymentMethod, undefined);
  await assert.rejects(prisma.$executeRaw`UPDATE checkout_sessions SET payment_method = 'invented' WHERE merchant_id = 'store'`);
  await repo.saveSession({ ...saved, paymentMethod: undefined });
  assert.equal((await repo.getSession("store", "one"))!.paymentMethod, undefined);
  assert.equal((await prisma.checkoutSession.findFirstOrThrow({ where: { merchantId: "store" } })).paymentMethod, null);
});

integration("an assignment requires a durable message key before customer work even when request flags are off", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture();
  process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  await assert.rejects(useCase.execute({ ...buyerRequest(), message_id: undefined }), httpStatus(400));
  assert.equal(calls.customer, 0); assert.equal(await prisma.checkoutChatRequest.count(), 0);
  globalThis.fetch = (async () => providerResponse()) as typeof fetch;
  assert.equal((await useCase.execute(buyerRequest())).chat_request?.status, "completed");
  await assertNoMainEffects(calls);
});

integration("main chat keeps unassigned, holdout and deterministic paths outside strategy dispatch", async () => {
  await repo.createSessionIfAbsent(primarySession("unassigned"));
  await activate();
  await repo.createSessionIfAbsent(primarySession("holdout", { cohort: "holdout" }));
  await repo.createSessionIfAbsent(session("deterministic"));
  const { useCase, calls } = mainChatFixture(); let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  for (const id of ["unassigned", "holdout", "deterministic"]) {
    const response = await useCase.execute(buyerRequest(id));
    assert.equal(response.chat_request?.status, "completed"); assert.equal(response.turns.length, 2);
  }
  assert.equal(calls.legacy, 1); assert.equal(calls.conversation, 2); assert.equal(providerCalls, 0);
  assert.equal(calls.tools, 0); assert.equal(calls.payments, 0);
  assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(await prisma.strategyTurnPublication.count(), 0);
});

integration("main chat cannot select a strategy owned by another store with the same session ID", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  await repo.createSessionIfAbsent(primarySession("one", { merchantId: "other" }));
  const { useCase, calls } = mainChatFixture();
  const response = await useCase.execute({ ...buyerRequest(), merchant_id: "other" });
  assert.equal(response.message, "Resposta habitual."); assert.equal(calls.legacy, 1);
  assert.equal(await prisma.strategyTurn.count(), 0);
  assert.equal((await repo.getSession("store", "one"))!.chatHistory.length, 0);
});

integration("main chat preserves the deterministic transition from shipping to payment", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one", { shipping: undefined }));
  const { useCase, calls } = mainChatFixture({ async processCustomer(value) {
    const updated = { ...value, shipping: primarySession("one").shipping };
    await repo.saveSession(updated);
    return (await repo.getSession("store", "one"))!;
  } });
  const response = await useCase.execute(buyerRequest());
  assert.equal(response.stage, "payment"); assert.equal(response.chat_request?.status, "completed");
  assert.equal(calls.legacy, 0); assert.equal(calls.conversation, 1);
  assert.equal(await prisma.strategyTurn.count(), 0); assert.equal(await prisma.checkoutChatExchange.count(), 1);
});

integration("main chat never resends or duplicates a published response after receipt finalization fails", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "checkoutChatRequest") return Reflect.get(transaction, key);
      return new Proxy(transaction.checkoutChatRequest, { get(delegate, method) {
        if (method !== "updateMany") return Reflect.get(delegate, method);
        return (args: any) => {
          if (args.data.status === "completed") throw new Error("SIMULATED_RECEIPT_FAILURE");
          return delegate.updateMany(args);
        };
      } });
    } })));
  } }) as PrismaClient;
  const { useCase, calls } = mainChatFixture({ requestPrisma: broken });
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return providerResponse(); }) as typeof fetch;
  const request = buyerRequest();
  await assert.rejects(useCase.execute(request), httpStatus(503));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  assert.equal((await prisma.strategyTurnPublication.findFirstOrThrow()).decision, "persisted");
  await assert.rejects(useCase.execute(request), httpStatus(409));
  await assert.rejects(useCase.execute(buyerRequest()), httpStatus(409));
  assert.equal(providerCalls, 1); assert.equal(calls.customer, 1);
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
  assert.equal((await repo.getSession("store", "one"))!.chatHistory.length, 2);
  await assertNoMainEffects(calls);
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  const recovered = await new CheckoutChatRequestService(prisma).reconcile(request);
  assert.equal(recovered.chat_request.status, "reconciled");
  const next = mainChatFixture();
  assert.equal((await next.useCase.execute(buyerRequest())).chat_request?.status, "completed");
  assert.equal(providerCalls, 2); assert.equal(await prisma.checkoutChatExchange.count(), 2);
});

async function recoveryFixture(status: "processing" | "unknown" = "unknown", mainChat = true) {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  const { input, claim } = await claimFixture();
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { return completed; } });
  const candidate = await worker.dispatch({ ...boundTurn("one", claim, input.user_message),
    ...(mainChat ? { mainChat: true as const, expectedSession: (await repo.getSession("store", "one"))! } : {}) });
  if (candidate.status !== "candidate") throw new Error("missing candidate");
  const publication = await new StrategyChatPublisher(prisma).publish({ merchantId: "store", sessionId: "one",
    turnId: candidate.turnId, claim, userMessage: input.user_message, result: candidate.result,
    ...(mainChat ? { mainChat: true as const } : {}) });
  assert.equal(publication.status, "persisted");
  if (status === "unknown") {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await prisma.checkoutChatRequest.update({ where: { id: claim.requestId }, data: { status, finishedAt: clock.now } });
  }
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  return { input, claim, candidate };
}

integration("display telemetry requires terminal publication and deduplicates concurrent reports after recovery", async () => {
  const f = await recoveryFixture(), requests = new CheckoutChatRequestService(prisma);
  const report = { session_id: "one", conversation_id: "conversation-one", definition: "widget-visible-text-v1" as const,
    display_ref: { turn_id: f.candidate.turnId, text_hash: chatMessageTextHash(completed.result.content) } };
  assert.equal(await prisma.strategyMessageDisplay.count(), 0);
  assert.equal((await requests.readState("store", "one")).turns.some(turn => !!turn.display_ref), false);
  await assert.rejects(requests.recordDisplay("store", report), /NOT_AVAILABLE/);
  await assert.rejects(prisma.strategyMessageDisplay.create({ data: { merchantId: "store", sessionId: "one",
    conversationId: report.conversation_id, turnId: f.candidate.turnId, agentTextHash: report.display_ref.text_hash,
    definition: report.definition } }), /EVIDENCE_REQUIRED/);
  await requests.reconcile(f.input);
  const state = await requests.readState("store", "one");
  assert.deepEqual(state.turns[1].display_ref, report.display_ref);
  assert.equal(state.turns[0].display_ref, undefined);
  assert.equal(await prisma.strategyMessageDisplay.count(), 0);
  const reports = await Promise.all(Array.from({ length: 6 }, () => requests.recordDisplay("store", report)));
  assert.equal(new Set(reports.map(row => row.recorded_at)).size, 1);
  assert.equal(await prisma.strategyMessageDisplay.count(), 1);
  assert.equal(await prisma.strategyAssignment.count(), 1);
  await assert.rejects(prisma.strategyMessageDisplay.update({ where: { turnId: f.candidate.turnId }, data: { definition: "changed" } }), /IMMUTABLE/);
  await assert.rejects(prisma.strategyMessageDisplay.delete({ where: { turnId: f.candidate.turnId } }), /IMMUTABLE/);
});

integration("display telemetry rejects forged store, session, conversation, text, definition and publication", async () => {
  const f = await recoveryFixture(), requests = new CheckoutChatRequestService(prisma);
  await requests.reconcile(f.input);
  const valid = { session_id: "one", conversation_id: "conversation-one", definition: "widget-visible-text-v1" as const,
    display_ref: { turn_id: f.candidate.turnId, text_hash: chatMessageTextHash(completed.result.content) } };
  for (const [merchant, report] of [ ["other", valid], ["store", { ...valid, session_id: "other" }],
    ["store", { ...valid, conversation_id: "other" }], ["store", { ...valid, definition: "read" }],
    ["store", { ...valid, display_ref: { ...valid.display_ref, text_hash: "a".repeat(64) } }],
    ["store", { ...valid, display_ref: { ...valid.display_ref, turn_id: "missing" } }],
  ] as const) await assert.rejects(requests.recordDisplay(merchant, report as any), /NOT_AVAILABLE|INVALID_REPORT/);
  await assert.rejects(prisma.strategyMessageDisplay.create({ data: { merchantId: "store", sessionId: "one",
    conversationId: "conversation-one", turnId: f.candidate.turnId, agentTextHash: "a".repeat(64),
    definition: valid.definition } }), /EVIDENCE_REQUIRED/);
  assert.equal(await prisma.strategyMessageDisplay.count(), 0);
});

integration("a late display stays attached to the published version after stop and flag rollback", async () => {
  const f = await recoveryFixture(), requests = new CheckoutChatRequestService(prisma);
  await requests.reconcile(f.input);
  const execution = await prisma.strategyExecution.findFirstOrThrow();
  await ledger.stop({ merchantId: "store", executionId: execution.id, actorId: "operator", requestKey: "stop", kind: "paused" });
  process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false";
  const ref = (await requests.readState("store", "one")).turns[1].display_ref!;
  await requests.recordDisplay("store", { session_id: "one", conversation_id: "conversation-one",
    definition: "widget-visible-text-v1", display_ref: ref });
  assert.equal(await prisma.strategyMessageDisplay.count(), 1);
  assert.equal(await prisma.strategyTurn.count(), 1);
  const scoped = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const tenantClient = registerTenantMiddleware(scoped, { get: () => ({ merchantId: "other" }) } as any);
    assert.equal(await tenantClient.strategyMessageDisplay.count(), 0);
  } finally { await scoped.$disconnect(); }
});

for (const status of ["processing", "unknown"] as const) integration(`recovery reconciles ${status} from immutable main-chat text evidence without replay`, async () => {
  const f = await recoveryFixture(status), requests = new CheckoutChatRequestService(prisma);
  const before = await prisma.checkoutSession.findFirstOrThrow();
  const pending = await requests.readState("store", "one", f.input.message_id);
  assert.equal(pending.active_request?.status, status);
  assert.equal(pending.turns.length, 2);
  const response = await requests.reconcile(f.input);
  assert.deepEqual(response, { chat_request: { message_id: f.input.message_id, status: "reconciled", next_action: "refresh_session" } });
  assert.deepEqual(await requests.reconcile(f.input), response);
  assert.deepEqual(await prisma.checkoutSession.findFirstOrThrow(), before);
  const row = await prisma.checkoutChatRequest.findFirstOrThrow();
  assert.equal(row.status, "reconciled"); assert.equal(row.responseHash, null);
  const restored = await requests.readState("store", "one", f.input.message_id);
  assert.equal(restored.request?.status, "reconciled"); assert.equal(restored.active_request, undefined);
  assert.deepEqual(restored.turns.map(({ display_ref, ...turn }) => turn), pending.turns);
  assert.equal(restored.turns[1].display_ref?.turn_id, f.candidate.turnId);
  const resolution = await prisma.checkoutChatResolution.findFirstOrThrow();
  assert.equal(resolution.previousStatus, status); assert.equal(resolution.turnId, f.candidate.turnId);
  await assert.rejects(requests.run(f.input, async () => assert.fail("no preflight"), async () => assert.fail("no replay")),
    (error: any) => error.getResponse().chat_request.status === "reconciled");
  assert.equal(await prisma.checkoutChatResolution.count(), 1); assert.equal(await prisma.strategyTurn.count(), 1);
});

integration("concurrent recovery writes one proof and never requires a running strategy or an unchanged cart", async () => {
  const f = await recoveryFixture();
  const execution = await prisma.strategyExecution.findFirstOrThrow();
  await ledger.stop({ merchantId: "store", executionId: execution.id, actorId: "fixture", requestKey: "pause-recovery", kind: "paused" });
  const saved = (await repo.getSession("store", "one"))!;
  await repo.saveSession({ ...saved, cart: { ...saved.cart, total: 333 } });
  process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "false";
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "false";
  const requests = new CheckoutChatRequestService(prisma);
  const results = await Promise.all(Array.from({ length: 6 }, () => requests.reconcile(f.input)));
  assert.ok(results.every(r => r.chat_request.status === "reconciled"));
  assert.equal(await prisma.checkoutChatResolution.count(), 1);
  assert.equal((await repo.getSession("store", "one"))!.cart.total, 333);
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
});

integration("recovery requires its own opt-in but keeps a terminal receipt readable after rollback", async () => {
  const f = await recoveryFixture(), requests = new CheckoutChatRequestService(prisma);
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "false";
  await assert.rejects(requests.reconcile(f.input), httpStatus(503));
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS = "*";
  await assert.rejects(requests.reconcile(f.input), httpStatus(503));
  process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS = "store";
  await requests.reconcile(f.input);
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "false";
  assert.equal((await requests.reconcile(f.input)).chat_request.status, "reconciled");
});

integration("recovery refuses wrong tenant, session, conversation and message keys", async () => {
  const f = await recoveryFixture(), requests = new CheckoutChatRequestService(prisma);
  await repo.createSessionIfAbsent(primarySession("one", { merchantId: "other" }));
  for (const patch of [{ merchant_id: "other" }, { session_id: "missing" }, { conversation_id: "other" },
    { message_id: randomUUID() }, { message_id: "bad" }]) await assert.rejects(requests.reconcile({ ...f.input, ...patch }));
  assert.equal(await prisma.checkoutChatResolution.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
});

integration("old generic publications cannot be relabeled as recoverable main chat", async () => {
  const f = await recoveryFixture("unknown", false);
  await assert.rejects(new CheckoutChatRequestService(prisma).reconcile(f.input), httpStatus(409));
  await assert.rejects(prisma.strategyTurn.update({ where: { id: f.candidate.turnId }, data: { publicationPolicy: "main_chat_text_only_v1" } }), /IMMUTABLE/);
  assert.equal(await prisma.checkoutChatResolution.count(), 0);
});

integration("missing, uncertain and suppressed publications cannot release an unresolved request", async () => {
  await activate(); process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  for (const scenario of ["missing", "unknown", "suppressed"] as const) {
    process.env.CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED = scenario === "suppressed" ? "false" : "true";
    await repo.createSessionIfAbsent(primarySession(scenario));
    const f = await claimFixture(scenario);
    if (scenario !== "missing") {
      const result = { content: "Vou aplicar um desconto de 10%.", toolCalls: [] };
      const candidate = await new StrategyChatDispatcher(ledger, { async callPinned() {
        return scenario === "unknown" ? { outcome: "provider_unknown" as const } : { outcome: "provider_completed" as const, result };
      } }).dispatch({ ...boundTurn(scenario, f.claim, f.input.user_message), mainChat: true,
        expectedSession: (await repo.getSession("store", scenario))! });
      if (scenario === "unknown") {
        assert.equal(candidate.status, "suppressed");
      } else {
        if (candidate.status !== "candidate") assert.fail("expected a candidate before publication is suppressed");
        const publication = await new StrategyChatPublisher(prisma).publish({ merchantId: "store", sessionId: scenario,
          claim: f.claim, turnId: candidate.turnId, userMessage: f.input.user_message, result, mainChat: true });
        assert.equal(publication.status, "suppressed");
      }
    }
    await assert.rejects(new CheckoutChatRequestService(prisma).reconcile(f.input), httpStatus(409));
  }
  assert.equal(await prisma.checkoutChatResolution.count(), 0); assert.equal(await prisma.checkoutChatExchange.count(), 0);
  assert.equal(await prisma.strategyTurnPublication.count({ where: { decision: "suppressed" } }), 1);
});

integration("database recovery proof and terminal status are atomic and immutable", async () => {
  const f = await recoveryFixture();
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: f.claim.requestId },
    data: { status: "reconciled", finishedAt: new Date() } }), /RESOLUTION_REQUIRED/);
  const row = await prisma.checkoutChatRequest.findFirstOrThrow();
  // Evidence uses the database clock, even when the host/container clocks differ.
  const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const proof = { requestId: row.id, merchantId: row.merchantId, sessionId: row.sessionId,
    turnId: f.candidate.turnId, previousStatus: row.status, previousFinishedAt: row.finishedAt, resolvedAt: clock.now };
  await assert.rejects(prisma.checkoutChatResolution.create({ data: proof }), /RESOLUTION_NOT_APPLIED/);
  await assert.rejects(prisma.checkoutChatResolution.create({ data: { ...proof, previousStatus: "processing" } }), /EVIDENCE_REQUIRED/);
  await assert.rejects(prisma.checkoutChatResolution.create({ data: { ...proof, resolvedAt: new Date(clock.now.getTime() + 60_000) } }), /EVIDENCE_REQUIRED/);
  await assert.rejects(prisma.checkoutChatResolution.create({ data: { ...proof, merchantId: "other" } }), /EVIDENCE_REQUIRED/);
  assert.equal(await prisma.checkoutChatResolution.count(), 0);
  await new CheckoutChatRequestService(prisma).reconcile(f.input);
  await assert.rejects(prisma.checkoutChatResolution.deleteMany(), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatResolution.updateMany({ data: { resolvedAt: new Date() } }), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: row.id }, data: { status: "unknown" } }), /IMMUTABLE/);
});

integration("recovery transaction failure rolls back the proof and keeps the lane blocked", async () => {
  const f = await recoveryFixture();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "checkoutChatRequest") return Reflect.get(transaction, key);
      return new Proxy(transaction.checkoutChatRequest, { get(delegate, method) {
        if (method !== "update") return Reflect.get(delegate, method);
        return () => { throw new Error("SIMULATED_RECOVERY_FAILURE"); };
      } });
    } })));
  } }) as PrismaClient;
  await assert.rejects(new CheckoutChatRequestService(broken).reconcile(f.input), /RECOVERY_FAILURE/);
  assert.equal(await prisma.checkoutChatResolution.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  await assert.rejects(new CheckoutChatRequestService(prisma).run(buyerRequest(), async () => {}, async () => assert.fail("no work")), httpStatus(409));
});

integration("tenant middleware scopes recovery evidence in reads, writes and transactions", async () => {
  const f = await recoveryFixture();
  await new CheckoutChatRequestService(prisma).reconcile(f.input);
  const scoped = registerTenantMiddleware(prisma, { get: () => ({ merchantId: "other" }) } as any);
  assert.equal(await scoped.checkoutChatResolution.count({ where: { merchantId: "store" } }), 0);
  assert.equal(await scoped.strategyTurn.count({ where: { merchantId: "store" } }), 0);
  await scoped.$transaction(async tx => {
    assert.equal(await tx.checkoutChatRequest.count({ where: { merchantId: "store" } }), 0);
  });
  await assert.rejects(scoped.$transaction(tx => tx.checkoutChatResolution.create({ data: { requestId: randomUUID(),
    merchantId: "store", sessionId: "one", turnId: f.candidate.turnId, previousStatus: "unknown", resolvedAt: new Date() } })),
    /EVIDENCE_REQUIRED|Foreign key/);
  assert.equal(await prisma.checkoutChatResolution.count(), 1);
});

integration("recovery fences a live main-chat worker after publication and permits the next distinct request", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  let reached!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let delayedOnce = false;
  const delayed = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return async (fn: any, options: any) => {
      // Pause between publication and finalization, before acquiring its session
      // lock. Holding that lock while waiting for recovery creates a fixture deadlock.
      if (!delayedOnce && await target.strategyTurnPublication.count({ where: { merchantId: "store", sessionId: "one" } })) {
        delayedOnce = true; reached(); await gate;
      }
      return target.$transaction(fn, options);
    };
  } }) as PrismaClient;
  const f = mainChatFixture({ requestPrisma: delayed }); let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  const request = buyerRequest();
  const running = f.useCase.execute(request);
  const fenced = assert.rejects(running, (error: any) => error.getStatus() === 409
    && error.getResponse().chat_request.status === "reconciled");
  try {
    await Promise.race([arrived, fenced.then(() => { throw new Error("WORKER_FINISHED_BEFORE_PUBLICATION_GATE"); })]);
    process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
    assert.equal((await new CheckoutChatRequestService(prisma).reconcile(request)).chat_request.status, "reconciled");
  } finally { release(); }
  await fenced;
  assert.equal((await f.useCase.execute(buyerRequest())).chat_request?.status, "completed");
  assert.equal(calls, 2); assert.equal(await prisma.checkoutChatExchange.count(), 2);
});

integration("lost recovery acknowledgement is safe to repeat without changing the proof", async () => {
  const f = await recoveryFixture();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return async (fn: any) => { await target.$transaction(fn); throw new Error("RECOVERY_ACK_LOST"); };
  } }) as PrismaClient;
  await assert.rejects(new CheckoutChatRequestService(broken).reconcile(f.input), /ACK_LOST/);
  const before = await prisma.checkoutChatResolution.findFirstOrThrow();
  assert.equal((await new CheckoutChatRequestService(prisma).reconcile(f.input)).chat_request.status, "reconciled");
  assert.deepEqual(await prisma.checkoutChatResolution.findFirstOrThrow(), before);
});

async function suppressionFixture(arm: "control" | "treatment" = "control", status: "processing" | "unknown" = "unknown",
  cost: "priced" | "unknown" | "overrun" = "priced") {
  const f = await activate();
  const globalUserId = Array.from({ length: 100 }, (_, i) => `suppression-buyer-${i}`)
    .find(buyer => strategyArm(f.execution.contract as any, buyer) === arm)!;
  await repo.createSessionIfAbsent(primarySession("one", { globalUserId }));
  process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED = "true";
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  process.env.CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED = "true";
  const { input, claim } = await claimFixture();
  const result = { content: "Vou aplicar um desconto de 90%.", toolCalls: [] };
  const candidate = await new StrategyChatDispatcher(ledger, { async callPinned() {
    return { outcome: "provider_completed" as const, result, providerEventId: `suppression-${claim.requestId}`,
      ...(cost === "unknown" ? {} : { usage: { prompt_tokens: 100, completion_tokens: cost === "overrun" ? 2000 : 10,
        total_tokens: cost === "overrun" ? 2100 : 110 } }) };
  } }).dispatch({ ...boundTurn("one", claim, input.user_message), mainChat: true,
    expectedSession: (await repo.getSession("store", "one"))! });
  if (candidate.status !== "candidate") throw new Error("missing suppression candidate");
  const publication = await new StrategyChatPublisher(prisma).publish({ merchantId: "store", sessionId: "one",
    turnId: candidate.turnId, claim, userMessage: input.user_message, result, mainChat: true });
  assert.equal(publication.status, "suppressed");
  if (status === "unknown") {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await prisma.checkoutChatRequest.update({ where: { id: claim.requestId }, data: { status, finishedAt: clock.now } });
  }
  return { ...f, input, claim, candidate };
}

for (const arm of ["control", "treatment"] as const) for (const status of ["processing", "unknown"] as const) {
  integration(`suppression recovery frees ${arm} ${status} without replay or erasing settled AI spend`, async () => {
    const f = await suppressionFixture(arm, status), service = new CheckoutChatRequestService(prisma);
    const assignment = await prisma.strategyAssignment.findFirstOrThrow();
    const reservations = await prisma.strategyAiReservation.findMany();
    assert.equal(reservations[0].state, "settled");
    assert.ok(reservations[0].amountMicros > 0);
    const history = (await repo.getSession("store", "one"))!.chatHistory;
    const reply = await service.reconcile(f.input);
    assert.equal(reply.chat_request.status, "reconciled");
    assert.deepEqual(await service.reconcile(f.input), reply);
    const state = await service.readState("store", "one");
    assert.equal(state.active_request, undefined);
    assert.equal(state.request?.response_outcome, "withheld"); assert.equal(state.turns.length, history.length);
    assert.deepEqual(await prisma.strategyAssignment.findFirstOrThrow(), assignment);
    assert.deepEqual(await prisma.strategyAiReservation.findMany(), reservations);
    assert.equal(await prisma.checkoutChatExchange.count(), 0); assert.equal(await prisma.paymentIntent.count(), 0);
    assert.equal(await prisma.strategyMessageDisplay.count(), 0);
    assert.equal((await prisma.strategyAssignmentStop.findFirstOrThrow()).reason, "checkout_response_suppressed");
    await assert.rejects(service.run(f.input, async () => {}, async () => assert.fail("no replay")), httpStatus(409));
    const { useCase, calls } = mainChatFixture();
    assert.equal((await useCase.execute(buyerRequest())).message, "Resposta habitual.");
    assert.equal(calls.legacy, 1); assert.equal(calls.payments, 0); assert.equal(calls.tools, 0);
    assert.equal(await prisma.strategyTurn.count(), 1);
    assert.equal((await service.readState("store", "one")).request?.response_outcome, undefined);
    const metrics = await new ExperimentMeasurementService(prisma).capture("store", f.execution.experimentId,
      "suppression-metrics", new Date(Date.now() + 25 * 3_600_000));
    const measured = metrics.result as any;
    assert.equal(measured[arm].assigned, 1); assert.equal(measured.participation[arm].stoppedSessions, 1);
    assert.equal(measured.participation[arm].contextExitSessions, 0);
    assert.equal(measured.delivery[arm].sessionsWithPublication, 0);
    assert.equal(measured.delivery[arm].suppressedTurns, 1);
  });
}

for (const cost of ["unknown", "overrun"] as const) integration(`suppression recovery refuses ${cost} AI spend`, async () => {
  const f = await suppressionFixture("control", "unknown", cost), service = new CheckoutChatRequestService(prisma);
  const reservation = await prisma.strategyAiReservation.findFirstOrThrow();
  assert.equal(reservation.state, cost);
  await assert.rejects(service.reconcile(f.input), httpStatus(409));
  assert.deepEqual(await prisma.strategyAiReservation.findFirstOrThrow(), reservation);
  assert.equal(await prisma.checkoutChatResolution.count(), 0); assert.equal(await prisma.strategyAssignmentStop.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
});

integration("suppression recovery is opt-in and refuses other tenants, conversations and message keys", async () => {
  const f = await suppressionFixture(), service = new CheckoutChatRequestService(prisma);
  process.env.CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED = "false";
  await assert.rejects(service.reconcile(f.input), httpStatus(409));
  process.env.CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED = "true";
  process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS = "other";
  await assert.rejects(service.reconcile(f.input), httpStatus(503));
  process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS = "store";
  for (const patch of [{ merchant_id: "other" }, { session_id: "other" }, { conversation_id: "other" }, { message_id: randomUUID() }]) {
    await assert.rejects(service.reconcile({ ...f.input, ...patch }));
  }
  assert.equal(await prisma.checkoutChatResolution.count(), 0); assert.equal(await prisma.strategyAssignmentStop.count(), 0);
  await service.reconcile(f.input);
  process.env.CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED = "false";
  assert.equal((await service.reconcile(f.input)).chat_request.status, "reconciled");
});

integration("suppression recovery is concurrent, atomic and immutable even after cart changes and pause", async () => {
  const f = await suppressionFixture();
  const changed = (await repo.getSession("store", "one"))!;
  changed.cart.total = 123; await repo.saveSession(changed);
  await ledger.stop({ merchantId: "store", executionId: f.execution.id, actorId: "fixture", requestKey: "pause-suppression", kind: "paused" });
  const replies = await Promise.all(Array.from({ length: 6 }, () => new CheckoutChatRequestService(prisma).reconcile(f.input)));
  assert.ok(replies.every(r => r.chat_request.status === "reconciled"));
  assert.equal(await prisma.checkoutChatResolution.count(), 1); assert.equal(await prisma.strategyAssignmentStop.count(), 1);
  assert.equal((await repo.getSession("store", "one"))!.cart.total, 123);
  await assert.rejects(prisma.checkoutChatResolution.deleteMany(), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: f.claim.requestId }, data: { status: "unknown" } }), /IMMUTABLE/);
});

integration("suppression recovery database proof requires stopped participation and terminal receipt together", async () => {
  const f = await suppressionFixture();
  const row = await prisma.checkoutChatRequest.findFirstOrThrow();
  const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const proof = { requestId: row.id, merchantId: "store", sessionId: "one", turnId: f.candidate.turnId,
    previousStatus: row.status, previousFinishedAt: row.finishedAt, resolvedAt: clock.now };
  await assert.rejects(prisma.checkoutChatResolution.create({ data: proof }), /SUPPRESSION_EVIDENCE_REQUIRED/);
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: row.id }, data: { status: "reconciled", finishedAt: clock.now } }), /RESOLUTION_REQUIRED/);
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.strategyAssignmentStop.create({ data: { assignmentId: (await tx.strategyAssignment.findFirstOrThrow()).id,
      merchantId: "store", reason: "checkout_response_suppressed", stoppedAt: clock.now } });
    await tx.checkoutChatResolution.create({ data: proof });
  }), /RESOLUTION_NOT_APPLIED/);
  assert.equal(await prisma.strategyAssignmentStop.count(), 0); assert.equal(await prisma.checkoutChatResolution.count(), 0);
});

integration("suppression recovery restores real main chat after a commercial tool is withheld and preserves settled spend", async () => {
  await activate(); await repo.createSessionIfAbsent(primarySession("one"));
  const { useCase, calls } = mainChatFixture(); let attempts = 0;
  globalThis.fetch = (async () => { attempts++; return navigationResponse(["apply_discount"], '{"percent":90}'); }) as typeof fetch;
  const request = buyerRequest();
  await assert.rejects(useCase.execute(request), httpStatus(503));
  const reservation = await prisma.strategyAiReservation.findFirstOrThrow();
  assert.notEqual(reservation.state, "unknown");
  const usage = await prisma.aiUsageEvent.findMany();
  assert.equal(usage.length, 1);
  process.env.CHECKOUT_CHAT_RECOVERY_ENABLED = "true";
  process.env.CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED = "true";
  await new CheckoutChatRequestService(prisma).reconcile(request);
  assert.deepEqual(await prisma.strategyAiReservation.findFirstOrThrow(), reservation);
  assert.deepEqual(await prisma.aiUsageEvent.findMany(), usage);
  assert.equal((await useCase.execute(buyerRequest())).message, "Resposta habitual.");
  assert.equal(attempts, 1); assert.equal(calls.legacy, 1); assert.equal(calls.tools, 0); assert.equal(calls.payments, 0);
  assert.equal((await repo.getSession("store", "one"))!.cart.currentDiscount ?? 0, 0);
});

integration("suppression recovery rolls back participation and proof when receipt persistence fails", async () => {
  const f = await suppressionFixture();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "checkoutChatRequest") return Reflect.get(transaction, key);
      return new Proxy(transaction.checkoutChatRequest, { get(delegate, method) {
        if (method !== "update") return Reflect.get(delegate, method);
        return () => { throw new Error("SIMULATED_SUPPRESSION_PERSISTENCE_FAILURE"); };
      } });
    } })));
  } }) as PrismaClient;
  await assert.rejects(new CheckoutChatRequestService(broken).reconcile(f.input), /SUPPRESSION_PERSISTENCE_FAILURE/);
  assert.equal(await prisma.strategyAssignmentStop.count(), 0); assert.equal(await prisma.checkoutChatResolution.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  await new CheckoutChatRequestService(prisma).reconcile(f.input);
});

integration("suppression recovery fences late workers and cannot revive the discarded candidate", async () => {
  const f = await suppressionFixture("control", "processing"), service = new CheckoutChatRequestService(prisma);
  await service.reconcile(f.input);
  const decision = await new StrategyChatPublisher(prisma).publish({ merchantId: "store", sessionId: "one",
    turnId: f.candidate.turnId, claim: f.claim, userMessage: f.input.user_message, result: f.candidate.result, mainChat: true });
  assert.equal(decision.status, "already_decided");
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: f.claim.requestId },
    data: { status: "completed", responseHash: digest("stale"), finishedAt: new Date() } }), /IMMUTABLE/);
  assert.equal(await prisma.checkoutChatExchange.count(), 0); assert.equal(await prisma.strategyMessageDisplay.count(), 0);
});

integration("loopback recovery returns a bounded receipt and a repeated send preserves it through the error filter", async () => {
  const f = await recoveryFixture();
  const requests = new CheckoutChatRequestService(prisma);
  const recovery = new ReconcileChatMessageUseCase(requests);
  // Transport fixture only. Actual tenant guards and embed session binding are
  // tested separately in the public/embed controller suites.
  @Controller("recovery-fixture")
  class FixtureController {
    @Post("reconcile") @HttpCode(200)
    reconcile(@Body() body: any) { return recovery.execute({ merchant_id: "store", session_id: "one",
      message_id: body.message_id, conversation_id: body.conversation_id }); }
    @Post("send") @HttpCode(200)
    send(@Body() body: any) { return requests.run({ ...body, merchant_id: "store", session_id: "one" },
      async () => assert.fail("no preflight"), async () => assert.fail("no work")); }
  }
  @Module({ controllers: [FixtureController] })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  app.useGlobalFilters(new ProblemDetailsFilter());
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const post = (path: string) => originalFetch(`${origin}/recovery-fixture/${path}`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(f.input) });
    const result = await post("reconcile");
    assert.equal(result.status, 200);
    const expected = { message_id: f.input.message_id, status: "reconciled", next_action: "refresh_session" };
    assert.deepEqual(await result.json(), { chat_request: expected });
    const repeated = await post("send");
    assert.equal(repeated.status, 409);
    const problem = await repeated.json() as any;
    assert.deepEqual(problem.chat_request, expected);
    assert.equal(problem.code, "chat_message_reconciled"); assert.equal(problem.message, undefined);
    assert.equal(await prisma.checkoutChatExchange.count(), 1);
  } finally { await app.close(); }
});
