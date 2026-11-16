import "reflect-metadata";
import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { ExperimentActivationService } from "./experiment-activation.service.js";
import { buildMeasurementPlan, digest } from "../domain/services/measurement-plan.js";
import { PrismaExperimentRepository } from "../infrastructure/repositories/prisma-experiment.repository.js";
import type { HumanTenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { AssignVariantToSessionUseCase } from "./use-cases/assign-variant-to-session.use-case.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });
async function fixture(t: TestContext) {
  const merchantId = "qa_athom_activation_" + randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "Activation QA" } });
  const user = await db.merchantUser.create({ data: { merchantId, email: randomUUID() + "@example.test", role: "owner",
    teamMembers: { create: { merchantId, role: "OWNER" } } } });
  const experiment = await db.promptExperiment.create({ data: { merchantId, name: "Compare communication", variants: { create: [
    { name: "Reference", systemPrompt: "Answer the buyer's questions.", weight: 50, isControl: true },
    { name: "Challenger", systemPrompt: "Explain the next step, without new incentives.", weight: 50, isControl: false },
  ] } }, include: { variants: true } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_athom_activation_"));
    await db.experimentActivationApproval.deleteMany({ where: { merchantId } });
    await db.experimentMeasurementReview.deleteMany({ where: { merchantId } });
    await db.experimentMeasurementPlan.deleteMany({ where: { merchantId } });
    await db.promptVariant.deleteMany({ where: { experiment: { merchantId } } });
    await db.promptExperiment.deleteMany({ where: { merchantId } });
    await db.revenueAnalysisSchedule.deleteMany({ where: { merchantId } });
    await db.outboxMessage.deleteMany({ where: { merchantId } });
    await db.merchantUser.deleteMany({ where: { merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
  });
  return { merchantId, experiment, user, service: new ExperimentActivationService(db) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const actor = (f: Fixture): HumanTenantPrincipal => ({ kind: "human", tenantId: f.merchantId, userId: f.user.id, email: f.user.email, role: "owner" });
const input = async (f: Fixture) => ({ expected_review_hash: (await f.service.review(f.merchantId, f.experiment.id)).reviewHash,
  request_key: randomUUID(), acknowledged: true as const });
async function planFor(f: Fixture) {
  await db.revenueAnalysisSchedule.create({ data: { merchantId: f.merchantId, group: 0, nextDueAt: new Date() } });
  const end = new Date(Date.now() - 86_400_000), start = new Date(end.getTime() - 28 * 86_400_000);
  const plan = buildMeasurementPlan({ variants: f.experiment.variants, durationDays: 7, conversionWindowHours: 24,
    minimumEffectBps: 100, baseline: { sessions: 1000, conversions: 100, windowStart: start.toISOString(), windowEnd: end.toISOString() } });
  return db.experimentMeasurementPlan.create({ data: { experimentId: f.experiment.id, merchantId: f.merchantId,
    planHash: digest(plan), plan: JSON.parse(JSON.stringify(plan)) } });
}

test("activation review returns exact prompts, weights and stable version without writes", async t => {
  const f = await fixture(t);
  const review = await f.service.review(f.merchantId, f.experiment.id);
  assert.equal(review.canApprove, true); assert.deepEqual(review.blockers, []);
  assert.equal(review.automaticPromotion, false); assert.equal(review.scope, "reviewed_communication_variants_only");
  assert.deepEqual(review.variants.map(v => v.systemPrompt).sort(), f.experiment.variants.map(v => v.systemPrompt).sort());
  assert.deepEqual(review.variants.map(v => v.weight), [50, 50]);
  assert.match(review.reviewHash, /^[a-f0-9]{64}$/);
  assert.equal((await f.service.review(f.merchantId, f.experiment.id)).reviewHash, review.reviewHash);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal(await db.experimentMeasurementPlan.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal((await db.promptExperiment.findUniqueOrThrow({ where: { id: f.experiment.id } })).status, "draft");
  await assert.rejects(f.service.review("foreign", f.experiment.id), /EXPERIMENT_NOT_FOUND/);
});

test("review explains missing required measurement plan and versions variant changes", async t => {
  const f = await fixture(t);
  const before = await f.service.review(f.merchantId, f.experiment.id);
  await db.revenueAnalysisSchedule.create({ data: { merchantId: f.merchantId, group: 0, nextDueAt: new Date() } });
  const governed = await f.service.review(f.merchantId, f.experiment.id);
  assert.equal(governed.measurementRequired, true); assert.equal(governed.canApprove, false);
  assert.deepEqual(governed.blockers, ["EXPERIMENT_MEASUREMENT_PLAN_REQUIRED"]);
  assert.notEqual(before.reviewHash, governed.reviewHash);
  await db.promptVariant.update({ where: { id: f.experiment.variants[0].id }, data: { systemPrompt: "Changed approach" } });
  assert.notEqual((await f.service.review(f.merchantId, f.experiment.id)).reviewHash, governed.reviewHash);
});

test("explicit approval stores canonical actor/version/time and starts exactly once under concurrent replay", async t => {
  const f = await fixture(t); await planFor(f); const body = await input(f);
  const [first, second] = await Promise.all([f.service.activate(actor(f), f.experiment.id, body), f.service.activate(actor(f), f.experiment.id, body)]);
  assert.deepEqual(first, second); assert.equal(first.actorUserId, f.user.id); assert.equal(first.actorRole, "owner");
  assert.equal(first.reviewHash, body.expected_review_hash);
  const saved = await db.promptExperiment.findUniqueOrThrow({ where: { id: f.experiment.id } });
  assert.equal(saved.status, "running"); assert.deepEqual(saved.startedAt, first.approvedAt);
  assert.equal(first.endsAt!.getTime() - first.approvedAt.getTime(), 7 * 86_400_000);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 1);
  const events = await db.outboxMessage.findMany({ where: { merchantId: f.merchantId } });
  assert.equal(events.length, 1); assert.equal(events[0].eventType, "experiment.started");
  assert.deepEqual(events[0].payload, { experiment_id: f.experiment.id, name: f.experiment.name, variant_count: 2,
    review_hash: body.expected_review_hash, approved_by: f.user.id });
  await db.promptExperiment.update({ where: { id: f.experiment.id }, data: { status: "completed" } });
  assert.deepEqual(await f.service.activate(actor(f), f.experiment.id, body), first);
  assert.equal((await db.promptExperiment.findUniqueOrThrow({ where: { id: f.experiment.id } })).status, "completed");
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, { ...body, request_key: randomUUID() }), /EXPERIMENT_ALREADY_APPROVED/);
});

test("stale version rejects without approval, state change or outbox", async t => {
  const f = await fixture(t), body = await input(f);
  await db.promptVariant.update({ where: { id: f.experiment.variants[0].id }, data: { systemPrompt: "New version" } });
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, body), /EXPERIMENT_REVIEW_STALE/);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal((await db.promptExperiment.findUniqueOrThrow({ where: { id: f.experiment.id } })).status, "draft");
});

