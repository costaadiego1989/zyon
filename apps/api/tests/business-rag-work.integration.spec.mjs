import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';
import {insert,at,baselineSnapshot} from './service-migration-fixture.mjs';

test('T64',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});let prisma;
  try{
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
    const {publicWorkSequence}=await import('../dist/modules/graph-rag/application/public-source-work-state.js');
    const tenant=new TenantContextService(),scoped=registerTenantMiddleware(prisma,tenant),sources=new PrismaPublicBusinessSources(scoped,tenant),jobs=new PublicSourceWorkService(scoped,tenant,sources);
    const {register,request}=companyHttpFixture(runtime),auth=await register('synthetic-private-queue@example.test'),other=await register('synthetic-private-other@example.test','products');
    const own=auth.merchant_id,foreign=other.merchant_id;
    const as=(merchantId,work)=>tenant.run({merchantId,userId:'synthetic-public-worker',role:'system'},work);
    const normalize=()=>as(own,()=>jobs.normalizeCurrent(own,'company',own));
    const claim=()=>as(own,()=>jobs.claimNext(own));
    const ref=job=>({merchantId:job.merchantId,id:job.id,leaseToken:job.leaseToken});
    let key=0;
    const put=async(description,path='/merchants/me/store-settings')=>{
      const headers=path==='/settings/store'?{'if-match':(await request(path,undefined,auth.access_token,'GET')).headers.get('etag'),'idempotency-key':'synthetic-rag-'+(++key)}:{};
      const response=await request(path,{company:{description}},auth.access_token,'PUT',headers);assert.equal(response.status,200);return response;
    };
    await runtime.db.sql([
      insert('merchants',{id:'base-products',name:'Preserved product business',updated_at:at}),
      insert('products',{id:'base-physical',merchant_id:'base-products',name:'Preserved product',updated_at:at}),
      insert('product_variants',{id:'base-physical-variant',product_id:'base-physical',sku:'preserved',updated_at:at}),
      insert('product_prices',{id:'base-price',variant_id:'base-physical-variant',base_price_in_cents:10999,updated_at:at}),
      insert('product_stock',{id:'base-stock',variant_id:'base-physical-variant',quantity:9,reserved:2,updated_at:at}),
      insert('storefront_carts',{id:'base-cart',merchant_id:'base-products',session_id:'base-cart-ref',items:[{sku:'preserved',quantity:2,unitPriceCents:10999}],total:21998,updated_at:at,expires_at:'2031-01-01T00:00:00Z'})
    ].join('\n'));
    const commerce=await baselineSnapshot(runtime.db),row=()=>prisma.merchant.findUnique({where:{id:own}});
    const snapshot=async()=>({merchant:await row(),work:await prisma.publicSourceWork.findMany({where:{merchantId:own},orderBy:{id:'asc'}}),chunks:await prisma.knowledgeChunk.findMany({where:{merchantId:own},orderBy:{id:'asc'}})});
    const protectedChunk=await prisma.knowledgeChunk.create({data:{merchantId:foreign,sourceType:'company',sourceId:foreign,content:'Other public tenant',embedding:'[]'}});
    let canonical;
    await t.test('RAG-11 actual three settings writers persist durable signals with indexing offline',async()=>{
      for(const path of ['/merchants/me/store-settings','/merchants/'+own+'/store-settings','/settings/store'])await put('Public source '+path,path);
      const work=await prisma.publicSourceWork.findMany({where:{merchantId:own}});
      assert.equal(work.length,3);assert.ok(work.every(item=>item.status==='pending'&&!item.sourceVersion.startsWith('public-v1:')));
      assert.ok(work.every(item=>item.sourceType==='company'&&item.sourceId===own&&item.merchantId===own));
      assert.equal((await row()).storeSettings.company.description,'Public source /settings/store');
      assert.equal(JSON.stringify(work).includes('synthetic-private-queue@example.test'),false);
      const source=await as(own,()=>sources.read(own,'company',own));
      assert.ok(work.every(item=>item.sourceHash!==source.sourceHash),'Legacy company-only hashes must not be mistaken for the full canonical projection');
    });
    await t.test('RAG-01 legacy signal normalizes explicitly from the current source with scoped invalidation',async()=>{
      const old=await claim();assert.ok(old&&!old.sourceVersion.startsWith('public-v1:'));
      await prisma.knowledgeChunk.create({data:{merchantId:own,sourceType:'company',sourceId:own,content:'Stale public text',embedding:'[]'}});
      canonical=await normalize();assert.equal(publicWorkSequence(canonical.sourceVersion),1);assert.equal(canonical.status,'pending');
      const source=await as(own,()=>sources.read(own,'company',own));assert.equal(canonical.sourceHash,source.sourceHash);
      const legacy=await prisma.publicSourceWork.findMany({where:{merchantId:own,sourceVersion:{not:{startsWith:'public-v1:'}}}});
      assert.equal(legacy.length,3);assert.ok(legacy.every(item=>item.status==='completed'&&item.lastErrorCode==='legacy_superseded'&&item.leaseToken===null));
      assert.equal(await as(own,()=>jobs.complete(ref(old))),false);
      assert.equal(await prisma.knowledgeChunk.count({where:{merchantId:own,sourceType:'company',sourceId:own}}),0);
      assert.deepEqual(await prisma.knowledgeChunk.findUnique({where:{id:protectedChunk.id}}),protectedChunk);
    });
    await t.test('RAG-01 unchanged public content and private timestamp churn preserve work and retry state',async()=>{
      const source=await row();await prisma.merchant.update({where:{id:own},data:{storeSettings:{...source.storeSettings,privateCredentials:{token:'SYNTHETIC-PRIVATE-CANARY'}}}});
      assert.deepEqual(await normalize(),canonical);assert.deepEqual(await normalize(),canonical);
      assert.equal(await prisma.publicSourceWork.count({where:{merchantId:own,sourceVersion:{startsWith:'public-v1:'}}}),1);
      assert.equal(JSON.stringify(canonical).includes('SYNTHETIC-PRIVATE-CANARY'),false);
    });
    await t.test('RAG-11 source work and invalidation roll back together inside the actual SQL transaction',async()=>{
      const before=await snapshot();
      await assert.rejects(as(own,()=>scoped.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR UPDATE`;
        const current=await tx.merchant.findUnique({where:{id:own}});
        await tx.merchant.update({where:{id:own},data:{storeSettings:{...current.storeSettings,company:{...current.storeSettings.company,description:'Must roll back'}}}});
        const source=await sources.readWithin(tx,own,'company',own);await jobs.enqueueWithin(tx,own,source);
        throw new Error('synthetic_failure_after_work');
      })),/synthetic_failure_after_work/);
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('RAG-11 a failed normalization never undoes an already committed valid source signal',async()=>{
      await put('Source saved while index preparation fails');
      const before=await snapshot();
      await runtime.db.sql("CREATE FUNCTION synthetic_queue_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_version LIKE 'public-v1:%' THEN RAISE EXCEPTION 'synthetic_queue_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_queue_failure BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION synthetic_queue_failure();");
      try{await assert.rejects(normalize(),/synthetic_queue_failure/);assert.deepEqual(await snapshot(),before);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_queue_failure ON public_source_work; DROP FUNCTION synthetic_queue_failure();');}
      assert.equal((await row()).storeSettings.company.description,'Source saved while index preparation fails');
      canonical=await normalize();assert.equal(publicWorkSequence(canonical.sourceVersion),2);
    });
    await t.test('RAG-01 A-to-B-to-A creates another revision and does not reopen completed work',async()=>{
      for(let index=0;index<20;index++){
        const pending=await claim();if(!pending)break;
        assert.equal(await as(own,()=>jobs.complete(ref(pending),undefined,true)),true);
        assert.ok(index<19,'Fixture queue drain must be bounded');
      }
      await put('Public A');const a=await normalize();const first=await claim();assert.equal(first.id,a.id);
      assert.equal(await as(own,()=>jobs.complete(ref(first),{model:'synthetic-model',dimensions:384})),true);
      await put('Public B');const b=await normalize();
      await put('Public A');canonical=await normalize();
      assert.equal(canonical.sourceHash,a.sourceHash);assert.notEqual(canonical.id,a.id);
      assert.equal(publicWorkSequence(canonical.sourceVersion),publicWorkSequence(b.sourceVersion)+1);
      const original=await prisma.publicSourceWork.findUnique({where:{id:a.id}});assert.equal(original.status,'completed');assert.equal(original.embeddingModel,'synthetic-model');
      const superseded=await claim();assert.equal(superseded.id,b.id);assert.equal(await as(own,()=>jobs.complete(ref(superseded),undefined,true)),true);
    });
    await t.test('RAG-01 concurrent workers acquire only one current lease using database time',async()=>{
      const before=JSON.parse(await runtime.db.sql('SELECT to_json(clock_timestamp())'));
      const results=await Promise.all([claim(),claim(),claim()]);const claimed=results.filter(Boolean);assert.equal(claimed.length,1);
      canonical=claimed[0];assert.equal(canonical.attempts,1);assert.ok(canonical.leaseToken);
      assert.ok(canonical.leaseExpiresAt.getTime()>new Date(before).getTime()+29000);
      assert.equal(await claim(),null);
    });
    await t.test('RAG-01 expired leases are reclaimed and stale owners cannot complete or fail them',async()=>{
      const old=ref(canonical);await runtime.db.sql(`UPDATE public_source_work SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${sqlText(canonical.id)}`);
      assert.equal(await as(own,()=>jobs.complete(old)),false);canonical=await claim();assert.equal(canonical.id,old.id);assert.equal(canonical.attempts,2);assert.notEqual(canonical.leaseToken,old.leaseToken);
      const before=await prisma.publicSourceWork.findUnique({where:{id:canonical.id}});
      assert.equal(await as(own,()=>jobs.complete(old)),false);assert.equal(await as(own,()=>jobs.fail(old,'graph_unavailable')),false);
      await assert.rejects(as(foreign,()=>jobs.complete(ref(canonical))),/public_work_scope_mismatch/);
      await assert.rejects(as(own,()=>jobs.complete(ref(canonical),{model:'synthetic',dimensions:0})),/public_work_completion_invalid/);
      assert.deepEqual(await prisma.publicSourceWork.findUnique({where:{id:canonical.id}}),before);
    });
    await t.test('RAG-03 bounded retry keeps a fixed safe error code and observes due time',async()=>{
      assert.equal(await as(own,()=>jobs.fail(ref(canonical),'graph_unavailable')),true);
      const failed=await prisma.publicSourceWork.findUnique({where:{id:canonical.id}});assert.equal(failed.status,'failed');assert.equal(failed.lastErrorCode,'graph_unavailable');
      assert.equal(failed.leaseToken,null);assert.ok(failed.nextAttemptAt>failed.updatedAt);
      assert.ok(failed.nextAttemptAt.getTime()-failed.updatedAt.getTime()<=300000,'Persisted retry delay stays bounded');
      // Due-state selection is tested against an explicit database deadline,
      // independently of how quickly this pressure-tested host executes reads.
      await runtime.db.sql(`UPDATE public_source_work SET next_attempt_at=clock_timestamp()+interval '1 hour' WHERE id=${sqlText(canonical.id)}`);
      assert.equal(await claim(),null);
      await runtime.db.sql(`UPDATE public_source_work SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=${sqlText(canonical.id)}`);
      canonical=await claim();assert.equal(canonical.attempts,3);
      assert.equal(await as(own,()=>jobs.complete(ref(canonical),{model:'synthetic-model',dimensions:384})),true);
      const complete=await prisma.publicSourceWork.findUnique({where:{id:canonical.id}});assert.equal(complete.status,'completed');assert.ok(complete.indexedAt);assert.equal(complete.embeddingDimensions,384);assert.equal(complete.nextAttemptAt,null);
      assert.equal(await as(own,()=>jobs.fail(ref(canonical),'canonical_unavailable')),false);assert.equal(await claim(),null);
    });
    await t.test('RAG-01 offline A-to-B-to-A signals require a new revision even when the current hash matches',async()=>{
      const indexed=await prisma.publicSourceWork.findUnique({where:{id:canonical.id}});assert.equal(indexed.status,'completed');
      await prisma.knowledgeChunk.create({data:{merchantId:own,sourceType:'company',sourceId:own,content:'Public A',embedding:'[]',metadata:{sourceVersion:indexed.sourceVersion,sourceHash:indexed.sourceHash}}});
      await put('Public B while worker is offline');await put('Public A');
      assert.equal(await prisma.knowledgeChunk.count({where:{merchantId:own,sourceType:'company',sourceId:own}}),0,'Actual writers invalidate the old corpus even when later edits restore its text');
      const fresh=await normalize();assert.notEqual(fresh.id,indexed.id);assert.equal(fresh.sourceHash,indexed.sourceHash);
      assert.equal(publicWorkSequence(fresh.sourceVersion),publicWorkSequence(indexed.sourceVersion)+1);assert.equal(fresh.status,'pending');
      assert.deepEqual(await prisma.publicSourceWork.findUnique({where:{id:indexed.id}}),indexed,'A completed revision is never reopened');
      assert.equal(await prisma.publicSourceWork.count({where:{merchantId:own,sourceVersion:{not:{startsWith:'public-v1:'}},status:{not:'completed'}}}),0,'Every observed legacy signal was normalized');
      assert.deepEqual(await normalize(),fresh,'Without another signal the newly queued work is stable');
    });
    await t.test('RAG-07 queue ownership and product snapshots remain isolated',async()=>{
      await assert.rejects(jobs.claimNext(own),/public_work_scope_mismatch/);
      await assert.rejects(async()=>as(foreign,()=>jobs.normalizeCurrent(own,'company',own)),/public_work_scope_mismatch/);
      assert.deepEqual(await prisma.knowledgeChunk.findUnique({where:{id:protectedChunk.id}}),protectedChunk);
      assert.deepEqual(await baselineSnapshot(runtime.db),commerce);
      assert.equal(runtime.evidence().providerCalls,0);assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().authOverrides,false);
    });
  }finally{if(prisma)await prisma.$disconnect();await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
