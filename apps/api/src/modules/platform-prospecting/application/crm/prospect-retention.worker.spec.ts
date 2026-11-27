import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { PrismaProspectRepository } from "../../infrastructure/crm/prisma-prospect.repository.js";
import { PrismaProspectPrivacyRepository, protectedContactLookups } from "../../infrastructure/crm/prisma-prospect-privacy.repository.js";
import { ProspectRetentionWorker } from "./prospect-retention.worker.js";

const keyRing = { currentVersion: 1, keys: { 1: "a".repeat(64) } };
const now = new Date("2026-11-21T12:00:00Z"); const day = 86_400_000;
async function seedPrivateLead(f: Awaited<ReturnType<typeof createProspectCrmFixture>>, id = "eligible") {
  const value = "+5511999991234"; const lookup = protectedContactLookups({ kind: "phone", value, businessScope: null }, keyRing)[0];
  await f.prisma.platformProspect.create({ data: { id, cnpj: "00000000000191", sourceSnapshotId: "search-old", lastBusinessActivityAt: new Date(now.getTime() - 180 * day), lastReplyPreview: "PERSON-SECRET", tags: ["PERSON-SECRET"] } });
  await f.prisma.prospectEndpoint.create({ data: { id: "endpoint", channel: "whatsapp", normalizedValue: value, protectedLookup: lookup.protectedLookup, keyVersion: 1, senderBindingId: "sender", timezone: "America/Sao_Paulo" } });
  await f.prisma.prospectContactBinding.create({ data: { prospectId: id, endpointId: "endpoint", evidenceRef: "PERSON-SECRET" } });
  await f.prisma.contactPermissionReceipt.create({ data: { id: "receipt", endpointId: "endpoint", senderBindingId: "sender", purpose: "zyon_sales", status: "opted_in", source: "zyon_platform", evidenceRef: "PERSON-SECRET", occurredAt: now } });
  await f.prisma.prospectConversation.create({ data: { id: "conversation", endpointId: "endpoint", prospectId: id, lastInboundPreview: "PERSON-SECRET", serviceWindowEndsAt: now } });
  await f.prisma.prospectMessage.create({ data: { id: "message", conversationId: "conversation", senderBindingId: "sender", sequence: 1, authorType: "prospect", direction: "inbound", content: "PERSON-SECRET", state: "received" } });
  await f.prisma.prospectNote.create({ data: { id: "note", conversationId: "conversation", operatorId: "operator", clientRequestId: "private-note", content: "PERSON-SECRET" } });
  await f.prisma.prospectSequence.create({ data: { id: "sequence", senderBindingId: "sender", endpointId: "endpoint" } });
  await f.prisma.prospectCampaign.create({ data: { id: "campaign", name: "Fixture", message: "controlled", createdBy: "operator", sendWindow: {}, reservedCents: 90 } });
  await f.prisma.campaignRecipient.create({ data: { id: "recipient", campaignId: "campaign", prospectId: id, endpointId: "endpoint", sequenceKey: "scope", frozenSnapshot: { snapshotId: "search-old", cnpj: "00000000000191" } } });
  for (const [attemptId, state, ordinal, reservedAmount] of [["pending", "reserved", 0, 30], ["unknown", "outcome_unknown", 1, 60]] as const) {
    await f.prisma.outreachAttempt.create({ data: { id: attemptId, sequenceId: "sequence", recipientId: "recipient", conversationId: "conversation", ordinal, clientRequestId: attemptId, requestHash: "hash", senderVersion: 1, state, reservedAmount, content: "PERSON-SECRET", ...(state === "outcome_unknown" ? { submittedAt: now, errorCode: "timeout" } : {}) } });
    await f.prisma.prospectOutbox.create({ data: { eventId: "outbox-" + attemptId, kind: "send", resourceIds: [id, "endpoint", attemptId], payload: { attemptId, endpointId: "endpoint", content: "PERSON-SECRET", phone: value } } });
  }
  await f.prisma.prospectInboxEvent.create({ data: { eventId: "inbound", senderBindingId: "sender", eventKind: "inbound", payloadHash: "hash", providerOccurredAt: now, resourceIds: [id, "endpoint"], payload: { body: "PERSON-SECRET", phone: value } } });
  await f.prisma.prospectCommand.create({ data: { clientRequestId: "copied-command", actorOperatorId: "operator", requestHash: "hash", kind: "fixture", state: "completed", resourceIds: [id], result: { phone: value, notes: "PERSON-SECRET" } } });
  await f.prisma.prospectAuditEvent.create({ data: { actorOperatorId: "operator", action: "fixture", resourceType: "prospect", resourceId: id, resourceVersion: 1, correlationId: "corr", outcome: "completed", details: { phone: value, note: "PERSON-SECRET" } } });
  return value;
}

