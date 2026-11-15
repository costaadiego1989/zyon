import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)).digest('hex');

// External preparation only. Caller supplies its existing real AppModule/DB
// fixture and invokes this once before that fixture's finally/close.
export async function exerciseCategoryFanoutCases(t,f){
  await t.test('RAG-11 an ordinary category PUT atomically refreshes 1005 existing service identities',async()=>{
    const {projectPublicBusinessSource,withdrawnPublicBusinessSource}=await import('../dist/modules/graph-rag/domain/public-business-source.js');
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const prefix='synthetic-category-fanout-'+randomUUID(),at=new Date('2026-01-01T00:00:00Z');
    const actor=await f.register('services',prefix),foreign=await f.register('services',prefix+'-foreign');
    const merchantId=actor.merchant_id,foreignId=foreign.merchant_id,categoryId=prefix+'-category';
    const oldName='Existing public category',newName='Renamed public category';
    const ids=Array.from({length:1005},(_,index)=>prefix+'-service-'+String(index).padStart(4,'0'));
    const unrelated=prefix+'-unrelated',allIds=[...ids,unrelated],initialVersion='public-v1:00000000000000000001';
    const metadata={serviceType:'presencial',serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}};
    const category={merchantId,id:categoryId,name:oldName,isActive:true};
    const project=(id,name=oldName)=>projectPublicBusinessSource(merchantId,{merchantId,sourceType:'service',sourceId:id,
      sourceVersion:'synthetic-named-history',publicationState:'published',row:{name:'Existing service '+id,description:'Public service introduction',
        type:'service',isActive:true,deletedAt:null,metadata,category:id===unrelated?null:{...category,name},professionals:[]}});
    const tenant=new TenantContextService(),reader=new PrismaPublicBusinessSources(registerTenantMiddleware(f.prisma,tenant),tenant);
    const read=id=>tenant.run({merchantId,userId:actor.user_id,role:'owner'},()=>reader.read(merchantId,'service',id));
    const http=companyHttpFixture(f.runtime),functionName='synthetic_cat_fanout_'+randomUUID().replaceAll('-','');
    const sequence=functionName+'_seq';let diagnosticInstalled=false;
    try{
      const merchant=await f.prisma.merchant.findUnique({where:{id:merchantId}});
      assert.equal(merchant.businessMode,'services');assert.ok(merchant.businessModeSelectedAt);assert.equal(merchant.businessModeNeedsReview,false);
      await f.prisma.productCategory.create({data:{...category,slug:prefix,createdAt:at,updatedAt:at}});
      for(let offset=0;offset<allIds.length;offset+=250){
        const batch=allIds.slice(offset,offset+250);
        await f.prisma.product.createMany({data:batch.map(id=>({id,merchantId,name:'Existing service '+id,description:'Public service introduction',
          type:'service',metadata,isActive:true,categoryId:id===unrelated?null:categoryId,createdAt:at,updatedAt:at}))});
        await f.prisma.productVariant.createMany({data:batch.map(id=>({id:id+'-variant',productId:id,sku:id,isActive:true,attributes:{},createdAt:at,updatedAt:at}))});
        await f.prisma.publicSourceWork.createMany({data:batch.map(id=>({merchantId,sourceType:'service',sourceId:id,sourceVersion:initialVersion,
          sourceHash:project(id).sourceHash,publicationState:'published',status:'completed',indexedAt:at,
          embeddingModel:'synthetic-history-only-no-inference',embeddingDimensions:384}))});
        await f.prisma.knowledgeChunk.createMany({data:batch.map(id=>({id:id+'-old-chunk',merchantId,sourceType:'service',sourceId:id,
          content:project(id).text,embedding:'[]',metadata:{sourceHash:project(id).sourceHash,sourceVersion:initialVersion}}))});
      }
      await f.prisma.knowledgeChunk.create({data:{id:prefix+'-foreign-chunk',merchantId:foreignId,sourceType:'service',sourceId:ids[0],
        content:'Foreign named historical public chunk',embedding:'[]'}});
      assert.equal(await f.prisma.product.count({where:{merchantId,categoryId,type:'service'}}),1005);
      assert.equal((await read(ids[0])).sourceHash,project(ids[0]).sourceHash);
      const snapshot=async()=>({
        merchant:await f.prisma.merchant.findUnique({where:{id:merchantId}}),
        admission:await f.prisma.serviceBusinessPolicy.findUnique({where:{merchantId}}),
        publicPolicy:await f.prisma.merchantPolicy.findUnique({where:{merchantId}}),
        payments:await f.prisma.paymentIntent.findMany({where:{merchantId},orderBy:{id:'asc'}}),
        appointments:await f.prisma.serviceAppointment.findMany({where:{merchantId},orderBy:{id:'asc'}}),
        checkouts:await f.prisma.checkoutSession.findMany({where:{merchantId},orderBy:{id:'asc'}}),
        categories:await f.prisma.productCategory.findMany({where:{merchantId},orderBy:{id:'asc'}}),
        products:await f.prisma.product.findMany({where:{merchantId},orderBy:{id:'asc'},include:{variants:{orderBy:{id:'asc'}}}}),
        work:await f.prisma.publicSourceWork.findMany({where:{merchantId},orderBy:{id:'asc'}}),
        chunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId},orderBy:{id:'asc'}}),
        foreignChunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId:foreignId},orderBy:{id:'asc'}}),
      });
      const before=await snapshot(),history=before.work,baselineIds=new Set(history.map(row=>row.id));
      await f.runtime.db.sql(`CREATE SEQUENCE ${sequence}; CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id=${sqlText(merchantId)} AND NEW.source_type::text='service' THEN PERFORM nextval('${sequence}'); END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} AFTER INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION ${functionName}();`);
      diagnosticInstalled=true;
      const correlationId=randomUUID(),path='/merchants/'+merchantId+'/categories/'+categoryId,started=Date.now();
      let settled=false,maxObservedTransactionMs=0,observedBackends=new Set();
      const request=http.request(path,{name:newName},actor.access_token,'PUT',{'idempotency-key':prefix,'x-correlation-id':correlationId})
        .finally(()=>{settled=true;});
      request.catch(()=>{});let response;
      // Observe the existing deadline; do not set or renew any transaction/HTTP
      // timeout, insert artificial sleeps in its TX, or inject a failure.
      try{
        while(!settled){
          const rows=await f.prisma.$queryRawUnsafe(`SELECT pid,extract(epoch FROM(clock_timestamp()-xact_start))*1000 AS age
            FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL
            AND xact_start>=to_timestamp($1::double precision/1000)
            AND (query LIKE '%public_source_work%' OR query LIKE '%product_categories%')`,started);
          for(const row of rows){observedBackends.add(row.pid);maxObservedTransactionMs=Math.max(maxObservedTransactionMs,Number(row.age));}
          if(!settled)await pause(100);
        }
      }finally{response=await request;}
      const durationMs=Date.now()-started;
      const attempted=Number(await f.runtime.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${sequence}`));
      t.diagnostic(JSON.stringify({kind:'category_fanout_observation',existingServices:1005,httpStatus:response.status,httpDurationMs:durationMs,
        attemptedSourceRows:attempted,maxObservedTransactionMs,observedBackends:[...observedBackends],transactionTimeoutChanged:false}));
      const deadline=Date.now()+5000;let audit;
      do{audit=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId,correlationId}});}while(!audit&&Date.now()<deadline);
      assert.ok(audit,'the actual category HTTP audit must settle before cleanup');assert.equal(audit.actorId,actor.user_id);
      assert.equal(audit.action,'http.put');assert.equal(audit.metadata.statusCode,response.status);
      assert.equal(audit.outcome,response.status<400?'success':'failed');
      const after=await snapshot();
      if(response.status!==200){
        assert.ok(attempted>0,'a failure before source work was attempted is not evidence of the proposed fanout failure');
        assert.equal(digest(after),digest(before),'category/source/work/chunk/finance state must roll back completely');
        assert.equal((await read(ids[0])).sourceHash,project(ids[0]).sourceHash);
      }
      assert.equal(response.status,200,'RAG-11 normal category editing must commit all public source changes within its unchanged transaction budget');
      assert.equal(after.categories.find(row=>row.id===categoryId).name,newName);
      assert.equal(digest(after.products),digest(before.products));assert.equal(digest(after.merchant),digest(before.merchant));
      assert.equal(digest(after.admission),digest(before.admission));assert.equal(digest(after.publicPolicy),digest(before.publicPolicy));
      assert.equal(digest(after.payments),digest(before.payments));assert.equal(digest(after.appointments),digest(before.appointments));
      assert.equal(digest(after.checkouts),digest(before.checkouts));
      assert.equal(digest(after.foreignChunks),digest(before.foreignChunks));
      assert.equal(digest(after.work.filter(row=>baselineIds.has(row.id))),digest(history),'completed history never reopens');
      assert.equal(after.chunks.filter(row=>ids.includes(row.sourceId)&&row.sourceType==='service').length,0);
      assert.equal(digest(after.chunks),digest(before.chunks.filter(row=>row.sourceId===unrelated)),'unrelated service representation survives');
      const newWork=after.work.filter(row=>!baselineIds.has(row.id));
      assert.equal(newWork.length,1005);assert.equal(new Set(newWork.map(row=>row.sourceId)).size,1005);
      for(const row of newWork){
        assert.equal(row.merchantId,merchantId);assert.equal(row.sourceType,'service');assert.ok(ids.includes(row.sourceId));
        assert.equal(row.status,'pending');assert.equal(row.leaseToken,null);assert.match(row.sourceHash,/^[a-f0-9]{64}$/);
        if(row.sourceVersion.startsWith('public-v1:')){
          assert.equal(row.sourceVersion,'public-v1:00000000000000000002');
          assert.equal(row.sourceHash,project(row.sourceId,newName).sourceHash);assert.equal(row.publicationState,'published');
        }else{
          // Existing64 contract: an opaque marker is durable dirty identity,
          // never indexed evidence;66 must normalize it before preparation.
          assert.ok(row.sourceVersion.trim());assert.equal(row.publicationState,'withdrawn');
          assert.equal(row.sourceHash,withdrawnPublicBusinessSource(merchantId,'service',row.sourceId,row.sourceVersion).sourceHash);
        }
      }
      for(const id of [ids[0],ids.at(-1)]){
        const current=await read(id);assert.equal(current.publicData.category.name,newName);assert.equal(current.sourceHash,project(id,newName).sourceHash);
      }
      // A timestamp-only save must not create another public revision or erase
      // valid rebuilt representations, even on this large batch path.
      const rebuilt=await f.prisma.knowledgeChunk.create({data:{merchantId,sourceType:'service',sourceId:ids[0],
        content:project(ids[0],newName).text,embedding:'[]',metadata:{sourceHash:project(ids[0],newName).sourceHash}}});
      const workBeforeReplay=await f.prisma.publicSourceWork.findMany({where:{merchantId},orderBy:{id:'asc'}});
      const replayCorrelation=randomUUID();
      const replay=await http.request(path,{name:newName},actor.access_token,'PUT',{'idempotency-key':randomUUID(),'x-correlation-id':replayCorrelation});
      assert.equal(replay.status,200);
      const replayDeadline=Date.now()+5000;let replayAudit;
      do{replayAudit=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId,correlationId:replayCorrelation}});}while(!replayAudit&&Date.now()<replayDeadline);
      assert.ok(replayAudit);assert.equal(replayAudit.actorId,actor.user_id);assert.equal(replayAudit.metadata.statusCode,200);
      assert.equal(digest(await f.prisma.publicSourceWork.findMany({where:{merchantId},orderBy:{id:'asc'}})),digest(workBeforeReplay));
      assert.deepEqual(await f.prisma.knowledgeChunk.findUnique({where:{id:rebuilt.id}}),rebuilt);
    }finally{
      if(diagnosticInstalled)await f.runtime.db.sql(`DROP TRIGGER ${functionName} ON public_source_work; DROP FUNCTION ${functionName}(); DROP SEQUENCE ${sequence};`);
      await f.prisma.knowledgeChunk.deleteMany({where:{merchantId:{in:[merchantId,foreignId]}}});
      await f.prisma.publicSourceWork.deleteMany({where:{merchantId}});
      await f.prisma.productVariant.deleteMany({where:{productId:{in:allIds}}});
      await f.prisma.product.deleteMany({where:{merchantId,id:{in:allIds}}});
      await f.prisma.productCategory.deleteMany({where:{id:categoryId,merchantId}});
    }
  });
}
