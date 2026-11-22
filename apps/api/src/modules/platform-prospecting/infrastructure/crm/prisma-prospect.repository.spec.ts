import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { PrismaProspectRepository } from "./prisma-prospect.repository.js";

test("PROS-08 AC1 persists one prospect per canonical CNPJ with durable actor/body-bound replay and source history", async () => {
  const f = await createProspectCrmFixture();
  const actor = { operatorId: "operator", correlationId: "add-proof" };
  const command = { snapshotId: "search-old", cnpjs: ["12ABC34501DE35", "12ABC34501DE35", "00000000000191"], clientRequestId: "add-once" };
  try {
    const repo = new PrismaProspectRepository(f.prisma, f.directory);
    const [a, b] = await Promise.all([repo.add(command, actor), repo.add(command, actor)]);
    assert.deepEqual(a, b); assert.equal(a.created, 2); assert.equal(a.existing, 0); assert.equal(a.prospectIds.length, 2);
    assert.equal(await f.prisma.platformProspect.count(), 2);
    const repeat = await repo.add({ ...command, clientRequestId: "add-again" }, actor);
    assert.equal(repeat.created, 0); assert.equal(repeat.existing, 2); assert.deepEqual(repeat.prospectIds, a.prospectIds);
    await assert.rejects(() => repo.add({ ...command, snapshotId: "different" }, actor), /idempotency_conflict/);
    await assert.rejects(() => repo.add(command, { ...actor, operatorId: "other" }), /idempotency_conflict/);
    const detail = await repo.find(a.prospectIds[0]); assert.equal(detail?.prospect.sourceSnapshotId, "search-old");
    assert.equal(detail?.prospect.stage, "new"); assert.equal(detail?.company?.competence, "2026-10");
    assert.equal(detail?.company?.contacts[0].validationState, "unknown"); assert.deepEqual(detail?.prospect.contacts, []);
    const before = await f.prisma.platformProspect.findMany();
    await assert.rejects(() => repo.add({ ...command, clientRequestId: "partial", cnpjs: ["11222333000181", "missing"] }, actor));
    assert.deepEqual(await f.prisma.platformProspect.findMany(), before);
    assert.equal(await f.prisma.prospectCommand.count(), 2);
    const audit = await f.prisma.prospectAuditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    assert.equal(audit.length, 2); assert.equal(audit[0].actorOperatorId, "operator"); assert.equal(audit[0].action, "prospect.add");
    assert.equal(audit[0].outcome, "completed"); assert.equal(audit[0].correlationId, "add-proof");
    assert.equal((await new PrismaProspectRepository(f.prisma, f.directory).list({ limit: 1 })).items.length, 1);
  } finally { await f.close(); }
});

test("PROS-08 AC1 stores scoped opaque provider identities with actual generated Prisma and keeps companies separate", async () => {
  const f = await createProspectCrmFixture();
  try {
    const endpoint = await f.prisma.prospectEndpoint.create({ data: { id: "opaque", channel: "whatsapp", identityKind: "bsuid", businessScope: "portfolio-a", normalizedValue: "BSUID.AbC_001-X", protectedLookup: "protected-opaque", senderBindingId: "sender" } });
    assert.equal(endpoint.normalizedValue, "BSUID.AbC_001-X"); assert.equal(endpoint.businessScope, "portfolio-a");
    const repo = new PrismaProspectRepository(f.prisma, f.directory);
    const result = await repo.add({ snapshotId: "search-old", cnpjs: ["00000000000191", "12ABC34501DE35"], clientRequestId: "two-companies" }, { operatorId: "operator", correlationId: "identity" });
    for (const prospectId of result.prospectIds) await f.prisma.prospectContactBinding.create({ data: { prospectId, endpointId: endpoint.id } });
    assert.equal(await f.prisma.platformProspect.count(), 2); assert.equal(await f.prisma.prospectEndpoint.count(), 1);
    const contacts = (await repo.find(result.prospectIds[0]))!.prospect.contacts;
    assert.equal(contacts[0].confirmationState, "unconfirmed"); assert.equal(contacts[0].permission, "no_opt_in");
    assert.deepEqual(contacts[0].identity, { kind: "bsuid", value: "BSUID.AbC_001-X", businessScope: "portfolio-a" });
    await assert.rejects(() => f.prisma.prospectEndpoint.create({ data: { channel: "whatsapp", identityKind: "bsuid", normalizedValue: "AbC", protectedLookup: "other", senderBindingId: "sender" } }));
  } finally { await f.close(); }
});
