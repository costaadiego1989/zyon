import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {sqlText} from './service-company-http-fixture.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';

/** Called by the root T65 native after its existing cases, using the SAME owned
 * AppModule/DB. This is not a second runner, mock repository or HTTP endpoint. */
export async function exerciseFaqPolicyWriterCases(t,f){
  const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
  const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
  const {PrismaSupportSettingsRepository}=await import('../dist/modules/support/infrastructure/prisma-support-settings.repository.js');
  const {PrismaPolicyRepository}=await import('../dist/modules/knowledge-base/infrastructure/repositories/prisma-policy.repository.js');
  const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const actor=f.owner,merchantId=actor.merchant_id;
  const tenant=new TenantContextService(),scoped=registerTenantMiddleware(f.prisma,tenant);
  const faq=new PrismaSupportSettingsRepository(scoped),policy=new PrismaPolicyRepository(scoped),reader=new PrismaPublicBusinessSources(scoped,tenant);
  const as=work=>tenant.run({merchantId,userId:actor.user_id,role:'owner'},work);
  const read=(type,id)=>as(()=>reader.read(merchantId,type,id));
  const http=businessRagWriterHttp(f.runtime);
  await f.prisma.merchantBillingSubscription.upsert({where:{merchantId},create:{merchantId,planKey:'growth',status:'active'},update:{planKey:'growth',status:'active'}});
  const latest=(sourceType,sourceId)=>f.prisma.publicSourceWork.findFirst({where:{merchantId,sourceType,sourceId,sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
  const expectCurrent=async(type,id,publicationState='published')=>{
    const source=await read(type,id),work=await latest(type,id);assert.ok(work,'canonical work must persist in the source write');
    assert.equal(work.merchantId,merchantId);assert.equal(work.sourceType,type);assert.equal(work.sourceId,id);
    assert.match(work.sourceVersion,/^public-v1:\d{20}$/);assert.match(work.sourceHash,/^[a-f0-9]{64}$/);assert.equal(work.publicationState,publicationState);
    if(source){assert.equal(work.sourceHash,source.sourceHash);assert.equal(source.publicationState,publicationState);}
    else assert.equal(publicationState,'withdrawn');
    return{source,work};
  };
  const snapshot=async()=>({
    merchant:await f.prisma.merchant.findUnique({where:{id:merchantId}}),
    faq:await f.prisma.supportSetting.findUnique({where:{merchantId}}),
    policy:await f.prisma.merchantPolicy.findUnique({where:{merchantId}}),
    work:await f.prisma.publicSourceWork.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    chunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId},orderBy:{id:'asc'}}),
  });
  const chunk=async(type,id,owner=merchantId)=>f.prisma.knowledgeChunk.create({data:{merchantId:owner,sourceType:type,sourceId:id,content:'Synthetic existing public chunk '+id,embedding:'[]'}});
  const audit=async(correlationId,status,path,auth)=>{
    const deadline=Date.now()+5000;let row;
    do{row=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}});}while(!row&&Date.now()<deadline);
    assert.ok(row,'actual HTTP audit must settle before snapshot or teardown');assert.equal(row.actorId,auth.user_id);
    assert.equal(row.action,'http.put');assert.equal(row.outcome,status<400?'success':'failed');
    assert.equal(row.metadata.statusCode,status);assert.equal(row.metadata.path,path);
  };
  const mutate=async(path,body,expectedStatus=200,auth=actor)=>{
    const correlationId=randomUUID();
    const result=await http.request(path,body,auth?.access_token,'PUT',{'idempotency-key':'synthetic-faq-policy-'+randomUUID(),'x-correlation-id':correlationId});
    assert.equal(result.status,expectedStatus,JSON.stringify({path,status:result.status,body:result.body}));
    if(expectedStatus===200||expectedStatus===500)await audit(correlationId,expectedStatus,
      path==='/merchants/'+auth.merchant_id+'/store-settings'?'/merchants/:mid/store-settings':path,auth);
    else assert.equal(await f.prisma.merchantAuditEvent.count({where:{correlationId}}),0,'early authorization rejection does not enter the audit interceptor');
    return result;
  };
  const failWithin=async(sourceType,failure,work)=>{
    const trigger='synthetic_faq_policy_'+failure+'_failure_t65';
    const sequence=trigger+'_reached';
    const table=failure==='queue'?'public_source_work':'knowledge_chunks',event=failure==='queue'?'INSERT':'DELETE',row=failure==='queue'?'NEW':'OLD';
    await f.runtime.db.sql(`CREATE SEQUENCE ${sequence}; CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${row}.merchant_id=${sqlText(merchantId)} AND ${row}.source_type::text=${sqlText(sourceType)} THEN PERFORM nextval('${sequence}'); RAISE EXCEPTION 'synthetic_faq_policy_${failure}_rejected'; END IF; RETURN ${row}; END $$; CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    try{
      await work();
      assert.equal(Number(await f.runtime.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${sequence}`)),1,'The intended FAQ/policy trigger must cause the failure');
    }finally{await f.runtime.db.sql(`DROP TRIGGER ${trigger} ON ${table}; DROP FUNCTION ${trigger}(); DROP SEQUENCE ${sequence};`);}
  };

  await t.test('RAG-11 FAQ replacement retires old generated identities and queues actual old/new public facts',async()=>{
    const question='Legacy public question',generatedId=createHash('sha256').update(question).digest('hex');
    // Historical no-id JSON is a named legacy seed. The replacement itself
    // goes through the real HTTP DTO/entity/repository, without overrides.
    await f.prisma.supportSetting.upsert({where:{merchantId},create:{merchantId,faqItems:[{question,answer:'Old public answer',privatePatientNote:'private-faq-canary'},{id:'t65-faq-keep',question:'Kept public question',answer:'Old kept answer'}]},update:{faqItems:[{question,answer:'Old public answer',privatePatientNote:'private-faq-canary'},{id:'t65-faq-keep',question:'Kept public question',answer:'Old kept answer'}]}});
    await chunk('faq',generatedId);await chunk('faq','t65-faq-keep');
    const foreignChunk=await chunk('faq',generatedId,f.foreign.merchant_id);
    const response=await mutate('/support/settings',{faqItems:[{id:'t65-faq-keep',question:'Kept public question',answer:'Updated kept answer'},{id:'t65-faq-new',question:'New public question',answer:'New public answer'}]});
    assert.deepEqual(response.body.faqItems,[{id:'t65-faq-keep',question:'Kept public question',answer:'Updated kept answer'},{id:'t65-faq-new',question:'New public question',answer:'New public answer'}]);
    assert.equal((await expectCurrent('faq',generatedId,'withdrawn')).source,null);
    assert.equal((await expectCurrent('faq','t65-faq-keep')).source.publicData.answer,'Updated kept answer');
    assert.equal((await expectCurrent('faq','t65-faq-new')).source.publicData.answer,'New public answer');
    assert.equal(await f.prisma.knowledgeChunk.count({where:{merchantId,sourceType:'faq',sourceId:{in:[generatedId,'t65-faq-keep','t65-faq-new']}}}),0);
    assert.deepEqual(await f.prisma.knowledgeChunk.findUnique({where:{id:foreignChunk.id}}),foreignChunk);
    assert.equal(JSON.stringify(await snapshot()).includes('private-faq-canary'),false);
  });

  await t.test('RAG-02 actual FAQ empty-list clear retires every current item without deleting unrelated sources',async()=>{
    const before=await expectCurrent('faq','t65-faq-new');
    await chunk('faq','t65-faq-keep');await chunk('faq','t65-faq-new');const other=await chunk('policy','unrelated-policy-chunk');
    await mutate('/support/settings',{faqItems:[]});
    assert.deepEqual((await f.prisma.supportSetting.findUnique({where:{merchantId}})).faqItems,[]);
    for(const id of ['t65-faq-keep','t65-faq-new'])assert.equal((await expectCurrent('faq',id,'withdrawn')).source,null);
    assert.notEqual((await latest('faq','t65-faq-new')).sourceVersion,before.work.sourceVersion);
    assert.equal(await f.prisma.knowledgeChunk.count({where:{merchantId,sourceType:'faq'}}),0);
    assert.deepEqual(await f.prisma.knowledgeChunk.findUnique({where:{id:other.id}}),other);
  });

  await t.test('RAG-02 internal FAQ delete retires explicit and legacy generated identities and repeat delete is idempotent',async()=>{
    const question='Legacy delete question',generatedId=createHash('sha256').update(question).digest('hex');
    await f.prisma.supportSetting.update({where:{merchantId},data:{faqItems:[{id:'t65-faq-delete',question:'Explicit delete question',answer:'Public delete answer'},{question,answer:'Legacy public delete answer'}]}});
    await chunk('faq',generatedId);await chunk('faq','t65-faq-delete');
    await as(()=>faq.delete(merchantId));
    assert.equal(await f.prisma.supportSetting.findUnique({where:{merchantId}}),null);
    for(const id of [generatedId,'t65-faq-delete'])assert.equal((await expectCurrent('faq',id,'withdrawn')).source,null);
    assert.equal(await f.prisma.knowledgeChunk.count({where:{merchantId,sourceType:'faq'}}),0);
    const before=await snapshot();await as(()=>faq.delete(merchantId));assert.deepEqual(await snapshot(),before);
  });

  await t.test('RAG-11 FAQ save and delete roll back source, work and chunks when queue or invalidation fails',async()=>{
    await mutate('/support/settings',{faqItems:[{id:'t65-faq-rollback',question:'Rollback public question',answer:'Original public answer'}]});
    for(const operation of ['save','delete'])for(const failure of ['queue','invalidation']){
      await chunk('faq','t65-faq-rollback');const before=await snapshot();
      await failWithin('faq',failure,async()=>{
        if(operation==='save')await mutate('/support/settings',{faqItems:[{id:'t65-faq-rollback',question:'Rollback public question',answer:'Rejected replacement answer'}]},500);
        else await assert.rejects(as(()=>faq.delete(merchantId)),new RegExp('synthetic_faq_policy_'+failure+'_rejected'));
        assert.deepEqual(await snapshot(),before);
      });
    }
  });

  await t.test('RAG-11 policy work uses resolved canonical precedence and keeps hash-identical public chunks',async()=>{
    const current=await f.prisma.merchant.findUnique({where:{id:merchantId}});
    await f.prisma.merchant.update({where:{id:merchantId},data:{storeSettings:{...current.storeSettings,company:{...current.storeSettings.company,serviceNames:['Public informational service']},policies:{...current.storeSettings.policies,general:'Canonical storefront override'},privateOwnerNote:'private-policy-canary'}}});
    const result=await mutate('/knowledge/policies',{general:'Hidden legacy policy text',returns:'Updated shared returns'});
    assert.equal(result.body.general,'Canonical storefront override');assert.equal(result.body.returns,'Updated shared returns');
    const first=await expectCurrent('policy','general');assert.equal(first.source.publicData.content,'Canonical storefront override');
    assert.equal((await expectCurrent('policy','returns')).source.publicData.content,'Updated shared returns');
    const valid=await chunk('policy','general');
    await f.prisma.publicSourceWork.update({where:{id:first.work.id},data:{status:'completed'}}); // Named already-indexed fixture, not an index-worker proof.
    const before=await latest('policy','general');
    // Isolate the writer transaction from the separate post-commit legacy
    // IndexPolicyUseCase, whose embedding lifecycle belongs to other gates.
    await as(()=>policy.upsert(merchantId,{general:'Another hidden legacy body'}));
    assert.deepEqual(await latest('policy','general'),before);
    assert.deepEqual(await f.prisma.knowledgeChunk.findUnique({where:{id:valid.id}}),valid);
    const stored=await f.prisma.merchant.findUnique({where:{id:merchantId}});
    assert.deepEqual(stored.storeSettings.company.serviceNames,['Public informational service']);
    assert.equal(stored.storeSettings.privateOwnerNote,'private-policy-canary');
    assert.equal(JSON.stringify((await read('policy','general')).publicData).includes('private-policy-canary'),false);
    assert.equal((await f.prisma.merchantPolicy.findUnique({where:{merchantId}})).general,'Another hidden legacy body');
  });

  await t.test('RAG-02 policy explicit clear overrides a legacy value and withdraws the resolved source',async()=>{
    await chunk('policy','returns');
    await mutate('/knowledge/policies',{returns:''});
    const stored=await f.prisma.merchant.findUnique({where:{id:merchantId}});
    assert.equal(stored.storeSettings.policies.returns,'');
    const withdrawn=await expectCurrent('policy','returns','withdrawn');assert.deepEqual(withdrawn.source.publicData,{});assert.equal(withdrawn.source.text,'');
    assert.equal(await f.prisma.knowledgeChunk.count({where:{merchantId,sourceType:'policy',sourceId:'returns'}}),0);
  });

  await t.test('RAG-11 clearing a whole policy container updates the canonical legacy fallback',async()=>{
    const path='/merchants/'+merchantId+'/store-settings';
    await mutate(path,{policies:{returns:'Settings return policy before whole clear'}});
    const before=await expectCurrent('policy','returns');
    // A named historical legacy row differs from the public settings override.
    await f.prisma.merchantPolicy.update({where:{merchantId},data:{returns:'Legacy public returns after whole clear'}});
    const old=await chunk('policy','returns');
    await mutate(path,{policies:null});
    const current=await expectCurrent('policy','returns');
    assert.equal(current.source.publicData.content,'Legacy public returns after whole clear');
    assert.notEqual(current.work.sourceHash,before.work.sourceHash);
    assert.notEqual(current.work.sourceVersion,before.work.sourceVersion);
    assert.equal(await f.prisma.knowledgeChunk.findUnique({where:{id:old.id}}),null);
    assert.equal((await f.prisma.merchant.findUnique({where:{id:merchantId}})).storeSettings.policies,null);
  });

  await t.test('RAG-02 clearing all checkout links withdraws only affected public policy identities',async()=>{
    const path='/merchants/'+merchantId+'/store-settings';
    await f.prisma.merchantPolicy.update({where:{merchantId},data:{returns:null,shipping:null}});
    await mutate(path,{checkoutPolicyLinks:{refundUrl:'https://public.example.test/returns',shippingUrl:'https://public.example.test/shipping'}});
    for(const id of ['returns','shipping']){await expectCurrent('policy',id);await chunk('policy',id);}
    const general=await expectCurrent('policy','general'),unrelated=await chunk('policy','general');
    await mutate(path,{checkoutPolicyLinks:null});
    for(const id of ['returns','shipping']){
      const current=await expectCurrent('policy',id,'withdrawn');assert.deepEqual(current.source.publicData,{});
      assert.equal(await f.prisma.knowledgeChunk.count({where:{merchantId,sourceType:'policy',sourceId:id}}),0);
    }
    assert.deepEqual(await latest('policy','general'),general.work);
    assert.deepEqual(await f.prisma.knowledgeChunk.findUnique({where:{id:unrelated.id}}),unrelated);
  });

  await t.test('RAG-11 policy writer waits on merchant before reading and preserves a concurrent company list',async()=>{
    await http.ready(actor.access_token);
    let release,readyResolve,readyReject,holderPid;
    const hold=new Promise(resolve=>{release=resolve;}),ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const names=['Concurrent informational service'];
    const holder=f.prisma.$transaction(async tx=>{
      const [identity]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;holderPid=identity.pid;
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR NO KEY UPDATE`;
      const current=await tx.merchant.findUnique({where:{id:merchantId}});
      await tx.merchant.update({where:{id:merchantId},data:{storeSettings:{...current.storeSettings,company:{...current.storeSettings.company,serviceNames:names}}}});
      readyResolve();await hold;
    });void holder.catch(readyReject);
    let pending,waiting=false;
    try{
      await ready;pending=mutate('/knowledge/policies',{shipping:'Public shipping after merchant lock'});void pending.catch(()=>{});
      const deadline=Date.now()+2000;
      do{waiting=Number(await f.runtime.db.sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ${holderPid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND position('SELECT' in upper(query))>0 AND position('merchants' in query)>0 AND position('FOR UPDATE' in upper(query))>0`))>0;}while(!waiting&&Date.now()<deadline);
    }finally{release();await Promise.allSettled([holder,...(pending?[pending]:[])]);}
    await holder;await pending;assert.equal(waiting,true,'policy JSON read must wait for the exact merchant blocker');
    const stored=await f.prisma.merchant.findUnique({where:{id:merchantId}});
    assert.deepEqual(stored.storeSettings.company.serviceNames,names);
    assert.equal(stored.storeSettings.policies.shipping,'Public shipping after merchant lock');
    assert.equal((await expectCurrent('policy','shipping')).source.publicData.content,'Public shipping after merchant lock');
  });

  await t.test('RAG-11 policy source and JSON merge roll back on queue and invalidation failure',async()=>{
    await mutate('/knowledge/policies',{payment:'Original public payment policy'});
    for(const failure of ['queue','invalidation']){
      await chunk('policy','payment');const before=await snapshot();
      await failWithin('policy',failure,async()=>{
        await mutate('/knowledge/policies',{payment:'Rejected public payment policy'},500);
        assert.deepEqual(await snapshot(),before);
      });
    }
  });

  await t.test('ONB-06 policy merge preserves product-company historical names without publishing private or service-only facts',async()=>{
    const productsId=f.products.merchant_id,current=await f.prisma.merchant.findUnique({where:{id:productsId}});
    const company={description:'Public product business description',serviceNames:['Historical informational service']};
    await f.prisma.merchant.update({where:{id:productsId},data:{storeSettings:{...current.storeSettings,company,privateOwnerNote:'private-products-owner-canary'}}});
    const companyWork=await f.prisma.publicSourceWork.count({where:{merchantId:productsId,sourceType:'company'}});
    await tenant.run({merchantId:productsId,userId:f.products.user_id,role:'owner'},()=>policy.upsert(productsId,{returns:'Product-company public returns'}));
    const stored=await f.prisma.merchant.findUnique({where:{id:productsId}});
    assert.deepEqual(stored.storeSettings.company,company);assert.equal(stored.storeSettings.privateOwnerNote,'private-products-owner-canary');
    assert.equal(stored.storeSettings.policies.returns,'Product-company public returns');
    const source=await tenant.run({merchantId:productsId,userId:f.products.user_id,role:'owner'},()=>reader.read(productsId,'company',productsId));
    assert.equal(source.publicData.description,'Public product business description');assert.equal(Object.hasOwn(source.publicData,'serviceNames'),false);
    assert.equal(source.text.includes('Historical informational service'),false);assert.equal(JSON.stringify(source).includes('private-products-owner-canary'),false);
    assert.equal(await f.prisma.publicSourceWork.count({where:{merchantId:productsId,sourceType:'company'}}),companyWork);
  });

  await t.test('RAG-07 FAQ/policy authorization stays server-owned and another tenant cannot overwrite this source',async()=>{
    const before=await snapshot();
    for(const [path,body]of [['/support/settings',{faqItems:[]}],['/knowledge/policies',{payment:'Unauthorized policy'}]]){
      await mutate(path,body,401,null);await mutate(path,body,403,f.staff);
      assert.deepEqual(await snapshot(),before);
    }
    const response=await mutate('/support/settings',{faqItems:[{id:'t65-foreign-faq',question:'Foreign public question',answer:'Foreign public answer'}]},200,f.foreign);
    assert.equal(response.body.merchantId,f.foreign.merchant_id);assert.deepEqual(await snapshot(),before);
    const foreignWork=await f.prisma.publicSourceWork.findFirst({where:{merchantId:f.foreign.merchant_id,sourceType:'faq',sourceId:'t65-foreign-faq',sourceVersion:{startsWith:'public-v1:'}}});
    assert.ok(foreignWork);assert.equal(foreignWork.merchantId,f.foreign.merchant_id);
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);
  });
}
