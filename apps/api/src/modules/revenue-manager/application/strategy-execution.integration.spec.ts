import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
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

// Only this disposable local database can be truncated by this suite.
const url = new URL(process.env.REVENUE_EXECUTION_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_execution_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const env = { ...process.env };
const repo = new PrismaCheckoutRepository(prisma);
const ledger = new StrategyExecutionLedger(prisma);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; });
beforeEach(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`TRUNCATE merchants, merchant_rules, checkout_settings, checkout_sessions,
    revenue_analysis_runs, revenue_analysis_schedules, revenue_manager_observations, revenue_strategies, prompt_experiments CASCADE`);
  process.env = { ...env, REVENUE_STRATEGY_EXECUTION_ENABLED: "true", REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS: "store,other",
    REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40),
    CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", OPENAI_MODEL: "fixture-model" };
  delete process.env.LOCAL_LLM_BASE_URL; delete process.env.OLLAMA_BASE_URL;
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