test("PROS-10 AC1 erases eligible operational PII at180 complete days with179-day converted and justified exceptions and no copied content", async () => {
  const f = await createProspectCrmFixture();
  try {
    await seedPrivateLead(f);
    await f.prisma.platformProspect.createMany({ data: [{ id: "179", cnpj: "11222333000181", sourceSnapshotId: "search-old", lastBusinessActivityAt: new Date(now.getTime() - 179 * day), lastReplyPreview: "retain179" }, { id: "converted", cnpj: "12ABC34501DE35", sourceSnapshotId: "search-old", convertedAt: now, stage: "converted", lastBusinessActivityAt: new Date(now.getTime() - 181 * day), lastReplyPreview: "retainConverted" }, { id: "hold", cnpj: "12345678000195", sourceSnapshotId: "search-old", lastBusinessActivityAt: new Date(now.getTime() - 181 * day), retentionHoldReason: "Contract obligation", retentionAuthorizationRef: "legal-ref", lastReplyPreview: "retainHold" }] });
    const privacy = new PrismaProspectPrivacyRepository(f.prisma, f.directory, keyRing); const worker = new ProspectRetentionWorker(privacy);
    assert.deepEqual(await worker.run(new Date(now.getTime() - 1)), { erased: 0 });
    assert.deepEqual(await worker.run(now), { erased: 1 });
    const erased = await f.prisma.platformProspect.findUniqueOrThrow({ where: { id: "eligible" } });
    assert.equal(erased.piiDiscardedAt?.toISOString(), now.toISOString()); assert.equal(erased.lastReplyPreview, null); assert.deepEqual(erased.tags, []); assert.equal(erased.stage, "do_not_contact");
    assert.equal((await f.prisma.prospectEndpoint.findUniqueOrThrow({ where: { id: "endpoint" } })).normalizedValue, null);
    assert.equal((await f.prisma.prospectMessage.findUniqueOrThrow({ where: { id: "message" } })).content, null); assert.equal((await f.prisma.prospectNote.findUniqueOrThrow({ where: { id: "note" } })).content, null);
    assert.equal((await f.prisma.prospectConversation.findUniqueOrThrow({ where: { id: "conversation" } })).lastInboundPreview, null);
    const pending = await f.prisma.outreachAttempt.findUniqueOrThrow({ where: { id: "pending" } }); assert.equal(pending.state, "cancelled_before_submit"); assert.equal(pending.costState, "released"); assert.equal(pending.content, null);
    const unknown = await f.prisma.outreachAttempt.findUniqueOrThrow({ where: { id: "unknown" } }); assert.equal(unknown.state, "outcome_unknown"); assert.equal(unknown.reservedAmount, 60n); assert.equal(unknown.costState, "reserved"); assert.equal(unknown.requestHash, "hash"); assert.equal(unknown.content, null);
    assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({ where: { id: "campaign" } })).reservedCents, 60n);
    assert.deepEqual((await f.prisma.prospectOutbox.findMany({ orderBy: { eventId: "asc" } })).map(x => x.state), ["cancelled", "held"]);
    for (const id of ["179", "converted", "hold"]) assert.equal((await f.prisma.platformProspect.findUniqueOrThrow({ where: { id } })).piiDiscardedAt, null);
    const copies = JSON.stringify(await Promise.all([f.prisma.prospectCommand.findMany(), f.prisma.prospectAuditEvent.findMany(), f.prisma.prospectInboxEvent.findMany(), f.prisma.prospectOutbox.findMany(), f.prisma.prospectContactBinding.findMany(), f.prisma.contactPermissionReceipt.findMany()]));
    assert.equal(copies.includes("PERSON-SECRET"), false); assert.equal(copies.includes("5511999991234"), false);
    const detail = await new PrismaProspectRepository(f.prisma, f.directory).find("eligible"); assert.deepEqual(detail?.prospect.contacts, []); assert.deepEqual(detail?.company?.contacts, []);
    assert.deepEqual(await worker.run(now), { erased: 0 }); assert.equal((await privacy.policy()).lastRunAt, now.toISOString());
  } finally { await f.close(); }
});

