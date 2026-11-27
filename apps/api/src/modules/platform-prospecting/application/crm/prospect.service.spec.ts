import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { PrismaProspectRepository } from "../../infrastructure/crm/prisma-prospect.repository.js";
import { ProspectService } from "./prospect.service.js";

test("PROS-08 AC2 commercial commands persist version and full actor audit atomically with replay and proven contact binding", async () => {
  const f = await createProspectCrmFixture(); const actor = { operatorId: "operator", correlationId: "treatment-proof" };
  try {
    const repo = new PrismaProspectRepository(f.prisma, f.directory); const service = new ProspectService(repo);
    const added = await service.add({ snapshotId: "search-old", cnpjs: ["00000000000191", "12ABC34501DE35"], clientRequestId: "add" }, actor); const id = added.prospectIds[0];
    const command = { expectedVersion: 1, assignedOperatorId: "other", tags: ["interested", "local"], stage: "qualified" as const, clientRequestId: "treat" };
    const result = await service.update(id, command, actor); assert.equal(result.version, 2); assert.equal(result.stage, "qualified"); assert.equal(result.assignedOperatorId, "other"); assert.deepEqual(result.tags, ["interested", "local"]);
    assert.deepEqual(await service.update(id, command, actor), result);
    assert.deepEqual((await service.commandResult("treat", actor))?.result, result); assert.equal(await service.commandResult("treat", { ...actor, operatorId: "other" }), null);
    await assert.rejects(() => service.update(id, { ...command, tags: ["changed"] }, actor), /idempotency_conflict/);
    await assert.rejects(() => service.update(id, { ...command, clientRequestId: "stale" }, actor), /version_conflict/);
    await assert.rejects(() => service.update(id, { ...command, expectedVersion: 2, clientRequestId: "audit-failure" }, { ...actor, operatorId: "missing" }));
    assert.equal((await service.find(id)).prospect.version, 2); assert.equal(await f.prisma.prospectCommand.count({ where: { clientRequestId: "audit-failure" } }), 0);
    await f.prisma.prospectEndpoint.create({ data: { id: "shared", channel: "whatsapp", normalizedValue: "+5511999999999", protectedLookup: "hmac", senderBindingId: "sender" } });
    for (const prospectId of added.prospectIds) await f.prisma.prospectContactBinding.create({ data: { prospectId, endpointId: "shared" } });
    const bound = await service.bindContact(id, { endpointId: "shared", evidenceRef: "manual-proof", expectedVersion: 2, clientRequestId: "bind" }, actor);
    assert.equal(bound.version, 3); assert.equal(bound.contacts[0].confirmationState, "confirmed"); assert.equal(bound.contacts[0].evidenceRef, "manual-proof"); assert.equal(bound.contacts[0].permission, "no_opt_in");
    assert.equal((await service.find(added.prospectIds[1])).prospect.contacts[0].confirmationState, "unconfirmed"); assert.equal(await f.prisma.contactPermissionReceipt.count(), 0);
    const audit = await f.prisma.prospectAuditEvent.findFirstOrThrow({ where: { action: "prospect.update" } });
    assert.equal(audit.actorOperatorId, "operator"); assert.equal(audit.resourceId, id); assert.equal(audit.resourceType, "prospect"); assert.equal(audit.resourceVersion, 2); assert.equal(audit.correlationId, "treatment-proof"); assert.equal(audit.outcome, "completed"); assert.ok(audit.occurredAt instanceof Date);
    assert.deepEqual(audit.details, { changedFields: ["assignedOperatorId", "stage", "tags"] });
    assert.equal(await f.prisma.prospectAuditEvent.count(), 3);
  } finally { await f.close(); }
});

test("PROS-08 AC2 rejects invalid treatment and verified-only transitions without partial changes", async () => {
  const f = await createProspectCrmFixture(); const actor = { operatorId: "operator", correlationId: "invalid-proof" };
  try {
    const service = new ProspectService(new PrismaProspectRepository(f.prisma, f.directory));
    const id = (await service.add({ snapshotId: "search-old", cnpjs: ["00000000000191"], clientRequestId: "add" }, actor)).prospectIds[0];
    for (const changes of [{ stage: "converted" }, { stage: "do_not_contact" }, { tags: [""] }, { assignedOperatorId: "missing" }, { tags: Array(21).fill("too-many") }]) {
      await assert.rejects(() => service.update(id, { ...changes, expectedVersion: 1, clientRequestId: "bad-" + Object.keys(changes)[0] } as never, actor));
      assert.equal((await service.find(id)).prospect.version, 1);
    }
    assert.equal(await f.prisma.prospectAuditEvent.count(), 1); assert.equal(await f.prisma.prospectCommand.count(), 1);
  } finally { await f.close(); }
});
