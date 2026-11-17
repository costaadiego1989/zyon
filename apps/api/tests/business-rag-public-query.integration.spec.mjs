import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {operatorDiagnosticError} from './whatsapp-operator-delivery-diagnostics.mjs';

// Actual local HTTP writers, graph engine, signed gateway/client and canonical
// SQL evidence. Embeddings are a declared fixed pinned-ABI fixture; this is not
// a model-quality or AppModule buyer-query-selection proof (T71/T72).
test('T70 native public graph queries',{timeout:SERVICE_LOCAL_TEST_MS,concurrency:false},async t=>{
  const f=await createProfessionalHttpFixture();let graph,gateway,client;
  try{
    graph=await createServiceTestNeo4j();
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
    const {PrismaPublicBusinessIndexAdapter}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-index.js');
    const {PublicBusinessProjectionService}=await import('../dist/modules/graph-rag/application/public-business-projection.service.js');
    const {PublicBusinessIndexWorker}=await import('../dist/modules/graph-rag/application/public-business-index.worker.js');
    const {ALL_GRAPH_SCHEMA_STATEMENTS}=await import('../dist/modules/graph-rag/application/graph-schema.js');
    const {GRAPH_EMBEDDING_ID}=await import('../dist/modules/graph-rag/domain/graph-embedding-model.js');
    const {createQueryGateway}=await import('../dist/modules/graph-rag/gateway/query-gateway.js');
    const {CommunityGatewayAdapter}=await import('../dist/modules/graph-rag/infrastructure/community-gateway.adapter.js');
    const {publicGraphCandidate}=await import('../dist/modules/graph-rag/domain/public-business-result.js');
    const {RevalidatePublicSourceService}=await import('../dist/modules/knowledge-base/application/use-cases/revalidate-public-source.service.js');
    const {PrismaPublicEvidenceSources}=await import('../dist/modules/knowledge-base/infrastructure/prisma-public-evidence.sources.js');
    const {GRAPH_TEMPLATE_HASH,signQuery,verifyQueryResponse}=await import('../dist/modules/graph-rag/gateway/query-protocol.js');
    const {PUBLIC_BUSINESS_TEMPLATE_HASH}=await import('../dist/modules/graph-rag/domain/public-business-query.js');
    const own=f.owner.merchant_id,foreign=f.foreign.merchant_id,tenant=new TenantContextService();
    const scoped=registerTenantMiddleware(f.prisma,tenant),sources=new PrismaPublicBusinessSources(scoped,tenant),jobs=new PublicSourceWorkService(scoped,tenant,sources);
    const asMerchant=(merchantId,work)=>tenant.run({merchantId,userId:'synthetic-t70-reader',role:'system'},work);
    const as=work=>asMerchant(own,work);
    const validator=new RevalidatePublicSourceService(new PrismaPublicEvidenceSources(scoped,tenant));
    const http=businessRagWriterHttp(f.runtime);
    const mutate=async(path,body,method='PUT',auth=f.owner)=>{
      const correlationId=randomUUID(),result=await http.request(path,body,auth.access_token,method,{'idempotency-key':randomUUID(),'x-correlation-id':correlationId});
      assert.ok([200,201].includes(result.status),JSON.stringify({path,status:result.status,body:result.body}));
      const deadline=Date.now()+5000;let audit;
      do{audit=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}});if(audit)break;await pause(20);}while(Date.now()<deadline);
      assert.ok(audit,'t70_actual_writer_audit_required');assert.equal(audit.outcome,'success');assert.equal(audit.actorId,auth.user_id);return result.body;
    };
    for(const statement of ALL_GRAPH_SCHEMA_STATEMENTS)await graph.query(statement);
    const projection=await graph.createProjectionAdapter([own,foreign]);
    const embedding={modelId:GRAPH_EMBEDDING_ID,dimensions:384,generate:async()=>[1,...Array(383).fill(0)]};
    const index=new PrismaPublicBusinessIndexAdapter(scoped,tenant,sources,jobs);
    // Observation delegates to the actual adapter; exceptions/results and case oracles are unchanged.
    const observedIndex=Object.fromEntries(['claimNext','normalizeMarker','loadSnapshot','commit','failConditional'].map(phase=>[phase,async(...args)=>{
      const started=performance.now();
      try{return await index[phase](...args);}catch(error){
        try{
          const prismaCode=typeof error?.code==='string'&&/^P[12]\d{3}$/.test(error.code)?error.code:null;
          console.info('t70_index_operation_failed',JSON.stringify({phase,elapsedMs:Math.round(performance.now()-started),prismaCode,error:operatorDiagnosticError(error)}));
        }catch{/* Observation must never replace the original adapter error. */}
        throw error;
      }
    }]));
    const worker=new PublicBusinessIndexWorker(observedIndex,new PublicBusinessProjectionService(projection,embedding),observedIndex,id=>[own,foreign].includes(id));
    const drain=async(merchantId=own)=>{for(let n=0;n<32;n++){const result=await asMerchant(merchantId,()=>worker.runMerchant(merchantId));assert.equal(result.failed,0,JSON.stringify(result));if(!result.claimed)return;}assert.fail('t70_bounded_drain_incomplete');};
    await f.prisma.merchantBillingSubscription.upsert({where:{merchantId:own},create:{merchantId:own,planKey:'starter',status:'active'},update:{planKey:'starter',status:'active'}});
    await f.prisma.aiGovernancePolicy.upsert({where:{merchantId:own},create:{merchantId:own,grants:[],version:1,updatedBy:f.owner.user_id},update:{grants:[]}});
    await mutate('/merchants/me/store-settings',{company:{description:'Synthetic professional consulting company',serviceNames:['Synthetic consultation']},businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}]});
    const service=await mutate('/merchants/'+own+'/products',{name:'Synthetic consultation',description:'Published consulting service',type:'service',metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:[{sku:'synthetic-t70-service',attributes:{},basePriceInCents:5000,stockQuantity:1}]},'POST');
    let professional=await mutate('/merchants/'+own+'/service-professionals',{...f.profile,publicName:'Synthetic public consultant',productIds:[service.id]},'POST');
    const unlinked=await mutate('/merchants/'+own+'/service-professionals',{...f.profile,publicName:'Synthetic unrelated consultant',productIds:[]},'POST');
    await f.prisma.merchantBillingSubscription.update({where:{merchantId:own},data:{planKey:'growth',status:'active'}});
    await mutate('/support/settings',{faqItems:[{id:'synthetic-t70-faq',question:'What is offered?',answer:'Public consulting facts.'}]});
    await mutate('/knowledge/policies',{general:'Current public consulting policy.'});
    const identities=[['company',own],['business_hours',own],['service',service.id],['professional',professional.id],['professional',unlinked.id],['faq','synthetic-t70-faq'],['policy','general']];
    for(const[type,id]of identities)await as(()=>jobs.normalizeCurrent(own,type,id));
    await drain();
    await mutate('/merchants/me/store-settings',{company:{description:'FOREIGN-T70-COMPANY-CANARY'}},'PUT',f.foreign);
    await asMerchant(foreign,()=>jobs.normalizeCurrent(foreign,'company',foreign));await drain(foreign);
    const foreignState=async()=>({merchant:await f.prisma.merchant.findUnique({where:{id:foreign}}),
      work:await f.prisma.publicSourceWork.findMany({where:{merchantId:foreign},orderBy:{id:'asc'}}),
      chunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId:foreign},orderBy:{id:'asc'}})});
    const beforeForeign=await foreignState();assert.ok(beforeForeign.chunks.some(row=>row.content.includes('FOREIGN-T70-COMPANY-CANARY')));
    const engine=await graph.createReadEngine([own]);
    let held;
    gateway=createQueryGateway({keyId:'local-t70',secret:'a'.repeat(64),merchantIds:[own]},
      {probe:()=>engine.probe(),read:input=>engine.read(input),readPublic:async input=>{const result=await engine.readPublic(input);if(held){held.started();await held.promise;}return result;},close:()=>engine.close()});
    gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');const address=gateway.server.address();assert.ok(address&&typeof address==='object');
    const uri='http://127.0.0.1:'+address.port;
    const settings={enabled:true,merchantIds:[own],database:'neo4j',production:true,timeoutMs:2000,queryMode:'community_gateway',queryGateway:{uri,keyId:'local-t70',secret:'a'.repeat(64)}};
    client=new CommunityGatewayAdapter(settings);
    const request={kind:'public_business',mode:'sources',merchantId:own,modelId:GRAPH_EMBEDDING_ID,query:'Public consulting',embedding:[1,...Array(383).fill(0)],nowEpochMs:Date.now(),limit:20};
    const query=async(extra={})=>{const result=await client.readPublic({...request,...extra});assert.equal(result.status,'ready',JSON.stringify(result));return result;};
    const validate=hits=>as(()=>validator.revalidate({merchantId:own,candidates:hits.map(publicGraphCandidate)}));
    const validatePairs=pairs=>as(()=>validator.revalidatePairs({merchantId:own,pairs:pairs.map(pair=>({service:publicGraphCandidate(pair.service),professional:publicGraphCandidate(pair.professional)}))}));
    const pairRequest={mode:'service_professional',pairs:[{serviceId:service.id,professionalId:professional.id}],limit:10};
    const financial=async()=>({appointments:await f.prisma.serviceAppointment.count({where:{merchantId:own}}),orders:await f.prisma.completedOrder.count({where:{merchantId:own}}),payments:await f.prisma.paymentIntent.count({where:{merchantId:own}})});
    const beforeFinancial=await financial();

    await t.test('01 real signed public capability executes all six fixed source families',async()=>{
      assert.equal(await client.admitReader(),true);assert.equal(await client.admitPublicReader(),true);
      const result=await query();assert.equal(result.partial,true);
      assert.deepEqual([...new Set(result.hits.map(hit=>hit.sourceType))].sort(),['business_hours','company','faq','policy','professional','service']);
      const accepted=await validate(result.hits);assert.equal(accepted.status,'ready');assert.equal(accepted.evidence.length,result.hits.length);
      for(const value of accepted.evidence){assert.equal(value.provenance.merchantId,own);assert.equal(value.provenance.embeddingModel,GRAPH_EMBEDDING_ID);assert.equal(value.provenance.embeddingDimensions,384);assert.equal(value.provenance.namespace,'public-business-v1');}
      assert.equal(JSON.stringify(accepted).includes('FOREIGN-T70-COMPANY-CANARY'),false);
    });
    await t.test('02 static public evidence older than legacy TTL stays current through canonical admission',async()=>{
      await graph.query('MATCH(n:ZyonPublicSourceV1 {merchantId:$merchantId}) SET n.projectedAt=$old',{merchantId:own,old:Date.now()-3_600_000});
      const result=await query();assert.ok(result.hits.length>=7);assert.equal((await validate(result.hits)).status,'ready');
    });
    await t.test('03 advanced pair template returns only complete currently linked canonical evidence',async()=>{
      const result=await query(pairRequest);assert.equal(result.mode,'service_professional');assert.equal(result.pairs.length,1);
      const accepted=await validatePairs(result.pairs);assert.equal(accepted.status,'ready');assert.equal(accepted.pairs.length,1);assert.equal(accepted.evidence.length,2);
      assert.equal(accepted.pairs[0].service.provenance.sourceId,service.id);assert.equal(accepted.pairs[0].professional.provenance.sourceId,professional.id);
    });
    await t.test('04 graph hints for two published but unlinked sources cannot assert a relationship',async()=>{
      const result=await query({...pairRequest,pairs:[{serviceId:service.id,professionalId:unlinked.id}]});assert.equal(result.pairs.length,1);
      assert.deepEqual(await validatePairs(result.pairs),{status:'insufficient',pairs:[],evidence:[]});
    });
    await t.test('05 actual unlink committed while graph response waits invalidates the old pair',async()=>{
      await http.ready(f.owner.access_token);
      let release,started;const began=new Promise(resolve=>{started=resolve;});const promise=new Promise(resolve=>{release=resolve;});held={started,promise};
      const pending=query(pairRequest);
      try{
        await Promise.race([began,pending.then(()=>assert.fail('t70_held_graph_response_not_observed'))]);
        professional=await mutate('/merchants/'+own+'/service-professionals/'+professional.id,{expectedVersion:professional.version,productIds:[]},'PATCH');
      }finally{held=undefined;release();await Promise.allSettled([pending]);}
      const stale=await pending;assert.equal(stale.pairs.length,1);assert.deepEqual(await validatePairs(stale.pairs),{status:'insufficient',pairs:[],evidence:[]});
      professional=await mutate('/merchants/'+own+'/service-professionals/'+professional.id,{expectedVersion:professional.version,productIds:[service.id]},'PATCH');await drain();
    });
    await t.test('06 foreign requested tuples and forged candidate scope never expose other company data',async()=>{
      assert.deepEqual(await client.readPublic({...request,merchantId:foreign}),{status:'unavailable',reason:'disabled'});
      const result=await query(pairRequest);const forged=result.pairs.map(pair=>({service:publicGraphCandidate(pair.service),professional:{...publicGraphCandidate(pair.professional),merchantId:foreign}}));
      assert.deepEqual(await as(()=>validator.revalidatePairs({merchantId:own,pairs:forged})),{status:'insufficient',pairs:[],evidence:[]});
      await assert.rejects(tenant.run({merchantId:foreign,role:'system'},()=>validator.revalidatePairs({merchantId:own,pairs:[]})),/scope/);
    });
    await t.test('07 current professional and service withdrawal each reject the old linked pair',async()=>{
      const old=await query(pairRequest);professional=await mutate('/merchants/'+own+'/service-professionals/'+professional.id,{expectedVersion:professional.version,isPublished:false},'PATCH');
      assert.deepEqual(await validatePairs(old.pairs),{status:'insufficient',pairs:[],evidence:[]});
      professional=await mutate('/merchants/'+own+'/service-professionals/'+professional.id,{expectedVersion:professional.version,isPublished:true},'PATCH');await drain();
      const beforeServiceWithdrawal=await query(pairRequest);
      await f.prisma.product.update({where:{id:service.id},data:{isActive:false}});
      try{assert.deepEqual(await validatePairs(beforeServiceWithdrawal.pairs),{status:'insufficient',pairs:[],evidence:[]});}
      finally{await f.prisma.product.update({where:{id:service.id},data:{isActive:true}});await as(()=>jobs.normalizeCurrent(own,'service',service.id));await drain();}
    });
    await t.test('08 actual canonical SQL outage after a successful graph response returns unavailable',async()=>{
      const result=await query(pairRequest);await f.runtime.db.sql('ALTER TABLE public_source_work RENAME TO synthetic_t70_unavailable_work;');
      try{assert.deepEqual(await validatePairs(result.pairs),{status:'unavailable',pairs:[],evidence:[],reason:'canonical_unavailable'});}
      finally{await f.runtime.db.sql('ALTER TABLE synthetic_t70_unavailable_work RENAME TO public_source_work;');}
    });
    await t.test('09 wrong revision model namespace and chunk hash candidates cannot become current context',async()=>{
      const result=await query();const current=result.hits.find(hit=>hit.sourceType==='company');assert.ok(current);
      for(const patch of [{sourceVersion:'public-v1:00000000000000000099'},{embeddingModel:'wrong-model-384'},{publicSourceNamespace:'legacy'},{contentHash:'f'.repeat(64)}])
        assert.deepEqual(await as(()=>validator.revalidate({merchantId:own,candidates:[{...publicGraphCandidate(current),...patch}]})),{status:'insufficient',evidence:[]});
    });
    await t.test('10 actual gateway rejects syntax, old mixed hashes, replay, bad signatures and write routes',async()=>{
      const send=async(input,{hash=PUBLIC_BUSINESS_TEMPLATE_HASH,path='/v1/read',key='a'.repeat(64),auth}={})=>{
        const body=JSON.stringify({protocol:1,templateHash:hash,input}),signed=auth??signQuery(key,'local-t70',path,body);
        const response=await fetch(uri+path,{method:'POST',body,headers:{'content-type':'application/json','x-zyon-key-id':'local-t70','x-zyon-timestamp':signed.timestamp,'x-zyon-nonce':signed.nonce,'x-zyon-signature':signed.signature}});
        const text=await response.text();return{status:response.status,text,signed,valid:verifyQueryResponse('a'.repeat(64),signed.nonce,response.status,text,response.headers.get('x-zyon-response-signature'))};
      };
      const count=(await graph.query('MATCH(n) RETURN count(n) AS count'))[0].count.toNumber();
      for(const extra of [{cypher:'MATCH(n) DETACH DELETE n'},{procedure:'dbms.components'},{subquery:'CALL {RETURN 1}'},{database:'system'}])assert.equal((await send({...request,...extra})).status,400);
      assert.equal((await send(request,{hash:GRAPH_TEMPLATE_HASH})).status,400);assert.equal((await send(request,{path:'/v1/write'})).status,404);assert.equal((await send(request,{key:'b'.repeat(64)})).status,401);
      assert.equal((await send({...request,merchantId:foreign})).status,403);
      const allowed=await send(request);assert.equal(allowed.status,200);assert.equal(allowed.valid,true);assert.equal((await send(request,{auth:allowed.signed})).status,401);
      await query({query:"x') CALL { DETACH DELETE n } RETURN n //"});
      assert.equal((await graph.query('MATCH(n) RETURN count(n) AS count'))[0].count.toNumber(),count);
    });
    await t.test('11 private operation retains request bounds without altering financial or booking state',async()=>{
      for(const extra of [{limit:21},{scanLimit:5001},{embedding:Array(384).fill(0)},{modelId:'wrong-model-384'}])assert.deepEqual(await client.readPublic({...request,...extra}),{status:'unavailable',reason:'invalid_input'});
      assert.deepEqual(await financial(),beforeFinancial);assert.deepEqual(await foreignState(),beforeForeign);assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().providerCalls,0);
    });
    await t.test('12 closed public client denies new requests and teardown retains owned graph marker',async()=>{
      await client.close();assert.equal(await client.admitPublicReader(),false);assert.deepEqual(await client.readPublic(request),{status:'unavailable',reason:'disabled'});
      assert.deepEqual(await graph.query('MATCH(n:ServiceTestMarker) RETURN n.runId AS runId'),[{runId:graph.runId}]);
    });
  }finally{
    try{if(client)await client.close();}finally{try{if(gateway)await gateway.close();}finally{try{if(graph)await graph.dispose();}finally{await f.close();}}}
  }
});