test("PROS-10 AC3 protected suppression survives source reimport and key rotation without restoring permission", async () => {
  const f = await createProspectCrmFixture();
  try {
    const value = await seedPrivateLead(f); const identity = { kind: "phone" as const, value, businessScope: null };
    const privacy = new PrismaProspectPrivacyRepository(f.prisma, f.directory, keyRing); await new ProspectRetentionWorker(privacy).run(now);
    const suppression = await f.prisma.contactSuppression.findFirstOrThrow(); assert.equal(suppression.senderScope, "zyon_platform"); assert.equal(suppression.keyVersion, 1); assert.match(suppression.protectedLookup, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(suppression).includes(value), false);
    const added = await new PrismaProspectRepository(f.prisma, f.directory).add({ snapshotId: "search-old", cnpjs: ["00000000000191"], clientRequestId: "reimport" }, { operatorId: "operator", correlationId: "reimport" });
    assert.equal(added.existing, 1); assert.equal(added.created, 0); assert.equal(await privacy.isSuppressed(identity), true);
    assert.equal((await f.directory.find("00000000000191", "search-old"))?.suppressed, true);
    const rotated = new PrismaProspectPrivacyRepository(f.prisma, f.directory, { currentVersion: 2, keys: { 1: "a".repeat(64), 2: "b".repeat(64) } }); assert.equal(await rotated.isSuppressed(identity), true);
    const missingOldKey = new PrismaProspectPrivacyRepository(f.prisma, f.directory, { currentVersion: 2, keys: { 2: "b".repeat(64) } }); await assert.rejects(() => missingOldKey.isSuppressed(identity), /suppression_key_version_unavailable/);
    assert.equal((await f.prisma.contactPermissionReceipt.findUniqueOrThrow({ where: { id: "receipt" } })).status, "revoked");
  } finally { await f.close(); }
});

test("PROS-10 AC1 privacy erasure rolls back on audit failure and ordinary receipt edits and deletes remain forbidden", async () => {
  const f = await createProspectCrmFixture();
  try {
    const value = await seedPrivateLead(f);
    await assert.rejects(() => f.prisma.contactPermissionReceipt.update({ where: { id: "receipt" }, data: { status: "revoked" } }));
    await assert.rejects(() => f.prisma.contactPermissionReceipt.delete({ where: { id: "receipt" } }));
    await assert.rejects(() => f.prisma.contactPermissionReceipt.update({ where: { id: "receipt" }, data: { status: "revoked", source: "retention_erased", evidenceRef: null, textVersion: null } }));
    await f.pg.query("CREATE FUNCTION reject_retention_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='prospect.retention' THEN RAISE EXCEPTION 'controlled_audit_failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_retention BEFORE INSERT ON prospect_audit_events FOR EACH ROW EXECUTE FUNCTION reject_retention_audit()");
    const worker = new ProspectRetentionWorker(new PrismaProspectPrivacyRepository(f.prisma, f.directory, keyRing));
    await assert.rejects(() => worker.run(now), /controlled_audit_failure/);
    assert.equal((await f.prisma.prospectEndpoint.findUniqueOrThrow({ where: { id: "endpoint" } })).normalizedValue, value); assert.equal(await f.prisma.contactSuppression.count(), 0);
    assert.equal((await f.prisma.platformProspect.findUniqueOrThrow({ where: { id: "eligible" } })).piiDiscardedAt, null); assert.equal((await f.prisma.prospectMessage.findUniqueOrThrow({ where: { id: "message" } })).content, "PERSON-SECRET");
    await f.pg.query("DROP TRIGGER reject_retention ON prospect_audit_events");
    assert.deepEqual(await worker.run(now), { erased: 1 });
    await assert.rejects(() => f.prisma.contactPermissionReceipt.update({ where: { id: "receipt" }, data: { status: "opted_in", evidenceRef: "restore" } }));
    await assert.rejects(() => f.prisma.contactPermissionReceipt.delete({ where: { id: "receipt" } }));
  } finally { await f.close(); }
});

