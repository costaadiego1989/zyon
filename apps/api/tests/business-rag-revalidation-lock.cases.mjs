import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {assertNativePrismaUrl} from './native-prisma-admission-guards.mjs';

// Root-reviewed exact-lock fixture. Actual current-source native execution is required.
const namespace='public-business-v1';
const pidSql="SELECT pg_backend_pid() AS pid, current_setting('application_name') AS application, current_setting('transaction_isolation') AS isolation";
const shareSql='SELECT id FROM merchants WHERE id=$1 FOR SHARE';
const normalized=query=>query.replace(/\s+/g,' ').trim();
const canonicalSelect=query=>/^SELECT\b/i.test(query)&&/\bFROM\s+(?:"?public"?\.)?"?(?:merchants|support_settings|products|public_source_work|knowledge_chunks)\b/i.test(query);
const deferred=()=>{
  let resolve,reject,settled=false;
  const promise=new Promise((done,fail)=>{resolve=value=>{if(!settled){settled=true;done(value);}};reject=error=>{if(!settled){settled=true;fail(error);}};});
  return{promise,resolve,reject,get settled(){return settled;}};
};

/** Called as a fifteenth child after the fourteen existing scenarios.
 * f is the existing actual owned professional HTTP fixture; drain is its
 * actual T66 indexing worker drain already bound to the same merchant/DB.
 * Neither argument is a reader result, query stub or business-origin override.
 */
