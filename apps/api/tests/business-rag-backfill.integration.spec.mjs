import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

// DRAFT: no native execution during preparation. One new root, no filters/skips.
const namespace='public-business-v1';
const vector=Array.from({length:384},(_,index)=>index===0?1:0);
const revision=value=>'public-v1:'+String(value).padStart(20,'0');
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
const stable=value=>JSON.parse(JSON.stringify(value));

test('T67',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture({postgresProfile:'pgvector16'});
  let graph,driver,worker,actual;
  try{
    const {PrismaClient}=await import('@prisma/client');
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const {PrismaPublicBusinessSourcePages}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-source-pages.js');
    const {PublicBusinessReconciler}=await import('../dist/modules/graph-rag/application/public-business-reconciler.js');
    const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
    const {PrismaPublicBusinessIndexAdapter}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-index.js');
    const {PublicBusinessProjectionService}=await import('../dist/modules/graph-rag/application/public-business-projection.service.js');
    const {PublicBusinessIndexWorker}=await import('../dist/modules/graph-rag/application/public-business-index.worker.js');
    const {ALL_GRAPH_SCHEMA_STATEMENTS}=await import('../dist/modules/graph-rag/application/graph-schema.js');
    const {GRAPH_EMBEDDING_ID}=await import('../dist/modules/graph-rag/domain/graph-embedding-model.js');
    const {withdrawnPublicBusinessSource}=await import('../dist/modules/graph-rag/domain/public-business-source.js');
    const tenant=new TenantContextService(),queryEvents=[];
    actual=new PrismaClient({datasources:{db:{url:f.runtime.db.prismaUrl}},log:[{emit:'event',level:'query'}]});
    actual.$on('query',event=>queryEvents.push(event.query));
    const scoped=registerTenantMiddleware(actual,tenant),sources=new PrismaPublicBusinessSources(scoped,tenant);
    const pages=new PrismaPublicBusinessSourcePages(scoped,tenant),jobs=new PublicSourceWorkService(scoped,tenant,sources);
    const reconciler=new PublicBusinessReconciler(pages,jobs),own=f.owner.merchant_id,foreign=f.foreign.merchant_id;
    const as=(merchantId,work)=>tenant.run({merchantId,userId:'synthetic-backfill-system',role:'system'},work);
    const read=(merchantId,type,id)=>as(merchantId,()=>sources.read(merchantId,type,id));
    const reconcile=(merchantId,instance=reconciler,stopping)=>as(merchantId,()=>instance.reconcile(merchantId,stopping));
    const latest=(merchantId,type,id)=>actual.publicSourceWork.findFirst({where:{merchantId,sourceType:type,sourceId:id,
      sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
    const rows=(merchantId,type)=>actual.publicSourceWork.findMany({where:{merchantId,...(type?{sourceType:type}:{}),
      sourceVersion:{startsWith:'public-v1:'}},orderBy:[{sourceType:'asc'},{sourceId:'asc'},{sourceVersion:'asc'}]});
    const chunks=(merchantId,type,id)=>actual.knowledgeChunk.findMany({where:{merchantId,sourceType:type,sourceId:id},orderBy:{id:'asc'}});
    const chunk=async(merchantId,type,id,content,metadata={})=>actual.knowledgeChunk.create({data:{id:'synthetic-backfill-chunk-'+randomUUID(),
      merchantId,sourceType:type,sourceId:id,content,embedding:JSON.stringify(vector),metadata}});
    const snapshot=async merchantId=>stable({merchant:await actual.merchant.findUnique({where:{id:merchantId}}),
      policy:await actual.merchantPolicy.findUnique({where:{merchantId}}),work:await rows(merchantId),
      professionals:await actual.serviceProfessional.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      products:await actual.product.findMany({where:{merchantId},include:{variants:{orderBy:{id:'asc'}}},orderBy:{id:'asc'}}),
      professionalServices:await actual.professionalService.findMany({where:{merchantId},orderBy:[{professionalId:'asc'},{productId:'asc'}]}),
      supportSetting:await actual.supportSetting.findUnique({where:{merchantId}}),
      chunks:await actual.knowledgeChunk.findMany({where:{merchantId},orderBy:{id:'asc'}})});
    const contexts=[];
    for(const [slug,category]of [['clinic','Neurology'],['salon','Beauty'],['consulting','Consulting']]){
      const merchantId='synthetic-backfill-'+slug,privateCanary='PRIVATE-SYNTHETIC-BACKFILL-'+slug;
      await actual.merchant.create({data:{id:merchantId,name:'Synthetic '+slug,storeCategory:category,businessMode:'services',
        businessModeSelectedAt:new Date(),businessModeNeedsReview:false,storeSettings:{company:{description:'Public '+slug+' introduction',
          serviceNames:['Public '+slug+' orientation'],phone:'+5521999990000'},
          businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}],credentials:{token:privateCanary},privateOwnerNote:privateCanary}}});
      await actual.merchantUser.create({data:{id:merchantId+'-owner',merchantId,email:privateCanary+'@example.test',passwordHash:privateCanary,role:'owner'}});
      const serviceId=merchantId+'-service',professionalId=merchantId+'-professional';
      await actual.product.create({data:{id:serviceId,merchantId,name:'Public '+slug+' service',description:'Public existing service',type:'service',
        metadata:{serviceType:'presencial',privateNote:privateCanary},variants:{create:{sku:merchantId+'-sku'}}}});
      await actual.serviceProfessional.create({data:{id:professionalId,merchantId,publicName:'Public '+slug+' professional',isPublished:true,
        timeZone:'America/Sao_Paulo',publicProfile:{description:'Public existing biography',specialties:[category],privateNotes:privateCanary}}});
      await actual.professionalService.create({data:{merchantId,professionalId,productId:serviceId}});
      await actual.supportSetting.create({data:{merchantId,faqItems:[{id:'existing-faq',question:'Public '+slug+' question?',answer:'Public '+slug+' answer.'}]}});
      await actual.merchantPolicy.create({data:{merchantId,general:'Public '+slug+' policy.'}});
      contexts.push({merchantId,serviceId,professionalId,privateCanary});
    }

    await t.test('RAG-03 actual AppModule HTTP and owned SQL are available without an external provider',async()=>{
      const health=await fetch(f.runtime.apiOrigin+'/health',{redirect:'error',signal:AbortSignal.timeout(15_000)});
      assert.equal(health.status,200);
      const ready=await fetch(f.runtime.apiOrigin+'/ready',{redirect:'error',signal:AbortSignal.timeout(15_000)});
      assert.equal(ready.status,200);
      assert.equal((await actual.$queryRaw`SELECT current_database() AS name`).length,1);
      assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().repositoryOverrides,false);
      assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().providerCalls,0);
    });

    await t.test('RAG-01/10/11 existing clinic salon and consulting data backfill all six canonical public families',async()=>{
      for(const context of contexts){
        const {merchantId,serviceId,professionalId,privateCanary}=context;
        assert.deepEqual(await rows(merchantId),[]);
        await reconcile(merchantId);
        for(const [type,id]of [['company',merchantId],['business_hours',merchantId],['professional',professionalId],['service',serviceId],['faq','existing-faq'],['policy','general']]){
          const source=await read(merchantId,type,id),work=await latest(merchantId,type,id);
          assert.equal(source.publicationState,'published');assert.equal(work.status,'pending');assert.equal(work.sourceVersion,revision(1));
          assert.equal(work.sourceHash,source.sourceHash);assert.equal(work.publicationState,source.publicationState);assert.equal(work.indexedAt,null);
          assert.equal(JSON.stringify(source.publicData).includes(privateCanary),false);assert.equal(source.text.includes(privateCanary),false);
        }
        assert.equal(JSON.stringify(await rows(merchantId)).includes(privateCanary),false);
      }
    });

    const professionalIds=Array.from({length:251},(_,index)=>'synthetic-backfill-page-'+String(index).padStart(3,'0'));
    await actual.serviceProfessional.createMany({data:professionalIds.map(id=>({id,merchantId:own,publicName:'Public page '+id,
      timeZone:'UTC',isPublished:true,publicProfile:{description:'Public existing page biography'}}))});
    await t.test('RAG-03 reconciliation processes at most two pages of 100 with set reads rather than N plus one loading',async()=>{
      const offset=queryEvents.length;
      await reconcile(own);
      const current=await rows(own,'professional');assert.equal(current.length,200);
      assert.deepEqual(current.map(row=>row.sourceId),professionalIds.slice(0,200));assert.ok(current.every(row=>row.sourceVersion===revision(1)));
      assert.equal(await latest(own,'professional',professionalIds[200]),null);
      const queries=queryEvents.slice(offset);
      // Actual driver query events on the real DB, not an adapter query spy.
      const canonicalReads=queries.filter(query=>query.includes('service_professionals')&&query.includes('public_profile')&&query.includes(' IN '));
      assert.equal(canonicalReads.length,2,'one set-based canonical professional read per committed page');
      assert.ok(queries.length<100,'two bounded pages must not open 200 source transactions');
      await reconcile(own);assert.equal((await rows(own,'professional')).length,251);
      assert.ok((await rows(own,'professional')).every(row=>row.sourceVersion===revision(1)));
    });

    await t.test('RAG-03 restart replay preserves exact canonical versions and untouched chunks',async()=>{
      const id=professionalIds[250];await chunk(own,'professional',id,'Synthetic unchanged chunk');
      const before=await snapshot(own);
      const restarted=new PublicBusinessReconciler(new PrismaPublicBusinessSourcePages(scoped,tenant),new PublicSourceWorkService(scoped,tenant,sources));
      await reconcile(own,restarted);await reconcile(own,restarted);
      assert.deepEqual(await snapshot(own),before);
    });

    await t.test('RAG-03 failed page rolls back all rows and retry does not advance its cursor',async()=>{
      const merchantId=contexts[0].merchantId,ids=Array.from({length:100},(_,index)=>'synthetic-failed-page-'+String(index).padStart(3,'0'));
      await actual.serviceProfessional.createMany({data:ids.map(id=>({id,merchantId,publicName:'Public rollback '+id,timeZone:'UTC',isPublished:true}))});
      const before=await snapshot(merchantId),name='synthetic_backfill_page_failure',probe=name+'_reached';
      await f.runtime.db.sql(`CREATE SEQUENCE ${probe}; CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id=${sql(merchantId)} AND NEW.source_type='professional' AND NEW.source_id LIKE 'synthetic-failed-page-%' THEN IF nextval('${probe}')=2 THEN RAISE EXCEPTION 'synthetic_page_rollback'; END IF; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION ${name}();`);
      const instance=new PublicBusinessReconciler(pages,jobs);
      try{
        await assert.rejects(reconcile(merchantId,instance),/synthetic_page_rollback/);
        assert.equal(Number(await f.runtime.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${probe}`)),2);
        assert.deepEqual(await snapshot(merchantId),before);
      }finally{await f.runtime.db.sql(`DROP TRIGGER ${name} ON public_source_work; DROP FUNCTION ${name}(); DROP SEQUENCE ${probe};`);}
      await reconcile(merchantId,instance);
      for(const id of ids){const work=await latest(merchantId,'professional',id);assert.equal(work.sourceVersion,revision(1));assert.equal(work.status,'pending');}
      assert.equal((await rows(merchantId,'professional')).length,101);
    });

    await t.test('RAG-03 stop after a committed page resumes its durable content without duplicate revisions',async()=>{
      const merchantId=contexts[1].merchantId,ids=Array.from({length:105},(_,index)=>'synthetic-stop-page-'+String(index).padStart(3,'0'));
      await actual.serviceProfessional.createMany({data:ids.map(id=>({id,merchantId,publicName:'Public stop '+id,timeZone:'UTC',isPublished:true}))});
      let stopping=false;
      const realPage={normalizeCurrentPage:async(...args)=>{await jobs.normalizeCurrentPage(...args);if(args[1]==='professional')stopping=true;}};
      const instance=new PublicBusinessReconciler(pages,realPage);
      await reconcile(merchantId,instance,()=>stopping);
      assert.equal((await rows(merchantId,'professional')).filter(row=>ids.includes(row.sourceId)).length,99);
      // The existing profession sorts first. Stop does not advance the just
      // committed page; replaying it is safe before the remaining six IDs.
      stopping=false;await reconcile(merchantId,instance,()=>false);
      for(const id of ids)assert.equal((await latest(merchantId,'professional',id)).sourceVersion,revision(1));
    });

    const retired={merchantId:contexts[2].merchantId,professionalId:'synthetic-retired-professional',serviceId:'synthetic-retired-service',faqId:'synthetic-retired-faq'};
    await t.test('RAG-02 missing historical identities receive scoped tombstones without reading a foreign same-ID source',async()=>{
      const {merchantId,professionalId,serviceId,faqId}=retired;
      await actual.serviceProfessional.create({data:{id:professionalId,merchantId,publicName:'Public subsequently deleted professional',timeZone:'UTC',isPublished:true}});
      await actual.product.create({data:{id:serviceId,merchantId,name:'Public subsequently deleted service',type:'service',variants:{create:{sku:serviceId+'-original-sku'}}}});
      const setting=await actual.supportSetting.findUnique({where:{merchantId}});
      await actual.supportSetting.update({where:{merchantId},data:{faqItems:[...setting.faqItems,{id:faqId,question:'Public subsequently deleted question?',answer:'Public subsequently deleted answer.'}]}});
      for(const [type,id]of [['professional',professionalId],['service',serviceId],['faq',faqId]]){
        const original=await read(merchantId,type,id);assert.equal(original.publicationState,'published');
        await actual.publicSourceWork.create({data:{merchantId,sourceType:type,sourceId:id,sourceVersion:revision(4),sourceHash:original.sourceHash,publicationState:'published',status:'completed',indexedAt:new Date(),embeddingModel:GRAPH_EMBEDDING_ID,embeddingDimensions:384}});
        await chunk(merchantId,type,id,original.text);
      }
      await actual.serviceProfessional.delete({where:{id:professionalId}});await actual.product.delete({where:{id:serviceId}});
      await actual.supportSetting.update({where:{merchantId},data:{faqItems:setting.faqItems}});
      await actual.serviceProfessional.create({data:{id:professionalId,merchantId:foreign,publicName:'Foreign private professional',timeZone:'UTC',isPublished:true}});
      await actual.product.create({data:{id:serviceId,merchantId:foreign,name:'Foreign private service',type:'service',variants:{create:{sku:serviceId+'-foreign-sku'}}}});
      const foreignBefore=await snapshot(foreign);
      await reconcile(merchantId,new PublicBusinessReconciler(pages,jobs));
      for(const [type,id]of [['professional',professionalId],['service',serviceId],['faq',faqId]]){
        const work=await latest(merchantId,type,id),expected=withdrawnPublicBusinessSource(merchantId,type,id,'missing-source');
        assert.equal(await read(merchantId,type,id),null);assert.equal(work.sourceVersion,revision(5));assert.equal(work.status,'pending');
        assert.equal(work.publicationState,'withdrawn');assert.equal(work.sourceHash,expected.sourceHash);assert.deepEqual(await chunks(merchantId,type,id),[]);
      }
      assert.deepEqual(await snapshot(foreign),foreignBefore);
    });

    await t.test('RAG-02 legacy aggregate FAQ chunks are excluded from discovery while a real FAQ with that ID remains public',async()=>{
      const merchantId=contexts[1].merchantId;
      await chunk(merchantId,'faq','faq-collection','Synthetic legacy FAQ collection');
      const before=await chunks(merchantId,'faq','faq-collection');
      await reconcile(merchantId,new PublicBusinessReconciler(pages,jobs));
      assert.equal(await latest(merchantId,'faq','faq-collection'),null);assert.deepEqual(await chunks(merchantId,'faq','faq-collection'),before);
      const setting=await actual.supportSetting.findUnique({where:{merchantId}});
      await actual.supportSetting.update({where:{merchantId},data:{faqItems:[...setting.faqItems,{id:'faq-collection',question:'Public actual item?',answer:'Public individual answer.'}]}});
      await reconcile(merchantId,new PublicBusinessReconciler(pages,jobs));
      const source=await read(merchantId,'faq','faq-collection'),work=await latest(merchantId,'faq','faq-collection');
      assert.equal(source.publicationState,'published');assert.equal(work.sourceHash,source.sourceHash);assert.equal(work.sourceVersion,revision(1));
      assert.deepEqual(await chunks(merchantId,'faq','faq-collection'),[]);
    });

    const indexMerchant=contexts[2].merchantId;
    const graphRoot=async(type,id)=>(await graph.query('MATCH (n:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId}) RETURN n.sourceHash AS hash,n.publicRevision AS revision,n.active AS active,n.modelId AS model',
      {merchantId:indexMerchant,sourceType:type,sourceId:id}))[0];
    const drain=async()=>{
      for(let attempt=0;attempt<30;attempt++){
        const report=await as(indexMerchant,()=>worker.runMerchant(indexMerchant));assert.equal(report.failed,0,JSON.stringify(report));
        if(!report.claimed)return;
      }
      assert.fail('bounded test drain did not settle');
    };
    await t.test('RAG-03 worker offline preserves canonical sources and pending work then real graph SQL publication catches up',async()=>{
      const before=await actual.merchant.findUnique({where:{id:indexMerchant}}),pending=await rows(indexMerchant);
      assert.ok(pending.some(row=>row.status==='pending'));assert.ok(pending.filter(row=>row.status==='pending').every(row=>row.indexedAt===null));
      graph=await createServiceTestNeo4j();driver=await graph.createProjectionAdapter([indexMerchant]);
      for(const statement of ALL_GRAPH_SCHEMA_STATEMENTS)await graph.query(statement);
      const projection=new PublicBusinessProjectionService(driver,{modelId:GRAPH_EMBEDDING_ID,dimensions:384,generate:async()=>[...vector]});
      const admission=new PrismaPublicBusinessIndexAdapter(scoped,tenant,sources,jobs);
      worker=new PublicBusinessIndexWorker(admission,projection,admission,id=>id===indexMerchant);
      await drain();
      assert.deepEqual(await actual.merchant.findUnique({where:{id:indexMerchant}}),before);
      for(const [type,id]of [['company',indexMerchant],['business_hours',indexMerchant],['professional',contexts[2].professionalId],['service',contexts[2].serviceId],['faq','existing-faq'],['policy','general']]){
        const source=await read(indexMerchant,type,id),work=await latest(indexMerchant,type,id),stored=await chunks(indexMerchant,type,id);
        assert.equal(work.status,'completed');assert.equal(work.sourceHash,source.sourceHash);assert.equal(work.embeddingModel,GRAPH_EMBEDDING_ID);
        assert.equal(stored.map(row=>row.content).join(''),source.text);assert.ok(stored.every(row=>row.metadata.publicSourceNamespace===namespace));
        assert.equal((await graphRoot(type,id)).hash,source.sourceHash);assert.equal((await graphRoot(type,id)).active,true);
      }
    });

    await t.test('RAG-02 offline unpublish delete and FAQ removal invalidate SQL and later retire graph without restoring text',async()=>{
      const context=contexts[2],merchantId=context.merchantId;
      const profile=await actual.serviceProfessional.findUnique({where:{id:context.professionalId}});
      await actual.serviceProfessional.update({where:{id:context.professionalId},data:{isPublished:false,version:{increment:1}}});
      await actual.product.update({where:{id:context.serviceId},data:{deletedAt:new Date(),isActive:false}});
      await actual.supportSetting.update({where:{merchantId},data:{faqItems:[]}});
      await reconcile(merchantId,new PublicBusinessReconciler(pages,jobs));
      for(const [type,id]of [['professional',context.professionalId],['service',context.serviceId],['faq','existing-faq']]){
        const work=await latest(merchantId,type,id);assert.equal(work.publicationState,'withdrawn');assert.equal(work.status,'pending');
        assert.deepEqual(await chunks(merchantId,type,id),[]);
      }
      assert.equal((await actual.serviceProfessional.findUnique({where:{id:context.professionalId}})).publicName,profile.publicName);
      await drain();
      for(const [type,id]of [['professional',context.professionalId],['service',context.serviceId],['faq','existing-faq']]){
        assert.equal((await latest(merchantId,type,id)).status,'completed');assert.deepEqual(await chunks(merchantId,type,id),[]);
        const root=await graphRoot(type,id);assert.equal(root.active,false);
        const active=await graph.query('MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$type,sourceId:$id})-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(c:ZyonPublicChunkV1 {merchantId:$merchantId}) WHERE c.active=true RETURN c.text AS text',
          {merchantId,type,id});assert.deepEqual(active,[]);
      }
    });

    await t.test('RAG-02/10 recreate the same public FAQ ID advances after tombstone and contains only its new text',async()=>{
      const merchantId=indexMerchant,before=await latest(merchantId,'faq','existing-faq');
      await actual.supportSetting.update({where:{merchantId},data:{faqItems:[{id:'existing-faq',question:'Public recreated consulting question?',answer:'Public new answer after recreation.'}]}});
      await reconcile(merchantId,new PublicBusinessReconciler(pages,jobs));
      const pending=await latest(merchantId,'faq','existing-faq');assert.ok(pending.sourceVersion>before.sourceVersion);assert.equal(pending.status,'pending');
      assert.equal(pending.publicationState,'published');assert.deepEqual(await chunks(merchantId,'faq','existing-faq'),[]);
      await drain();const current=await read(merchantId,'faq','existing-faq'),stored=await chunks(merchantId,'faq','existing-faq');
      assert.equal(stored.map(row=>row.content).join(''),current.text);assert.ok(current.text.includes('Public new answer after recreation.'));
      assert.equal(current.text.includes('Public consulting answer.'),false);
      assert.equal((await graphRoot('faq','existing-faq')).hash,current.sourceHash);
      assert.deepEqual(await actual.publicSourceWork.findUnique({where:{id:before.id}}),before);
    });

    await t.test('RAG-03/04 completed old ABI creates one new revision and real worker publishes only the current ABI',async()=>{
      for(const [type,id,oldModel,oldDimensions]of [['company',indexMerchant,'different-public-model-same-384',384],['policy','general',GRAPH_EMBEDDING_ID,128]]){
        const before=await latest(indexMerchant,type,id);
        await actual.publicSourceWork.update({where:{id:before.id},data:{embeddingModel:oldModel,embeddingDimensions:oldDimensions}});
        await actual.knowledgeChunk.updateMany({where:{merchantId:indexMerchant,sourceType:type,sourceId:id},data:{metadata:{publicSourceNamespace:namespace,
          sourceHash:before.sourceHash,sourceVersion:before.sourceVersion,embeddingModel:oldModel,embeddingDimensions:oldDimensions}}});
        const old=await actual.publicSourceWork.findUnique({where:{id:before.id}});
        await reconcile(indexMerchant,new PublicBusinessReconciler(pages,jobs));
        const pending=await latest(indexMerchant,type,id);assert.ok(pending.sourceVersion>before.sourceVersion);assert.equal(pending.sourceHash,before.sourceHash);
        assert.equal(pending.status,'pending');assert.deepEqual(await chunks(indexMerchant,type,id),[]);
        await reconcile(indexMerchant,new PublicBusinessReconciler(pages,jobs));assert.deepEqual(await latest(indexMerchant,type,id),pending);
        assert.deepEqual(await actual.publicSourceWork.findUnique({where:{id:old.id}}),old);
        await drain();const done=await latest(indexMerchant,type,id);assert.equal(done.id,pending.id);assert.equal(done.status,'completed');
        assert.equal(done.embeddingModel,GRAPH_EMBEDDING_ID);assert.equal(done.embeddingDimensions,384);
        assert.ok((await chunks(indexMerchant,type,id)).every(row=>row.metadata.embeddingModel===GRAPH_EMBEDDING_ID&&row.metadata.embeddingDimensions===384));
        const healthy=await snapshot(indexMerchant);await reconcile(indexMerchant,new PublicBusinessReconciler(pages,jobs));assert.deepEqual(await snapshot(indexMerchant),healthy);
      }
    });

    await t.test('RAG-03/04 public model reindex preserves healthy legacy model content and vectors for the same source',async()=>{
      const merchantId=indexMerchant,type='faq',id='existing-faq',before=await latest(merchantId,type,id);
      const publicRows=()=>actual.knowledgeChunk.findMany({where:{merchantId,sourceType:type,sourceId:id,
        metadata:{path:['publicSourceNamespace'],equals:namespace}},orderBy:{id:'asc'}});
      assert.ok((await publicRows()).length);
      const source=await read(merchantId,type,id);
      const legacy=await chunk(merchantId,type,id,source.text,{legacyModel:'synthetic-distinct-384-space',sourceHash:source.sourceHash});
      await actual.$executeRaw`UPDATE knowledge_chunks SET embedding_vec=${JSON.stringify(vector)}::vector(384)
        WHERE id=${legacy.id} AND merchant_id=${merchantId}`;
      const legacyVector=await actual.$queryRaw`SELECT embedding_vec::text AS vector FROM knowledge_chunks WHERE id=${legacy.id} AND merchant_id=${merchantId}`;
      assert.equal(legacyVector.length,1);assert.ok(legacyVector[0].vector);
      await actual.publicSourceWork.update({where:{id:before.id},data:{embeddingModel:'synthetic-previous-public-model',embeddingDimensions:384}});
      const history=await actual.publicSourceWork.findUnique({where:{id:before.id}});
      await reconcile(merchantId,new PublicBusinessReconciler(pages,jobs));
      const pending=await latest(merchantId,type,id);assert.ok(pending.sourceVersion>before.sourceVersion);assert.equal(pending.sourceHash,before.sourceHash);
      assert.deepEqual(await publicRows(),[]);
      assert.deepEqual(await actual.knowledgeChunk.findUnique({where:{id:legacy.id}}),legacy);
      assert.deepEqual(await actual.$queryRaw`SELECT embedding_vec::text AS vector FROM knowledge_chunks WHERE id=${legacy.id} AND merchant_id=${merchantId}`,legacyVector);
      assert.deepEqual(await actual.publicSourceWork.findUnique({where:{id:before.id}}),history);
      await drain();
      const refreshed=await publicRows();assert.ok(refreshed.length);
      assert.ok(refreshed.every(row=>row.metadata.embeddingModel===GRAPH_EMBEDDING_ID&&row.metadata.embeddingDimensions===384));
      assert.equal((await latest(merchantId,type,id)).status,'completed');
      assert.deepEqual(await actual.knowledgeChunk.findUnique({where:{id:legacy.id}}),legacy);
      assert.deepEqual(await actual.$queryRaw`SELECT embedding_vec::text AS vector FROM knowledge_chunks WHERE id=${legacy.id} AND merchant_id=${merchantId}`,legacyVector);
    });

    await t.test('RAG-02/07 tenant and invalid page guards preserve work chunks canonical data and product commerce',async()=>{
      const before=await snapshot(own),foreignBefore=await snapshot(foreign);
      const productsBefore=stable({merchant:await actual.merchant.findUnique({where:{id:f.products.merchant_id}}),
        products:await actual.product.findMany({where:{merchantId:f.products.merchant_id},orderBy:{id:'asc'}})});
      await assert.rejects(as(own,()=>new PublicBusinessReconciler(pages,jobs).reconcile(foreign)),/public_source_foreign_tenant/);
      await assert.rejects(as(own,async()=>jobs.normalizeCurrentPage(foreign,'company',[foreign])),/public_work_scope_mismatch/);
      for(const ids of [[''],['same','same'],Array.from({length:101},(_,index)=>'oversized-'+index)])
        await assert.rejects(as(own,async()=>jobs.normalizeCurrentPage(own,'professional',ids)),/public_reconciliation_page_invalid/);
      assert.deepEqual(await snapshot(own),before);assert.deepEqual(await snapshot(foreign),foreignBefore);
      assert.deepEqual(stable({merchant:await actual.merchant.findUnique({where:{id:f.products.merchant_id}}),
        products:await actual.product.findMany({where:{merchantId:f.products.merchant_id},orderBy:{id:'asc'}})}),productsBefore);
      assert.equal(f.runtime.evidence().providerCalls,0);
    });
  }finally{
    try{if(worker)await worker.stop();}
    finally{try{if(graph)await graph.dispose();}finally{try{if(actual)await actual.$disconnect();}finally{await f.close();}}}
  }
});