test("PROS-10 AC1 migrates blank historical holds, rejects invalid writes, and erases the expired personal preview",async()=>{
  const f=await createProspectCrmFixture();
  try {
    // Reconstruct the previous migration boundary in this disposable database only.
    await f.pg.query("ALTER TABLE platform_prospects DROP CONSTRAINT IF EXISTS prospect_retention_hold_meaningful");
    const data={sourceSnapshotId:"search-old",lastBusinessActivityAt:new Date(now.getTime()-194*day)};
    await f.prisma.platformProspect.createMany({data:[
      { ...data,id:"a-valid",cnpj:"11222333000181",retentionHoldReason:"  Contrato vigente  ",retentionAuthorizationRef:"doc-41",lastReplyPreview:"keep" },
      { ...data,id:"x-old",cnpj:"00000000000191",retentionHoldReason:"  ",retentionAuthorizationRef:"verifier-case",lastReplyPreview:"SYNTHETIC-ONLY" },
      { ...data,id:"y-old",cnpj:"12ABC34501DE35",retentionHoldReason:"justified",retentionAuthorizationRef:"\t\u00a0\u2003\n",lastReplyPreview:"old" },
    ]});
    const sql=readFileSync(new URL("../../../../../prisma/migrations/20261123010000_prospect_retention_hold/migration.sql",import.meta.url),"utf8");
    await f.pg.query(sql);
    for(const blank of ["","  ","\r\t\n","\u00a0\u2002","\u3000\ufeff"]){
      for(const patch of [{retentionHoldReason:blank},{retentionAuthorizationRef:blank}])
        await assert.rejects(f.prisma.platformProspect.update({where:{id:"a-valid"},data:patch}),/prospect_retention_hold_meaningful/);
    }
    const privacy=new PrismaProspectPrivacyRepository(f.prisma,f.directory,keyRing);
    assert.deepEqual(await new ProspectRetentionWorker(privacy).run(now),{erased:2});
    for(const id of ["x-old","y-old"]){
      const row=await f.prisma.platformProspect.findUniqueOrThrow({where:{id}});
      assert.equal(row.piiDiscardedAt?.toISOString(),now.toISOString());assert.equal(row.lastReplyPreview,null);
      assert.equal(row.retentionHoldReason,null);assert.equal(row.retentionAuthorizationRef,null);
    }
    const keep=await f.prisma.platformProspect.findUniqueOrThrow({where:{id:"a-valid"}});
    assert.equal(keep.piiDiscardedAt,null);assert.equal(keep.lastReplyPreview,"keep");assert.equal(keep.retentionAuthorizationRef,"doc-41");
    await f.prisma.platformProspect.create({data:{...data,id:"z-eligible",cnpj:"12345678000195",lastReplyPreview:"expired"}});
    assert.deepEqual(await privacy.retain(now,1),{erased:1});
    assert.deepEqual(await new ProspectRetentionWorker(privacy).run(now),{erased:0});
  }finally{await f.close();}
});
