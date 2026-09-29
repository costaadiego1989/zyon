import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { ExperimentMeasurementService } from "./experiment-measurement.service.js";
import { PrismaExperimentRepository } from "../infrastructure/repositories/prisma-experiment.repository.js";
import { PromptExperimentEntity } from "../domain/entities/prompt-experiment.entity.js";
import { fingerprintVariants, type MeasurementPlan } from "../domain/services/measurement-plan.js";

// Only named disposable databases may be truncated. Suites sharing the recovery
// database must run with --test-concurrency=1, never in separate concurrent jobs.
const url = new URL(process.env.REVENUE_MEASUREMENT_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557"
  && ["/revenue_measurement_0924", "/revenue_recovery_final_0924"].includes(url.pathname);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const service = new ExperimentMeasurementService(prisma);
const repository = new PrismaExperimentRepository(prisma);
const environment = { ...process.env };
const registered = new Date("2030-08-30T00:00:00Z");
const started = new Date("2030-09-01T00:00:00Z");
const mature = new Date("2030-09-09T00:00:00Z");
const historical = new Date("2030-08-20T00:00:00Z");
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = environment; });
beforeEach(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`TRUNCATE experiment_measurement_reviews, experiment_measurement_plans,
    prompt_experiments, checkout_sessions, revenue_analysis_schedules, merchants CASCADE`);
  Object.assign(process.env, { REVENUE_WEEKLY_ENABLED: "false", REVENUE_EXPERIMENT_DURATION_DAYS: "7",
    REVENUE_EXPERIMENT_CONVERSION_WINDOW_HOURS: "24", REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS: "500" });
});

async function setup() {
  await prisma.merchant.create({ data: { id: "merchant", name: "Measurement fixture" } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId: "merchant", group: 0, nextDueAt: registered } });
  await prisma.checkoutSession.createMany({ data: Array.from({ length: 1000 }, (_, i) => session(`history-${i}`, null, historical)) });
  await prisma.completedOrder.createMany({ data: Array.from({ length: 100 }, (_, i) => order(`history-${i}`, `history-order-${i}`, historical)) });
  const entity = PromptExperimentEntity.create({ merchant_id: "merchant", name: "Communication fixture", variants: [
    { name: "Control", system_prompt: "Current checkout behavior", weight: 50, is_control: true },
    { name: "Treatment", system_prompt: "Explain next step", weight: 50, is_control: false },
  ] });
  await repository.save(entity);
  return entity;
}
function session(id: string, variant: string | null, createdAt = started, merchantId = "merchant") {
  return { id: `${merchantId}-${id}`, merchantId, sessionId: id, globalUserId: `${merchantId}-buyer-${id}`,
    conversationId: id, cart: { currency: "BRL" }, cohort: "treatment", promptVariantId: variant, createdAt, updatedAt: createdAt };
}
function order(sessionId: string, id: string, completedAt = new Date(started.getTime() + 1000), merchantId = "merchant") {
  return { id: `${merchantId}-${id}`, merchantId, sessionId, externalOrderId: id, currency: "BRL", orderTotal: 100, completedAt };
}
async function prepared() {
  const entity = await setup();
  const stored = await service.prepare("merchant", entity.id, registered);
  return { entity, stored, plan: stored.plan as unknown as MeasurementPlan };
}
async function activatedFixture() {
  const result = await prepared();
  // Synthetic activation only. Production activation remains gated on RI-07/09.
  await prisma.promptExperiment.update({ where: { id: result.entity.id }, data: { status: "running", startedAt: started } });
  return result;
}
async function population(plan: MeasurementPlan, controlConversions = 100, treatmentConversions = 200) {
  for (const [prefix, variant, conversions] of [["c", plan.controlVariantId, controlConversions], ["t", plan.treatmentVariantId, treatmentConversions]] as const) {
    await prisma.checkoutSession.createMany({ data: Array.from({ length: 1000 }, (_, i) => session(`${prefix}-${i}`, variant)) });
    if (conversions) await prisma.completedOrder.createMany({ data: Array.from({ length: conversions }, (_, i) => order(`${prefix}-${i}`, `${prefix}-order-${i}`)) });
  }
}

