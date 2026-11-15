import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqlText} from './service-company-http-fixture.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';

/** New children for root65's SAME owned AppModule/database. Insert after its
 * offline modality ABA case and before exerciseCatalogWriterCases(t,f). */
export async function exerciseBusinessPublicationCases(t,f){
  const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
  const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
  const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
  const {invalidateServiceBusinessPublicationWithin}=await import('../dist/modules/graph-rag/infrastructure/public-business-write.js');
  const {withdrawnPublicBusinessSource}=await import('../dist/modules/graph-rag/domain/public-business-source.js');
  const {assertServiceBusinessActor}=await import('../dist/modules/merchant/presentation/http/service-business-policy.controller.js');
  const prisma=f.prisma,merchantId=f.owner.merchant_id,foreignId=f.foreign.merchant_id;
  const tenant=new TenantContextService(),scoped=registerTenantMiddleware(prisma,tenant);
  const reader=new PrismaPublicBusinessSources(scoped,tenant),jobs=new PublicSourceWorkService(scoped,tenant,reader),http=businessRagWriterHttp(f.runtime);
  const as=(auth,work)=>tenant.run({merchantId:auth.merchant_id,userId:auth.user_id,role:auth===f.staff?'staff':'owner'},work);
  const read=(auth,type,id)=>as(auth,()=>reader.read(auth.merchant_id,type,id));
  const key=row=>JSON.stringify([row.sourceType,row.sourceId]);
  const prefix='publication-dirty-v1:';
  const versionPattern=/^publication-dirty-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const historicalIds=Array.from({length:1005},(_,index)=>'zz-t65-publication-'+String(index).padStart(4,'0'));
  const target=historicalIds.at(-1),missing='zz-t65-publication-missing-professional',chunkOnly='zz-t65-publication-chunk-only-service';
  const foreignProfessional='foreign-t65-publication-profile';
  assert.equal((await prisma.merchant.findUnique({where:{id:merchantId}})).businessMode,'services');
  assert.equal(await prisma.product.count({where:{merchantId,isActive:true,deletedAt:null}}),0,'Place these cases after ABA and before catalog creates an active offer');
  // Named historical seed only. No claim that1005 profiles were created through
  // HTTP, no offers/links/appointments, and no private field enters dirty data.
  await prisma.serviceProfessional.createMany({data:historicalIds.map(id=>({id,merchantId,publicName:'Synthetic historical publication '+id,
    publicProfile:{description:'Named public historical profile',privateMemo:'private-publication-canary'},timeZone:'UTC',isActive:true,isPublished:true}))});
  await prisma.serviceProfessional.create({data:{id:foreignProfessional,merchantId:foreignId,publicName:'Foreign historical public profile',timeZone:'UTC',isPublished:true}});
  const historic=await prisma.publicSourceWork.create({data:{merchantId,sourceType:'professional',sourceId:missing,
    sourceVersion:'public-v1:00000000000000000001',sourceHash:withdrawnPublicBusinessSource(merchantId,'professional',missing,'historical-fixture').sourceHash,
    publicationState:'withdrawn',status:'completed',indexedAt:new Date(),embeddingModel:'synthetic-history-only',embeddingDimensions:384}});
  await prisma.knowledgeChunk.createMany({data:[
    {merchantId,sourceType:'professional',sourceId:historicalIds[0],content:'Synthetic previously indexed profile',embedding:'[]'},
    {merchantId,sourceType:'service',sourceId:chunkOnly,content:'Synthetic missing historical service projection',embedding:'[]'},
    {merchantId:foreignId,sourceType:'professional',sourceId:foreignProfessional,content:'Foreign historical projection',embedding:'[]'},
  ]});
  // Make policy rollback observable, independently of whether signup configured
  // admission. This named historical policy seed precedes every snapshot.
  await prisma.serviceBusinessPolicy.upsert({where:{merchantId},create:{merchantId,admissionsEnabled:true,holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',version:1,configuredAt:new Date()},
    update:{admissionsEnabled:true,holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',version:1,configuredAt:new Date()}});
  const identities=async owner=>{
    const [profiles,services,work,chunks]=await Promise.all([
      prisma.serviceProfessional.findMany({where:{merchantId:owner},select:{id:true}}),
      prisma.product.findMany({where:{merchantId:owner,type:'service'},select:{id:true}}),
      prisma.publicSourceWork.findMany({where:{merchantId:owner,sourceType:{in:['professional','service']}},select:{sourceType:true,sourceId:true}}),
      prisma.knowledgeChunk.findMany({where:{merchantId:owner,sourceType:{in:['professional','service']}},select:{sourceType:true,sourceId:true}}),
    ]);
    const rows=[...profiles.map(row=>({sourceType:'professional',sourceId:row.id})),...services.map(row=>({sourceType:'service',sourceId:row.id})),...work,...chunks];
    return [...new Map(rows.filter(row=>typeof row.sourceId==='string'&&row.sourceId.trim()&&row.sourceId.length<=191).map(row=>[key(row),row])).values()];
  };
  const snapshot=async owner=>({
    merchant:await prisma.merchant.findUnique({where:{id:owner}}),
    admissionPolicy:await prisma.serviceBusinessPolicy.findUnique({where:{merchantId:owner}}),
    publicPolicy:await prisma.merchantPolicy.findUnique({where:{merchantId:owner}}),
    professionals:await prisma.serviceProfessional.findMany({where:{merchantId:owner},orderBy:{id:'asc'}}),
    links:await prisma.professionalService.findMany({where:{merchantId:owner},orderBy:{id:'asc'}}),
    products:await prisma.product.findMany({where:{merchantId:owner},orderBy:{id:'asc'},include:{variants:{orderBy:{id:'asc'},include:{price:true,stock:{orderBy:{id:'asc'}}}}}}),
    work:await prisma.publicSourceWork.findMany({where:{merchantId:owner},orderBy:{id:'asc'}}),
    chunks:await prisma.knowledgeChunk.findMany({where:{merchantId:owner},orderBy:{id:'asc'}}),
    domainAudit:await prisma.merchantAuditEvent.findMany({where:{merchantId:owner,action:'business_mode.changed'},orderBy:{id:'asc'}}),
  });
  const mutate=async(body,status,auth=f.owner)=>{
    const correlationId=randomUUID(),path='/merchants/me/business-mode';
    const response=await http.request(path,body,auth?.access_token,'PUT',{'idempotency-key':'synthetic-publication-'+randomUUID(),'x-correlation-id':correlationId});
    assert.equal(response.status,status,JSON.stringify({status:response.status,body:response.body}));
    if(auth&&[200,400,500].includes(status)){
      const deadline=Date.now()+5000;let audit;
      do{audit=await prisma.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}});}while(!audit&&Date.now()<deadline);
      assert.ok(audit,'actual HTTP audit settles before snapshot/teardown');assert.equal(audit.actorId,auth.user_id);
      assert.equal(audit.action,'http.put');assert.equal(audit.outcome,status<400?'success':'failed');
      assert.equal(audit.metadata.path,path);assert.equal(audit.metadata.statusCode,status);
    }else assert.equal(await prisma.merchantAuditEvent.count({where:{correlationId}}),0,'early auth refusal never enters the HTTP audit interceptor');
    return response;
  };
  const expected=await identities(merchantId);
  assert.ok(expected.length>=1005);assert.ok(expected.some(row=>row.sourceType==='professional'&&row.sourceId===missing));
  assert.ok(expected.some(row=>row.sourceType==='service'&&row.sourceId===chunkOnly));assert.ok(!expected.some(row=>row.sourceId===foreignProfessional));

  await t.test('RAG-02 publication batch2 rejection rolls back mode,1005+ source identities, JSON, policies and all work/chunks',async()=>{
    const before=await snapshot(merchantId),foreignBefore=await snapshot(foreignId);
    const probe='synthetic_publication_prior_rows_t65',trigger='synthetic_publication_batch2_reject_t65';
    // The nontransactional sequence is diagnostic only. At the target row the
    // trigger observes >=1000 rows of this SAME UUID already inserted, then
    // deliberately rejects batch2; those rows must still all roll back.
    await f.runtime.db.sql(`CREATE SEQUENCE ${probe} AS bigint MINVALUE 0 START 0; CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE observed text; prior_rows bigint; BEGIN IF NEW.merchant_id=${sqlText(merchantId)} AND NEW.source_version LIKE 'publication-dirty-v1:%' THEN IF NEW.source_version !~ '^publication-dirty-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'synthetic_publication_uuid_invalid'; END IF; observed:=current_setting('synthetic_t65.publication_uuid',true); IF observed IS NULL OR observed='' THEN PERFORM set_config('synthetic_t65.publication_uuid',NEW.source_version,true); ELSIF observed<>NEW.source_version THEN RAISE EXCEPTION 'synthetic_publication_uuid_changed_between_batches'; END IF; IF NEW.source_type::text='professional' AND NEW.source_id=${sqlText(target)} THEN SELECT count(*) INTO prior_rows FROM public_source_work WHERE merchant_id=NEW.merchant_id AND source_version=NEW.source_version; IF prior_rows<1000 THEN RAISE EXCEPTION 'synthetic_publication_not_batch2'; END IF; PERFORM setval('${probe}',prior_rows,true); RAISE EXCEPTION 'synthetic_publication_batch2_rejected'; END IF; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    try{
      await mutate({expectedBusinessMode:'services',businessMode:'products'},500);
      assert.ok(Number(await f.runtime.db.sql(`SELECT last_value FROM ${probe}`))>=1000,'the failure must occur only after the first real bulk batch persisted inside the transaction');
      assert.deepEqual(await snapshot(merchantId),before);assert.deepEqual(await snapshot(foreignId),foreignBefore);
    }finally{await f.runtime.db.sql(`DROP TRIGGER ${trigger} ON public_source_work; DROP FUNCTION ${trigger}(); DROP SEQUENCE ${probe};`);}
  });

  await t.test('RAG-02 actual bulk chunk DELETE rejection also rolls back every publication dirty batch and policy change',async()=>{
    const before=await snapshot(merchantId),foreignBefore=await snapshot(foreignId),trigger='synthetic_publication_chunk_reject_t65',probe='synthetic_publication_chunk_prior_rows_t65';
    assert.ok(before.chunks.some(row=>row.sourceType==='professional'));assert.ok(before.chunks.some(row=>row.sourceType==='service'));
    const oldVersions=[...new Set(before.work.filter(row=>row.sourceVersion.startsWith(prefix)).map(row=>row.sourceVersion))];
    const excluded=(oldVersions.length?oldVersions:['publication-dirty-v1:synthetic-empty-baseline']).map(sqlText).join(',');
    await f.runtime.db.sql(`CREATE SEQUENCE ${probe} AS bigint MINVALUE 0 START 0; CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE prior_rows bigint; BEGIN IF OLD.merchant_id=${sqlText(merchantId)} AND OLD.source_type IN ('professional','service') THEN SELECT count(*) INTO prior_rows FROM public_source_work WHERE merchant_id=OLD.merchant_id AND source_type::text IN ('professional','service') AND source_version LIKE 'publication-dirty-v1:%' AND source_version NOT IN (${excluded}); IF prior_rows<${expected.length} THEN RAISE EXCEPTION 'synthetic_publication_dirty_batches_not_complete'; END IF; PERFORM setval('${probe}',prior_rows,true); RAISE EXCEPTION 'synthetic_publication_chunk_delete_rejected'; END IF; RETURN OLD; END $$; CREATE TRIGGER ${trigger} BEFORE DELETE ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    try{
      await mutate({expectedBusinessMode:'services',businessMode:'products'},500);
      assert.equal(Number(await f.runtime.db.sql(`SELECT last_value FROM ${probe}`)),expected.length,'DELETE must actually be reached after the new dirty batches, not masked by an earlier timeout');
      assert.deepEqual(await snapshot(merchantId),before);assert.deepEqual(await snapshot(foreignId),foreignBefore);
    }finally{await f.runtime.db.sql(`DROP TRIGGER ${trigger} ON knowledge_chunks; DROP FUNCTION ${trigger}(); DROP SEQUENCE ${probe};`);}
  });

  await t.test('RAG-02 actual HTTP services-to-services legacy review resolution publishes and dirties without a company-content change',async()=>{
    await prisma.merchant.update({where:{id:merchantId},data:{businessModeSelectedAt:null,businessModeNeedsReview:true}});
    const before=await snapshot(merchantId),foreignBefore=await snapshot(foreignId),companyBefore=await read(f.owner,'company',merchantId);
    assert.equal((await read(f.owner,'professional',historicalIds[0])).publicationState,'withdrawn');
    const existingIds=new Set(before.work.map(row=>row.id));
    const response=await mutate({expectedBusinessMode:'services',businessMode:'services'},200);
    assert.deepEqual(response.body,{businessMode:'services',businessModeSelectionState:'selected'});
    const after=await snapshot(merchantId);assert.equal(after.merchant.businessMode,'services');assert.equal(after.merchant.businessModeNeedsReview,false);assert.ok(after.merchant.businessModeSelectedAt);
    const oldAuditIds=new Set(before.domainAudit.map(row=>row.id)),domainAudit=after.domainAudit.filter(row=>!oldAuditIds.has(row.id));
    assert.equal(domainAudit.length,1);assert.equal(domainAudit[0].actorId,f.owner.user_id);assert.deepEqual(domainAudit[0].metadata,{before:'services',after:'services',reviewResolved:true});
    assert.deepEqual(after.merchant.storeSettings,before.merchant.storeSettings);assert.deepEqual(after.publicPolicy,before.publicPolicy);
    assert.deepEqual(after.professionals,before.professionals);assert.deepEqual(after.products,before.products);assert.deepEqual(after.links,before.links);
    assert.equal(after.admissionPolicy.admissionsEnabled,false);assert.equal(after.admissionPolicy.version,before.admissionPolicy.version+1);
    const companyAfter=await read(f.owner,'company',merchantId);assert.equal(companyAfter.sourceHash,companyBefore.sourceHash);assert.deepEqual(companyAfter.publicData,companyBefore.publicData);
    assert.deepEqual(after.work.filter(row=>row.sourceType==='company'),before.work.filter(row=>row.sourceType==='company'),'no artificial company job when its public content is unchanged');
    const dirty=after.work.filter(row=>!existingIds.has(row.id)&&row.sourceVersion.startsWith(prefix));
    assert.deepEqual(dirty.map(key).sort(),expected.map(key).sort());assert.equal(new Set(dirty.map(row=>row.sourceVersion)).size,1);
    assert.match(dirty[0].sourceVersion,versionPattern);
    for(const row of dirty){assert.equal(row.merchantId,merchantId);assert.equal(row.status,'pending');assert.equal(row.publicationState,'withdrawn');assert.equal(row.sourceHash,withdrawnPublicBusinessSource(merchantId,row.sourceType,row.sourceId,row.sourceVersion).sourceHash);}
    assert.equal(JSON.stringify(dirty).includes('private-publication-canary'),false);
    assert.equal(after.chunks.filter(row=>['professional','service'].includes(row.sourceType)).length,0);
    assert.equal((await read(f.owner,'professional',historicalIds[0])).publicationState,'published');
    assert.deepEqual(await prisma.publicSourceWork.findUnique({where:{id:historic.id}}),historic,'completed canonical history is never reopened');
    assert.deepEqual(await snapshot(foreignId),foreignBefore);
  });

  const invokeGuarded=async(auth,targetMerchantId,transitionId)=>{
    // This is the real production caller guard, not protection inferred from
    // Prisma's tenant injection on the helper's raw SQL. HTTP auth is separate.
    const principal={kind:'human',tenantId:auth.merchant_id,userId:auth.user_id,email:auth.email,role:auth===f.staff?'staff':'owner'};
    const actor=assertServiceBusinessActor(targetMerchantId,{tenantPrincipal:principal});
    return as(auth,()=>scoped.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${actor.tenantId} FOR UPDATE`;
      await reader.readWithin(tx,actor.tenantId,'company',actor.tenantId); // real tenant/context guard
      await invalidateServiceBusinessPublicationWithin(tx,actor.tenantId,transitionId);
    }));
  };

  await t.test('RAG-02 replay of the same transition UUID preserves normalized/completed history and rebuilt valid chunks',async()=>{
    const transitionId=randomUUID(),sourceVersion=prefix+transitionId,ownerBefore=await snapshot(merchantId);
    const original=await read(f.foreign,'professional',foreignProfessional);
    const completed=await prisma.publicSourceWork.create({data:{merchantId:foreignId,sourceType:'professional',sourceId:foreignProfessional,
      sourceVersion:'public-v1:00000000000000000001',sourceHash:original.sourceHash,publicationState:original.publicationState,status:'completed',indexedAt:new Date(),embeddingModel:'synthetic-history-only',embeddingDimensions:384}});
    await invokeGuarded(f.foreign,foreignId,transitionId);
    const first=await snapshot(foreignId),dirty=first.work.filter(row=>row.sourceVersion===sourceVersion);
    assert.deepEqual(dirty.map(key).sort(),(await identities(foreignId)).map(key).sort());assert.ok(dirty.length>0);
    assert.deepEqual(await prisma.publicSourceWork.findUnique({where:{id:completed.id}}),completed);
    await invokeGuarded(f.foreign,foreignId,transitionId);assert.deepEqual(await snapshot(foreignId),first,'pending replay creates no duplicate marker');
    for(const row of dirty){
      await as(f.foreign,()=>jobs.normalizeCurrent(foreignId,row.sourceType,row.sourceId));
      const canonical=await prisma.publicSourceWork.findFirst({where:{merchantId:foreignId,sourceType:row.sourceType,sourceId:row.sourceId,sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
      assert.ok(canonical);assert.equal(canonical.publicationState,'published');
      // Explicit already-indexed fixture. Normalization above is real; the
      // embedding/graph worker is not executed or claimed by this test.
      await prisma.publicSourceWork.update({where:{id:canonical.id},data:{status:'completed',indexedAt:new Date(),embeddingModel:'synthetic-rebuilt-fixture',embeddingDimensions:384}});
      await prisma.knowledgeChunk.create({data:{merchantId:foreignId,sourceType:row.sourceType,sourceId:row.sourceId,content:'Synthetic rebuilt valid public profile',embedding:'[]',metadata:{sourceHash:canonical.sourceHash,sourceVersion:canonical.sourceVersion}}});
    }
    const indexed=await snapshot(foreignId);assert.ok(indexed.chunks.length>0);assert.ok(indexed.work.filter(row=>row.sourceVersion===sourceVersion).every(row=>row.status==='completed'));
    await invokeGuarded(f.foreign,foreignId,transitionId);
    assert.deepEqual(await snapshot(foreignId),indexed,'a consumed publication UUID cannot delete valid rebuilt chunks without new work');
    assert.deepEqual(await snapshot(merchantId),ownerBefore);
  });

  await t.test('RAG-07 real actor/tenant guards reject cross-tenant and staff publication calls before any source mutation',async()=>{
    const own=await snapshot(merchantId),foreign=await snapshot(foreignId);
    await assert.rejects(async()=>invokeGuarded(f.foreign,merchantId,randomUUID()),/service_business_forbidden/);
    await assert.rejects(async()=>invokeGuarded(f.staff,merchantId,randomUUID()),/service_business_forbidden/);
    await mutate({expectedBusinessMode:'services',businessMode:'products'},401,null);
    await mutate({expectedBusinessMode:'services',businessMode:'products'},403,f.staff);
    const foreignBody=await mutate({expectedBusinessMode:'services',businessMode:'products',merchantId},403,f.foreign);assert.equal(foreignBody.body.code,'tenant_mismatch_body');
    // Same-tenant extra fields reach the actual strict business-mode validator;
    // a cross-tenant ID is already refused by the earlier global guard above.
    const forged=await mutate({expectedBusinessMode:'services',businessMode:'products',merchantId:foreignId},400,f.foreign);assert.match(JSON.stringify(forged.body),/invalid_business_mode_field/);
    assert.deepEqual(await snapshot(merchantId),own);assert.deepEqual(await snapshot(foreignId),foreign);
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);
  });
}
