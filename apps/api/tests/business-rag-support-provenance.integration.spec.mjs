import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash}from 'node:crypto';
import {setTimeout as pause}from 'node:timers/promises';
import {createServiceTestRuntime}from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS}from './service-test-startup.mjs';

test('T69 actual public support response persists exact source audit and exposes audit failure', {timeout:SERVICE_LOCAL_TEST_MS},async t=>{
 const runtime=await createServiceTestRuntime({local:true,supportQueryModel:true});let prisma;
 try{
  const {PrismaClient}=await import('@prisma/client');prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
  assert.deepEqual(runtime.evidence().localProviderOverrides,[]);
  assert.deepEqual(runtime.evidence().localModelOverrides,['QueryKnowledgeUseCase.embeddingService','support.CHAT_COMPLETION_PORT']);
  assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().authOverrides,false);assert.equal(runtime.evidence().providerCalls,0);
  const request=async(path,body,auth,method='POST',extra={})=>{
   const correlationId=randomUUID(),response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'content-type':'application/json','idempotency-key':randomUUID(),'x-correlation-id':correlationId,
      ...(auth?{authorization:'Bearer '+auth.access_token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const result={status:response.status,body:await response.json(),correlationId};
   if(auth&&method==='PUT'&&result.status===200){
    const end=Date.now()+5000;let audit;
    do{audit=await prisma.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}});if(!audit)await pause(10);}while(!audit&&Date.now()<end);
    assert.ok(audit,'actual protected writer audit must settle before cleanup');assert.equal(audit.actorId,auth.user_id);assert.equal(audit.outcome,'success');assert.equal(audit.metadata.statusCode,200);
   }
   return result;
  };
  const register=async suffix=>{const result=await request('/auth/register',{merchant_name:'Synthetic public support '+suffix,
   email:suffix+'@public-support.example.test',password:'SyntheticPassword123!',business_mode:'products'});
   assert.equal(result.status,201,JSON.stringify(result));return result.body;};
  const own=await register('own'),foreign=await register('foreign');
  const current='CURRENT_PUBLIC_POLICY_T68: returns are accepted for seven days after receipt.',
   stale='STALE_POLICY_CANARY_T68: obsolete private promise',other='FOREIGN_POLICY_CANARY_T68',hidden='PRIVATE_CONFIG_CANARY_T68';
  await t.test('the actual knowledgeBase plan guard remains active before the named Growth seed',async()=>{
   const rejected=await request('/knowledge/policies',{returns:current},own,'PUT');assert.equal(rejected.status,403);
   assert.equal(await prisma.merchantPolicy.count({where:{merchantId:own.merchant_id}}),0);
   assert.equal(await prisma.publicSourceWork.count({where:{merchantId:own.merchant_id,sourceType:'policy'}}),0);
   assert.deepEqual(runtime.supportQueryModel.counts(),{queryEmbeddings:0,completions:0});
  });
  for(const auth of [own,foreign])await prisma.merchantBillingSubscription.upsert({where:{merchantId:auth.merchant_id},
   create:{merchantId:auth.merchant_id,planKey:'growth',status:'active'},update:{planKey:'growth',status:'active'}});
  const saved=await request('/knowledge/policies',{returns:current},own,'PUT');assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.returns,current);
  const foreignSaved=await request('/knowledge/policies',{returns:other},foreign,'PUT');assert.equal(foreignSaved.status,200,JSON.stringify(foreignSaved));
  const faq=[{id:'unrelated-public-faq',question:'Zebra catalogue installation reference',answer:'Only the separate catalogue FAQ.'}];
  const setting=await request('/support/settings',{faqItems:faq},own,'PUT');assert.equal(setting.status,200,JSON.stringify(setting));
  const question='Qual e o prazo para devolver uma compra?';
  const {faqLookup}=await import('../dist/modules/support/application/support-faq.service.js');assert.equal(faqLookup(question,faq),null,'FAQ nonmatch must not mask the knowledge path');
  const {PUBLIC_POLICY_LABELS}=await import('../dist/modules/knowledge-base/domain/public-knowledge-content.js');
  const content=PUBLIC_POLICY_LABELS.returns+': '+current,vector=JSON.stringify([1,...Array(383).fill(0)]);
  // Explicit historical legacy SQL index seeds. Canonical policy was saved by
  // actual HTTP above. The query repository and canonical validator are real.
  for(const [merchantId,sourceType,sourceId,text]of [
   [own.merchant_id,'policy','returns',content],[own.merchant_id,'policy','returns',stale],
   [own.merchant_id,'config','private-synthetic',hidden],[foreign.merchant_id,'policy','returns',PUBLIC_POLICY_LABELS.returns+': '+other]])
    await prisma.knowledgeChunk.create({data:{id:randomUUID(),merchantId,sourceType,sourceId,content:text,embedding:vector}});
  const canonicalBefore=await prisma.merchantPolicy.findUniqueOrThrow({where:{merchantId:own.merchant_id}});
  const queryBefore=await prisma.knowledgeChunk.findMany({where:{merchantId:own.merchant_id},orderBy:{id:'asc'}});
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const{readCanonicalPublicBusinessSourceWithin}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const canonical=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own.merchant_id} FOR SHARE`;
   return readCanonicalPublicBusinessSourceWithin(tx,own.merchant_id,'policy','returns');});assert.ok(canonical);
  await t.test('public visitor HTTP reaches the real selector and current canonical policy in the captured system prompt',async()=>{
   const result=await request('/support/chat/public',{merchant_id:own.merchant_id,session_id:'synthetic-public-policy-session',message:question});
   assert.equal(result.status,201,JSON.stringify(result));assert.equal(result.body.safe,true);assert.equal(result.body.reply,'Consulte a politica publica atual apresentada pela loja.');
   assert.equal(result.body.handoff,undefined);assert.equal(typeof result.body.ai_user_token,'string');assert.ok(result.body.ai_user_token.length>50);
   const audits=await prisma.merchantAuditEvent.findMany({where:{merchantId:own.merchant_id,correlationId:result.correlationId,action:'knowledge.response'}});
   assert.equal(audits.length,1,'the actual source audit is awaited before returning the reply');const audit=audits[0];
   assert.equal(audit.actorType,'service');assert.equal(audit.actorId,'knowledge-response');assert.equal(audit.outcome,'success');
   assert.equal(audit.metadata.responseSha256,sha(result.body.reply));assert.equal(audit.metadata.evidenceRole,'admitted_context');
   assert.equal(audit.metadata.responseStage,'application_reply');assert.equal(audit.metadata.channel,'support');assert.equal(audit.metadata.evidenceStatus,'ready');
   assert.deepEqual(audit.metadata.references,[{origin:'legacy_sql',namespace:'canonical-legacy',merchantId:own.merchant_id,
    sourceType:'policy',sourceId:'returns',sourceVersion:canonical.sourceVersion,sourceHash:canonical.sourceHash,publicWorkVersion:null,
    publicationState:'published',embeddingModel:null,embeddingDimensions:null,chunkId:sha('returns\0'+content),contentHash:sha(content)}]);
   for(const forbidden of [question,result.body.reply,current,stale,other,hidden,result.body.ai_user_token])assert.equal(JSON.stringify(audit.metadata).includes(forbidden),false);

   const end=Date.now()+5000;while(runtime.supportQueryModel.events().length<2&&Date.now()<end)await pause(10);
   assert.deepEqual(runtime.supportQueryModel.counts(),{queryEmbeddings:1,completions:1});
   const events=runtime.supportQueryModel.events();assert.deepEqual(events.map(event=>event.kind),['queryEmbedding','chatCompletion']);
   assert.ok(events.every(event=>event.runId===runtime.db.runId));assert.equal(events[0].input.text,question);assert.equal(events[0].result.dimensions,384);
   const messages=events[1].input.messages;assert.equal(messages[0].role,'system');assert.deepEqual(messages[1],{role:'user',content:question});
   assert.ok(messages[0].content.includes(String.fromCharCode(0x2022)+' '+content),'Current canonical policy must be selected into knowledgeContext, not only FAQ/base prompt');
   for(const forbidden of [stale,other,hidden,'public_evidence_scope_mismatch'])assert.equal(messages[0].content.includes(forbidden),false,forbidden);
   assert.deepEqual(await prisma.merchantPolicy.findUniqueOrThrow({where:{merchantId:own.merchant_id}}),canonicalBefore);
   assert.deepEqual(await prisma.knowledgeChunk.findMany({where:{merchantId:own.merchant_id},orderBy:{id:'asc'}}),queryBefore);
  });
  await t.test('the actual visitor identity rejection cannot invoke either local model port',async()=>{
   const before=runtime.supportQueryModel.counts();const rejected=await request('/support/chat/public',
    {merchant_id:own.merchant_id,message:question},undefined,'POST',{'x-ai-user-token':'synthetic-invalid-credential'});
   assert.equal(rejected.status,401);assert.match(JSON.stringify(rejected.body),/invalid_ai_visitor_token/);assert.deepEqual(runtime.supportQueryModel.counts(),before);
  });
  await t.test('real SQL audit rejection remains visible and does not return an unlogged factual reply',async()=>{
   const quoted="'"+own.merchant_id.replaceAll("'","''")+"'",before=await prisma.merchantAuditEvent.count({where:{merchantId:own.merchant_id,action:'knowledge.response'}});
   await runtime.db.sql(`CREATE SEQUENCE synthetic_t69_audit_reached;
    CREATE FUNCTION synthetic_t69_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     IF NEW.merchant_id=${quoted} AND NEW.action='knowledge.response' THEN PERFORM nextval('synthetic_t69_audit_reached'); RAISE EXCEPTION 'synthetic_t69_audit_write_failed'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_t69_reject_audit BEFORE INSERT ON merchant_audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_t69_reject_audit();`);
   try{
    const rejected=await request('/support/chat/public',{merchant_id:own.merchant_id,session_id:'synthetic-audit-failure',message:question});
    assert.equal(rejected.status,500);assert.equal(Object.hasOwn(rejected.body,'reply'),false);
    assert.equal(Number(await runtime.db.sql('SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM synthetic_t69_audit_reached;')),1);
    assert.equal(await prisma.merchantAuditEvent.count({where:{merchantId:own.merchant_id,action:'knowledge.response'}}),before);
    assert.deepEqual(await prisma.merchantPolicy.findUniqueOrThrow({where:{merchantId:own.merchant_id}}),canonicalBefore);
   }finally{await runtime.db.sql('DROP TRIGGER synthetic_t69_reject_audit ON merchant_audit_events; DROP FUNCTION synthetic_t69_reject_audit(); DROP SEQUENCE synthetic_t69_audit_reached;');}
  });
  assert.equal(runtime.evidence().providerCalls,0);assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().authOverrides,false);
 }finally{if(prisma)await prisma.$disconnect();await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}
});
