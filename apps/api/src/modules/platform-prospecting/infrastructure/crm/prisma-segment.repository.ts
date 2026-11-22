import type { PrismaClient, SavedProspectSegment as SegmentRow } from "@prisma/client";
import type { CompanyFilters, SavedProspectSegment, SaveProspectSegment, ProspectingVersionedCommand } from "@zyon/shared-types";
import type { SegmentRepositoryPort, ProspectingActor } from "../../domain/prospecting.ports.js";
import { validateCompanyFilters } from "../../domain/company-directory/company-filters.js";
import { prospectAudit, prospectCommand } from "./prospect-command.js";

function segment(row: SegmentRow): SavedProspectSegment {
  return { id: row.id, name: row.name, filters: row.filterJson as CompanyFilters, filterVersion: row.filterVersion, ownerOperatorId: row.ownerOperatorId, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export class PrismaSegmentRepository implements SegmentRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}
  async list(cursor?: string) {
    const rows = await this.prisma.savedProspectSegment.findMany({ where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 51 });
    return { items: rows.slice(0, 50).map(segment), nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  async find(id: string) { const row = await this.prisma.savedProspectSegment.findFirst({ where: { id, deletedAt: null } }); return row ? segment(row) : null; }
  save(id: string | null, command: SaveProspectSegment, actor: ProspectingActor): Promise<SavedProspectSegment> {
    return prospectCommand(this.prisma, id ? "segment.update" : "segment.create", { ...command, id }, actor, async tx => {
      if (typeof command.name !== "string" || !command.name.trim() || command.name.length > 120 || command.filterVersion !== 1) throw new Error("invalid_command:segment");
      const filterJson = validateCompanyFilters(command.filters);
      let row: SegmentRow;
      if (id) {
        if (!Number.isInteger(command.expectedVersion) || Number(command.expectedVersion) < 1) throw new Error("invalid_command:expectedVersion");
        const current = await tx.savedProspectSegment.findFirst({ where: { id, deletedAt: null } }); if (!current) throw new Error("segment_not_found");
        const changed = await tx.savedProspectSegment.updateMany({ where: { id, deletedAt: null, version: command.expectedVersion }, data: { name: command.name.trim(), filterJson: JSON.parse(JSON.stringify(filterJson)), filterVersion: command.filterVersion, version: { increment: 1 } } });
        if (changed.count !== 1) throw new Error("version_conflict"); row = await tx.savedProspectSegment.findUniqueOrThrow({ where: { id } });
      } else {
        if (command.expectedVersion !== undefined) throw new Error("invalid_command:expectedVersion");
        row = await tx.savedProspectSegment.create({ data: { name: command.name.trim(), filterJson: JSON.parse(JSON.stringify(filterJson)), filterVersion: command.filterVersion, ownerOperatorId: actor.operatorId } });
      }
      await prospectAudit(tx, actor, id ? "segment.update" : "segment.create", "segment", row.id, row.version);
      return { result: segment(row), resourceIds: [row.id] };
    });
  }
  async remove(id: string, command: ProspectingVersionedCommand, actor: ProspectingActor): Promise<void> {
    await prospectCommand(this.prisma, "segment.delete", { ...command, id }, actor, async tx => {
      if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) throw new Error("invalid_command:expectedVersion");
      const current = await tx.savedProspectSegment.findFirst({ where: { id, deletedAt: null } }); if (!current) throw new Error("segment_not_found");
      const changed = await tx.savedProspectSegment.updateMany({ where: { id, deletedAt: null, version: command.expectedVersion }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("version_conflict");
      await prospectAudit(tx, actor, "segment.delete", "segment", id, command.expectedVersion + 1);
      return { result: { id, version: command.expectedVersion + 1, deleted: true }, resourceIds: [id] };
    });
  }
}
