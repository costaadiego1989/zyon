import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type SalesKnowledgePublication } from "@prisma/client";
import type { SalesKnowledgeSource, SalesKnowledgeFact } from "@zyon/shared-types";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";
import { prospectAudit, prospectCommand } from "../crm/prospect-command.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";

type DraftFact = Pick<SalesKnowledgeFact, "id" | "subject" | "predicate" | "value">;
export interface KnowledgeDraft {
  clientRequestId: string; expectedVersion: number; title: string; sourceRef: string;
  validFrom: string; validUntil: string | null; facts: DraftFact[];
}

function field(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("invalid_knowledge_field");
  return value.trim();
}
export function knowledgeHash(facts: SalesKnowledgeFact[]) {
  return createHash("sha256").update(stableDirectoryJson([...facts].sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0))).digest("hex");
}
function source(row: SalesKnowledgePublication, activePublicationId: string | null): SalesKnowledgeSource {
  return { id:row.sourceId, title:row.title, sourceRef:row.sourceRef, version:row.version, state:row.state as SalesKnowledgeSource["state"],
    draft:row.draft as unknown as SalesKnowledgeFact[], contentHash:row.contentHash, publishedBy:row.publishedBy,
    validFrom:row.validFrom.toISOString(), validUntil:row.validUntil?.toISOString() ?? null, updatedAt:row.updatedAt.toISOString(), activePublicationId };
}
export class PrismaSalesKnowledgeRepository {
  constructor(readonly prisma: PrismaClient) {}

  async save(sourceId: string, input: KnowledgeDraft, actor: ProspectingActor) {
    if (!/^[-a-zA-Z0-9_.]{1,120}$/.test(sourceId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error("invalid_knowledge_source");
    const title=field(input.title,200), sourceRef=field(input.sourceRef,500);
    const validFrom=new Date(field(input.validFrom,40)), validUntil=input.validUntil === null ? null : new Date(field(input.validUntil,40));
    if (!Number.isFinite(validFrom.getTime()) || (validUntil && (!Number.isFinite(validUntil.getTime()) || validUntil <= validFrom))) throw new Error("invalid_knowledge_validity");
    if (!Array.isArray(input.facts) || input.facts.length < 1 || input.facts.length > 200) throw new Error("invalid_knowledge_facts");
    return prospectCommand(this.prisma, "knowledge.draft", { sourceId,...input }, actor, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sales-knowledge'),hashtext(${sourceId}))::text`;
      const last=await tx.salesKnowledgePublication.findFirst({where:{sourceId},orderBy:{version:"desc"}});
      if ((last?.version ?? 0) !== input.expectedVersion) throw new Error("version_conflict");
      const id=randomUUID(), version=input.expectedVersion+1;
      const facts=input.facts.map(item=>{
        if (!item || !["feature","plan","integration","faq"].includes(item.predicate)) throw new Error("invalid_knowledge_predicate");
        return {id:field(item.id,120),subject:field(item.subject,160),predicate:item.predicate,value:field(item.value,1200),
          sourceId,publicationId:id,publicationVersion:version,validFrom:validFrom.toISOString(),validUntil:validUntil?.toISOString() ?? null};
      });
      if (new Set(facts.map(f=>f.id)).size !== facts.length) throw new Error("invalid_duplicate_fact");
      const row=await tx.salesKnowledgePublication.create({data:{id,sourceId,version,title,sourceRef,validFrom,validUntil,draft:facts,contentHash:knowledgeHash(facts)}});
      const pointer=await tx.salesKnowledgeActivePublication.findUnique({where:{sourceId}});
      await prospectAudit(tx,actor,"knowledge.draft","knowledge",sourceId,version,{publicationId:id,sourceRef});
      return { result:source(row,pointer?.publicationId ?? null),resourceIds:[sourceId,id] };
    });
  }
  async find(sourceId: string, client:Prisma.TransactionClient=this.prisma) {
    const row=await client.salesKnowledgePublication.findFirst({where:{sourceId},orderBy:{version:"desc"}});
    if (!row) return null;
    const pointer=await client.salesKnowledgeActivePublication.findUnique({where:{sourceId}});
    return source(row,pointer?.publicationId ?? null);
  }
  async list() {
    const rows=await this.prisma.salesKnowledgePublication.findMany({distinct:["sourceId"],orderBy:[{sourceId:"asc"},{version:"desc"}]});
    const pointers=await this.prisma.salesKnowledgeActivePublication.findMany();
    const active=new Map(pointers.map(p=>[p.sourceId,p.publicationId]));
    return rows.map(row=>source(row,active.get(row.sourceId) ?? null));
  }
  async active(now: Date, ids?: string[]): Promise<{ sourceId:string; publicationId:string; version:number }[]> {
    if (ids && ids.length === 0) return [];
    return this.prisma.$queryRaw`SELECT a.source_id AS "sourceId", a.publication_id AS "publicationId", a.version
      FROM sales_knowledge_active_publications a JOIN sales_knowledge_publications p
        ON p.id=a.publication_id AND p.version=a.version AND p.source_id=a.source_id
      WHERE p.state='published' AND p.valid_from<=${now} AND (p.valid_until IS NULL OR p.valid_until>${now})
      ${ids ? Prisma.sql`AND p.id IN (${Prisma.join(ids)})` : Prisma.empty} ORDER BY a.source_id`;
  }
}
