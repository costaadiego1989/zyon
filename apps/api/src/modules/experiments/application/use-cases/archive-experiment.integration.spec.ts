import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaExperimentRepository } from "../../infrastructure/repositories/prisma-experiment.repository.js";
import { PromptExperimentEntity } from "../../domain/entities/prompt-experiment.entity.js";
import { ArchiveExperimentUseCase } from "./archive-experiment.use-case.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });
async function fixture(t: TestContext) {
  const merchantId = "qa_athom_archive_" + randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "Owned archive QA" } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_athom_archive_"));
    await db.promptVariant.deleteMany({ where: { experiment: { merchantId } } });
    await db.promptExperiment.deleteMany({ where: { merchantId } });
    await db.revenueAnalysisSchedule.deleteMany({ where: { merchantId } });
    await db.merchant.deleteMany({ where: { id: merchantId } });
  });
  const entity = PromptExperimentEntity.create({ merchant_id: merchantId, name: "Owned draft", variants: [
    { name: "Control", system_prompt: "Existing communication", weight: 50, is_control: true },
    { name: "Treatment", system_prompt: "Explain the next step", weight: 50, is_control: false },
  ] });
  const repository = new PrismaExperimentRepository(db); await repository.save(entity);
  return { merchantId, entity, repository, archive: new ArchiveExperimentUseCase(repository) };
}
test("archives a persisted owned draft without changing its variants", async t => {
  const { merchantId, entity, archive, repository } = await fixture(t);
  await archive.execute({ merchant_id: merchantId, experiment_id: entity.id });
  const saved = (await repository.findById(entity.id, merchantId))!.snapshot();
  assert.equal(saved.status, "archived"); assert.equal(saved.started_at, null); assert.equal(saved.completed_at, null);
  assert.deepEqual(saved.variants, entity.snapshot().variants);
});
test("foreign archive rejects and preserves the owned draft", async t => {
  const { merchantId, entity, archive, repository } = await fixture(t);
  await assert.rejects(archive.execute({ merchant_id: "foreign-merchant", experiment_id: entity.id }), /EXPERIMENT_NOT_FOUND/);
  assert.equal((await repository.findById(entity.id, merchantId))!.status, "draft");
});
test("a stale activation cannot overwrite an archived draft", async t => {
  const { merchantId, entity, archive, repository } = await fixture(t);
  const stale = entity.start();
  await archive.execute({ merchant_id: merchantId, experiment_id: entity.id });
  await assert.rejects(repository.save(stale), /EXPERIMENT_STATE_CHANGED/);
  assert.equal((await repository.findById(entity.id, merchantId))!.status, "archived");
});
test("weekly review still blocks direct activation while allowing draft archival", async t => {
  const { merchantId, entity, archive, repository } = await fixture(t);
  await db.revenueAnalysisSchedule.create({ data: { merchantId, group: 0, nextDueAt: new Date() } });
  await assert.rejects(repository.save(entity.start()), /EXPERIMENT_VERSIONED_APPROVAL_REQUIRED/);
  assert.equal((await repository.findById(entity.id, merchantId))!.status, "draft");
  await archive.execute({ merchant_id: merchantId, experiment_id: entity.id });
  assert.equal((await repository.findById(entity.id, merchantId))!.status, "archived");
});
