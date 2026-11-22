import neo4j, { type Driver } from "neo4j-driver";
import type { SalesKnowledgeFact, SalesKnowledgeSource } from "@zyon/shared-types";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";
import { prospectAudit, prospectCommand } from "../crm/prospect-command.js";
import { knowledgeHash, PrismaSalesKnowledgeRepository } from "./prisma-sales-knowledge.repository.js";

export const SALES_NAMESPACE = "zyon-platform-sales";
export interface PublicationCommand { clientRequestId:string; expectedVersion:number; contentHash:string }
interface Projection { count:number; hash:string }
interface Projector { project(draft:SalesKnowledgeSource):Promise<Projection> }
export class Neo4jSalesKnowledgeAdapter implements Projector {
  constructor(private readonly driver:Driver, private readonly namespace=SALES_NAMESPACE) {}
  async project(draft:SalesKnowledgeSource) {
    const id=draft.draft[0].publicationId;
    const session=this.driver.session({defaultAccessMode:neo4j.session.WRITE});
    try {
      return await session.executeWrite(async tx=>{
        await tx.run(`MERGE (p:ZyonSalesPublication {namespace:$ns,id:$id})
          WITH p UNWIND $facts AS data MERGE (p)-[:CONTAINS]->(f:ZyonSalesFact {namespace:$ns,id:data.id})
          ON CREATE SET f += data`,{ns:this.namespace,id,facts:draft.draft});
        const result=await tx.run(`MATCH (:ZyonSalesPublication {namespace:$ns,id:$id})-[:CONTAINS]->(f:ZyonSalesFact)
          RETURN f{.id,.subject,.predicate,.value,.sourceId,.publicationId,.publicationVersion,.validFrom,.validUntil} AS fact`,{ns:this.namespace,id});
        const facts=result.records.map(record=>{const f=record.get("fact");return {...f,publicationVersion:Number(f.publicationVersion)} as SalesKnowledgeFact;});
        if(facts.length!==draft.draft.length) throw new Error("projection_count_mismatch");
        const hash=knowledgeHash(facts);
        if(hash!==draft.contentHash) throw new Error("projection_hash_mismatch");
        return {count:facts.length,hash};
      },{timeout:5000});
    } finally {await session.close();}
  }
}
export class SalesPublicationService {
  constructor(private readonly repo:PrismaSalesKnowledgeRepository, private readonly graph:Projector, private readonly clock=()=>new Date()) {}
  async withdraw(sourceId:string,command:PublicationCommand,actor:ProspectingActor) {
    return prospectCommand(this.repo.prisma,"knowledge.withdraw",{sourceId,...command},actor,async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sales-knowledge'),hashtext(${sourceId}))::text`;
      const active=await tx.salesKnowledgeActivePublication.findUnique({where:{sourceId}});
      if(!active || active.version!==command.expectedVersion) throw new Error("version_conflict");
      const row=await tx.salesKnowledgePublication.findUniqueOrThrow({where:{id:active.publicationId}});
      if(row.contentHash!==command.contentHash || row.state!=="published") throw new Error("version_conflict");
      await tx.salesKnowledgePublication.update({where:{id:row.id},data:{state:"withdrawn",withdrawnAt:this.clock()}});
      await tx.salesKnowledgeActivePublication.delete({where:{sourceId}});
      await prospectAudit(tx,actor,"knowledge.withdraw","knowledge",sourceId,row.version,{publicationId:row.id,sourceRef:row.sourceRef,validFrom:row.validFrom.toISOString(),validUntil:row.validUntil?.toISOString() ?? null});
      return {result:{id:sourceId,version:row.version,state:"withdrawn" as const,activePublicationId:null},resourceIds:[sourceId,row.id]};
    });
  }
  async publish(sourceId:string, command:PublicationCommand, actor:ProspectingActor) {
    let projectionFailed:string | null=null;
    try {
      return await prospectCommand(this.repo.prisma,"knowledge.publish",{sourceId,...command},actor,async tx=>{
        const draft=await this.repo.find(sourceId);
        if (!draft) throw new Error("knowledge_not_found");
        if (draft.version!==command.expectedVersion || draft.contentHash!==command.contentHash || !["draft","failed"].includes(draft.state)) throw new Error("version_conflict");
        const id=draft.draft[0].publicationId;
        let projection:Projection;
        try {projection=await this.graph.project(draft);}
        catch(error){projectionFailed=id;throw new Error("projection_failed",{cause:error});}
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sales-knowledge'),hashtext(${sourceId}))::text`;
        const latest=await tx.salesKnowledgePublication.findFirst({where:{sourceId},orderBy:{version:"desc"}});
        const active=await tx.salesKnowledgeActivePublication.findUnique({where:{sourceId}});
        if(latest?.id!==id || !["draft","failed"].includes(latest.state) || (active?.publicationId ?? null)!==draft.activePublicationId) throw new Error("version_conflict");
        const now=this.clock();
        if(latest.validUntil && latest.validUntil<=now) throw new Error("invalid_knowledge_validity");
        if(active) await tx.salesKnowledgePublication.update({where:{id:active.publicationId},data:{state:"withdrawn",withdrawnAt:now}});
        const row=await tx.salesKnowledgePublication.update({where:{id},data:{state:"published",projectedHash:projection.hash,projectedCount:projection.count,publishedBy:actor.operatorId,publishedAt:now}});
        await tx.salesKnowledgeActivePublication.upsert({where:{sourceId},create:{sourceId,publicationId:id,version:row.version},update:{publicationId:id,version:row.version}});
        await prospectAudit(tx,actor,"knowledge.publish","knowledge",sourceId,row.version,{publicationId:id,sourceRef:row.sourceRef,validFrom:draft.validFrom,validUntil:draft.validUntil});
        return {result:{...draft,state:"published" as const,publishedBy:actor.operatorId,updatedAt:row.updatedAt.toISOString(),activePublicationId:id},resourceIds:[id,sourceId]};
      });
    } catch(error) {
      if(projectionFailed) await this.repo.prisma.salesKnowledgePublication.updateMany({where:{id:projectionFailed,state:"draft"},data:{state:"failed"}});
      throw error;
    }
  }
}