export async function exercisePublicEvidenceReadLockCase(t,{f,drain}){
  await t.test('15 exact reader backend waits behind canonical writer and reads only the committed successor',async()=>{
    assert.equal(typeof drain,'function','actual_index_worker_drain_required');
    const {PrismaClient}=await import('@prisma/client');
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicEvidenceSources}=await import('../dist/modules/knowledge-base/infrastructure/prisma-public-evidence.sources.js');
    const {RevalidatePublicSourceService}=await import('../dist/modules/knowledge-base/application/use-cases/revalidate-public-source.service.js');
    const {enqueueCanonicalPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/public-business-write.js');
    const {readCanonicalPublicBusinessSourceWithin}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const own=f.owner.merchant_id,tenant=new TenantContextService();
    const as=work=>tenant.run({merchantId:own,userId:'synthetic-t68-lock-reader',role:'system'},work);
    const writer=registerTenantMiddleware(f.prisma,tenant);
    const originalUrl=assertNativePrismaUrl(f.runtime.db.prismaUrl);
    assert.equal(f.runtime.db.transport,'loopback-exec');assert.equal(f.runtime.db.network,'none');
    const ownership=await f.runtime.db.inspectOwned();assert.equal(ownership.exists,true);assert.equal(ownership.runId,f.runtime.db.runId);
    assert.match(ownership.id,/^[a-f0-9]{64}$/);
    const readerUrl=new URL(originalUrl.href),application='aacp_write_native_'+randomUUID();
    readerUrl.searchParams.set('application_name',application);assert.ok(application.length<64);
    assertNativePrismaUrl(readerUrl.href);
    assert.equal(readerUrl.origin,originalUrl.origin);assert.equal(readerUrl.pathname,originalUrl.pathname);
    for(const field of ['protocol','hostname','port','username','password'])assert.equal(readerUrl[field],originalUrl[field]);
    for(const [name,value]of originalUrl.searchParams)if(name!=='application_name')assert.equal(readerUrl.searchParams.get(name),value);
    const queries=[];
    const rawReader=new PrismaClient({datasources:{db:{url:readerUrl.href}},log:[{emit:'event',level:'query'}]});
    rawReader.$on('query',event=>queries.push(normalized(event.query)));
    const scopedReader=registerTenantMiddleware(rawReader,tenant);
    const readerInfo=deferred(),writerReady=deferred(),releaseWriter=deferred();
    let writing,reading;

    // Only observes the actual backend in the SAME interactive transaction.
    // Every callback, option, statement and result otherwise delegates intact.
    // In particular a RepeatableRead mutation is NOT normalized to ReadCommitted.
    const observedReader=new Proxy(scopedReader,{get(target,property){
      const value=Reflect.get(target,property,target);
      if(property==='$transaction')return(callback,...options)=>{
        if(typeof callback!=='function')return target.$transaction(callback,...options);
        return target.$transaction(async tx=>{
          const [info]=await tx.$queryRawUnsafe(pidSql);readerInfo.resolve(info);
          return callback(tx);
        },...options);
      };
      return typeof value==='function'?value.bind(target):value;
    }});
    const validator=new RevalidatePublicSourceService(new PrismaPublicEvidenceSources(observedReader,tenant));
    const directValidator=new RevalidatePublicSourceService(new PrismaPublicEvidenceSources(writer,tenant));
    const candidates=async()=>{
      const rows=await f.prisma.knowledgeChunk.findMany({where:{merchantId:own,sourceType:'company',sourceId:own,
        metadata:{path:['publicSourceNamespace'],equals:namespace}},orderBy:{id:'asc'}});
      assert.ok(rows.length,'actual_published_SQL_candidate_required');
      return rows.map(row=>({origin:'public_sql',merchantId:own,sourceType:row.sourceType,sourceId:row.sourceId,
        rowId:row.id,content:row.content,...row.metadata}));
    };
    const setDescription=async(tx,description)=>{
      const merchant=await tx.merchant.findUnique({where:{id:own},select:{id:true,storeSettings:true}});
      assert.equal(merchant.id,own);assert.ok(merchant.storeSettings&&typeof merchant.storeSettings==='object'&&!Array.isArray(merchant.storeSettings));
      const settings=structuredClone(merchant.storeSettings);assert.ok(settings.company&&typeof settings.company==='object'&&!Array.isArray(settings.company));
      settings.company.description=description;
      await tx.merchant.update({where:{id:own},data:{storeSettings:settings}});
      await enqueueCanonicalPublicBusinessSources(tx,own,[{sourceType:'company',sourceId:own}]);
      const source=await readCanonicalPublicBusinessSourceWithin(tx,own,'company',own);
      assert.equal(source.publicationState,'published');assert.ok(source.text.includes(description));return source;
    };
    try{
      // Warm only the owned observer connection before the5s writer window.
      assert.equal((await rawReader.$queryRaw`SELECT current_database() AS name`)[0].name,'storefront_synthetic');
      queries.length=0;
      const textA='Synthetic canonical lock A '+randomUUID(),textB='Synthetic canonical lock B '+randomUUID();
      await as(()=>writer.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR UPDATE`;
        await setDescription(tx,textA);
      }));
      await drain();const original=await candidates();
      const baseline=await as(()=>directValidator.revalidate({merchantId:own,candidates:original}));
      assert.equal(baseline.status,'ready');assert.ok(baseline.evidence.some(item=>item.content.includes(textA)));
      const originalHash=original[0].sourceHash,originalVersion=original[0].sourceVersion;

      writing=as(()=>writer.$transaction(async tx=>{
        const [info]=await tx.$queryRawUnsafe(pidSql);
        assert.equal(info.isolation,'read committed');assert.ok(Number.isInteger(info.pid)&&info.pid>0);
        const locked=await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR UPDATE`;
        assert.deepEqual(locked,[{id:own}]);
        const source=await setDescription(tx,textB);assert.notEqual(source.sourceHash,originalHash);
        writerReady.resolve({pid:info.pid,sourceHash:source.sourceHash});
        await releaseWriter.promise;
        return{sourceHash:source.sourceHash};
      }));void writing.catch(writerReady.reject);
      const held=await writerReady.promise;
      const visible=await f.prisma.merchant.findUnique({where:{id:own},select:{storeSettings:true}});
      assert.equal(visible.storeSettings.company.description,textA,'B_must_still_be_uncommitted_when_reader_starts');
      const visibleWork=await f.prisma.publicSourceWork.findFirst({where:{merchantId:own,sourceType:'company',sourceId:own,
        sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
      assert.equal(visibleWork.sourceVersion,originalVersion);assert.equal(visibleWork.status,'completed');

      reading=as(()=>validator.revalidate({merchantId:own,candidates:original}));
      void reading.then(()=>{if(!readerInfo.settled)readerInfo.reject(Error('actual_reader_transaction_not_observed'));},readerInfo.reject);
      const info=await readerInfo.promise;assert.ok(Number.isInteger(info.pid)&&info.pid>0);assert.notEqual(info.pid,held.pid);
      assert.equal(info.application,application);assert.equal(info.isolation,'read committed');
      let waiting;
      const deadline=Date.now()+2000; // Existing T66 exact-lock observer window.
      do{
        const rows=await f.prisma.$queryRaw`SELECT pid,application_name AS application,query,wait_event_type AS "waitEventType",
          pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname=current_database() AND pid=${info.pid} AND application_name=${application}`;
        const row=rows[0];
        if(row?.waitEventType==='Lock'&&row.blockers.includes(held.pid)&&normalized(row.query)===shareSql){waiting=row;break;}
        await pause(20);
      }while(Date.now()<deadline);
      assert.ok(waiting,'exact_reader_PID_and_FOR_SHARE_must_wait_on_actual_writer_PID');
      assert.equal(waiting.pid,info.pid);assert.equal(waiting.application,application);assert.equal(normalized(waiting.query),shareSql);
      assert.ok(waiting.blockers.includes(held.pid));
      // This assertion uses completed REAL Prisma query events, not query spies.
      // Public latestBpending alone could hide a premature canonical read ofA.
      const beforeRelease=queries.filter(canonicalSelect);
      assert.deepEqual(beforeRelease,[],'canonical_SQL_must_not_run_before_the_merchant_lock');

      releaseWriter.resolve();const committed=await writing;assert.equal(committed.sourceHash,held.sourceHash);
      const result=await reading;assert.equal(result.status,'insufficient');assert.deepEqual(result.evidence,[]);
      const shareIndex=queries.indexOf(shareSql);assert.ok(shareIndex>=0,'actual_FOR_SHARE_query_completion_required');
      for(let index=0;index<queries.length;index++)if(canonicalSelect(queries[index]))
        assert.ok(index>=shareIndex,'completed_canonical_queries_must_follow_FOR_SHARE');
      const afterCommit=await f.prisma.merchant.findUnique({where:{id:own},select:{storeSettings:true}});
      assert.equal(afterCommit.storeSettings.company.description,textB);
      await drain();const successor=await candidates();assert.ok(successor[0].sourceVersion>originalVersion);
      assert.equal(successor[0].sourceHash,held.sourceHash);
      const freshValidator=new RevalidatePublicSourceService(new PrismaPublicEvidenceSources(scopedReader,tenant));
      const fresh=await as(()=>freshValidator.revalidate({merchantId:own,candidates:successor}));
      assert.equal(fresh.status,'ready');assert.ok(fresh.evidence.some(item=>item.content.includes(textB)));
      assert.equal(JSON.stringify(fresh).includes(textA),false);
      assert.ok(fresh.evidence.every(item=>item.provenance.sourceHash===held.sourceHash));
      assert.equal(f.runtime.evidence().providerCalls,0);
    }finally{
      releaseWriter.resolve();
      await Promise.allSettled([...(writing?[writing]:[]),...(reading?[reading]:[])]);
      await rawReader.$disconnect();
    }
  });
}
