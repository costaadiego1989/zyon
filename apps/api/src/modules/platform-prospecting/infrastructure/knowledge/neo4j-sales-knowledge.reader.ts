import neo4j,{type Driver} from "neo4j-driver";
import type {SalesKnowledgeFact} from "@zyon/shared-types";
import type {KnowledgeReadRequest,KnowledgeReader} from "../../application/knowledge/query-sales-knowledge.js";
import {SALES_NAMESPACE} from "./neo4j-sales-knowledge.adapter.js";

const predicates=Object.freeze({
  explain_feature:"feature",compare_plans:"plan",answer_faq:"faq",integration_capability:"integration",
});
export const SALES_KNOWLEDGE_READ_QUERY=`UNWIND $ids AS id MATCH (p:ZyonSalesPublication {namespace:$ns,id:id})-[:CONTAINS]->(f:ZyonSalesFact {namespace:$ns,predicate:$predicate})
  WHERE f.publicationId=id AND any(term IN $terms WHERE toLower(f.subject)=term OR term CONTAINS toLower(f.subject))
  RETURN f{.id,.subject,.predicate,.value,.sourceId,.publicationId,.publicationVersion,.validFrom,.validUntil} AS fact
  ORDER BY f.sourceId,f.id LIMIT $limit`;
export class Neo4jSalesKnowledgeReader implements KnowledgeReader {
  constructor(private readonly driver:Driver,private readonly timeoutMs:number,private readonly namespace=SALES_NAMESPACE) {
    if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>10000) throw new Error("invalid_knowledge_timeout");
  }
  async read({operation,terms,limit,ids}:KnowledgeReadRequest) {
    if(!Object.hasOwn(predicates,operation) || !Number.isInteger(limit) || limit<1 || limit>10) throw new Error("invalid_knowledge_query");
    const session=this.driver.session({defaultAccessMode:neo4j.session.READ});
    try {
      const result=await session.run(SALES_KNOWLEDGE_READ_QUERY,{ns:this.namespace,terms,predicate:predicates[operation],limit:neo4j.int(limit),ids},{timeout:this.timeoutMs});
      return result.records.map(r=>{const f=r.get("fact");return {...f,publicationVersion:Number(f.publicationVersion)} as SalesKnowledgeFact;});
    } finally {await session.close();}
  }
}