test("concurrent preparation freezes one server-owned plan with a mature baseline", { skip: !enabled }, async () => {
  const entity = await setup();
  const plans = await Promise.all(Array.from({ length: 12 }, () => service.prepare("merchant", entity.id, registered)));
  assert.equal(new Set(plans.map(p => p.planHash)).size, 1);
  assert.equal(await prisma.experimentMeasurementPlan.count(), 1);
  const plan = plans[0].plan as unknown as MeasurementPlan;
  assert.equal(plan.baseline.sessions, 1000); assert.equal(plan.baseline.conversions, 100);
  assert.ok(plan.minimumSessionsPerArm > 600);
  // Operator changes cannot rewrite an already registered plan on retry.
  process.env.REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS = "100";
  assert.equal((await service.prepare("merchant", entity.id)).planHash, plans[0].planHash);
});

test("tenant isolation protects registration, reads, captures and composite foreign keys", { skip: !enabled }, async () => {
  const { entity } = await prepared();
  for (const call of [() => service.read("foreign", entity.id), () => service.prepare("foreign", entity.id),
    () => service.capture("foreign", entity.id, "review-foreign")]) {
    await assert.rejects(call(), (e: any) => e.getStatus() === 404);
  }
  await assert.rejects(prisma.experimentMeasurementReview.create({ data: { id: "forged", experimentId: entity.id,
    merchantId: "foreign", requestKey: "forged", planHash: "forged", evidenceHash: "forged", result: {} } }));
});

test("missing configuration or data does not create a guessed plan", { skip: !enabled }, async () => {
  const entity = await setup();
  delete process.env.REVENUE_EXPERIMENT_DURATION_DAYS;
  await assert.rejects(service.prepare("merchant", entity.id, registered), /EXPERIMENT_MEASUREMENT_NOT_CONFIGURED/);
  assert.equal(await prisma.experimentMeasurementPlan.count(), 0);
  process.env.REVENUE_EXPERIMENT_DURATION_DAYS = "7";
  await prisma.completedOrder.deleteMany();
  await assert.rejects(service.prepare("merchant", entity.id, registered), /EXPERIMENT_INSUFFICIENT_PLANNING_BASELINE/);
  assert.equal(await prisma.experimentMeasurementPlan.count(), 0);
});

test("post hoc plans are refused for running or already assigned experiments", { skip: !enabled }, async () => {
  const entity = await setup();
  await prisma.checkoutSession.create({ data: session("premature", entity.variants[0].id) });
  await assert.rejects(service.prepare("merchant", entity.id, registered), /EXPERIMENT_PLAN_MUST_PRECEDE_ASSIGNMENT/);
  await prisma.checkoutSession.delete({ where: { id: "merchant-premature" } });
  await prisma.promptExperiment.update({ where: { id: entity.id }, data: { status: "running", startedAt: started } });
  await assert.rejects(service.prepare("merchant", entity.id, registered), /EXPERIMENT_PLAN_MUST_PRECEDE_ACTIVATION/);
});

