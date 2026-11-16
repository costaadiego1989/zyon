import assert from 'node:assert/strict';
import neo4j from 'neo4j-driver';
import {exercisePublicEvidenceReadLockCase} from './business-rag-revalidation-lock.cases.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';

// Prepared from the C fixture proposal; root composes the actual reader. Native gate remains required.
// Root supplies a thin composition of the actual T68 service/use case through
// makeReader. It is not a new HTTP API or a fake canonical repository.
const namespace='public-business-v1';
const vector=[1,...Array(383).fill(0)];
const digest=value=>createHash('sha256').update(value).digest('hex');
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>JSON.parse(JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item));
const number=value=>typeof value?.toNumber==='function'?value.toNumber():value;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

export async function exerciseBusinessEvidenceRevalidationCases(t,{f,graph,makeReader}){
  assert.equal(typeof makeReader,'function','actual_T68_reader_composition_required');
  const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
  const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
  const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
  const {PrismaPublicBusinessIndexAdapter}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-index.js');
  const {PublicBusinessProjectionService}=await import('../dist/modules/graph-rag/application/public-business-projection.service.js');
  const {PublicBusinessIndexWorker}=await import('../dist/modules/graph-rag/application/public-business-index.worker.js');
  const {GRAPH_EMBEDDING_ID}=await import('../dist/modules/graph-rag/domain/graph-embedding-model.js');
  const {ALL_GRAPH_SCHEMA_STATEMENTS}=await import('../dist/modules/graph-rag/application/graph-schema.js');
  const {GraphProjectionService}=await import('../dist/modules/graph-rag/application/graph-projection.service.js');
  const {compileGraphRead}=await import('../dist/modules/graph-rag/domain/graph-query.js');
  const {PrismaKnowledgeRepository}=await import('../dist/modules/knowledge-base/infrastructure/repositories/prisma-knowledge.repository.js');
  const {IndexFaqUseCase}=await import('../dist/modules/knowledge-base/application/use-cases/index-faq.use-case.js');
  const tenant=new TenantContextService(),scoped=registerTenantMiddleware(f.prisma,tenant);
  const sources=new PrismaPublicBusinessSources(scoped,tenant),jobs=new PublicSourceWorkService(scoped,tenant,sources);
  const legacy=new PrismaKnowledgeRepository(scoped),own=f.owner.merchant_id,foreign=f.foreign.merchant_id;
  const as=(merchantId,work)=>tenant.run({merchantId,userId:'synthetic-t68-reader',role:'system'},work);
  const read=(type,id)=>as(own,()=>sources.read(own,type,id));
  const reader=await makeReader({prisma:scoped,tenant,sources,legacyRepository:legacy,graph,
    publicEmbedding:{modelId:GRAPH_EMBEDDING_ID,dimensions:384,generate:async()=>[...vector]},
    legacyEmbedding:{isAvailable:()=>true,generate:async()=>[...vector]}});
  assert.equal(typeof reader.revalidate,'function');assert.equal(typeof reader.queryLegacy,'function');
  const validate=candidates=>as(own,()=>reader.revalidate({merchantId:own,candidates}));
  const legacyQuery=graphState=>as(own,()=>reader.queryLegacy({merchantId:own,queryText:'Synthetic public question',limit:20,threshold:0.1,graphState}));
  const http=businessRagWriterHttp(f.runtime);
  const mutate=async(path,body,method='PUT')=>{
    const correlationId=randomUUID();
    const result=await http.request(path,body,f.owner.access_token,method,{'idempotency-key':randomUUID(),'x-correlation-id':correlationId});
    assert.ok([200,201].includes(result.status),JSON.stringify({path,status:result.status,body:result.body}));
    const deadline=Date.now()+5000;let audit;
    do{audit=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId:own,correlationId}});if(audit)break;await pause(20);}while(Date.now()<deadline);
    assert.ok(audit,'actual_T68_writer_audit_required');assert.equal(audit.outcome,'success');assert.equal(audit.actorId,f.owner.user_id);
    return result.body;
  };
  const work=(type,id)=>f.prisma.publicSourceWork.findFirst({where:{merchantId:own,sourceType:type,sourceId:id,
    sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
  const stored=(type,id)=>f.prisma.knowledgeChunk.findMany({where:{merchantId:own,sourceType:type,sourceId:id,
    metadata:{path:['publicSourceNamespace'],equals:namespace}},orderBy:{id:'asc'}});
  const sqlCandidate=row=>({origin:'public_sql',merchantId:row.merchantId,sourceType:row.sourceType,sourceId:row.sourceId,
    rowId:row.id,content:row.content,...row.metadata});
  const sqlCandidates=async(type,id)=>(await stored(type,id)).map(sqlCandidate);
  // Fixed test-owned inspection of actual T66 graph storage. This is NOT the
  // production new-corpus query compiler/gateway or T70 semantic retrieval.
  const graphCandidates=async(type,id)=>{
    const rows=await graph.query('MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId})-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(c:ZyonPublicChunkV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId}) RETURN properties(s) AS source,properties(c) AS chunk',
      {merchantId:own,sourceType:type,sourceId:id});
    return rows.map(({source:s,chunk:c})=>({origin:'public_graph',merchantId:s.merchantId,sourceType:s.sourceType,sourceId:s.sourceId,
      publicSourceNamespace:namespace,schemaVersion:number(c.schemaVersion),sourceVersion:'public-v1:'+String(number(s.publicRevision)).padStart(20,'0'),
      sourceHash:s.sourceHash,publicationState:s.active?'published':'withdrawn',chunkId:c.chunkId,contentHash:c.contentHash,
      embeddingModel:c.modelId,embeddingDimensions:number(c.dimensions),projectedAt:number(c.projectedAt),normalizedText:c.normalizedText}));
  };
  const evidence=result=>{assert.ok(Array.isArray(result.evidence),'typed_actual_T68_evidence_required');return result.evidence;};
  const noText=(result,text)=>assert.equal(JSON.stringify(result).includes(text),false);
  const ready=(result,type,id)=>{assert.equal(result.status,'ready');const values=evidence(result).filter(value=>value.provenance.sourceType===type&&value.provenance.sourceId===id);
    assert.ok(values.length,'exact_source_evidence_required');return values;};
  const refused=result=>{assert.equal(result.status,'insufficient');assert.deepEqual(evidence(result),[]);};
  const financial=async()=>JSON.parse(await f.runtime.db.sql(`SELECT json_build_object(
    'orders',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM completed_orders x WHERE merchant_id=${sql(own)}),
    'payments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM payment_intents x WHERE merchant_id=${sql(own)}),
    'appointments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM service_appointments x WHERE merchant_id=${sql(own)}),
    'carts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM storefront_carts x WHERE merchant_id=${sql(own)}))`));
  const snapshot=async merchantId=>json({merchant:await f.prisma.merchant.findUnique({where:{id:merchantId}}),
    policy:await f.prisma.merchantPolicy.findUnique({where:{merchantId}}),
    work:await f.prisma.publicSourceWork.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    chunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId},orderBy:{id:'asc'}})});
  const driver=await graph.createProjectionAdapter([own,foreign,f.products.merchant_id]);
  for(const statement of ALL_GRAPH_SCHEMA_STATEMENTS)await graph.query(statement);
  const embeddings={modelId:GRAPH_EMBEDDING_ID,dimensions:384,generate:async()=>[...vector]};
  const projection=new PublicBusinessProjectionService(driver,embeddings),admission=new PrismaPublicBusinessIndexAdapter(scoped,tenant,sources,jobs);
  const worker=new PublicBusinessIndexWorker(admission,projection,admission,id=>id===own);
  const drain=async()=>{for(let count=0;count<32;count++){const report=await as(own,()=>worker.runMerchant(own));assert.equal(report.failed,0,JSON.stringify(report));if(!report.claimed)return;}assert.fail('bounded_T68_fixture_drain_incomplete');};
  const company=async description=>{await mutate('/merchants/me/store-settings',{company:{description}});await as(own,()=>jobs.normalizeCurrent(own,'company',own));await drain();return sqlCandidates('company',own);};
  let service,professional;
  try{
    await f.prisma.merchantBillingSubscription.upsert({where:{merchantId:own},create:{merchantId:own,planKey:'starter',status:'active'},update:{planKey:'starter',status:'active'}});
    await f.prisma.aiGovernancePolicy.upsert({where:{merchantId:own},create:{merchantId:own,grants:[],version:1,updatedBy:f.owner.user_id},update:{grants:[]}});
    await mutate('/merchants/me/store-settings',{company:{description:'Synthetic public introduction',serviceNames:['Synthetic consulting']},
      businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}]});
    service=await mutate('/merchants/'+own+'/products',{name:'Synthetic revalidation consultation',description:'Public service facts only',type:'service',
      metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},
      variants:[{sku:'synthetic-t68-service',attributes:{},basePriceInCents:5000,stockQuantity:1}]},'POST');
    professional=await mutate('/merchants/'+own+'/service-professionals',{...f.profile,publicName:'Synthetic public consultant',productIds:[service.id]},'POST');
    await f.prisma.merchantBillingSubscription.update({where:{merchantId:own},data:{planKey:'growth',status:'active'}});
    await mutate('/support/settings',{faqItems:[{id:'synthetic-t68-faq',question:'Synthetic public question?',answer:'Current public answer.'}]});
    await mutate('/knowledge/policies',{general:'Current public consulting policy.'});
    for(const [type,id]of [['company',own],['business_hours',own],['professional',professional.id],['service',service.id],['faq','synthetic-t68-faq'],['policy','general']])
      await as(own,()=>jobs.normalizeCurrent(own,type,id));
    await drain();

    await t.test('01 current six-family graph storage evidence is rehydrated from actual canonical SQL',async()=>{
      const before=await financial();
      for(const [type,id]of [['company',own],['business_hours',own],['professional',professional.id],['service',service.id],['faq','synthetic-t68-faq'],['policy','general']]){
        const source=await read(type,id),current=await work(type,id),candidates=await graphCandidates(type,id);assert.ok(candidates.length);
        const admitted=ready(await validate(candidates),type,id);assert.equal(admitted.map(item=>item.content).join(''),source.text);
        for(const item of admitted){assert.equal(item.provenance.merchantId,own);assert.equal(item.provenance.sourceHash,source.sourceHash);
          assert.equal(item.provenance.publicWorkVersion,current.sourceVersion);assert.equal(item.provenance.embeddingModel,GRAPH_EMBEDDING_ID);assert.equal(item.provenance.embeddingDimensions,384);}
      }
      assert.deepEqual(await financial(),before);assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().providerCalls,0);
    });

    await t.test('02 actual legacy SQL is canonically revalidated with graph disabled unavailable and ready',async()=>{
      await mutate('/support/settings',{faqItems:[{id:'synthetic-t68-faq',question:'Synthetic public question?',answer:'Current public answer.'},
        {id:'synthetic-t68-faq-agree',question:'Synthetic public question?',answer:'Current public answer.'}]});await drain();
      const text='P: Synthetic public question?\nR: Current public answer.';
      await as(own,()=>legacy.upsertChunks(own,'faq','faq-collection',[{content:text,embedding:[...vector],metadata:{itemId:'synthetic-t68-faq'}}]));
      const setting=await f.prisma.supportSetting.findUnique({where:{merchantId:own}}),chunkId=digest('faq-collection\0'+text);
      const legacyProjector=new GraphProjectionService(driver,embeddings);
      assert.equal((await legacyProjector.projectDocument({kind:'knowledge',merchantId:own,id:'faq-collection',sourceType:'faq',
        version:setting.updatedAt.getTime(),active:true,chunks:[{id:chunkId,content:text}]})).status,'applied');
      const graphRows=await graph.query('MATCH (d:ZyonGraphDocument {merchantId:$merchantId,sourceType:"faq",canonicalId:"faq-collection"})-[:ZyonGraphHasChunk {merchantId:$merchantId}]->(c:ZyonGraphChunk {merchantId:$merchantId}) RETURN properties(d) AS source,properties(c) AS chunk',
        {merchantId:own});assert.ok(graphRows.length);
      const legacyGraph=await validate(graphRows.map(({source:d,chunk:c})=>({origin:'legacy_graph',merchantId:own,sourceType:'faq',sourceId:d.canonicalId,
        sourceVersion:number(d.sourceVersion),sourceHash:d.sourceHash,chunkId:c.canonicalId,contentHash:c.contentHash,
        embeddingModel:c.modelId,embeddingDimensions:384,projectedAt:number(c.projectedAt)})));
      assert.equal(legacyGraph.status,'ready');assert.ok(evidence(legacyGraph).some(item=>item.content===text));
      assert.deepEqual(new Set(evidence(legacyGraph).map(item=>item.provenance.sourceId)),new Set(['synthetic-t68-faq','synthetic-t68-faq-agree']));
      for(const graphState of ['disabled','unavailable','ready']){
        const result=await legacyQuery(graphState);assert.equal(result.status,'ready');assert.ok(evidence(result).some(item=>item.content===text));
        assert.ok(evidence(result).every(item=>item.provenance.merchantId===own));
        assert.deepEqual(new Set(evidence(result).filter(item=>item.content===text).map(item=>item.provenance.sourceId)),new Set(['synthetic-t68-faq','synthetic-t68-faq-agree']));
        assert.equal(result.chunks.filter(item=>item.content===text).length,1);
      }
      const row=(await f.prisma.knowledgeChunk.findMany({where:{merchantId:own,sourceType:'faq',sourceId:'faq-collection'}}))[0];
      await f.prisma.knowledgeChunk.update({where:{id:row.id},data:{content:'SYNTHETIC-STALE-UNFILTERED-FAQ'}});
      for(const graphState of ['disabled','unavailable'])noText(await legacyQuery(graphState),'SYNTHETIC-STALE-UNFILTERED-FAQ');
    });

    await t.test('03 equal384 models and namespace remain distinct and ABI-only repair preserves healthy legacy rows',async()=>{
      const candidates=await company('Current public ABI proof'),row=candidates[0];
      const legacyText='P: Synthetic public question?\nR: Current public answer.';
      await as(own,()=>legacy.upsertChunks(own,'faq','faq-collection',[{content:legacyText,embedding:[...vector]}]));
      await as(own,()=>legacy.upsertChunks(own,'company',own,[{content:'Synthetic healthy legacy same-identity ABI row',embedding:[...vector]}]));
      const healthyLegacy=async()=>json((await f.prisma.knowledgeChunk.findMany({where:{merchantId:own,sourceType:'company',sourceId:own},orderBy:{id:'asc'}}))
        .filter(item=>item.metadata?.publicSourceNamespace!==namespace));
      const legacyBefore=await healthyLegacy();assert.equal(legacyBefore.length,1);
      refused(await validate([{...row,embeddingModel:'Xenova/all-MiniLM-L6-v2'}]));
      refused(await validate([{...row,embeddingDimensions:128}]));
      refused(await validate([{...row,publicSourceNamespace:undefined}]));
      const selected=await as(own,()=>legacy.similaritySearch(own,vector,20,0.1));
      assert.ok(selected.some(item=>item.content===legacyText));assert.ok(selected.every(item=>item.metadata?.publicSourceNamespace!==namespace));
      const current=await work('company',own);await f.prisma.publicSourceWork.update({where:{id:current.id},data:{embeddingModel:'different-public-model-same-384'}});
      await as(own,()=>jobs.normalizeCurrentPage(own,'company',[own]));
      assert.deepEqual(await healthyLegacy(),legacyBefore);
      refused(await validate(candidates));await drain();ready(await validate(await sqlCandidates('company',own)),'company',own);
    });

    await t.test('04 candidate selected before real HTTP B cannot pass the later canonical read',async()=>{
      const old=await company('Public A before HTTP edit'),before=await financial();
      await mutate('/merchants/me/store-settings',{company:{description:'Public B after actual HTTP edit'}});
      refused(await validate(old));await as(own,()=>jobs.normalizeCurrent(own,'company',own));await drain();
      const result=await validate(await sqlCandidates('company',own));ready(result,'company',own);noText(result,'Public A before HTTP edit');
      assert.deepEqual(await financial(),before);
    });

    await t.test('05 older completed evidence never wins over a pending processing or failed latest revision',async()=>{
      const old=await company('Public status A');await mutate('/merchants/me/store-settings',{company:{description:'Public status B'}});
      await as(own,()=>jobs.normalizeCurrent(own,'company',own));const next=await work('company',own);
      for(const status of ['pending','processing','failed']){
        await f.prisma.publicSourceWork.update({where:{id:next.id},data:{status,leaseToken:status==='processing'?randomUUID():null,
          leaseExpiresAt:status==='processing'?new Date(Date.now()+30000):null}});refused(await validate(old));
      }
      await f.prisma.publicSourceWork.update({where:{id:next.id},data:{status:'pending',nextAttemptAt:new Date(0)}});await drain();
      ready(await validate(await sqlCandidates('company',own)),'company',own);
    });

    await t.test('06 A B A with unresolved legacy marker cannot revive the old public revision',async()=>{
      const old=await company('Public ABA original A'),oldWork=await work('company',own);
      await mutate('/merchants/me/store-settings',{company:{description:'Public ABA intermediate B'}});
      await mutate('/merchants/me/store-settings',{company:{description:'Public ABA original A'}});
      assert.equal((await read('company',own)).sourceHash,oldWork.sourceHash);
      assert.ok(await f.prisma.publicSourceWork.findFirst({where:{merchantId:own,sourceType:'company',sourceId:own,sourceVersion:{not:{startsWith:'public-v1:'}},status:{not:'completed'}}}));
      refused(await validate(old));await as(own,()=>jobs.normalizeCurrent(own,'company',own));await drain();
      const next=await work('company',own);assert.ok(next.sourceVersion>oldWork.sourceVersion);ready(await validate(await sqlCandidates('company',own)),'company',own);
    });

    await t.test('07 withdrawal and actual mode switch reject old service professional and serviceNames evidence',async()=>{
      const oldService=await graphCandidates('service',service.id),oldProfessional=await sqlCandidates('professional',professional.id),oldCompany=await sqlCandidates('company',own);
      const rawSettings=(await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings;
      await f.prisma.serviceProfessional.update({where:{id:professional.id},data:{isPublished:false}});
      await f.prisma.product.update({where:{id:service.id},data:{isActive:false}});
      let changed=false;
      try{
        await mutate('/merchants/me/business-mode',{businessMode:'products',expectedBusinessMode:'services'});
        changed=true;
        refused(await validate(oldService));refused(await validate(oldProfessional));refused(await validate(oldCompany));
        assert.deepEqual((await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings.company.serviceNames,rawSettings.company.serviceNames);
        assert.equal((await read('company',own)).text.includes('Synthetic consulting'),false);
      }finally{
        if(changed)await mutate('/merchants/me/business-mode',{businessMode:'services',expectedBusinessMode:'products'});
        await f.prisma.serviceProfessional.update({where:{id:professional.id},data:{isPublished:true}});
        await f.prisma.product.update({where:{id:service.id},data:{isActive:true}});
        for(const [type,id]of [['company',own],['service',service.id],['professional',professional.id]])await as(own,()=>jobs.normalizeCurrent(own,type,id));await drain();
      }
    });

    await t.test('08 actual IndexFaq A inserts after actual HTTP B and cannot escape through disabled-graph fallback',async()=>{
      const faqA=[{id:'synthetic-t68-faq',question:'Synthetic public question?',answer:'SYNTHETIC-LATE-LEGACY-A'}];
      await mutate('/support/settings',{faqItems:faqA});const entered=deferred(),release=deferred();
      const delayed=new IndexFaqUseCase({isAvailable:()=>true,generate:async()=>{entered.resolve();return release.promise;}},legacy);
      const indexing=as(own,()=>delayed.execute({merchantId:own,faqItems:faqA}));void indexing.catch(()=>{});
      try{
        await entered.promise;await mutate('/support/settings',{faqItems:[{id:'synthetic-t68-faq',question:'Synthetic public question?',answer:'Current real HTTP B'}]});
        release.resolve([...vector]);await indexing;
        assert.ok((await as(own,()=>legacy.similaritySearch(own,vector,20,0.1))).some(item=>item.content.includes('SYNTHETIC-LATE-LEGACY-A')));
        for(const graphState of ['disabled','unavailable'])noText(await legacyQuery(graphState),'SYNTHETIC-LATE-LEGACY-A');
        await mutate('/support/settings',{faqItems:[]});for(const graphState of ['disabled','unavailable'])noText(await legacyQuery(graphState),'SYNTHETIC-LATE-LEGACY-A');
      }finally{release.resolve([...vector]);await indexing;}
    });

    await t.test('09 aggregate identity collision and explicit-empty public policy cannot resurrect a legacy fallback',async()=>{
      await mutate('/support/settings',{faqItems:[{id:'faq-collection',question:'Real individual public FAQ?',answer:'Current individual public answer.'}]});
      await as(own,()=>jobs.normalizeCurrent(own,'faq','faq-collection'));await drain();
      ready(await validate(await sqlCandidates('faq','faq-collection')),'faq','faq-collection');
      await mutate('/knowledge/policies',{returns:'OLD-MERCHANT-POLICY-FALLBACK'});await drain();
      const old=await sqlCandidates('policy','returns');
      const oldSource=await read('policy','returns');
      await as(own,()=>legacy.upsertChunks(own,'policy','returns',[{content:oldSource.text,embedding:[...vector]}]));
      assert.ok((await as(own,()=>legacy.similaritySearch(own,vector,20,0.1))).some(item=>item.content.includes('OLD-MERCHANT-POLICY-FALLBACK')));
      await mutate('/merchants/me/store-settings',{policies:{returns:''}});
      assert.equal((await f.prisma.merchantPolicy.findUnique({where:{merchantId:own}})).returns,null);
      assert.equal((await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings.policies.returns,'');
      // The real withdrawal clears both current stores. Explicitly simulate a
      // delayed legacy-only writer afterwards; the public empty marker must
      // still defeat the old field and its old vector. All storage is owned.
      await f.prisma.merchantPolicy.update({where:{merchantId:own},data:{returns:'OLD-MERCHANT-POLICY-FALLBACK'}});
      assert.equal((await f.prisma.merchantPolicy.findUnique({where:{merchantId:own}})).returns,'OLD-MERCHANT-POLICY-FALLBACK');
      refused(await validate(old));noText(await legacyQuery('disabled'),'OLD-MERCHANT-POLICY-FALLBACK');
      assert.equal((await read('policy','returns')).publicationState,'withdrawn');
    });

    await t.test('10 old projectedAt does not expire a current business source while actual legacy catalog TTL remains',async()=>{
      await company('Static current public source');
      await graph.query('MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:"company",sourceId:$merchantId})-[:ZyonPublicHasChunkV1]->(c) SET s.projectedAt=$old,c.projectedAt=$old',
        {merchantId:own,old:Date.now()-600000});
      ready(await validate(await graphCandidates('company',own)),'company',own);
      const now=Date.now(),control=id=>({kind:'catalog',merchantId:own,id,version:1,active:true,name:'Synthetic TTL control',variants:[{id:id+'-variant',sku:id,active:true,attributes:{}}]});
      const oldProjector=new GraphProjectionService(driver,embeddings,()=>now-600000),freshProjector=new GraphProjectionService(driver,embeddings,()=>now);
      assert.equal((await oldProjector.projectCatalog(control('synthetic-t68-old-catalog'))).status,'applied');
      assert.equal((await freshProjector.projectCatalog(control('synthetic-t68-fresh-catalog'))).status,'applied');
      const command=compileGraphRead({kind:'catalog',merchantId:own,modelId:GRAPH_EMBEDDING_ID,query:'Synthetic TTL',embedding:vector,nowEpochMs:now,maxAgeMs:300000,limit:20,threshold:0.1});
      const found=await graph.query(command.text,{...command.parameters,limit:neo4j.int(command.parameters.limit),scanLimit:neo4j.int(command.parameters.scanLimit)});
      assert.ok(found.some(item=>item.productId==='synthetic-t68-fresh-catalog'));assert.equal(found.some(item=>item.productId==='synthetic-t68-old-catalog'),false);
    });

    await t.test('11 wrong tenant identity aliases corrupted metadata and private canaries never become evidence',async()=>{
      await company('Public canary control');const canary='PRIVATE-T68-CANARY';
      const merchant=await f.prisma.merchant.findUnique({where:{id:own}});
      const settings=structuredClone(merchant.storeSettings);settings.privateOwnerNote=canary;delete settings.company.email;
      await f.prisma.merchant.update({where:{id:own},data:{storeSettings:settings}});
      await as(own,()=>jobs.normalizeCurrent(own,'company',own));await drain();
      const good=await sqlCandidates('company',own);ready(await validate(good),'company',own);
      const before=await snapshot(own),foreignBefore=await snapshot(foreign),money=await financial();
      for(const forged of [{...good[0],merchantId:foreign},{...good[0],sourceId:foreign},{...good[0],sourceType:'professional'},
        {...good[0],rowId:'wrong-global-row'},{...good[0],schemaVersion:99},{...good[0],content:canary},{...good[0],contentHash:'0'.repeat(64)}]){
        const result=await validate([forged]);refused(result);noText(result,canary);noText(result,f.owner.email);
      }
      await assert.rejects(as(own,()=>reader.revalidate({merchantId:foreign,candidates:good})),/scope|tenant/);
      assert.deepEqual(await snapshot(own),before);assert.deepEqual(await snapshot(foreign),foreignBefore);assert.deepEqual(await financial(),money);
    });

    await t.test('12 real canonical SQL failure is unavailable rather than empty success or no products',async()=>{
      const current=await company('Public canonical availability'),before=await financial();
      const conflict=await validate([...current,{...current[0],sourceHash:'f'.repeat(64),content:'SYNTHETIC-CONTRADICTORY-STALE-HIGH-SCORE',score:999}]);
      ready(conflict,'company',own);noText(conflict,'SYNTHETIC-CONTRADICTORY-STALE-HIGH-SCORE');
      const setting=await f.prisma.supportSetting.findUnique({where:{merchantId:own}}),faq=await sqlCandidates('faq','faq-collection');assert.ok(faq.length);
      await f.prisma.supportSetting.update({where:{merchantId:own},data:{faqItems:[
        {id:'faq-collection',question:'Synthetic ambiguous current question?',answer:'Current answer one'},
        {id:'faq-collection',question:'Synthetic ambiguous current question?',answer:'Current incompatible answer two'}]}});
      try{const ambiguous=await validate(faq);assert.equal(ambiguous.status,'conflicting');assert.deepEqual(evidence(ambiguous),[]);}
      finally{await f.prisma.supportSetting.update({where:{merchantId:own},data:{faqItems:setting.faqItems}});}
      const sourceBefore=await snapshot(own);
      await f.runtime.db.sql('ALTER TABLE public_source_work RENAME TO synthetic_t68_unavailable_work;');
      try{
        const result=await validate(current);assert.equal(result.status,'unavailable');assert.deepEqual(evidence(result),[]);
        assert.equal(result.reason,'canonical_unavailable');noText(result,'synthetic_t68_unavailable_work');
      }finally{await f.runtime.db.sql('ALTER TABLE synthetic_t68_unavailable_work RENAME TO public_source_work;');}
      ready(await validate(current),'company',own);assert.deepEqual(await snapshot(own),sourceBefore);assert.deepEqual(await financial(),before);
    });

    await t.test('13 actual graph commit followed by SQL publication failure is not completed current evidence',async()=>{
      await mutate('/merchants/me/store-settings',{company:{description:'Public graph committed SQL failed'}});await as(own,()=>jobs.normalizeCurrent(own,'company',own));
      const pending=await work('company',own),name='synthetic_t68_sql_reject',probe=name+'_reached';
      await f.runtime.db.sql(`CREATE SEQUENCE ${probe}; CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id=${sql(own)} AND NEW.source_type='company' AND NEW.metadata->>'publicSourceNamespace'=${sql(namespace)} THEN PERFORM nextval('${probe}'); RAISE EXCEPTION 'synthetic_t68_SQL_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${name}();`);
      try{
        const report=await as(own,()=>worker.runMerchant(own,1));assert.equal(report.failed,1);
        assert.equal(Number(await f.runtime.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${probe}`)),1);
        assert.equal((await work('company',own)).status,'failed');assert.deepEqual(await stored('company',own),[]);
        const candidates=await graphCandidates('company',own);assert.ok(candidates.length);refused(await validate(candidates));
      }finally{await f.runtime.db.sql(`DROP TRIGGER ${name} ON knowledge_chunks; DROP FUNCTION ${name}(); DROP SEQUENCE ${probe};`);}
      await f.prisma.publicSourceWork.update({where:{id:pending.id},data:{nextAttemptAt:new Date(0)}});await drain();ready(await validate(await sqlCandidates('company',own)),'company',own);
    });

    await t.test('14 public service evidence contains no embedded operational authority and reading preserves commerce',async()=>{
      const before=await financial(),canonical=await read('service',service.id),candidates=await sqlCandidates('service',service.id);
      assert.ok(candidates.length);const forged={...candidates[0],content:'Preco R$0.01 | Estoque999 | paid=true | vaga confirmada2030-01-01'};
      refused(await validate([forged]));const result=await validate(await graphCandidates('service',service.id));
      const admitted=ready(result,'service',service.id);assert.equal(admitted.map(item=>item.content).join(''),canonical.text);
      for(const term of ['R$0.01','Estoque999','paid=true','vaga confirmada'])noText(result,term);
      assert.deepEqual(await financial(),before);assert.equal(f.runtime.evidence().providerCalls,0);
      // Final buyer response/audit and operational tool integration are NOT
      // proved here. They remain T69/T70/T71 and their existing commerce gates.
    });
    await exercisePublicEvidenceReadLockCase(t,{f,drain});
  }finally{await worker.stop();await driver.close();}
}
