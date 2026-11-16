import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { ExperimentActivationService } from "./experiment-activation.service.js";

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