test("prepared plans and review snapshots reject updates and legacy activation", { skip: !enabled }, async () => {
  const { entity } = await prepared();
  await assert.rejects(repository.save(entity.update({ name: "Changed" })), /EXPERIMENT_PLAN_IMMUTABLE/);
  await assert.rejects(repository.delete(entity.id, "merchant"), /EXPERIMENT_PLAN_IMMUTABLE/);
  await assert.rejects(repository.save(entity.start()), /EXPERIMENT_VERSIONED_APPROVAL_REQUIRED/);
  await assert.rejects(prisma.experimentMeasurementPlan.update({ where: { experimentId: entity.id }, data: { planHash: "replacement" } }), /EXPERIMENT_MEASUREMENT_IMMUTABLE/);
  await assert.rejects(prisma.experimentMeasurementPlan.delete({ where: { experimentId: entity.id } }), /EXPERIMENT_MEASUREMENT_IMMUTABLE/);
  const review = await service.capture("merchant", entity.id, "initial-review", registered);
  assert.equal((review.result as any).state, "not_started");
  await assert.rejects(prisma.experimentMeasurementReview.update({ where: { id: review.id }, data: { result: {} } }), /EXPERIMENT_MEASUREMENT_IMMUTABLE/);
  await assert.rejects(prisma.experimentMeasurementReview.delete({ where: { id: review.id } }), /EXPERIMENT_MEASUREMENT_IMMUTABLE/);
});

test("all assignments count even without result rows, and orders deduplicate only conversion", { skip: !enabled }, async () => {
  const { entity, plan } = await activatedFixture();
  await population(plan);
  await prisma.completedOrder.create({ data: order("t-0", "second-order") });
  // Same session identifier and even variant ID in another tenant cannot contribute.
  await prisma.checkoutSession.create({ data: session("t-0", plan.treatmentVariantId, started, "foreign") });
  await prisma.completedOrder.create({ data: order("t-0", "foreign-order", started, "foreign") });
  assert.equal(await prisma.promptVariantResult.count(), 0);
  const review = await service.capture("merchant", entity.id, "mature-review", mature);
  const result = review.result as any;
  assert.equal(result.control.assigned, 1000); assert.equal(result.control.converted, 100);
  assert.equal(result.treatment.assigned, 1000); assert.equal(result.treatment.converted, 200);
  assert.equal(result.treatment.orders, 201); assert.equal(result.treatment.revenueCents, 2_010_000);
  assert.equal(result.state, "positive"); assert.equal(result.promotionAllowed, false); assert.equal(result.contributionCents, null);
  assert.equal((await prisma.promptExperiment.findUniqueOrThrow({ where: { id: entity.id } })).winnerVariantId, null);
});

test("concurrent retries return one original snapshot; later correction preserves old evidence", { skip: !enabled }, async () => {
  const { entity, plan } = await activatedFixture();
  await population(plan);
  const reviews = await Promise.all(Array.from({ length: 10 }, () => service.capture("merchant", entity.id, "same-review", mature)));
  assert.equal(new Set(reviews.map(r => r.id)).size, 1);
  await prisma.completedOrder.updateMany({ where: { merchantId: "merchant", sessionId: { startsWith: "t-" } }, data: { status: "cancelled" } });
  const retry = await service.capture("merchant", entity.id, "same-review", new Date(mature.getTime() + 1000));
  assert.deepEqual(retry, reviews[0]);
  const correction = await service.capture("merchant", entity.id, "corrected-review", new Date(mature.getTime() + 1000));
  assert.equal((correction.result as any).state, "negative");
  assert.notEqual(correction.evidenceHash, retry.evidenceHash);
  assert.equal((await service.read("merchant", entity.id)).reviews.length, 2);
});

test("half-open attribution excludes late orders; enrollment and maturity have different deadlines", { skip: !enabled }, async () => {
  const { entity, plan } = await activatedFixture();
  const last = new Date("2030-09-07T23:59:59Z");
  await prisma.checkoutSession.createMany({ data: [session("last", plan.treatmentVariantId, last), session("boundary-order", plan.controlVariantId)] });
  await prisma.completedOrder.createMany({ data: [order("last", "pending-order", new Date("2030-09-08T01:00:00Z")),
    order("boundary-order", "at-cutoff", new Date("2030-09-02T00:00:00Z"))] });
  const pending = (await service.capture("merchant", entity.id, "pending-review", new Date("2030-09-08T12:00:00Z"))).result as any;
  assert.equal(pending.state, "awaiting_maturity"); assert.equal(pending.treatment.assigned, 1); assert.equal(pending.treatment.mature, 0);
  const final = (await service.capture("merchant", entity.id, "final-review", mature)).result as any;
  assert.equal(final.control.converted, 0); assert.equal(final.treatment.converted, 1); assert.equal(final.state, "inconclusive");
});

