import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {STOREFRONT_RAG_QUESTION as question,STOREFRONT_RAG_REPLY as reply} from './service-public-storefront-model-fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
test('T69 actual storefront capability HTTP retains current RAG provenance through response audit',
 {timeout:SERVICE_LOCAL_TEST_MS},async t=>{
 const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true});let prisma;
 try{
  const {PrismaClient}=await import('@prisma/client');prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
  assert.equal(runtime.evidence().canonicalAppModule,true);assert.equal(runtime.evidence().repositoryOverrides,false);
  assert.equal(runtime.evidence().authOverrides,false);assert.equal(runtime.evidence().providerCalls,0);
  assert.deepEqual(runtime.evidence().localProviderOverrides,[]);
  assert.deepEqual(runtime.evidence().localModelOverrides,['QueryKnowledgeUseCase.embeddingService','storefront.STOREFRONT_PROVIDER_FETCH_FACTORY']);
  const request=async(path,body,token,method='POST',headers={})=>{
   const correlationId=randomUUID(),response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'content-type':'application/json','idempotency-key':randomUUID(),'x-correlation-id':correlationId,
     ...(token?{authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return{status:response.status,body:await response.json(),correlationId};
  };
  const register=async suffix=>{
   const result=await request('/auth/register',{merchant_name:'Synthetic storefront RAG '+suffix,
    email:suffix+'@storefront-rag.example.test',password:'SyntheticPassword123!',business_mode:'products'});
   assert.equal(result.status,201,JSON.stringify(result));return result.body;
  };
  const own=await register('own'),foreign=await register('foreign');
  for(const auth of [own,foreign])await prisma.merchantBillingSubscription.upsert({where:{merchantId:auth.merchant_id},
   create:{merchantId:auth.merchant_id,planKey:'growth',status:'active'},update:{planKey:'growth',status:'active'}});
  const current='CURRENT_STOREFRONT_POLICY_T69: consulte a equipe para as tratativas apos o recebimento.',
   stale='STALE_STOREFRONT_POLICY_CANARY',other='FOREIGN_STOREFRONT_POLICY_CANARY',hidden='PRIVATE_STOREFRONT_CONFIG_CANARY';
  for(const [auth,content]of [[own,current],[foreign,other]]){
   const result=await request('/knowledge/policies',{returns:content},auth.access_token,'PUT');assert.equal(result.status,200,JSON.stringify(result));
   const end=Date.now()+5000;let audit;
   do{audit=await prisma.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId:result.correlationId,action:'http.put'}});
    if(!audit)await pause(10);}while(!audit&&Date.now()<end);
   assert.ok(audit);assert.equal(audit.actorId,auth.user_id);assert.equal(audit.outcome,'success');assert.equal(audit.metadata.statusCode,200);
  }
  const {PUBLIC_POLICY_LABELS}=await import('../dist/modules/knowledge-base/domain/public-knowledge-content.js');
  const content=PUBLIC_POLICY_LABELS.returns+': '+current,embedding=JSON.stringify([1,...Array(383).fill(0)]);
  for(const [merchantId,sourceType,sourceId,text]of [[own.merchant_id,'policy','returns',content],
   [own.merchant_id,'policy','returns',stale],[own.merchant_id,'config','private-synthetic',hidden],
   [foreign.merchant_id,'policy','returns',PUBLIC_POLICY_LABELS.returns+': '+other]])
   await prisma.knowledgeChunk.create({data:{id:randomUUID(),merchantId,sourceType,sourceId,content:text,embedding}});
  const {readCanonicalPublicBusinessSourceWithin}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const canonical=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own.merchant_id} FOR SHARE`;
   return readCanonicalPublicBusinessSourceWithin(tx,own.merchant_id,'policy','returns');
  });
  assert.ok(canonical);assert.equal(canonical.publicationState,'published');assert.equal(canonical.text,content);
  const sourceBefore=await prisma.merchantPolicy.findUniqueOrThrow({where:{merchantId:own.merchant_id}});
  const chunksBefore=await prisma.knowledgeChunk.findMany({where:{merchantId:own.merchant_id},orderBy:{id:'asc'}});
  const started=await request('/storefront/conversations',{merchant_id:own.merchant_id});
  assert.equal(started.status,201,JSON.stringify(started));assert.equal(started.body.merchant_id,own.merchant_id);
  assert.match(started.body.conversation_id,/^conv_[a-f0-9-]{36}$/);assert.equal(typeof started.body.conversation_token,'string');
  assert.equal(typeof started.body.ai_user_token,'string');assert.deepEqual(runtime.storefrontQueryModel.counts(),{queryEmbeddings:0,providerFetches:0});
  const path='/storefront/conversations/'+started.body.conversation_id+'/messages';
  await t.test('missing and tampered real capability never invoke either model transport',async()=>{
   for(const token of [undefined,'synthetic-invalid-capability']){
    const result=await request(path,{user_message:question},token);assert.equal(result.status,401);
    assert.match(JSON.stringify(result.body),/invalid_conversation_token/);
   }
   assert.deepEqual(runtime.storefrontQueryModel.counts(),{queryEmbeddings:0,providerFetches:0});
  });
  await t.test('actual query, prompt, final strict reply and exact persisted source audit share one admitted tenant',async()=>{
   const result=await request(path,{user_message:question,history:[]},started.body.conversation_token);
   assert.equal(result.status,201,JSON.stringify(result));assert.equal(result.body.message,reply);
   assert.deepEqual(result.body.blocks,[]);assert.equal(result.body.conversation_id,started.body.conversation_id);
   assert.equal(Object.hasOwn(result.body,'evidence'),false);assert.equal(Object.hasOwn(result.body,'knowledgeEvidence'),false);
   const end=Date.now()+5000;while(runtime.storefrontQueryModel.events().length<4&&Date.now()<end)await pause(10);
   const events=runtime.storefrontQueryModel.events();assert.deepEqual(events.map(event=>event.kind),['providerFetch','queryEmbedding','providerFetch','providerFetch']);
   assert.deepEqual(events.filter(event=>event.kind==='providerFetch').map(event=>event.input.phase),['classifier','answer','review']);
   assert.deepEqual(runtime.storefrontQueryModel.counts(),{queryEmbeddings:1,providerFetches:3});
   assert.ok(events.every(event=>event.runId===runtime.db.runId));assert.equal(events[1].input.text,question);
   const prompt=JSON.parse(events[2].input.messages[0].content);assert.equal(prompt.id,'storefront.sales');
   assert.equal(prompt.context.knowledge,String.fromCharCode(0x2022)+' '+content,'must come from real QueryKnowledge RAG, not only canonical tool/base prompt');
   for(const forbidden of [stale,other,hidden,'public_evidence_scope_mismatch'])
    assert.equal(JSON.stringify(events[2].input.messages).includes(forbidden),false,forbidden);
   const rows=await prisma.merchantAuditEvent.findMany({where:{merchantId:own.merchant_id,correlationId:result.correlationId,action:'knowledge.response'}});
   assert.equal(rows.length,1,'actual response audit must be awaited before the HTTP response completes');const audit=rows[0];
   assert.equal(audit.actorType,'service');assert.equal(audit.actorId,'knowledge-response');assert.equal(audit.outcome,'success');
   assert.equal(audit.metadata.schemaVersion,1);assert.equal(audit.metadata.channel,'storefront');assert.equal(audit.metadata.evidenceStatus,'ready');
   assert.equal(audit.metadata.evidenceRole,'admitted_context');assert.equal(audit.metadata.responseStage,'application_reply');
   assert.equal(audit.metadata.responseSha256,sha(result.body.message));
   const decisions=await prisma.aiGovernanceDecision.findMany({where:{merchantId:own.merchant_id,source:'storefront_agent'}});
   assert.equal(decisions.length,3);assert.ok(decisions.every(decision=>decision.allowed&&decision.actorRole==='buyer'
    &&decision.correlationId===result.correlationId),'real AI admission retains buyer scope/correlation, never merchant privileges');
   assert.deepEqual(audit.metadata.references,[{origin:'legacy_sql',namespace:'canonical-legacy',merchantId:own.merchant_id,
    sourceType:'policy',sourceId:'returns',sourceVersion:canonical.sourceVersion,sourceHash:canonical.sourceHash,publicWorkVersion:null,
    publicationState:'published',embeddingModel:null,embeddingDimensions:null,chunkId:sha('returns\0'+content),contentHash:sha(content)}]);
   for(const forbidden of [question,reply,current,stale,other,hidden,started.body.ai_user_token,started.body.conversation_token])
    assert.equal(JSON.stringify(audit.metadata).includes(forbidden),false,forbidden);
   assert.equal(await prisma.merchantAuditEvent.count({where:{merchantId:foreign.merchant_id,action:'knowledge.response'}}),0);
   assert.deepEqual(await prisma.merchantPolicy.findUniqueOrThrow({where:{merchantId:own.merchant_id}}),sourceBefore);
   assert.deepEqual(await prisma.knowledgeChunk.findMany({where:{merchantId:own.merchant_id},orderBy:{id:'asc'}}),chunksBefore);
  });
  await t.test('valid capability cannot select another merchant in the message body',async()=>{
   const before=runtime.storefrontQueryModel.counts(),audits=await prisma.merchantAuditEvent.count({where:{action:'knowledge.response'}});
   const result=await request(path,{user_message:question,merchant_id:foreign.merchant_id},started.body.conversation_token);
   assert.equal(result.status,403);assert.match(JSON.stringify(result.body),/conversation_access_denied/);
   assert.deepEqual(runtime.storefrontQueryModel.counts(),before);assert.equal(await prisma.merchantAuditEvent.count({where:{action:'knowledge.response'}}),audits);
  });
  assert.equal(runtime.evidence().providerCalls,0);assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().authOverrides,false);
 }finally{if(prisma)await prisma.$disconnect();await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}
});
