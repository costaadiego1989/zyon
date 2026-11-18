import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AssistantKnowledgeRetriever} from './assistant-knowledge.retriever.js';
import {CASHBACK_MERCHANT_KNOWLEDGE,cashbackGuideSource} from './knowledge/cashback.pt-BR.js';
import {META_ADS_MERCHANT_KNOWLEDGE} from './knowledge/meta-ads.pt-BR.js';
import {merchantGuideProjectionHash} from '../../graph-rag/application/graph-projection.service.js';
import {AssistantService} from '../application/assistant.service.js';
import {AssistantApiService} from '../application/assistant-api.service.js';
import {PrismaAssistantRepository} from './prisma-assistant.repository.js';
import {assistantDatabase} from './__tests__/database.js';
import type {AssistantContextPort} from '../domain/context.port.js';
import type {AssistantModelPort} from '../domain/model.port.js';
import {AssistantError} from '../domain/assistant.port.js';
import {CASHBACK_KNOWLEDGE_FALLBACK_NOTICE} from '../domain/knowledge.port.js';

const clock=()=>new Date('2026-11-18T12:00:00Z');
const scope={merchantId:'store-a',context:'cashback',audience:'merchant' as const};
const docs=()=>[...META_ADS_MERCHANT_KNOWLEDGE,...CASHBACK_MERCHANT_KNOWLEDGE];
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function hit(doc=CASHBACK_MERCHANT_KNOWLEDGE[3]!,merchantId='store-a'){
  const source=cashbackGuideSource(merchantId,doc),section=doc.sections[0]!;
  return {merchantId,audience:'merchant' as const,context:'cashback' as const,sourceType:'merchant_guide' as const,
    sourceId:doc.id,chunkId:section.id,sourceVersion:source.version,sourceHash:merchantGuideProjectionHash(source),contentHash:digest(section.content),
    modelId:'model-v1',projectedAt:clock().getTime(),vectorScore:1,score:1};
}
const graph=(result:unknown)=>({enabledFor:()=>true,searchMerchantGuides:async()=>result} as any);

