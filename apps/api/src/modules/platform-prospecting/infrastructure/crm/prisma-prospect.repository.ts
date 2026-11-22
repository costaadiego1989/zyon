import { Prisma, type PrismaClient, type PlatformProspect } from "@prisma/client";
import type { AddProspectsCommand, AddProspectsResult, ProspectRecord, ProspectListQuery, ProspectDetail, ProspectContact } from "@zyon/shared-types";
import type { DirectoryReadPort, ProspectingActor } from "../../domain/prospecting.ports.js";
import { canonicalCnpj } from "../../domain/company-directory/cnpj.js";
import { companyPageLimit } from "../../domain/company-directory/company-filters.js";
import { contactPermission, type ContactIdentity } from "../../domain/crm/prospect-contact.js";
import { prospectAudit, prospectCommand } from "./prospect-command.js";

export class PrismaProspectRepository {
  constructor(readonly prisma: PrismaClient, private readonly directory: DirectoryReadPort) {}
  async add(command: AddProspectsCommand, actor: ProspectingActor): Promise<AddProspectsResult> {
    return prospectCommand(this.prisma, "prospect.add", command, actor, async tx => {
      if (!command.snapshotId || !Array.isArray(command.cnpjs) || !command.cnpjs.length || command.cnpjs.length > 100 || command.selectionId) throw new Error("invalid_command:selection");
      const cnpjs = [...new Set(command.cnpjs.map(canonicalCnpj))].sort();
      for (const cnpj of cnpjs) if (!await this.directory.find(cnpj, command.snapshotId)) throw new Error("company_not_found");
      const result: AddProspectsResult = { created: 0, existing: 0, prospectIds: [] };
      for (const cnpj of cnpjs) {
        const inserted = await tx.platformProspect.createMany({ data: { cnpj, sourceSnapshotId: command.snapshotId }, skipDuplicates: true });
        const row = await tx.platformProspect.findUniqueOrThrow({ where: { cnpj } });
        result.created += inserted.count; result.existing += 1 - inserted.count; result.prospectIds.push(row.id);
      }
      await prospectAudit(tx, actor, "prospect.add", "prospect_batch", command.clientRequestId, 1, { created: result.created, existing: result.existing });
      return { result, resourceIds: result.prospectIds };
    });
  }
  async record(row: PlatformProspect, db: Prisma.TransactionClient | PrismaClient = this.prisma): Promise<ProspectRecord> {
    const bindings = await db.prospectContactBinding.findMany({ where: { prospectId: row.id }, include: { endpoint: { include: { permissions: true } } }, orderBy: { endpointId: "asc" } });
    const contacts: ProspectContact[] = bindings.map(b => ({ endpointId: b.endpointId, channel: b.endpoint.channel as "whatsapp" | "email", normalizedValue: b.endpoint.normalizedValue,
      identity: b.endpoint.normalizedValue ? { kind: b.endpoint.identityKind as ContactIdentity["kind"], value: b.endpoint.normalizedValue, businessScope: b.endpoint.businessScope } : null,
      confirmationState: b.confirmationState as ProspectContact["confirmationState"], evidenceRef: b.evidenceRef,
      permission: contactPermission({ senderBindingId: b.endpoint.senderBindingId, endpointId: b.endpointId, purpose: "zyon_sales" }, b.endpoint.permissions.map(p => ({ ...p, status: p.status as ProspectContact["permission"] }))), timezone: b.endpoint.timezone, timezoneSource: b.endpoint.timezoneSource }));
    const endpointIds = bindings.map(b => b.endpointId);
    const suppressed = row.stage === "do_not_contact" || (endpointIds.length > 0 && !!await db.contactSuppression.findFirst({ where: { OR: bindings.map(b => ({ protectedLookup: b.endpoint.protectedLookup, keyVersion: b.endpoint.keyVersion, senderScope: "zyon_platform" })) } }));
    return { id: row.id, cnpj: row.cnpj, sourceSnapshotId: row.sourceSnapshotId, stage: row.stage as ProspectRecord["stage"], assignedOperatorId: row.assignedOperatorId, tags: row.tags, version: row.version, createdAt: row.createdAt.toISOString(), lastBusinessActivityAt: row.lastBusinessActivityAt.toISOString(), firstAttemptAt: row.firstAttemptAt?.toISOString() ?? null, lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null, lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null, lastReplyAt: row.lastReplyAt?.toISOString() ?? null, lastReplyPreview: row.lastReplyPreview, suppressed, contacts };
  }
  async list(query: ProspectListQuery) {
    const limit = companyPageLimit(query.limit);
    const rows = await this.prisma.platformProspect.findMany({ where: { ...(query.stage ? { stage: { in: query.stage } } : {}), ...(query.assignedOperatorId ? { assignedOperatorId: query.assignedOperatorId } : {}), ...(query.campaignId ? { recipients: { some: { campaignId: query.campaignId } } } : {}), ...(query.search ? { cnpj: { contains: query.search } } : {}), ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}), ...(query.cursor ? { id: { gt: query.cursor } } : {}) }, orderBy: { id: "asc" }, take: limit + 1 });
    return { items: await Promise.all(rows.slice(0, limit).map(row => this.record(row))), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
  }
  async find(id: string): Promise<ProspectDetail | null> {
    const row = await this.prisma.platformProspect.findUnique({ where: { id } }); if (!row) return null;
    const conversation = await this.prisma.prospectConversation.findFirst({ where: { prospectId: id }, select: { id: true } });
    return { prospect: await this.record(row), company: await this.directory.find(row.cnpj, row.sourceSnapshotId), conversationId: conversation?.id ?? null, retentionHold: row.retentionHoldReason && row.retentionAuthorizationRef ? { reason: row.retentionHoldReason, authorizationRef: row.retentionAuthorizationRef } : null };
  }
  async commandResult(clientRequestId: string, actor: ProspectingActor) {
    const row = await this.prisma.prospectCommand.findUnique({ where: { clientRequestId } });
    if (!row || row.actorOperatorId !== actor.operatorId) return null;
    return { clientRequestId, state: row.state as "completed", result: row.result, errorCode: row.errorCode };
  }
}
