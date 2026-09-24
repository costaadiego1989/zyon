import test, { before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_MERCHANT_RULES, type CheckoutSession } from "@zyon/shared-types";
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

// Only this disposable local database can be truncated by this suite.
const url = new URL(process.env.REVENUE_EXECUTION_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557"
  && url.pathname === "/revenue_publication_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const env = { ...process.env };
const repo = new PrismaCheckoutRepository(prisma);
const ledger = new StrategyExecutionLedger(prisma);
const originalFetch = globalThis.fetch;
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; });
afterEach(() => { globalThis.fetch = originalFetch; });
beforeEach(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`TRUNCATE merchants, merchant_rules, checkout_settings, checkout_sessions,
    revenue_analysis_runs, revenue_analysis_schedules, revenue_manager_observations, revenue_strategies, prompt_experiments CASCADE`);
  process.env = { ...env, REVENUE_STRATEGY_EXECUTION_ENABLED: "true", REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS: "store,other",
    REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED: "true",
    REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED: "true",
    CHECKOUT_CHAT_REQUESTS_ENABLED: "true", CHECKOUT_CHAT_REQUEST_MERCHANT_IDS: "store,other",
    REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40),
    CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", OPENAI_MODEL: "fixture-model" };
  delete process.env.LOCAL_LLM_BASE_URL; delete process.env.OLLAMA_BASE_URL;
  // Every dispatch test supplies a controlled transport; never call a provider.
  globalThis.fetch = (async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN_IN_FIXTURE"); }) as typeof fetch;
});

async function proposalFixture(merchantId = "store", suffix = "one") {
  const now = new Date();
  await prisma.merchant.upsert({ where: { id: merchantId }, create: { id: merchantId, name: "Fixture" }, update: {} });
  await repo.getRules(merchantId);
  await repo.setRules(merchantId, { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 5, minimumMarginPercent: 30 });
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
async function activate(merchantId = "store") {
  const f = await proposalFixture(merchantId);
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
  }, completeTurn: ledger.completeTurn.bind(ledger) } as StrategyExecutionLedger;
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
  const wrapped = { admitTurn: ledger.admitTurn.bind(ledger), completeTurn: async () => { throw new Error("SIMULATED_DATABASE_OUTAGE"); } } as unknown as StrategyExecutionLedger;
  await assert.rejects(new StrategyChatDispatcher(wrapped, new ChatLlmGatewayService()).dispatch(dispatchInput()), /DATABASE_OUTAGE/);
  assert.equal((await dispatcher().dispatch(dispatchInput())).status, "already_admitted");
  assert.equal(await prisma.strategyTurnOutcome.count(), 0);
  assert.equal(calls, 1);
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
  const dispatcherInput = { ...turn(sessionId, f.claim.requestId), chatRequest: f.claim, userMessage: f.input.user_message };
  const dispatched = await new StrategyChatDispatcher(ledger, { async callPinned() { return { outcome: "provider_completed", result }; } }).dispatch(dispatcherInput);
  assert.equal(dispatched.status, "candidate");
  if (dispatched.status !== "candidate") throw new Error("candidate missing");
  return { merchantId: "store", sessionId, turnId: dispatched.turnId, claim: f.claim,
    userMessage: f.input.user_message, result: dispatched.result };
}

integration("durable request, pinned gateway and publication persist the exact control and treatment response", async () => {
  const f = await activate();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return providerResponse(); }) as typeof fetch;
  const publisher = new StrategyChatPublisher(prisma), requests = new CheckoutChatRequestService(prisma);
  for (const arm of ["control", "treatment"] as const) {
    const buyer = Array.from({ length: 100 }, (_, i) => `publication-buyer-${i}`)
      .find(id => strategyArm(f.execution.contract as any, id) === arm)!;
    await repo.createSessionIfAbsent(session(arm, { globalUserId: buyer }));
    const response = await requests.run(buyerRequest(arm), async () => {}, async (message, claim) => {
      assert.ok(claim);
      const candidate = await dispatcher().dispatch({ ...turn(arm, claim.requestId), chatRequest: claim, userMessage: message.user_message });
      assert.equal(candidate.status, "candidate");
      if (candidate.status !== "candidate") throw new Error("candidate missing");
      const publication = await publisher.publish({ merchantId: "store", sessionId: arm, turnId: candidate.turnId,
        claim, userMessage: message.user_message, result: candidate.result });
      if (publication.status !== "persisted") throw new Error("publication missing");
      return { message: publication.message, objection: "unknown", actions: [], turns: publication.session.chatHistory };
    });
    assert.equal(response.chat_request?.status, "completed");
    assert.equal(response.message, completed.result.content);
    assert.equal(response.turns.length, 2);
  }
  assert.equal(calls, 2); assert.equal(await prisma.strategyTurnPublication.count(), 2);
  assert.equal(await prisma.checkoutChatExchange.count(), 2); assert.equal(await prisma.completedOrder.count(), 0);
  assert.equal(JSON.stringify(await prisma.strategyTurnPublication.findMany()).includes(completed.result.content), false);
});