test('CBX-19 current references match reviewed text and reject changed versions content and forged references',async()=>{
  let documents=docs();const retriever=new AssistantKnowledgeRetriever(()=>documents,clock,graph({status:'ready',hits:[hit()],partial:true}));
  const result=await retriever.retrieveWithStatus(scope,'Como usar o cashback?');assert.equal(result.status,'graph_used');assert.equal(result.entries.length,1);
  const entry=result.entries[0]!,doc=CASHBACK_MERCHANT_KNOWLEDGE[3]!;
  assert.deepEqual(entry.reference,{id:'cashback-uso:uso',version:doc.version,title:doc.title,url:doc.url,reviewedAt:doc.reviewedAt,excerpt:doc.sections[0]!.content});
  assert.equal(entry.content,doc.sections[0]!.content);
  assert.deepEqual(await retriever.validateReferences(scope,[entry.reference.id],result.entries),[entry.reference]);
  assert.deepEqual(await retriever.source(scope,entry.reference.id),doc);
  for(const patch of [{version:'2026-11-18.2'},{published:false},{sections:[{...doc.sections[0]!,content:'Conteúdo alterado sem nova versão.'}]}]){
    documents=docs().map(d=>d.id===doc.id?{...d,...patch}:d);
    await assert.rejects(retriever.validateReferences(scope,[entry.reference.id],result.entries),{code:'assistant_reference_invalid'});
  }
  documents=docs();await assert.rejects(retriever.validateReferences(scope,['inventada:uso'],result.entries),{code:'assistant_reference_invalid'});
});
test('reviewed cashback topic matrix retrieves relevant guidance and keeps advertisements out of the context',async()=>{
  const retriever=new AssistantKnowledgeRetriever(undefined,clock);
  const topics=[['Qual percentual de ganho?','ganhos'],['Quando liberar o saldo pendente?','liberacao'],['Quando vence a validade?','validade'],
    ['Como usar e resgatar?','uso'],['Posso combinar cupons?','cupons'],['Combinar regras avançadas?','regras-avancadas'],
    ['Qual teto e orçamento mensal?','tetos'],['Carteira compartilhada site WhatsApp?','carteira'],['Como pausar novos ganhos?','pausa']];
  for(const [query,id]of topics){const result=await retriever.retrieveWithStatus(scope,query!);assert.equal(result.status,'reviewed_fallback');
    assert.equal(result.entries[0]?.reference.id.split(':')[0],`cashback-${id}`);assert.ok(result.entries.every(e=>e.reference.url.startsWith('/?tab=cashback&help=')));}
  assert.deepEqual(await retriever.retrieve({...scope,context:'meta_ads'},'carteira compartilhada cashback'),[]);
});
test('graph help rejects foreign unknown stale hash version audience and context evidence before reviewed fallback',async()=>{
  for(const patch of [{merchantId:'store-b'},{audience:'buyer'},{context:'meta_ads'},{sourceType:'faq'},{sourceId:'unknown'},
    {chunkId:'unknown'},{sourceVersion:0},{sourceHash:'0'.repeat(64)},{contentHash:'0'.repeat(64)},
    {projectedAt:clock().getTime()-300001},{projectedAt:clock().getTime()+30001}]){
    const retriever=new AssistantKnowledgeRetriever(undefined,clock,graph({status:'ready',hits:[{...hit(),...patch}],partial:true}));
    const result=await retriever.retrieveWithStatus(scope,'Como usar cashback?');assert.equal(result.status,'reviewed_fallback');
    assert.equal(result.reason,'stale_graph');assert.ok(result.entries.some(e=>e.reference.id==='cashback-uso:uso'));
    assert.ok(result.entries.every(e=>e.content===CASHBACK_MERCHANT_KNOWLEDGE.find(d=>d.id===e.reference.id.split(':')[0])!.sections[0]!.content));
  }
});
test('cashback internal source policy rejects cross-context tabs arbitrary routes duplicate authority and unsafe hosts',async()=>{
  const doc=CASHBACK_MERCHANT_KNOWLEDGE[3]!;
  for(const url of ['/?tab=meta-ads-agent&help=cashback-uso','/?tab=cashback&help=cashback-uso&tab=meta-ads-agent',
    '/wallet?tab=cashback&help=cashback-uso','https://evil.test/help','https://developers.facebook.com/docs',
    '/?tab=cashback&help=cashback-uso#other','/?tab=cashback&help=other']){
    const retriever=new AssistantKnowledgeRetriever(()=>[{...doc,url}],clock);
    assert.equal(await retriever.source(scope,doc.id),null);assert.deepEqual(await retriever.retrieve(scope,'uso cashback'),[]);
  }
});
test('cashback retrieve validate and source require authenticated merchant scope and merchant audience',async()=>{
  const retriever=new AssistantKnowledgeRetriever(undefined,clock,graph({status:'ready',hits:[hit()],partial:true}));
  const prior=await retriever.retrieve(scope,'uso');assert.ok(prior.length);
  for(const invalid of [{context:'cashback',audience:'merchant' as const},{...scope,merchantId:''},{...scope,audience:'buyer' as const}]){
    assert.deepEqual(await retriever.retrieve(invalid,'uso'),[]);assert.equal(await retriever.source(invalid,'cashback-uso'),null);
    await assert.rejects(retriever.validateReferences(invalid,['cashback-uso:uso'],prior),{code:'assistant_reference_invalid'});
  }
});
test('per-call graph status stays isolated across interleaved merchant retrievals',async()=>{
  let release!:(value:unknown)=>void;
  const retriever=new AssistantKnowledgeRetriever(undefined,clock,{enabledFor:()=>true,searchMerchantGuides:async input=>input.merchantId==='store-a'
    ?new Promise(resolve=>{release=resolve;}):{status:'ready',hits:[hit(undefined,'store-b')],partial:true}} as any);
  const first=retriever.retrieveWithStatus(scope,'uso');
  const second=await retriever.retrieveWithStatus({...scope,merchantId:'store-b'},'uso');
  release({status:'unavailable',reason:'timeout'});const fallback=await first;
  assert.equal(second.status,'graph_used');assert.equal(fallback.status,'reviewed_fallback');assert.equal(fallback.reason,'timeout');
  assert.equal(second.status,'graph_used');assert.notEqual(second,fallback);
});
test('graph exceptions recover only reviewed fallback content without leaking transport details',async()=>{
  for(const failAdmission of [false,true]){
    const retriever=new AssistantKnowledgeRetriever(undefined,clock,{enabledFor:()=>{if(failAdmission)throw Error('secret-transport');return true;},
      searchMerchantGuides:async()=>{throw Error('secret-transport');}});
    const result=await retriever.retrieveWithStatus(scope,'uso cashback');
    assert.equal(result.status,'reviewed_fallback');assert.equal(result.reason,'graph_unavailable');assert.ok(result.entries.length>0);
    assert.ok(!JSON.stringify(result).includes('secret-transport'));
  }
});

