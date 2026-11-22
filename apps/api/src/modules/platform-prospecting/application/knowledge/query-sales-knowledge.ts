import type { KnowledgeOperation,SalesKnowledgeFact,SalesKnowledgeQuery } from "@zyon/shared-types";

export interface ActivePublication {sourceId:string;publicationId:string;version:number}
export interface ActiveKnowledgeStore {active(now:Date,ids?:string[]):Promise<ActivePublication[]>}
export interface KnowledgeReadRequest {operation:KnowledgeOperation; terms:string[];limit:number;ids:string[]}
export interface KnowledgeReader {read(input:KnowledgeReadRequest):Promise<SalesKnowledgeFact[]>}
const fields={explain_feature:"feature",compare_plans:"planKeys",answer_faq:"question",integration_capability:"integration"} as const;

function invalid():never {throw new Error("invalid_knowledge_query");}
function term(value:unknown) {
  if(typeof value!=="string" || !value.trim() || value.length>180 || !/^[\p{L}\p{N} .,!?'’_/-]+$/u.test(value) ||
    /\b(match|cypher|apoc|detach|merge|create|delete|procedure|call|return|unwind|foreach|remove|set|yield|merchantId|tenantId)\b/i.test(value) || /\b(?:dados|documentos|recursos|pedidos|clientes)\s+(?:privad[oa]s?|intern[oa]s?)\s+(?:d[oa]|de)\s+(?:lojista|loja|tenant|merchant)\b/iu.test(value) || /\bprivate\s+(?:merchant|tenant|store)\b/i.test(value)) invalid();
  return value.trim().toLowerCase();
}
export class QuerySalesKnowledge {
  constructor(private readonly store:ActiveKnowledgeStore, private readonly reader:KnowledgeReader,
    private readonly audit:(event:{queryVersion:string;operation:KnowledgeOperation;count:number;publications:string[]})=>void=()=>{}) {}
  async queryPublishedKnowledge(query:SalesKnowledgeQuery,now:Date) {
    if(!query || typeof query!=="object" || Object.keys(query).some(k=>!["operation","params","limit"].includes(k)) || !Object.hasOwn(fields,query.operation)) invalid();
    const key=fields[query.operation], params=query.params;
    if(!params || typeof params!=="object" || Object.keys(params).length!==1 || !Object.hasOwn(params,key)) invalid();
    const value=params[key], limit=query.limit===undefined ? 10 : query.limit;
    if(!Number.isInteger(limit) || limit<1 || limit>10) invalid();
    const terms=key==="planKeys" ? (Array.isArray(value) && value.length>=1 && value.length<=5 ? value.map(term) : invalid()) : [term(value)];
    const active=await this.store.active(now);
    const facts=active.length ? await this.reader.read({operation:query.operation,terms,limit,ids:active.map(x=>x.publicationId)}) : [];
    const ids=[...new Set(facts.map(f=>f.publicationId))];
    const current=ids.length ? await this.store.active(now,ids) : [];
    const valid=facts.filter(f=>current.some(p=>p.publicationId===f.publicationId && p.sourceId===f.sourceId && p.version===f.publicationVersion));
    this.audit({queryVersion:"sales-read-v1",operation:query.operation,count:valid.length,publications:[...new Set(valid.map(f=>f.publicationId))]});
    return valid;
  }
}