integration("bound admission rejects another request, text, key, tenant and personalized context before provider I/O", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const f = await claimFixture();
  const original = { ...turn("one", f.claim.requestId), chatRequest: f.claim, userMessage: f.input.user_message };
  let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return completed; } });
  for (const patch of [{ requestKey: "wrong" }, { userMessage: "changed" },
    { chatRequest: { ...f.claim, requestHash: "f".repeat(64) } },
    { turn: { ...original.turn, buyerIntent: { primary_intent: "discount" } } }]) {
    await assert.rejects(worker.dispatch({ ...original, ...patch }), /CHAT_REQUEST_CONFLICT|PERSONALIZATION_UNSUPPORTED/);
  }
  await activate("other"); await repo.createSessionIfAbsent(session("one", { merchantId: "other" }));
  await assert.rejects(worker.dispatch({ ...original, merchantId: "other" }), /CHAT_REQUEST_CONFLICT/);
  assert.equal(calls, 0); assert.equal(await prisma.strategyTurn.count(), 0);
});

integration("simultaneous publications append once and return only receipts on repeats", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
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

for (const scenario of ["pause", "cart_restore", "identity", "baseline", "publication_flag", "dispatch_flag", "execution_flag", "horizon"] as const) {
  integration(`publication revalidates ${scenario} after eligible completion`, async () => {
    const f = await activate(); await repo.createSessionIfAbsent(session("one"));
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
    await activate(); await repo.createSessionIfAbsent(session("one"));
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
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const publisher = new StrategyChatPublisher(prisma), candidate = await boundCandidate();
  await assert.rejects(publisher.publish({ ...candidate, result: { ...candidate.result, content: "changed" } }), /RESPONSE_CONFLICT/);
  await assert.rejects(publisher.publish({ ...candidate, merchantId: "other" }), /REQUEST_CONFLICT/);
  await assert.rejects(publisher.publish({ ...candidate, userMessage: "changed" }), /REQUEST_CONFLICT/);
  await repo.createSessionIfAbsent(session("legacy"));
  const f = await claimFixture("legacy");
  const old = await new StrategyChatDispatcher(ledger, { async callPinned() { return completed; } })
    .dispatch({ ...turn("legacy"), userMessage: f.input.user_message });
  if (old.status !== "candidate") throw new Error("candidate missing");
  await assert.rejects(publisher.publish({ ...candidate, sessionId: "legacy", claim: f.claim, turnId: old.turnId }), /REQUEST_CONFLICT/);
  assert.equal(await prisma.checkoutChatExchange.count(), 0); assert.equal(await prisma.strategyTurnPublication.count(), 0);
});

integration("a bound exchange cannot bypass publication through the normal repository", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
  const candidate = await boundCandidate();
  await assert.rejects(repo.appendChatExchange({ merchantId: "store", sessionId: "one", claim: candidate.claim,
    expectedSession: await repo.getSession("store", "one"),
    buyer: { role: "buyer", text: candidate.userMessage, occurredAt: new Date().toISOString() },
    agent: { role: "agent", text: completed.result.content, occurredAt: new Date().toISOString() } }), /PUBLICATION_REQUIRED/);
  assert.equal(await prisma.checkoutChatExchange.count(), 0);
  assert.equal((await repo.getSession("store", "one"))?.chatHistory.length, 0);
});

integration("failure after publication insertion rolls back pair, exchange and decision together", async () => {
  await activate(); await repo.createSessionIfAbsent(session("one"));
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
  await activate(); await repo.createSessionIfAbsent(session("one"));
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
  await activate(); await repo.createSessionIfAbsent(session("one"));
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
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
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
  const f = await activate(); await repo.createSessionIfAbsent(session("one"));
  const request = buyerRequest(); let calls = 0;
  const worker = new StrategyChatDispatcher(ledger, { async callPinned() { calls++; return completed; } });
  const requests = new CheckoutChatRequestService(prisma);
  await assert.rejects(requests.run(request, async () => {}, async (message, claim) => {
    const candidate = await worker.dispatch({ ...turn("one", claim!.requestId), chatRequest: claim, userMessage: message.user_message });
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