test("foreign, staff, disabled and revoked membership cannot approve", async t => {
  const f = await fixture(t), body = await input(f);
  await assert.rejects(f.service.activate({ ...actor(f), tenantId: "foreign" }, f.experiment.id, body), /EXPERIMENT_NOT_FOUND/);
  await assert.rejects(f.service.activate({ ...actor(f), role: "staff" }, f.experiment.id, body), /EXPERIMENT_HUMAN_APPROVAL_REQUIRED/);
  await assert.rejects(f.service.activate({ kind: "service", tenantId: f.merchantId, credentialId: "test", environment: "test", scopes: ["experiments:write"] }, f.experiment.id, body), /EXPERIMENT_HUMAN_APPROVAL_REQUIRED/);
  await db.merchantUser.update({ where: { id: f.user.id }, data: { disabledAt: new Date() } });
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, body), /EXPERIMENT_HUMAN_APPROVAL_REQUIRED/);
  await db.merchantUser.update({ where: { id: f.user.id }, data: { disabledAt: null } });
  await db.merchantTeamMember.deleteMany({ where: { merchantId: f.merchantId } });
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, body), /EXPERIMENT_HUMAN_APPROVAL_REQUIRED/);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { merchantId: f.merchantId } }), 0);
});

test("missing or corrupt measurement and financial variants stay blocked", async t => {
  const f = await fixture(t);
  await db.revenueAnalysisSchedule.create({ data: { merchantId: f.merchantId, group: 0, nextDueAt: new Date() } });
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, await input(f)), /EXPERIMENT_MEASUREMENT_PLAN_REQUIRED/);
  await db.revenueAnalysisSchedule.delete({ where: { merchantId: f.merchantId } });
  const plan = await planFor(f);
  await db.experimentMeasurementPlan.update({ where: { experimentId: f.experiment.id }, data: { planHash: "corrupt" } });
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, await input(f)), /EXPERIMENT_MEASUREMENT_PLAN_CORRUPT/);
  await db.experimentMeasurementPlan.update({ where: { experimentId: f.experiment.id }, data: { planHash: plan.planHash } });
  await db.promptVariant.update({ where: { id: f.experiment.variants[0].id }, data: { appliedRuleId: "not-authorized" } });
  await assert.rejects(f.service.activate(actor(f), f.experiment.id, await input(f)), /EXPERIMENT_COMMUNICATION_VARIANTS_REQUIRED/);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { merchantId: f.merchantId } }), 0);
});