async function responseFixture(retriever:AssistantKnowledgeRetriever,model?:AssistantModelPort){
  const db=await assistantDatabase(),actor={merchantId:'store-a',actorId:'owner-a',context:'cashback'};
  const repo=new PrismaAssistantRepository(db.prisma,clock),thread=await repo.createThread(actor);
  await repo.atomic(actor,thread.id,async tx=>{await tx.append({id:'cbx-turn',requestKey:'cbx-turn',inputHash:'a'.repeat(64),message:'Como usar cashback?',budgetAmountMicros:100n});
    await tx.update('cbx-turn',{status:'running',leaseToken:'cbx-lease',leaseUntil:'2026-11-18T12:01:00Z'});});
  const context:AssistantContextPort={descriptor:{id:'cashback',label:'Cashback',capabilities:[]},knowledgeScope:{...scope,merchantId:'store-b'},
    authorize:async()=>{},authorizeInvocation:async()=>{},tools:()=>[],execute:async()=>{throw Error('no writes');}};
  const service=new AssistantService({repo,context,knowledge:retriever,clock,model:model??{complete:async input=>({reply:'O uso depende das regras publicadas da loja.',
    referenceIds:input.knowledge.length?[input.knowledge[0]!.reference.id]:[],toolCalls:[],providerRequestId:'controlled-local',costMicros:0n})}});
  return {db,repo,context,actor,thread,service,respond:()=>service.respond({scope:actor,threadId:thread.id,turnId:'cbx-turn',leaseToken:'cbx-lease'})};
}
test('CBX-21 unavailable empty or stale graph produces reviewed evidence and a server-owned notice in actual assistant replies',async()=>{
  for(const result of [{status:'unavailable',reason:'disabled'},{status:'unavailable',reason:'timeout'},
    {status:'ready',hits:[],partial:true},{status:'ready',hits:[{...hit(),sourceVersion:0}],partial:true}]){
    const retriever=new AssistantKnowledgeRetriever(undefined,clock,graph(result)),f=await responseFixture(retriever);
    try{const response=await f.respond();assert.ok(response.references.length>0);assert.ok(response.references.every(r=>r.url.startsWith('/?tab=cashback&help=')));
      assert.match(response.reply,/A busca contextual está indisponível\. Consultei somente a ajuda revisada de cashback\./);
      assert.match(response.reply,/O uso depende das regras publicadas da loja\./);assert.doesNotMatch(response.reply,/Cypher|Neo4j/);
    }finally{await f.db.close();}
  }
  const retriever=new AssistantKnowledgeRetriever(undefined,clock,graph({status:'unavailable',reason:'disabled'}));
  const recovered=await responseFixture(retriever,{complete:async()=>{throw new AssistantError('assistant_model_response_invalid',502);}});
  try{
    recovered.context.recoveredResponse=()=> 'Consulte o checklist para retomar a próxima decisão.';
    const response=await recovered.respond();
    assert.equal(response.reply,`${CASHBACK_KNOWLEDGE_FALLBACK_NOTICE}\n\nConsulte o checklist para retomar a próxima decisão.`);
    assert.deepEqual(response.references,[]);assert.deepEqual(response.artifacts,[]);
  }finally{await recovered.db.close();}
  const unknown=await responseFixture(retriever,{complete:async()=>{throw new AssistantError('assistant_outcome_unknown',409);}});
  try{
    unknown.context.recoveredResponse=()=> 'Esta resposta não pode esconder um resultado desconhecido.';
    await assert.rejects(unknown.respond(),{code:'assistant_outcome_unknown'});
  }finally{await unknown.db.close();}
});
test('assistant uses authenticated server merchant for retrieval validation and source despite context authority fields',async()=>{
  const scopes:unknown[]=[];const graphRequests:unknown[]=[];
  class CapturedRetriever extends AssistantKnowledgeRetriever{
    override async retrieveWithStatus(s:any,q:string){scopes.push(s);return super.retrieveWithStatus(s,q);}
    override async validateReferences(s:any,ids:any,entries:any){scopes.push(s);return super.validateReferences(s,ids,entries);}
    override async source(s:any,id:string){scopes.push(s);return super.source(s,id);}
  }
  const retriever=new CapturedRetriever(undefined,clock,{enabledFor:()=>true,searchMerchantGuides:async input=>{
    graphRequests.push(input);return {status:'ready',hits:[hit()],partial:true};}} as any),f=await responseFixture(retriever);
  try{
    const response=await f.respond();assert.equal(response.reply,'O uso depende das regras publicadas da loja.');assert.equal(response.references[0]!.id,'cashback-uso:uso');
    const api=new AssistantApiService({repo:f.repo,context:async()=>f.context,knowledge:retriever,enabled:()=>true,dashboardUrl:'',wake:()=>{},admission:{} as any});
    assert.equal((await api.source(f.actor,'cashback-uso:uso')).id,'cashback-uso');
    assert.equal(scopes.length,3);assert.ok(scopes.every(s=>(s as any).merchantId==='store-a'));
    assert.deepEqual(graphRequests,[{merchantId:'store-a',context:'cashback',query:'Como usar cashback?',limit:5}]);
  }finally{await f.db.close();}
});
