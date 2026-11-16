import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const namespace='public-business-v1',vector=Array.from({length:384},(_,i)=>i===0?1:0);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function waitForPreparation(gate){
  let timer;
  try{await Promise.race([gate.entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('native_index_prepare_not_reached')),2000);})]);}
  finally{clearTimeout(timer);}
}
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";

test('T66',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture({postgresProfile:'pgvector16'});
  let graph,driver,worker,other;
  try{
    graph=await createServiceTestNeo4j();
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
    const {PublicBusinessReconciler}=await import('../dist/modules/graph-rag/application/public-business-reconciler.js');
    const {PrismaPublicBusinessSourcePages}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-source-pages.js');
    const {PrismaPublicBusinessIndexAdapter}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-index.js');
    const {PublicBusinessProjectionService}=await import('../dist/modules/graph-rag/application/public-business-projection.service.js');
    const {ALL_GRAPH_SCHEMA_STATEMENTS}=await import('../dist/modules/graph-rag/application/graph-schema.js');
    const {PublicBusinessIndexWorker}=await import('../dist/modules/graph-rag/application/public-business-index.worker.js');
    const {GRAPH_EMBEDDING_ID}=await import('../dist/modules/graph-rag/domain/graph-embedding-model.js');
    const {projectPublicBusinessSource}=await import('../dist/modules/graph-rag/domain/public-business-source.js');
    const own=f.owner.merchant_id,foreign=f.foreign.merchant_id,tenant=new TenantContextService();
    const scoped=registerTenantMiddleware(f.prisma,tenant),sources=new PrismaPublicBusinessSources(scoped,tenant);
    const jobs=new PublicSourceWorkService(scoped,tenant,sources);
    const as=work=>tenant.run({merchantId:own,userId:f.owner.user_id,role:'system'},work);
    const read=(type,id)=>as(()=>sources.read(own,type,id));
    const latest=(type,id)=>f.prisma.publicSourceWork.findFirst({where:{merchantId:own,sourceType:type,sourceId:id,sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
    const canonical=(type,id)=>as(()=>jobs.normalizeCurrent(own,type,id));
    driver=await graph.createProjectionAdapter([own,foreign]);
    for(const statement of ALL_GRAPH_SCHEMA_STATEMENTS)await graph.query(statement);
    assert.equal((await graph.query('SHOW CONSTRAINTS YIELD name WHERE name STARTS WITH "zyon_" RETURN name')).length,8);
    let calls=0,pauseNext,afterGraph,available=true;
    const embeddings={modelId:GRAPH_EMBEDDING_ID,dimensions:384,generate:async()=>{
      calls++;if(!available)return null;
      if(pauseNext){const gate=pauseNext;pauseNext=undefined;gate.entered.resolve();await gate.release.promise;}
      return [...vector];
    }};
    const projections=new PublicBusinessProjectionService(driver,embeddings);
    const port={prepare:(...args)=>projections.prepare(...args),submit:async prepared=>{
      const result=await projections.submit(prepared);if(result.status==='applied'&&afterGraph)await afterGraph();return result;
    }};
    const admission=new PrismaPublicBusinessIndexAdapter(scoped,tenant,sources,jobs);
    worker=new PublicBusinessIndexWorker(admission,port,admission,id=>id===own);
    other=new PublicBusinessIndexWorker(admission,port,admission,id=>id===own);
    const http=businessRagWriterHttp(f.runtime);
    const mutate=async(path,body,method='PUT')=>{
      const response=await http.request(path,body,f.owner.access_token,method,{'idempotency-key':randomUUID()});
      assert.ok([200,201].includes(response.status),JSON.stringify({path,status:response.status,body:response.body}));return response.body;
    };
    const updateCompany=async description=>{
      await mutate('/merchants/me/store-settings',{company:{description}});return canonical('company',own);
    };
    const chunks=(type,id)=>f.prisma.knowledgeChunk.findMany({where:{merchantId:own,sourceType:type,sourceId:id,
      metadata:{path:['publicSourceNamespace'],equals:namespace}},orderBy:{id:'asc'}});
    const root=async(type,id)=>(await graph.query('MATCH (n:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId}) RETURN n.sourceHash AS hash,n.publicRevision AS revision,n.active AS active,n.modelId AS model',
      {merchantId:own,sourceType:type,sourceId:id}))[0];
    const drain=async()=>{
      for(let i=0;i<20;i++){const report=await as(()=>worker.runMerchant(own));assert.equal(report.failed,0,JSON.stringify(report));if(!report.claimed)return;}
      assert.fail('bounded native drain did not settle');
    };
    // This one-service merchant uses its real basic plan. Paid automatic SEO
    // is outside this indexing case and must be denied by the actual billing
    // guard before creating an unrelated model timer or provider request.
    await f.prisma.merchantBillingSubscription.upsert({where:{merchantId:own},create:{merchantId:own,planKey:'starter',status:'active'},update:{planKey:'starter',status:'active'}});
    await f.prisma.aiGovernancePolicy.create({data:{merchantId:own,grants:[],version:1,updatedBy:f.owner.user_id}});
    const privateCanary='SYNTHETIC-PRIVATE-INDEX-CANARY';
    const stored=await f.prisma.merchant.findUnique({where:{id:own}});
    await f.prisma.merchant.update({where:{id:own},data:{storeSettings:{...stored.storeSettings,privateOwnerNote:privateCanary}}});
    await mutate('/merchants/me/store-settings',{company:{description:'Public introduction with accents: atendimento e orienta\u00e7\u00e3o.',serviceNames:['Public consultation']},
      businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}]});
    const service=await mutate('/merchants/'+own+'/products',{name:'Public index consultation',description:'Public service explanation',type:'service',
      metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},
      variants:[{sku:'synthetic-public-index-service',attributes:{},basePriceInCents:5000,stockQuantity:1}]},'POST');
    let professional=await mutate('/merchants/'+own+'/service-professionals',{...f.profile,publicName:'Public index professional',productIds:[service.id]},'POST');
    // Policies use the existing premium knowledge endpoint. Upgrade the real
    // persisted entitlement after basic catalog registration; keep its actual
    // authorization instead of bypassing or overriding that controller guard.
    await f.prisma.merchantBillingSubscription.update({where:{merchantId:own},data:{planKey:'growth',status:'active'}});
    await mutate('/support/settings',{faqItems:[{id:'synthetic-public-index-faq',question:'Public question?',answer:'Public approved answer.'}]});
    await mutate('/knowledge/policies',{general:'Public appointment policy.'});
    // Match the real background lifecycle: canonical reconciliation precedes
    // indexing. Then add one explicit historical-format durable signal so the
    // opaque normalization case cannot depend on incidental HTTP row order.
    await as(()=>new PublicBusinessReconciler(new PrismaPublicBusinessSourcePages(scoped,tenant),jobs).reconcile(own));
    await f.prisma.publicSourceWork.create({data:{merchantId:own,sourceType:'company',sourceId:own,
      sourceVersion:randomUUID(),sourceHash:(await read('company',own)).sourceHash,
      publicationState:'published',createdAt:new Date(0)}});

    await t.test('RAG-01 opaque source work normalizes from canonical data before any model or graph publication',async()=>{
      const before=calls,report=await as(()=>worker.runMerchant(own,1));
      assert.equal(report.normalized,1);assert.equal(report.completed,0);assert.equal(calls,before);
      assert.ok(await latest('company',own));assert.equal(await f.prisma.publicSourceWork.count({where:{merchantId:own,sourceVersion:{not:{startsWith:'public-v1:'}},status:{not:'completed'}}}),0);
    });

    await t.test('RAG-01/04 all six actual registered public sources publish matching graph and real vector SQL provenance',async()=>{
      await drain();
      for(const [type,id]of [['company',own],['business_hours',own],['professional',professional.id],['service',service.id],['faq','synthetic-public-index-faq'],['policy','general']]){
        const source=await read(type,id),work=await latest(type,id),rows=await chunks(type,id);
        assert.equal(work.status,'completed');assert.ok(work.indexedAt);assert.equal(work.sourceHash,source.sourceHash);
        assert.equal(work.embeddingModel,GRAPH_EMBEDDING_ID);assert.equal(work.embeddingDimensions,384);
        assert.ok(rows.length);assert.equal(rows.map(row=>row.content).join(''),source.text);
        for(const row of rows){assert.equal(row.metadata.publicSourceNamespace,namespace);assert.equal(row.metadata.sourceVersion,work.sourceVersion);
          assert.equal(row.metadata.sourceHash,work.sourceHash);assert.equal(row.metadata.embeddingModel,GRAPH_EMBEDDING_ID);assert.equal(row.metadata.embeddingDimensions,384);}
        const native=await f.prisma.$queryRawUnsafe("SELECT vector_dims(embedding_vec) AS dimensions FROM knowledge_chunks WHERE merchant_id=$1 AND source_type=$2 AND source_id=$3 AND metadata->>'publicSourceNamespace'=$4",own,type,id,namespace);
        assert.ok(native.length);assert.ok(native.every(row=>row.dimensions===384));
        const published=await root(type,id);assert.equal(published.hash,source.sourceHash);assert.equal(published.active,true);assert.equal(published.model,GRAPH_EMBEDDING_ID);
      }
      assert.equal(JSON.stringify(await f.prisma.knowledgeChunk.findMany({where:{merchantId:own}})).includes(privateCanary),false);
      assert.equal(JSON.stringify(await graph.query('MATCH (n:ZyonPublicChunkV1 {merchantId:$merchantId}) RETURN properties(n) AS data',{merchantId:own})).includes(privateCanary),false);
      assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().providerCalls,0);
    });

    await t.test('RAG-02 a canonical withdrawal retires actual graph vectors and SQL chunks without another embedding',async()=>{
      const previous=await root('policy','general'),before=calls;
      await mutate('/knowledge/policies',{general:''});
      const work=await canonical('policy','general'),source=await read('policy','general');
      assert.equal(source.publicationState,'withdrawn');assert.equal(source.text,'');
      const report=await as(()=>worker.runMerchant(own,1));assert.equal(report.completed,1);assert.equal(calls,before);
      const retired=await root('policy','general');assert.equal(retired.active,false);assert.equal(retired.hash,source.sourceHash);
      assert.ok(retired.revision>previous.revision);assert.deepEqual(await chunks('policy','general'),[]);
      const nodes=await graph.query('MATCH (n:ZyonPublicChunkV1 {merchantId:$merchantId,sourceType:"policy",sourceId:"general"}) RETURN n.active AS active,n.embedding AS embedding,n.normalizedText AS text',{merchantId:own});
      assert.ok(nodes.length);assert.ok(nodes.every(node=>node.active===false&&node.embedding===null&&node.text===null));
      const completed=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});
      assert.equal(completed.status,'completed');assert.ok(completed.indexedAt);assert.equal(completed.sourceHash,source.sourceHash);
    });

    await t.test('RAG-01 duplicate and out-of-order graph revisions cannot replace a newer public source',async()=>{
      const source=projectPublicBusinessSource(own,{merchantId:own,sourceId:'synthetic-projection-order-only',sourceType:'policy',sourceVersion:'projection-only-fixture',
        publicationState:'published',row:{title:'Public fixture',content:'Public projection ordering fixture'}});
      const work=await latest('company',own),prepared=await projections.prepare(source,work.sourceVersion);
      assert.equal(prepared.status,'prepared');const original=await root('company',own);
      // A separately named projection-only fixture never claims canonical SQL
      // indexing or consumes another source's actual work counter.
      const fixture=prepared.projection;
      assert.equal((await projections.submit(fixture)).status,'applied');
      const newer={...fixture,publicRevision:fixture.publicRevision+1,sourceHash:'b'.repeat(64)};
      assert.equal((await projections.submit(newer)).status,'applied');assert.equal((await projections.submit(fixture)).status,'ignored');
      assert.equal((await root('policy',fixture.sourceId)).hash,newer.sourceHash);
      assert.deepEqual(await root('company',own),original);
    });

    await t.test('RAG-01 competing workers cannot share a live lease and an expired original owner cannot acknowledge its successor',async()=>{
      await updateCompany('Public competing lease revision');
      const gate={entered:defer(),release:defer()};pauseNext=gate;
      const pending=as(()=>worker.runMerchant(own,1));void pending.catch(()=>{});
      try{
        await waitForPreparation(gate);const held=await latest('company',own);assert.equal(held.status,'processing');
        assert.equal((await as(()=>other.runMerchant(own,1))).claimed,0);
        await f.prisma.$executeRaw`UPDATE public_source_work SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=${held.id}`;
        const successor=await as(()=>other.runMerchant(own,1));assert.equal(successor.completed,1);
        const settled=await f.prisma.publicSourceWork.findUnique({where:{id:held.id}});assert.equal(settled.attempts,2);
        gate.release.resolve();assert.equal((await pending).leaseLost,1);
        assert.deepEqual(await f.prisma.publicSourceWork.findUnique({where:{id:held.id}}),settled);
        assert.equal((await root('company',own)).hash,(await read('company',own)).sourceHash);
      }finally{gate.release.resolve();await Promise.allSettled([pending]);}
    });

    await t.test('RAG-02 a real source save during model preparation commits and prevents old prepared evidence from publishing',async()=>{
      await updateCompany('Public prepared source A');const old=await read('company',own);
      const gate={entered:defer(),release:defer()};pauseNext=gate;
      const pending=as(()=>worker.runMerchant(own,1));void pending.catch(()=>{});
      try{
        await waitForPreparation(gate);
        await mutate('/merchants/me/store-settings',{company:{description:'Public current source B'}});
        gate.release.resolve();assert.equal((await pending).superseded,1);
        assert.notEqual((await root('company',own)).hash,old.sourceHash);assert.deepEqual(await chunks('company',own),[]);
        await drain();assert.equal((await root('company',own)).hash,(await read('company',own)).sourceHash);
      }finally{gate.release.resolve();await Promise.allSettled([pending]);}
    });

    await t.test('RAG-02 changing A to B and back to A during preparation still supersedes the original claim',async()=>{
      const work=await updateCompany('Public prepared ABA A'),source=await read('company',own);
      const gate={entered:defer(),release:defer()};pauseNext=gate;
      const pending=as(()=>worker.runMerchant(own,1));void pending.catch(()=>{});
      try{
        await waitForPreparation(gate);
        await mutate('/merchants/me/store-settings',{company:{description:'Public prepared ABA B'}});
        await mutate('/merchants/me/store-settings',{company:{description:'Public prepared ABA A'}});
        assert.equal((await read('company',own)).sourceHash,source.sourceHash);
        assert.ok(await f.prisma.publicSourceWork.count({where:{merchantId:own,sourceType:'company',sourceId:own,
          sourceVersion:{not:{startsWith:'public-v1:'}},status:{not:'completed'}}}));
        gate.release.resolve();assert.equal((await pending).superseded,1);
        const original=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});
        assert.equal(original.status,'completed');assert.equal(original.lastErrorCode,'source_superseded');assert.equal(original.indexedAt,null);
        const replacement=await latest('company',own);
        assert.ok(replacement.sourceVersion>work.sourceVersion);assert.equal(replacement.sourceHash,source.sourceHash);
        assert.deepEqual(await chunks('company',own),[]);
        assert.notEqual((await root('company',own)).hash,source.sourceHash);
        await drain();
        assert.equal((await latest('company',own)).status,'completed');
        assert.equal((await root('company',own)).hash,source.sourceHash);
        assert.deepEqual(await f.prisma.publicSourceWork.findUnique({where:{id:work.id}}),original);
      }finally{gate.release.resolve();await Promise.allSettled([pending]);}
    });

    await t.test('RAG-03 SQL failure after graph commit remains retryable and exact duplicate recovery publishes only one SQL revision',async()=>{
      const work=await updateCompany('Public recoverable graph commit'),name='synthetic_index_insert_reject',probe=name+'_reached';
      await f.runtime.db.sql(`CREATE SEQUENCE ${probe}; CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id=${sql(own)} AND NEW.metadata->>'publicSourceNamespace'=${sql(namespace)} THEN PERFORM nextval('${probe}'); RAISE EXCEPTION 'synthetic_index_SQL_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${name}();`);
      try{
        const report=await as(()=>worker.runMerchant(own,1));assert.equal(report.failed,1);
        assert.equal(Number(await f.runtime.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${probe}`)),1);
        const failed=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});assert.equal(failed.status,'failed');assert.equal(failed.lastErrorCode,'canonical_unavailable');assert.equal(failed.indexedAt,null);
        assert.equal((await root('company',own)).hash,(await read('company',own)).sourceHash);assert.deepEqual(await chunks('company',own),[]);
      }finally{await f.runtime.db.sql(`DROP TRIGGER ${name} ON knowledge_chunks; DROP FUNCTION ${name}(); DROP SEQUENCE ${probe};`);}
      await f.prisma.$executeRaw`UPDATE public_source_work SET next_attempt_at=clock_timestamp() WHERE id=${work.id}`;
      const recovered=await as(()=>worker.runMerchant(own,1));assert.equal(recovered.completed,1);
      const done=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});assert.equal(done.sourceVersion,work.sourceVersion);assert.equal(done.attempts,2);assert.equal(done.status,'completed');
      assert.equal((await chunks('company',own)).length,1);
    });

    await t.test('RAG-04 unavailable embeddings and wrong model ABI cannot become completed public evidence',async()=>{
      let work=await updateCompany('Public unavailable model');available=false;
      try{assert.equal((await as(()=>worker.runMerchant(own,1))).failed,1);}finally{available=true;}
      let row=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});assert.equal(row.lastErrorCode,'embedding_unavailable');assert.equal(row.indexedAt,null);
      await f.prisma.$executeRaw`UPDATE public_source_work SET next_attempt_at=clock_timestamp() WHERE id=${work.id}`;await drain();
      work=await updateCompany('Public wrong ABI');const claim=await as(()=>admission.claimNext(own)),source=await read('company',own),prepared=await projections.prepare(source,claim.sourceVersion);
      let submitted=false;
      await assert.rejects(as(()=>admission.commit(claim,source,{...prepared.projection,modelId:'different-model-same-384'},async()=>{submitted=true;})),/invalid_source/);
      assert.equal(submitted,false);row=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});assert.equal(row.status,'processing');assert.equal(row.indexedAt,null);assert.deepEqual(await chunks('company',own),[]);
      await as(()=>admission.failConditional(claim,'invalid_source'));
      await f.prisma.$executeRaw`UPDATE public_source_work SET next_attempt_at=clock_timestamp() WHERE id=${work.id}`;await drain();
    });

    await t.test('RAG-01 lease expiry after an actual graph commit rolls back SQL publication and cannot acknowledge completion',async()=>{
      const work=await updateCompany('Public lease expiry after graph');
      const claim=await as(()=>admission.claimNext(own)),loaded=await as(()=>admission.loadSnapshot(claim)),prepared=await projections.prepare(loaded.source,claim.sourceVersion);
      await f.prisma.$executeRaw`UPDATE public_source_work SET lease_expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=${work.id}`;
      let graphApplied=false;
      const outcome=as(()=>admission.commit(claim,loaded.source,prepared.projection,async()=>{
        assert.equal((await projections.submit(prepared.projection)).status,'applied');graphApplied=true;
        const deadline=Date.now()+2000;let expired=false;
        do{expired=(await f.prisma.$queryRaw`SELECT lease_expires_at<clock_timestamp() AS expired FROM public_source_work WHERE id=${work.id}`)[0].expired;}while(!expired&&Date.now()<deadline);
        assert.equal(expired,true);
      }));
      assert.equal(await outcome,'lease_lost');assert.equal(graphApplied,true);
      const row=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});assert.equal(row.status,'processing');assert.equal(row.indexedAt,null);assert.deepEqual(await chunks('company',own),[]);
      await drain();assert.equal((await latest('company',own)).status,'completed');
    });

    await t.test('RAG-01 a lease expiring during the exact merchant lock wait cannot use the transaction start time',async()=>{
      const work=await updateCompany('Public lease across lock wait'),claim=await as(()=>admission.claimNext(own));
      const loaded=await as(()=>admission.loadSnapshot(claim)),prepared=await projections.prepare(loaded.source,claim.sourceVersion);
      const ready=defer(),release=defer();let blocker,submitted=false;
      const holder=f.prisma.$transaction(async tx=>{
        blocker=(await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR NO KEY UPDATE`;
        ready.resolve();await release.promise;
      });void holder.catch(ready.reject);
      let pending,waiting=false,expired=false,aliveWhileWaiting=false,transactionBeforeExpiry=false;
      try{
        await ready.promise;
        pending=as(()=>admission.commit(claim,loaded.source,prepared.projection,async()=>{submitted=true;}));void pending.catch(()=>{});
        const deadline=Date.now()+2000;
        do{waiting=Number(await f.runtime.db.sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ${blocker}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND position('merchants' in query)>0 AND position('FOR UPDATE' in upper(query))>0`))>0;}while(!waiting&&Date.now()<deadline);
        if(waiting){
          // Arm expiry only AFTER the actual admitted transaction is waiting.
          // A transaction-start clock would still see this lease as live.
          await f.prisma.$executeRaw`UPDATE public_source_work SET lease_expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=${work.id}`;
          const observed=(await f.prisma.$queryRaw`SELECT w.lease_expires_at>clock_timestamp() AS alive,
            EXISTS(SELECT 1 FROM pg_stat_activity a WHERE ${blocker}=ANY(pg_blocking_pids(a.pid))
              AND a.wait_event_type='Lock' AND a.xact_start<w.lease_expires_at
              AND position('merchants' in a.query)>0 AND position('FOR UPDATE' in upper(a.query))>0) AS started_before
            FROM public_source_work w WHERE w.id=${work.id}`)[0];
          aliveWhileWaiting=observed.alive;transactionBeforeExpiry=observed.started_before;
        }
        do{expired=(await f.prisma.$queryRaw`SELECT lease_expires_at<clock_timestamp() AS expired FROM public_source_work WHERE id=${work.id}`)[0].expired;}while(!expired&&Date.now()<deadline);
      }finally{release.resolve();await Promise.allSettled([holder,...(pending?[pending]:[])]);}
      await holder;assert.equal(waiting,true);assert.equal(aliveWhileWaiting,true);assert.equal(transactionBeforeExpiry,true);
      assert.equal(expired,true);assert.equal(await pending,'lease_lost');assert.equal(submitted,false);
      const row=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});assert.equal(row.status,'processing');assert.equal(row.indexedAt,null);assert.deepEqual(await chunks('company',own),[]);
      await drain();assert.equal((await latest('company',own)).status,'completed');
    });

    await t.test('RAG-07 foreign scope is rejected before queue access and another merchant graph or SQL is untouched',async()=>{
      const before=await f.prisma.publicSourceWork.findMany({where:{merchantId:own},orderBy:{id:'asc'}});
      await assert.rejects(tenant.run({merchantId:foreign,userId:f.foreign.user_id,role:'system'},()=>admission.claimNext(own)),/scope/);
      assert.deepEqual(await f.prisma.publicSourceWork.findMany({where:{merchantId:own},orderBy:{id:'asc'}}),before);
      assert.equal((await graph.query('MATCH (n:ZyonPublicSourceV1 {merchantId:$merchantId}) RETURN count(n) AS count',{merchantId:foreign}))[0].count.toNumber(),0);
      // Preserve the original empty-foreign oracle above, then make the next
      // own publication prove that existing foreign data also survives. The
      // source ID intentionally overlaps the own policy being republished.
      const foreignSource=projectPublicBusinessSource(foreign,{merchantId:foreign,sourceId:'general',sourceType:'policy',
        sourceVersion:'synthetic-foreign-fixture',publicationState:'published',
        row:{title:'Foreign public fixture',content:'Synthetic foreign policy must remain unchanged.'}});
      const foreignVersion='public-v1:00000000000000000001';
      const preparedForeign=await projections.prepare(foreignSource,foreignVersion);
      assert.equal(preparedForeign.status,'prepared');assert.equal((await projections.submit(preparedForeign.projection)).status,'applied');
      const foreignChunk=await f.prisma.knowledgeChunk.create({data:{merchantId:foreign,sourceType:'policy',sourceId:'general',
        content:foreignSource.text,embedding:JSON.stringify(vector),metadata:{publicSourceNamespace:namespace,
          sourceVersion:foreignVersion,sourceHash:foreignSource.sourceHash,embeddingModel:GRAPH_EMBEDDING_ID,embeddingDimensions:384}}});
      await f.prisma.$executeRaw`UPDATE knowledge_chunks SET embedding_vec=${JSON.stringify(vector)}::vector(384)
        WHERE id=${foreignChunk.id} AND merchant_id=${foreign}`;
      const foreignWork=await f.prisma.publicSourceWork.create({data:{merchantId:foreign,sourceType:'policy',sourceId:'general',
        sourceVersion:foreignVersion,sourceHash:foreignSource.sourceHash,publicationState:'published',createdAt:new Date(0)}});
      const foreignSnapshot=async()=>({
        chunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId:foreign},orderBy:{id:'asc'}}),
        vectors:await f.prisma.$queryRaw`SELECT id,embedding_vec::text AS vector FROM knowledge_chunks WHERE merchant_id=${foreign} ORDER BY id`,
        work:await f.prisma.publicSourceWork.findMany({where:{merchantId:foreign},orderBy:{id:'asc'}}),
        roots:await graph.query('MATCH (n:ZyonPublicSourceV1 {merchantId:$merchantId}) RETURN properties(n) AS data ORDER BY n.sourceType,n.sourceId',{merchantId:foreign}),
        graphChunks:await graph.query('MATCH (n:ZyonPublicChunkV1 {merchantId:$merchantId}) RETURN properties(n) AS data ORDER BY n.sourceType,n.sourceId,n.chunkId',{merchantId:foreign}),
        edges:await graph.query('MATCH (a)-[r:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(b) RETURN a.merchantId AS owner,a.sourceType AS sourceType,a.sourceId AS sourceId,b.merchantId AS chunkOwner,b.chunkId AS chunkId,properties(r) AS data ORDER BY sourceType,sourceId,chunkId',{merchantId:foreign})
      });
      const foreignBefore=await foreignSnapshot();
      assert.equal(foreignBefore.roots.length,1);assert.equal(foreignBefore.graphChunks.length,1);assert.equal(foreignBefore.edges.length,1);
      assert.ok(foreignBefore.chunks.some(row=>row.id===foreignChunk.id));
      assert.ok(foreignBefore.vectors.some(row=>row.id===foreignChunk.id));
      assert.ok(foreignBefore.work.some(row=>row.id===foreignWork.id&&row.status==='pending'));
      await mutate('/knowledge/policies',{general:'Public own policy republished beside a foreign policy with the same ID.'});
      await canonical('policy','general');await drain();
      assert.equal((await root('policy','general')).hash,(await read('policy','general')).sourceHash);
      assert.deepEqual(await foreignSnapshot(),foreignBefore);
      assert.equal(f.runtime.evidence().providerCalls,0);
    });
    await t.test('RAG-03 an unavailable actual graph adapter retains retryable work and cannot block a source registration',async()=>{
      const published=await root('company',own);
      await driver.close();
      const work=await updateCompany('Public source saved while graph is unavailable');
      const report=await as(()=>worker.runMerchant(own,1));assert.equal(report.failed,1);
      const failed=await f.prisma.publicSourceWork.findUnique({where:{id:work.id}});
      assert.equal(failed.status,'failed');assert.equal(failed.lastErrorCode,'graph_unavailable');assert.equal(failed.indexedAt,null);
      assert.deepEqual(await chunks('company',own),[]);assert.deepEqual(await root('company',own),published);
      assert.equal((await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings.company.description,
        'Public source saved while graph is unavailable');
      const next=await updateCompany('Public later source saved during the same graph outage');
      assert.ok(next.sourceVersion>work.sourceVersion);assert.equal(next.status,'pending');
      assert.deepEqual(await f.prisma.publicSourceWork.findUnique({where:{id:work.id}}),failed);
      assert.equal(f.runtime.evidence().providerCalls,0);
    });
  }catch(error){
    console.error('T66 primary failure',JSON.stringify({name:String(error?.name??'Error').slice(0,80),
      frames:String(error?.stack??'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,12)}));throw error;
  }finally{
    if(worker)await worker.stop();if(other)await other.stop();
    try{if(graph)await graph.dispose();}finally{await f.close();}
  }
});