test("two different drafts racing cannot both become running", async t => {
  const f = await fixture(t);
  const other = await db.promptExperiment.create({ data: { merchantId: f.merchantId, name: "Other draft", variants: { create:
    f.experiment.variants.map(v => ({ name: v.name, systemPrompt: v.systemPrompt, weight: v.weight, isControl: v.isControl })) } } });
  const otherBody = { ...await input(f), expected_review_hash: (await f.service.review(f.merchantId, other.id)).reviewHash };
  const results = await Promise.allSettled([f.service.activate(actor(f), f.experiment.id, await input(f)), f.service.activate(actor(f), other.id, otherBody)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await db.promptExperiment.count({ where: { merchantId: f.merchantId, status: "running" } }), 1);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 1);
  assert.equal(await db.outboxMessage.count({ where: { merchantId: f.merchantId } }), 1);
});

test("outbox failure rolls back approval and running state", async t => {
  const f = await fixture(t);
  const fault = db.$extends({ query: { outboxMessage: { create: async () => { throw Error("injected_outbox_failure"); } } } });
  const service = new ExperimentActivationService(fault as unknown as typeof db);
  await assert.rejects(service.activate(actor(f), f.experiment.id, await input(f)), /injected_outbox_failure/);
  assert.equal((await db.promptExperiment.findUniqueOrThrow({ where: { id: f.experiment.id } })).status, "draft");
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { merchantId: f.merchantId } }), 0);
});

