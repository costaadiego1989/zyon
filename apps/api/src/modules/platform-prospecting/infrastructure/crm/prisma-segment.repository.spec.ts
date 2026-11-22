import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { PrismaSegmentRepository } from "./prisma-segment.repository.js";

test("PROS-07 AC1 persists definition author and version across repository sessions with atomic optimistic edits", async () => {
  const f = await createProspectCrmFixture(); const actor = { operatorId: "operator", correlationId: "segment-proof" };
  try {
    const repo = new PrismaSegmentRepository(f.prisma);
    const input = { name: "São Paulo", filters: { ufs: ["SP"] }, filterVersion: 1, clientRequestId: "save-segment" };
    const first = await repo.save(null, input, actor);
    assert.equal(first.name, "São Paulo"); assert.deepEqual(first.filters, { ufs: ["SP"] }); assert.equal(first.filterVersion, 1);
    assert.equal(first.ownerOperatorId, "operator"); assert.equal(first.version, 1);
    assert.deepEqual(await new PrismaSegmentRepository(f.prisma).find(first.id), first);
    assert.deepEqual(await repo.save(null, input, actor), first);
    await f.prisma.prospectCampaign.create({ data: { id: "frozen", name: "Frozen", message: "controlled", createdBy: "operator", segmentId: first.id, segmentVersion: 1, audienceHash: "unchanged", filterSnapshot: first.filters, sendWindow: {} } });
    const edited = await repo.save(first.id, { ...input, name: "Rio", filters: { ufs: ["RJ"] }, expectedVersion: 1, clientRequestId: "edit-segment" }, { ...actor, operatorId: "other" });
    assert.equal(edited.version, 2); assert.equal(edited.ownerOperatorId, "operator"); assert.deepEqual(edited.filters, { ufs: ["RJ"] });
    await assert.rejects(() => repo.save(first.id, { ...input, expectedVersion: 1, clientRequestId: "stale-segment" }, actor), /version_conflict/);
    assert.deepEqual(await repo.find(first.id), edited);
    const frozen = await f.prisma.prospectCampaign.findUniqueOrThrow({ where: { id: "frozen" } });
    assert.equal(frozen.audienceHash, "unchanged"); assert.deepEqual(frozen.filterSnapshot, { ufs: ["SP"] }); assert.equal(frozen.segmentVersion, 1);
    assert.equal((await repo.list()).items.length, 1);
    await assert.rejects(() => repo.save(null, { ...input, filters: { ufs: ["XX"] }, clientRequestId: "bad-filter" }, actor), /invalid_filter/);
    await repo.remove(first.id, { expectedVersion: 2, clientRequestId: "delete-segment" }, actor);
    await repo.remove(first.id, { expectedVersion: 2, clientRequestId: "delete-segment" }, actor);
    assert.equal(await repo.find(first.id), null); assert.equal((await repo.list()).items.length, 0);
    assert.equal((await f.prisma.savedProspectSegment.findUniqueOrThrow({ where: { id: first.id } })).version, 3);
    const audits = await f.prisma.prospectAuditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    assert.deepEqual(audits.map(a => [a.action, a.actorOperatorId, a.resourceVersion, a.outcome]), [["segment.create", "operator", 1, "completed"], ["segment.update", "other", 2, "completed"], ["segment.delete", "operator", 3, "completed"]]);
    assert.equal(await f.prisma.prospectCommand.count(), 3);
  } finally { await f.close(); }
});
