import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectingFixture } from "../../../../tests/prospecting-fixture.js";
import { createProspectCrmFixture } from "../../../../tests/prospect-crm-fixture.js";
import { PrismaProspectRepository } from "../infrastructure/crm/prisma-prospect.repository.js";
import { PrismaProspectPrivacyRepository, protectedContactLookups } from "../infrastructure/crm/prisma-prospect-privacy.repository.js";
import { ProspectService } from "../application/crm/prospect.service.js";
import { PROSPECTING_PORTS } from "../domain/prospecting.ports.js";
import { ProspectController } from "./prospect.controller.js";
import { ProspectPrivacyController } from "./prospect-privacy.controller.js";

test("PROS-10 AC2 guarded opt-out persists protected suppression and cancels only unsubmitted work before another response", async () => {
  const f = await createProspectCrmFixture(); const ring = { currentVersion: 1, keys: { 1: "a".repeat(64) } };
  const repo = new PrismaProspectRepository(f.prisma, f.directory); const service = new ProspectService(repo); const privacy = new PrismaProspectPrivacyRepository(f.prisma, f.directory, ring);
  const http = await createProspectingFixture({ controllers: [ProspectPrivacyController, ProspectController], providers: [{ provide: PROSPECTING_PORTS.privacy, useValue: privacy }, { provide: ProspectService, useValue: service }] });
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)", [http.operators.admin.id]); const actor = { operatorId: http.operators.admin.id, correlationId: "optout-proof" };
  const base = http.url + "/v1/platform/prospecting"; const headers = { Authorization: `Bearer ${http.operators.admin.token}`, "Content-Type": "application/json" };
  const request = (path: string, method = "GET", body?: unknown, token = http.operators.admin.token) => fetch(base + path, { method, headers: { ...headers, Authorization: token ? `Bearer ${token}` : "" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const id = (await repo.add({ snapshotId: "search-old", cnpjs: ["00000000000191"], clientRequestId: "add" }, actor)).prospectIds[0];
    const identity = { kind: "phone" as const, value: "+5511999999999", businessScope: null }; const lookup = protectedContactLookups(identity, ring)[0];
    await f.prisma.prospectEndpoint.create({ data: { id: "endpoint", channel: "whatsapp", normalizedValue: identity.value, ...lookup, senderBindingId: "sender" } });
    await f.prisma.prospectContactBinding.create({ data: { prospectId: id, endpointId: "endpoint" } });
    await f.prisma.prospectConversation.create({ data: { id: "conversation", endpointId: "endpoint", prospectId: id, controlEpoch: 5 } });
    await f.prisma.prospectSequence.create({ data: { id: "sequence", endpointId: "endpoint", senderBindingId: "sender", followUpDueAt: new Date() } });
    for (const [attemptId, state, ordinal] of [["pending", "reserved", 0], ["unknown", "outcome_unknown", 1]] as const) {
      await f.prisma.outreachAttempt.create({ data: { id: attemptId, sequenceId: "sequence", conversationId: "conversation", ordinal, clientRequestId: attemptId, requestHash: "stable-hash", state, senderVersion: 1, reservedAmount: 50 } });
      await f.prisma.prospectOutbox.create({ data: { eventId: attemptId, kind: "send", resourceIds: [id, "endpoint", attemptId], payload: { endpointId: "endpoint", attemptId } } });
    }
    for (const [path, method] of [["/privacy", "GET"], ["/prospects/" + id + "/suppress", "POST"]]) for (const [token, code] of [["", 401], ["merchant", 401], [http.operators.auditor.token, 403]] as const) assert.equal((await request(path, method, method === "GET" ? undefined : {}, token)).status, code);
    assert.equal(await f.prisma.contactSuppression.count(), 0); assert.equal((await f.prisma.outreachAttempt.findUniqueOrThrow({ where: { id: "pending" } })).state, "reserved");
    const policy = await (await request("/privacy")).json(); assert.equal(policy.retentionDays, 180); assert.equal(policy.preservedSuppressions, 0); assert.equal(policy.lastRunAt, null); assert.ok(policy.backupPolicy); assert.ok(policy.sourceSnapshotPolicy);
    const command = { reason: "private-reason-5511999999999", expectedVersion: 1, clientRequestId: "suppress" };
    const response = await request("/prospects/" + id + "/suppress", "POST", command); assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(result, { prospectId: id, suppressed: true, cancelledAttempts: 1, inFlightAttempts: 1, version: 2 });
    assert.deepEqual(await (await request("/prospects/" + id + "/suppress", "POST", command)).json(), result);
    assert.equal((await request("/prospects/" + id + "/suppress", "POST", { ...command, reason: "different" })).status, 409);
    assert.equal((await request("/prospects/" + id + "/suppress", "POST", { ...command, clientRequestId: "stale" })).status, 409);
    assert.equal((await f.prisma.outreachAttempt.findUniqueOrThrow({ where: { id: "pending" } })).state, "cancelled_before_submit"); const unknown = await f.prisma.outreachAttempt.findUniqueOrThrow({ where: { id: "unknown" } }); assert.equal(unknown.state, "outcome_unknown"); assert.equal(unknown.reservedAmount, 50n); assert.equal(unknown.costState, "reserved"); assert.equal(unknown.requestHash, "stable-hash");
    const conversation = await f.prisma.prospectConversation.findUniqueOrThrow({ where: { id: "conversation" } }); assert.equal(conversation.mode, "human"); assert.equal(conversation.controlEpoch, 6); assert.equal(conversation.serviceWindowEndsAt, null);
    const sequence = await f.prisma.prospectSequence.findUniqueOrThrow({ where: { id: "sequence" } }); assert.equal(sequence.state, "cancelled"); assert.equal(sequence.followUpDueAt, null);
    assert.equal(await privacy.isSuppressed(identity), true); assert.equal((await service.find(id)).prospect.suppressed, true);
    const receipt = await f.prisma.contactPermissionReceipt.findFirstOrThrow(); assert.equal(receipt.status, "revoked"); assert.equal(receipt.source, "zyon_platform"); assert.equal(receipt.purpose, "zyon_sales");
    assert.equal((await request("/prospects/" + id, "PATCH", { expectedVersion: 2, stage: "new", clientRequestId: "restore" })).status, 409);
    assert.equal((await request("/prospects/" + id + "/suppress", "DELETE", {})).status, 404);
    for (const body of [{}, { ...command, reason: "" }, { ...command, reason: "a".repeat(201) }, { ...command, expectedVersion: 0 }, { ...command, clearSuppression: true }]) assert.equal((await request("/prospects/" + id + "/suppress", "POST", body)).status, 400);
    assert.equal((await request("/prospects/missing/suppress", "POST", { ...command, clientRequestId: "missing" })).status, 404);
    const audit = await f.prisma.prospectAuditEvent.findFirstOrThrow({ where: { action: "prospect.suppress" } }); assert.equal(audit.actorOperatorId, actor.operatorId); assert.equal(audit.resourceVersion, 2); assert.equal(audit.outcome, "completed");
    assert.equal(JSON.stringify([audit, await f.prisma.contactSuppression.findMany(), await f.prisma.prospectCommand.findMany()]).includes(command.reason), false);
    assert.equal((await (await request("/privacy")).json()).preservedSuppressions, 1);
    await http.operatorJwt.revoke(http.operators.admin.token); assert.equal((await request("/privacy")).status, 401); assert.equal((await request("/prospects/" + id + "/suppress", "POST", command)).status, 401);
    assert.deepEqual(http.ports.meta.calls, []); assert.deepEqual(http.ports.llm.calls, []);
  } finally { await http.close(); await f.close(); }
});