test("assignment uses only approved variants within the registered fixed horizon", async t => {
  const f = await fixture(t); await planFor(f);
  await f.service.activate(actor(f), f.experiment.id, await input(f));
  const repository = new PrismaExperimentRepository(db), assign = new AssignVariantToSessionUseCase(repository);
  const selected = await assign.execute({ merchant_id: f.merchantId, session_id: "qa-new-session" });
  assert.ok(f.experiment.variants.some(v => v.id === selected!.variant_id && v.systemPrompt === selected!.system_prompt));
  assert.equal(selected!.applied_rule_id, null);
  await db.experimentActivationApproval.update({ where: { experimentId: f.experiment.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  assert.equal(await assign.execute({ merchant_id: f.merchantId, session_id: "qa-late-session" }), null);
  await db.experimentActivationApproval.update({ where: { experimentId: f.experiment.id }, data: { endsAt: new Date(Date.now() + 86_400_000) } });
  await db.promptVariant.update({ where: { id: f.experiment.variants[0].id }, data: { systemPrompt: "Unreviewed change" } });
  assert.equal(await assign.execute({ merchant_id: f.merchantId, session_id: "qa-drift-session" }), null);
});

test("actual HTTP requires session and plan access, rejects forged approval and returns persisted running state", async t => {
  const f = await fixture(t);
  const { Module, ForbiddenException } = await import("@nestjs/common");
  const { NestFactory, Reflector } = await import("@nestjs/core");
  const { ExperimentActivationController } = await import("../presentation/http/experiment-activation.controller.js");
  const { ExperimentMeasurementService } = await import("./experiment-measurement.service.js");
  const { GetExperimentUseCase } = await import("./use-cases/get-experiment.use-case.js");
  const { AuthGuard } = await import("../../auth/presentation/auth.guard.js");
  const { JwtService } = await import("../../auth/domain/services/jwt.service.js");
  const { AuthCookieService } = await import("../../auth/domain/services/auth-cookie.service.js");
  const { PrismaAuthRepository } = await import("../../auth/infrastructure/prisma-auth.repository.js");
  const { PlanLimitGuard, BillingPlanMeteringService } = await import("../../payment/domain/billing-plan-guard.js");
  const jwt = new JwtService("owned-local-activation-http-fixture-secret", 3600, new PrismaAuthRepository(db));
  const token = await jwt.issue({ userId: f.user.id, merchantId: f.merchantId, email: f.user.email, role: "owner" });
  let allowed = true; const scopes: unknown[] = [];
  const metering = { assertAllowed: async (merchantId: string, requirement: unknown) => {
    scopes.push([merchantId, requirement]); if (!allowed) throw new ForbiddenException("plan_feature_not_available");
  } };
  // The TS source loader does not emit constructor type metadata. Restore the
  // metadata emitted by the production compiler for these existing guards.
  Reflect.defineMetadata("design:paramtypes", [JwtService, AuthCookieService], AuthGuard);
  Reflect.defineMetadata("design:paramtypes", [Reflector, BillingPlanMeteringService], PlanLimitGuard);
  class HttpFixture {}
  Module({ controllers: [ExperimentActivationController], providers: [
    { provide: ExperimentActivationService, useValue: f.service },
    { provide: ExperimentMeasurementService, useValue: new ExperimentMeasurementService(db) },
    { provide: GetExperimentUseCase, useValue: new GetExperimentUseCase(new PrismaExperimentRepository(db)) },
    { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService("qa_session", false) },
    Reflector, { provide: BillingPlanMeteringService, useValue: metering }, AuthGuard, PlanLimitGuard,
  ] })(HttpFixture);
  const app = await NestFactory.create(HttpFixture, { logger: false });
  await app.listen(0, "127.0.0.1"); t.after(async () => { await app.close(); });
  const base = await app.getUrl() + "/dashboard/experiments/" + f.experiment.id;
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  assert.equal((await fetch(base + "/activation-review")).status, 401);
  let response = await fetch(base + "/activation-review", { headers });
  assert.equal(response.status, 200); const review = await response.json();
  assert.equal(review.experimentId, f.experiment.id); assert.equal(review.canApprove, true);
  assert.deepEqual(scopes[0], [f.merchantId, { kind: "feature", key: "abTests" }]);
  allowed = false; assert.equal((await fetch(base + "/activation-review", { headers })).status, 403); allowed = true;
  const body = { expected_review_hash: review.reviewHash, request_key: randomUUID(), acknowledged: true };
  response = await fetch(base + "/approve-and-start", { method: "POST", headers, body: JSON.stringify({ ...body, actor: "forged", merchant_id: "foreign" }) });
  assert.equal(response.status, 400);
  assert.equal(await db.experimentActivationApproval.count({ where: { merchantId: f.merchantId } }), 0);
  response = await fetch(base + "/approve-and-start", { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(response.status, 201); const result = await response.json();
  assert.equal(result.experiment.status, "running"); assert.equal(result.experiment.merchant_id, f.merchantId);
  assert.equal(result.approval.actorUserId, f.user.id); assert.equal(result.approval.reviewHash, review.reviewHash);
  await jwt.revoke(token);
  assert.equal((await fetch(base + "/approve-and-start", { method: "POST", headers, body: JSON.stringify(body) })).status, 401);
  assert.equal(await db.outboxMessage.count({ where: { merchantId: f.merchantId } }), 1);
});
