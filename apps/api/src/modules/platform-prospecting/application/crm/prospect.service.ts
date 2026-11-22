import type { AddProspectsCommand, BindProspectContactCommand, ProspectListQuery, UpdateProspectCommand } from "@zyon/shared-types";
import type { ProspectRepositoryPort, ProspectingActor } from "../../domain/prospecting.ports.js";
import { companyPageLimit } from "../../domain/company-directory/company-filters.js";
const stages = ["new", "contacted", "responded", "qualified", "proposal", "converted", "lost", "do_not_contact"];
export function prospectVersion(value: unknown) { if (!Number.isInteger(value) || Number(value) < 1) throw new Error("invalid_command:expectedVersion"); }
export function prospectText(value: unknown, name: string, max = 200): asserts value is string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`invalid_command:${name}`); }
export class ProspectService {
  constructor(private readonly repository: ProspectRepositoryPort) {}
  add(command: AddProspectsCommand, actor: ProspectingActor) { return this.repository.add(command, actor); }
  async list(query: ProspectListQuery) {
    companyPageLimit(query.limit);
    if (query.stage && (!Array.isArray(query.stage) || !query.stage.length || query.stage.length > 8 || query.stage.some(s => !stages.includes(s)))) throw new Error("invalid_filter:stage");
    for (const field of ["search", "assignedOperatorId", "campaignId", "cursor"] as const) if (query[field] !== undefined) prospectText(query[field], field);
    for (const field of ["from", "to"] as const) if (query[field] !== undefined && (typeof query[field] !== "string" || query[field]!.length > 40 || !Number.isFinite(Date.parse(query[field]!)))) throw new Error("invalid_filter:date");
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new Error("invalid_filter:date_range");
    return this.repository.list(query);
  }
  async find(id: string) { prospectText(id, "id"); const result = await this.repository.find(id); if (!result) throw new Error("prospect_not_found"); return result; }
  async update(id: string, command: UpdateProspectCommand, actor: ProspectingActor) {
    prospectText(id, "id"); prospectVersion(command.expectedVersion);
    if (command.stage !== undefined && !stages.includes(command.stage)) throw new Error("invalid_command:stage");
    if (command.tags !== undefined && (!Array.isArray(command.tags) || command.tags.length > 20 || command.tags.some(t => typeof t !== "string" || !t.trim() || t.length > 50))) throw new Error("invalid_command:tags");
    if (command.assignedOperatorId !== undefined && command.assignedOperatorId !== null) prospectText(command.assignedOperatorId, "assignedOperatorId");
    if (command.stage === undefined && command.tags === undefined && command.assignedOperatorId === undefined) throw new Error("invalid_command:empty");
    return this.repository.update(id, command, actor);
  }
  async bindContact(id: string, command: BindProspectContactCommand, actor: ProspectingActor) {
    prospectText(id, "id"); prospectVersion(command.expectedVersion); prospectText(command.endpointId, "endpointId"); prospectText(command.evidenceRef, "evidenceRef", 500);
    return this.repository.bindContact(id, command, actor);
  }
  commandResult(clientRequestId: string, actor: ProspectingActor) { prospectText(clientRequestId, "clientRequestId", 160); return this.repository.commandResult(clientRequestId, actor); }
}