test("holdout, repeated buyers, currencies and out-of-window assignments invalidate inference", { skip: !enabled }, async () => {
  const { entity, plan } = await activatedFixture();
  await prisma.checkoutSession.createMany({ data: [
    { ...session("holdout", plan.controlVariantId), cohort: "holdout", globalUserId: "repeated" },
    { ...session("repeat", plan.treatmentVariantId), globalUserId: "repeated" },
    session("boundary", plan.treatmentVariantId, new Date("2030-09-08T00:00:00Z")),
  ] });
  await prisma.completedOrder.create({ data: { ...order("repeat", "usd-order"), currency: "USD" } });
  const result = (await service.capture("merchant", entity.id, "invalid-review", mature)).result as any;
  assert.equal(result.state, "invalid"); assert.equal(result.interval, null);
  for (const reason of ["holdout_contamination", "session_independence_unverified", "mixed_order_currencies", "assignment_outside_fixed_horizon"]) assert.ok(result.reasons.includes(reason));
});

test("registration racing with a draft edit freezes exactly the stored variants", { skip: !enabled }, async () => {
  const entity = await setup();
  const changed = entity.updateVariants(entity.variants.map(v => ({ ...v, system_prompt: `${v.system_prompt} Updated` })));
  const outcomes = await Promise.allSettled([service.prepare("merchant", entity.id, registered), repository.save(changed)]);
  assert.equal(outcomes[0].status, "fulfilled");
  const row = await prisma.promptExperiment.findUniqueOrThrow({ where: { id: entity.id }, include: { variants: true, measurementPlan: true } });
  assert.equal((row.measurementPlan!.plan as unknown as MeasurementPlan).variantFingerprint, fingerprintVariants(row.variants));
  if (outcomes[1].status === "rejected") assert.match(String(outcomes[1].reason), /EXPERIMENT_PLAN_IMMUTABLE/);
});

test("legacy stores retain legal lifecycle transitions; stale saves cannot resurrect completed experiments", { skip: !enabled }, async () => {
  const draft = PromptExperimentEntity.create({ merchant_id: "legacy", name: "Legacy fixture", variants: [
    { name: "Control", system_prompt: "Current", weight: 50, is_control: true },
    { name: "Treatment", system_prompt: "Alternative", weight: 50, is_control: false },
  ] });
  await repository.save(draft);
  await repository.delete(draft.id, "foreign");
  assert.ok(await repository.findById(draft.id, "legacy"));
  assert.equal(await repository.findById(draft.id, "foreign"), null);
  const running = draft.start();
  await repository.save(running);
  const completed = running.complete();
  await repository.save(completed);
  await assert.rejects(repository.save(running), /EXPERIMENT_STATE_CHANGED/);
  await assert.rejects(repository.save(draft), /EXPERIMENT_STATE_CHANGED/);
  await repository.save(completed.archive());
  assert.equal((await repository.findById(draft.id, "legacy"))!.status, "archived");
  const forged = PromptExperimentEntity.rehydrate({ ...draft.snapshot(), merchant_id: "foreign" });
  await assert.rejects(repository.save(forged), /EXPERIMENT_NOT_FOUND/);
});

test("preexisting result records cannot be relabeled as preregistered evidence", { skip: !enabled }, async () => {
  const entity = await setup();
  await prisma.promptVariantResult.create({ data: { variantId: entity.variants[0].id, sessionId: "old-session", converted: true } });
  await assert.rejects(service.prepare("merchant", entity.id, registered), /EXPERIMENT_PLAN_MUST_PRECEDE_ASSIGNMENT/);
});
