import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProspectPrivacyPolicy, ProspectSuppressionResult, SuppressProspectCommand } from "@zyon/shared-types";
import type { DirectoryReadPort, ProspectingActor, ProspectPrivacyPort } from "../../domain/prospecting.ports.js";
import { normalizeContactIdentity, type ContactIdentity } from "../../domain/crm/prospect-contact.js";
import { prospectVersion, prospectText } from "../../application/crm/prospect.service.js";
import { prospectAudit, prospectCommand } from "./prospect-command.js";

export interface SuppressionKeyRing { currentVersion: number; keys: Record<number, string> }
export function protectedContactLookups(identity: ContactIdentity, ring: SuppressionKeyRing) {
  if (!Number.isInteger(ring.currentVersion) || ring.currentVersion < 1 || !ring.keys[ring.currentVersion] || Object.entries(ring.keys).some(([version, key]) => !/^[1-9]\d*$/.test(version) || !/^[a-f0-9]{64}$/i.test(key))) throw new Error("config_invalid:suppression_keys");
  const normalized = normalizeContactIdentity(identity);
  return Object.entries(ring.keys).map(([version, key]) => ({ keyVersion: Number(version), protectedLookup: createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify([normalized.kind, normalized.businessScope, normalized.value])).digest("hex") }));
}
const retentionWhere = (cutoff: Date): Prisma.PlatformProspectWhereInput => ({ convertedAt: null, stage: { not: "converted" }, piiDiscardedAt: null, lastBusinessActivityAt: { lte: cutoff }, OR: [{ retentionHoldReason: null }, { retentionHoldReason: "" }, { retentionAuthorizationRef: null }, { retentionAuthorizationRef: "" }] });
export class PrismaProspectPrivacyRepository implements ProspectPrivacyPort {
  constructor(private readonly prisma: PrismaClient, private readonly directory: DirectoryReadPort, private readonly keys: SuppressionKeyRing) { protectedContactLookups({ kind: "phone", value: "+5511999999999", businessScope: null }, keys); }
  async isSuppressed(identity: ContactIdentity, senderScope = "zyon_platform") {
    const versions = await this.prisma.contactSuppression.findMany({ where: { senderScope }, distinct: ["keyVersion"], select: { keyVersion: true } });
    if (versions.some(v => !this.keys.keys[v.keyVersion])) throw new Error("suppression_key_version_unavailable");
    return !!await this.prisma.contactSuppression.findFirst({ where: { senderScope, OR: protectedContactLookups(identity, this.keys) } });
  }
  private async preserve(tx: Prisma.TransactionClient, lookups: { protectedLookup: string; keyVersion: number }[], reason: "opt_out" | "retention", now: Date) {
    for (const lookup of lookups) {
      if (!this.keys.keys[lookup.keyVersion]) throw new Error("suppression_key_version_unavailable");
      const key = { senderScope: "zyon_platform", protectedLookup:lookup.protectedLookup,keyVersion:lookup.keyVersion };
      await tx.contactSuppression.upsert({ where: { senderScope_protectedLookup_keyVersion: key }, create: { ...key, reason, occurredAt: now }, update: {} });
    }
  }
  private async sourceLookups(cnpj: string, snapshotId: string) {
    const company = await this.directory.find(cnpj, snapshotId); const lookups: { protectedLookup: string; keyVersion: number }[] = [];
    for (const contact of company?.contacts ?? []) {
      try { const identity = normalizeContactIdentity({ kind: contact.channel === "phone" ? "phone" : "email", value: contact.normalizedValue ?? contact.originalValue }); lookups.push(...protectedContactLookups(identity, this.keys)); } catch (error) { if (!(error instanceof Error) || !error.message.startsWith("invalid_contact")) throw error; }
    }
    return lookups;
  }
  private async cancel(tx: Prisma.TransactionClient, endpointIds: string[], now: Date) {
    if (!endpointIds.length) return { cancelledAttempts: 0, inFlightAttempts: 0 };
    // Dispatch/inbound must acquire this same endpoint fence before submission.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM prospect_endpoints WHERE id IN (${Prisma.join(endpointIds)}) ORDER BY id FOR UPDATE`);
    const pending = await tx.outreachAttempt.findMany({ where: { sequence: { endpointId: { in: endpointIds } }, state: { in: ["prepared", "reserved"] } }, include: { recipient: true } });
    const replies={conversation:{endpointId:{in:endpointIds}},clientRequestId:{not:null}};
    const cancelledReplies=await tx.prospectMessage.updateMany({where:{...replies,state:"prepared"},data:{state:"cancelled_before_submit",errorCode:"suppressed"}});
    const inFlightReplies=await tx.prospectMessage.count({where:{...replies,state:{in:["submitting","outcome_unknown"]}}});
    const inFlightAttempts = await tx.outreachAttempt.count({ where: { sequence: { endpointId: { in: endpointIds } }, state: { in: ["submitting", "outcome_unknown"] } } });
    await tx.outreachAttempt.updateMany({ where: { id: { in: pending.map(a => a.id) }, state: { in: ["prepared", "reserved"] } }, data: { state: "cancelled_before_submit", costState: "released", leaseToken: null, leaseExpiresAt: null, errorCode: "suppressed" } });
    for (const attempt of pending) if (attempt.costState === "reserved" && attempt.recipient) {
      await tx.$executeRaw`UPDATE prospect_campaigns SET reserved_cents=GREATEST(0,reserved_cents-${attempt.reservedAmount}) WHERE id=${attempt.recipient.campaignId}`;
      await tx.$executeRaw`UPDATE prospect_campaign_daily_usage SET reserved_recipients=GREATEST(0,reserved_recipients-1) WHERE campaign_id=${attempt.recipient.campaignId} AND day=${attempt.reservationDay ?? attempt.createdAt.toISOString().slice(0, 10)}`;
    }
    await tx.prospectSequence.updateMany({ where: { endpointId: { in: endpointIds } }, data: { state: "cancelled", cancelledAt: now, cancelReason: "suppressed", followUpDueAt: null } });
    await tx.prospectConversation.updateMany({ where: { endpointId: { in: endpointIds } }, data: { controlEpoch: { increment: 1 }, mode: "human", serviceWindowEndsAt: null } });
    await tx.campaignRecipient.updateMany({ where: { endpointId: { in: endpointIds }, state: { in: ["pending", "prepared", "reserved", "blocked"] } }, data: { state: "blocked", blockers: ["suppressed"] } });
    const outboxes = await tx.prospectOutbox.findMany({ where: { state: { in: ["pending", "leased", "processing"] }, OR: [{ resourceIds: { hasSome: endpointIds } }, ...endpointIds.map(endpointId => ({ payload: { path: ["endpointId"], equals: endpointId } }))] } });
    for (const event of outboxes) {
      const payload = event.payload as Record<string, unknown>; const attempt = typeof payload.attemptId === "string" ? await tx.outreachAttempt.findUnique({ where: { id: payload.attemptId } }) : null;
      await tx.prospectOutbox.update({ where: { id: event.id }, data: { state: attempt && ["submitting", "outcome_unknown", "provider_accepted", "delivered", "read"].includes(attempt.state) ? "held" : "cancelled", leaseToken: null, leaseExpiresAt: null } });
    }
    return { cancelledAttempts: pending.length+cancelledReplies.count, inFlightAttempts:inFlightAttempts+inFlightReplies };
  }
  async suppress(id: string, command: SuppressProspectCommand, actor: ProspectingActor): Promise<ProspectSuppressionResult> {
    prospectVersion(command.expectedVersion); prospectText(command.reason, "reason", 200);
    return prospectCommand(this.prisma, "prospect.suppress", { ...command, id }, actor, async tx => {
      await tx.$queryRaw`SELECT id FROM platform_prospects WHERE id=${id} FOR UPDATE`;
      const row = await tx.platformProspect.findUnique({ where: { id } }); if (!row) throw new Error("prospect_not_found"); if (row.version !== command.expectedVersion) throw new Error("version_conflict");
      const bindings = await tx.prospectContactBinding.findMany({ where: { prospectId: id }, include: { endpoint: true } }); const endpointIds = bindings.map(b => b.endpointId);
      await this.preserve(tx, [...await tx.prospectEndpointAlias.findMany({where:{endpointId:{in:endpointIds}}}),...bindings.map(b => ({ protectedLookup: b.endpoint.protectedLookup, keyVersion: b.endpoint.keyVersion })), ...await this.sourceLookups(row.cnpj, row.sourceSnapshotId)], "opt_out", new Date());
      const stopped = await this.cancel(tx, endpointIds, new Date());
      for (const binding of bindings) await tx.contactPermissionReceipt.create({ data: { senderBindingId: binding.endpoint.senderBindingId, endpointId: binding.endpointId, purpose: "zyon_sales", status: "revoked", source: "zyon_platform", occurredAt: new Date() } });
      const updated = await tx.platformProspect.update({ where: { id }, data: { stage: row.convertedAt ? row.stage : "do_not_contact", version: { increment: 1 }, lastBusinessActivityAt: new Date() } });
      await prospectAudit(tx, actor, "prospect.suppress", "prospect", id, updated.version, { ...stopped, reasonCode: "opt_out" });
      return { result: { prospectId: id, suppressed: true as const, ...stopped, version: updated.version }, resourceIds: [id, ...endpointIds] };
    });
  }
  private async eraseEndpointContent(tx:Prisma.TransactionClient,erasable:string[],leadIds:string[]){
      const conversations = await tx.prospectConversation.findMany({ where: { endpointId: { in: erasable } }, select: { id: true } }); const conversationIds = conversations.map(c => c.id);
      const attempts = await tx.outreachAttempt.findMany({ where: { sequence: { endpointId: { in: erasable } } }, select: { id: true } });
      const ids = [...leadIds, ...erasable, ...conversationIds, ...attempts.map(a => a.id)];
      await tx.prospectMessage.updateMany({ where: { conversationId: { in: conversationIds } }, data: { content: null } });
      await tx.prospectNote.updateMany({ where: { conversationId: { in: conversationIds } }, data: { content: null } });
      await tx.outreachAttempt.updateMany({ where: { id: { in: attempts.map(a => a.id) } }, data: { content: null } });
      await tx.prospectConversation.updateMany({ where: { id: { in: conversationIds } }, data: { lastInboundPreview: null, prospectId: null, ambiguousBindings: [], assignedOperatorId: null } });
      await tx.prospectEndpoint.updateMany({ where: { id: { in: erasable } }, data: { normalizedValue: null, timezone: null, timezoneSource: null } });
      await tx.contactPermissionReceipt.updateMany({ where: { endpointId: { in: erasable } }, data: { status: "revoked", evidenceRef: null, source: "retention_erased", textVersion: null } });
      const commands = await tx.prospectCommand.findMany({ where: { resourceIds: { hasSome: ids } }, select: { clientRequestId: true } });
      await tx.prospectCommand.updateMany({ where: { resourceIds: { hasSome: ids } }, data: { result: { redacted: true } } });
      await tx.prospectAuditEvent.updateMany({ where: { resourceId: { in: [...ids, ...commands.map(c => c.clientRequestId)] } }, data: { details: Prisma.DbNull } });
      await tx.prospectOutbox.updateMany({ where: { OR: [{ resourceIds: { hasSome: ids } }, ...ids.map(id => ({ payload: { path: ["attemptId"], equals: id } }))] }, data: { payload: { redacted: true } } });
      await tx.prospectInboxEvent.updateMany({ where: { resourceIds: { hasSome: ids } }, data: { payload: { redacted: true } } });
  }
  async retain(now: Date, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid_retention_limit");
    const cutoff = new Date(now.getTime() - 180 * 86_400_000); let erased = 0;
    while (true) {
    const rows = await this.prisma.platformProspect.findMany({ where: retentionWhere(cutoff), take: limit, orderBy: { id: "asc" }, select: { id: true } });
    if (!rows.length) break;
    for (const candidate of rows) erased += await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM platform_prospects WHERE id=${candidate.id} FOR UPDATE`;
      const row = await tx.platformProspect.findFirst({ where: { id: candidate.id, ...retentionWhere(cutoff) } }); if (!row) return 0;
      const bindings = await tx.prospectContactBinding.findMany({ where: { prospectId: row.id }, include: { endpoint: true } }); const endpointIds = bindings.map(b => b.endpointId);
      await this.preserve(tx, [...await tx.prospectEndpointAlias.findMany({where:{endpointId:{in:endpointIds}}}),...bindings.map(b => ({ protectedLookup: b.endpoint.protectedLookup, keyVersion: b.endpoint.keyVersion })), ...await this.sourceLookups(row.cnpj, row.sourceSnapshotId)], "retention", now);
      await this.cancel(tx, endpointIds, now);
      await tx.prospectContactBinding.deleteMany({ where: { prospectId: row.id } });
      const erasable: string[] = []; for (const endpointId of endpointIds) if (!await tx.prospectContactBinding.count({ where: { endpointId } })) erasable.push(endpointId);
      await this.eraseEndpointContent(tx,erasable,[row.id]);
      const updated = await tx.platformProspect.update({ where: { id: row.id }, data: { piiDiscardedAt: now, stage: "do_not_contact", tags: [], lastReplyPreview: null, assignedOperatorId: null, retentionHoldReason: null, retentionAuthorizationRef: null, version: { increment: 1 } } });
      await tx.prospectAuditEvent.create({ data: { action: "prospect.retention", resourceType: "prospect", resourceId: row.id, resourceVersion: updated.version, correlationId: "retention-" + now.toISOString(), outcome: "completed", occurredAt: now } });
      return 1;
    }, { timeout: 30_000 });
    }
    // Contacts can legitimately reply before a company is identified.
    const orphanWhere:Prisma.ProspectEndpointWhereInput={normalizedValue:{not:null},lastContactActivityAt:{lte:cutoff},bindings:{none:{}},recipients:{none:{}}};
    while(true){
      const orphans=await this.prisma.prospectEndpoint.findMany({where:orphanWhere,orderBy:{id:"asc"},take:limit,select:{id:true}});
      if(!orphans.length)break;
      for(const orphan of orphans)erased+=await this.prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${orphan.id} FOR UPDATE`;
        const ep=await tx.prospectEndpoint.findFirst({where:{...orphanWhere,id:orphan.id},include:{aliases:true}});if(!ep)return 0;
        await this.preserve(tx,[ep,...ep.aliases],"retention",now);
        await this.cancel(tx,[ep.id],now);await this.eraseEndpointContent(tx,[ep.id],[]);
        return 1;
      });
    }
    await this.prisma.prospectRetentionRun.upsert({ where: { id: "daily" }, create: { id: "daily", lastRunAt: now, nextRunAt: new Date(now.getTime() + 86_400_000), erasedCount: erased }, update: { lastRunAt: now, nextRunAt: new Date(now.getTime() + 86_400_000), erasedCount: erased } });
    return { erased };
  }
  async policy(): Promise<ProspectPrivacyPolicy> {
    const run = await this.prisma.prospectRetentionRun.findUnique({ where: { id: "daily" } });
    return { retentionDays: 180, preservedSuppressions: await this.prisma.contactSuppression.count(), lastRunAt: run?.lastRunAt.toISOString() ?? null, nextRunAt: run?.nextRunAt.toISOString() ?? null, backupPolicy: "Operational erasure does not instantly remove backups; backup expiration follows the documented storage lifecycle.", sourceSnapshotPolicy: "Official company snapshots remain separate; erased CRM details do not restore source contact data or authorization." };
  }
}
