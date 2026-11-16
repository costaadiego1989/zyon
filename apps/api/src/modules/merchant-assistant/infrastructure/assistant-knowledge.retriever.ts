import type {AssistantReference} from '@zyon/shared-types';
import {AssistantError} from '../domain/assistant.port.js';
import type {AssistantKnowledgeDocument,AssistantKnowledgeScope,AssistantKnowledgePort,RetrievedAssistantKnowledge} from '../domain/knowledge.port.js';
import {META_ADS_MERCHANT_KNOWLEDGE} from './knowledge/meta-ads.pt-BR.js';

const stop=new Set('a o as os de da do das dos e em no na nos nas um uma para por com como qual quais que eu minha meu minhas meus quero posso onde quando se ao'.split(' '));
const identifier=(value:string)=>/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(value)&&value===value.trim();
function tokens(value:string):string[]{
  return (value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[a-z0-9]+/g)??[])
    .filter(word=>word.length>1&&!stop.has(word)).map(word=>word.length>4&&word.endsWith('s')?word.slice(0,-1):word);
}
function officialUrl(value:string):boolean{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&
    ['developers.facebook.com','business.facebook.com','www.facebook.com','facebook.com'].includes(url.hostname)&&
    ![...url.searchParams.keys()].some(key=>/token|secret|password|api_key/i.test(key));}catch{return false;}
}
function safeSource(doc:AssistantKnowledgeDocument):boolean{
  if(!identifier(doc.id)||doc.sections.some(section=>!identifier(section.id)))return false;
  let safe=false;
  if(doc.url.startsWith('/?')){
    const url=new URL(doc.url,'https://assistant.invalid');
    safe=url.origin==='https://assistant.invalid'&&url.pathname==='/'&&!url.hash&&url.searchParams.get('tab')==='meta-ads-agent'&&
      url.searchParams.get('help')===doc.id&&[...url.searchParams.keys()].every(key=>['tab','help'].includes(key));
  }else safe=officialUrl(doc.url);
  return safe&&doc.externalSources.every(source=>officialUrl(source.url));
}
function chunk(doc:AssistantKnowledgeDocument,section:AssistantKnowledgeDocument['sections'][number],score=0):RetrievedAssistantKnowledge{
  const content=section.content.slice(0,4000);
  return {reference:{id:`${doc.id}:${section.id}`,version:doc.version,title:doc.title,url:doc.url,reviewedAt:doc.reviewedAt,excerpt:content.slice(0,1200)},content,score};
}
const sameReference=(a:AssistantReference,b:AssistantReference)=>a.id===b.id&&a.version===b.version&&a.title===b.title&&a.url===b.url&&a.reviewedAt===b.reviewedAt&&a.excerpt===b.excerpt;

export class AssistantKnowledgeRetriever implements AssistantKnowledgePort {
  constructor(private readonly load:()=>readonly AssistantKnowledgeDocument[]=()=>META_ADS_MERCHANT_KNOWLEDGE,private readonly clock:()=>Date=()=>new Date()){}
  private current(scope:AssistantKnowledgeScope){
    const now=this.clock().getTime();const documents=new Map<string,AssistantKnowledgeDocument>();
    let loaded:readonly AssistantKnowledgeDocument[];
    try{loaded=this.load();}catch{return documents;}
    for(const doc of loaded){
      const start=Date.parse(doc.validFrom),review=Date.parse(doc.reviewedAt),end=doc.validUntil===null?Infinity:Date.parse(doc.validUntil);
      if(!doc.published||doc.context!==scope.context||doc.audience!==scope.audience||!safeSource(doc)||!Number.isFinite(start)||!Number.isFinite(review)||
        !Number.isFinite(now)||start>now||review>now||Number.isNaN(end)||end<=now)continue;
      const previous=documents.get(doc.id);
      if(!previous||review>Date.parse(previous.reviewedAt)||review===Date.parse(previous.reviewedAt)&&doc.version.localeCompare(previous.version,undefined,{numeric:true})>0)documents.set(doc.id,doc);
    }
    return documents;
  }
  async retrieve(scope:AssistantKnowledgeScope,query:string):Promise<RetrievedAssistantKnowledge[]>{
    if(typeof query!=='string'||query.length>8000)return [];
    const terms=[...new Set(tokens(query))];if(!terms.length)return [];
    const entries=[...this.current(scope).values()].flatMap(doc=>doc.sections.map(section=>({doc,section,body:tokens(section.content),
      title:new Set(tokens(doc.title)),keywords:new Set(tokens(section.keywords.join(' ')))})));
    const average=entries.reduce((sum,e)=>sum+e.body.length,0)/Math.max(1,entries.length);
    return entries.map(entry=>{
      let score=0;
      for(const term of terms){
        const frequency=entry.body.filter(word=>word===term).length;
        if(!frequency&&!entry.title.has(term)&&!entry.keywords.has(term))continue;
        const containing=entries.filter(e=>e.body.includes(term)||e.title.has(term)||e.keywords.has(term)).length;
        const idf=Math.log(1+(entries.length-containing+0.5)/(containing+0.5));
        const weighted=frequency*2.2/(frequency+1.2*(0.25+0.75*entry.body.length/Math.max(1,average)));
        score+=idf*(weighted+(entry.title.has(term)?3:0)+(entry.keywords.has(term)?5:0));
      }
      return chunk(entry.doc,entry.section,score);
    }).filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score||a.reference.id.localeCompare(b.reference.id)).slice(0,5);
  }
  async validateReferences(scope:AssistantKnowledgeScope,ids:readonly string[],retrieved:readonly RetrievedAssistantKnowledge[]):Promise<AssistantReference[]>{
    if(!Array.isArray(ids)||ids.length>5||ids.some(id=>typeof id!=='string'||id.length>201))throw new AssistantError('assistant_reference_invalid',422);
    const current=this.current(scope);const result:AssistantReference[]=[];
    for(const id of [...new Set(ids)]){
      const supplied=retrieved.find(entry=>entry.reference.id===id);
      const [documentId,sectionId,...extra]=id.split(':');const doc=current.get(documentId);const section=doc?.sections.find(section=>section.id===sectionId);
      if(!supplied||!doc||!section||extra.length)throw new AssistantError('assistant_reference_invalid',422);
      const canonical=chunk(doc,section);
      if(supplied.content!==canonical.content||!sameReference(supplied.reference,canonical.reference))throw new AssistantError('assistant_reference_invalid',422);
      result.push(canonical.reference);
    }
    return result;
  }
  async source(scope:AssistantKnowledgeScope,id:string):Promise<AssistantKnowledgeDocument|null>{
    const [documentId,sectionId,...extra]=id.split(':');const doc=this.current(scope).get(documentId);
    if(!doc||extra.length||sectionId!==undefined&&!doc.sections.some(section=>section.id===sectionId))return null;
    return structuredClone(doc);
  }
}
