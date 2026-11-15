import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const version=value=>'public-v1:'+String(value).padStart(20,'0');
const hash=value=>createHash('sha256').update(value).digest('hex');
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
const digest=value=>hash(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item));

test('T65 mixed batch PG',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const {enqueuePublicSourceProjections}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
    const own=f.owner.merchantId,foreign=f.foreign.merchantId,at=new Date('2026-01-01T00:00:00Z');
    const source=(sourceId,sourceHash,merchantId=own)=>({merchantId,sourceType:'service',sourceId,sourceHash,publicationState:'published'});
    const sources=[source('synthetic-mixed-A',hash('A')),source('synthetic-mixed-B',hash('B')),source('synthetic-mixed-C',hash('C-new'))];
    const seed=async(merchantId,sourceId,sequence,sourceHash,extra={})=>f.raw.publicSourceWork.create({data:{merchantId,
      sourceType:'service',sourceId,sourceVersion:typeof sequence==='number'?version(sequence):sequence,sourceHash,
      publicationState:'published',status:'completed',indexedAt:at,embeddingModel:'synthetic-history-only',embeddingDimensions:384,...extra}});
    const chunk=async(merchantId,sourceId,label)=>f.raw.knowledgeChunk.create({data:{merchantId,sourceType:'service',sourceId,
      content:'Named synthetic public representation '+label,embedding:'[]',metadata:{fixture:'existing-public-representation'}}});
    const snapshot=async()=>({
      merchants:await f.raw.merchant.findMany({where:{id:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      publicPolicies:await f.raw.merchantPolicy.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      admissionPolicies:await f.raw.serviceBusinessPolicy.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{merchantId:'asc'}}),
      products:await f.raw.product.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'},include:{variants:{orderBy:{id:'asc'}}}}),
      professionals:await f.raw.serviceProfessional.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      links:await f.raw.professionalService.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      appointments:await f.raw.serviceAppointment.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      payments:await f.raw.paymentIntent.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      checkouts:await f.raw.checkoutSession.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      work:await f.raw.publicSourceWork.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
      chunks:await f.raw.knowledgeChunk.findMany({where:{merchantId:{in:[own,foreign]}},orderBy:{id:'asc'}}),
    });
    const apply=inputs=>f.as(f.owner,()=>f.scoped.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR UPDATE`;
      await enqueuePublicSourceProjections(tx,own,inputs);
    }));
    const rewriteWithin=async(tx,label)=>{
      const row=await tx.merchant.findUnique({where:{id:own},select:{storeSettings:true}});
      const settings=row.storeSettings??{};
      await tx.merchant.update({where:{id:own},data:{storeSettings:{...settings,company:{...settings.company,description:label}}}});
      await tx.merchantPolicy.upsert({where:{merchantId:own},create:{merchantId:own,general:label},update:{general:label}});
    };

    await t.test('RAG-01/11 equal changed and legacy identities retain independent counters histories chunks and tenant scope',async()=>{
      const initial=[];
      initial.push(await seed(own,sources[0].sourceId,7,sources[0].sourceHash));
      initial.push(await seed(own,sources[1].sourceId,8,hash('B-old-history')));
      initial.push(await seed(own,sources[1].sourceId,9,sources[1].sourceHash));
      initial.push(await seed(own,sources[2].sourceId,1,hash('C-older-history')));
      initial.push(await seed(own,sources[2].sourceId,2,hash('C-old')));
      const completedLegacy=await seed(own,sources[1].sourceId,'legacy-already-completed',hash('historical-B'));
      const pendingB=await seed(own,sources[1].sourceId,'legacy-pending-B',sources[1].sourceHash,
        {status:'pending',indexedAt:null,embeddingModel:null,embeddingDimensions:null});
      const unrelatedLegacy=await seed(own,'synthetic-mixed-unrelated','legacy-unrelated-pending',hash('unrelated'),
        {status:'pending',indexedAt:null,embeddingModel:null,embeddingDimensions:null});
      for(const input of sources){
        await chunk(own,input.sourceId,'own-'+input.sourceId);
        await seed(foreign,input.sourceId,30,hash('foreign-'+input.sourceId));
        await chunk(foreign,input.sourceId,'foreign-'+input.sourceId);
      }
      const foreignPending=await seed(foreign,sources[1].sourceId,'legacy-pending-B',hash('foreign-pending'),
        {status:'pending',indexedAt:null,embeddingModel:null,embeddingDimensions:null});
      const before=await snapshot(),originalIds=new Set(before.work.map(row=>row.id));
      await apply(sources);
      const after=await snapshot(),created=after.work.filter(row=>!originalIds.has(row.id));
      assert.equal(created.length,2);
      const b=created.find(row=>row.sourceId===sources[1].sourceId),c=created.find(row=>row.sourceId===sources[2].sourceId);
      assert.ok(b);assert.ok(c);assert.equal(b.sourceVersion,version(10));assert.equal(c.sourceVersion,version(3));
      for(const [row,input]of [[b,sources[1]],[c,sources[2]]]){
        assert.equal(row.merchantId,own);assert.equal(row.sourceType,'service');assert.equal(row.sourceHash,input.sourceHash);
        assert.equal(row.publicationState,'published');assert.equal(row.status,'pending');assert.equal(row.leaseToken,null);
      }
      for(const row of [...initial,completedLegacy,unrelatedLegacy,foreignPending])
        assert.deepEqual(after.work.find(current=>current.id===row.id),row);
      const superseded=after.work.find(row=>row.id===pendingB.id);
      assert.deepEqual(superseded,{...pendingB,status:'completed',lastErrorCode:'legacy_superseded',leaseToken:null,leaseExpiresAt:null,nextAttemptAt:null,updatedAt:superseded.updatedAt});
      assert.ok(superseded.updatedAt.getTime()>=pendingB.updatedAt.getTime());
      assert.equal(after.work.filter(row=>row.merchantId===own&&row.sourceId===sources[0].sourceId).length,1);
      assert.deepEqual(after.chunks.filter(row=>row.merchantId===own),before.chunks.filter(row=>row.merchantId===own&&row.sourceId===sources[0].sourceId));
      assert.deepEqual(after.work.filter(row=>row.merchantId===foreign),before.work.filter(row=>row.merchantId===foreign));
      assert.deepEqual(after.chunks.filter(row=>row.merchantId===foreign),before.chunks.filter(row=>row.merchantId===foreign));
      assert.equal(digest({...after,work:[],chunks:[]}),digest({...before,work:[],chunks:[]}));
      // Named rebuilt representations only, not an assertion of actual indexing.
      await chunk(own,sources[1].sourceId,'rebuilt-B');await chunk(own,sources[2].sourceId,'rebuilt-C');
      const stable=await snapshot();await apply(sources);assert.equal(digest(await snapshot()),digest(stable));
    });

    await t.test('RAG-11 second bulk queue failure rolls back the completed first batch and canonical JSON policy changes',async()=>{
      const prefix='synthetic-mixed-queue-'+randomUUID(),ids=Array.from({length:1002},(_,index)=>prefix+'-'+String(index).padStart(4,'0'));
      for(let offset=0;offset<ids.length;offset+=250){
        const part=ids.slice(offset,offset+250);
        await f.raw.publicSourceWork.createMany({data:part.map(sourceId=>({merchantId:own,sourceType:'service',sourceId,
          sourceVersion:version(2),sourceHash:hash('old-'+sourceId),publicationState:'published',status:'completed',indexedAt:at,
          embeddingModel:'synthetic-history-only',embeddingDimensions:384}))});
        await f.raw.knowledgeChunk.createMany({data:part.map(sourceId=>({merchantId:own,sourceType:'service',sourceId,content:'Old synthetic '+sourceId,embedding:'[]'}))});
      }
      const name='synthetic_mixed_queue_'+randomUUID().replaceAll('-',''),sequence=name+'_seq',target=ids[1000];
      const before=await snapshot();
      await f.db.sql(`CREATE SEQUENCE ${sequence}; CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE observed bigint; BEGIN IF NEW.merchant_id=${sql(own)} AND NEW.source_type::text='service' AND NEW.source_id=${sql(target)} AND NEW.source_version=${sql(version(3))} THEN SELECT count(*) INTO observed FROM public_source_work WHERE merchant_id=${sql(own)} AND source_type::text='service' AND source_version=${sql(version(3))} AND source_id LIKE ${sql(prefix+'-%')} AND source_id COLLATE "C" < ${sql(target)} COLLATE "C"; PERFORM setval('${sequence}',observed+1,true); RAISE EXCEPTION 'synthetic_mixed_queue_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION ${name}();`);
      try{
        await assert.rejects(f.as(f.owner,()=>f.scoped.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR UPDATE`;
          await rewriteWithin(tx,'Must roll back queue failure');
          await enqueuePublicSourceProjections(tx,own,ids.map(id=>source(id,hash('new-'+id))));
        })));
        assert.equal(Number(await f.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${sequence}`)),1001,
          'the target in batch2 must observe all1000 actual new work rows from completed batch1');
        assert.equal(digest(await snapshot()),digest(before));
      }finally{await f.db.sql(`DROP TRIGGER ${name} ON public_source_work; DROP FUNCTION ${name}(); DROP SEQUENCE ${sequence};`);}
    });

    await t.test('RAG-11 bulk chunk failure occurs after all new jobs and rolls back both namespaces and canonical source edits',async()=>{
      const prefix='synthetic-mixed-chunk-'+randomUUID(),ids=[prefix+'-A',prefix+'-B',prefix+'-C'];
      for(const id of ids){await seed(own,id,2,hash('old-'+id));await chunk(own,id,'legacy-'+id);
        await f.raw.knowledgeChunk.create({data:{merchantId:own,sourceType:'service',sourceId:id,content:'Named new-namespace fixture '+id,embedding:'[]',metadata:{publicSourceNamespace:'public-business-v1'}}});}
      const name='synthetic_mixed_chunk_'+randomUUID().replaceAll('-',''),sequence=name+'_seq',before=await snapshot();
      await f.db.sql(`CREATE SEQUENCE ${sequence}; CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE observed bigint; BEGIN IF OLD.merchant_id=${sql(own)} AND OLD.source_type='service' AND OLD.source_id=${sql(ids[0])} THEN SELECT count(*) INTO observed FROM public_source_work WHERE merchant_id=${sql(own)} AND source_type::text='service' AND source_version=${sql(version(3))} AND source_id IN(${ids.map(sql).join(',')}); PERFORM setval('${sequence}',observed+1,true); RAISE EXCEPTION 'synthetic_mixed_chunk_failure'; END IF; RETURN OLD; END $$; CREATE TRIGGER ${name} BEFORE DELETE ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${name}();`);
      try{
        await assert.rejects(f.as(f.owner,()=>f.scoped.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR UPDATE`;
          await rewriteWithin(tx,'Must roll back chunk failure');
          await enqueuePublicSourceProjections(tx,own,ids.map(id=>source(id,hash('new-'+id))));
        })));
        assert.equal(Number(await f.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${sequence}`)),4,
          'the failing real DELETE must observe all3 newly inserted canonical work rows');
        assert.equal(digest(await snapshot()),digest(before));
      }finally{await f.db.sql(`DROP TRIGGER ${name} ON knowledge_chunks; DROP FUNCTION ${name}(); DROP SEQUENCE ${sequence};`);}
    });
  }finally{await f.close();}
});
