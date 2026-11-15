import assert from 'node:assert/strict';
import test from 'node:test';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {sqlText} from './service-company-http-fixture.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';
import {exerciseFaqPolicyWriterCases} from './business-rag-faq-policy-writers.cases.mjs';
import {exerciseBusinessPublicationCases} from './business-rag-publication.cases.mjs';
import {exerciseCatalogWriterCases} from './business-rag-catalog-writers.cases.mjs';
import {exerciseCategoryFanoutCases} from './business-rag-category-fanout.cases.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T65',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture();
  try{
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const {PrismaPublicBusinessSourcePages}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business-source-pages.js');
    const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
    const {PublicBusinessReconciler}=await import('../dist/modules/graph-rag/application/public-business-reconciler.js');
    const tenant=new TenantContextService(),scoped=registerTenantMiddleware(f.prisma,tenant),sources=new PrismaPublicBusinessSources(scoped,tenant);
    const jobs=new PublicSourceWorkService(scoped,tenant,sources),pages=new PrismaPublicBusinessSourcePages(scoped,tenant),reconcile=new PublicBusinessReconciler(pages,jobs);
    const own=f.owner.merchant_id,foreign=f.foreign.merchant_id;
    // Named offline-AI scenario: ordinary source registration still commits
    // while the real merchant policy denies unrelated paid SEO generation.
    // No transport or application provider is replaced.
    await f.prisma.aiGovernancePolicy.create({data:{merchantId:own,grants:[],version:1,updatedBy:f.owner.user_id}});
    const as=(merchantId,work)=>tenant.run({merchantId,userId:'synthetic-public-reconciler',role:'system'},work);
    const read=(type,id)=>as(own,()=>sources.read(own,type,id));
    const latest=(type,id)=>f.prisma.publicSourceWork.findFirst({where:{merchantId:own,sourceType:type,sourceId:id,sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
    const expectCurrent=async(type,id)=>{
      const source=await read(type,id),work=await latest(type,id);
      assert.ok(source,'actual canonical source required');assert.ok(work,'durable canonical work required');
      assert.equal(work.merchantId,own);assert.equal(work.sourceType,type);assert.equal(work.sourceId,id);
      assert.equal(work.sourceHash,source.sourceHash);assert.equal(work.publicationState,source.publicationState);
      assert.match(work.sourceVersion,/^public-v1:\d{20}$/);return{source,work};
    };
    await f.prisma.merchantBillingSubscription.upsert({where:{merchantId:own},
      create:{merchantId:own,planKey:'growth',status:'active'},update:{planKey:'growth',status:'active'}});
    const publicHttp=businessRagWriterHttp(f.runtime);
    let sequence=0,category,service,professional;
    const request=async(path,body,method='PUT')=>{
      const extra={'idempotency-key':'synthetic-public-edit-'+(++sequence)};
      if(path==='/settings/store')extra['if-match']=(await publicHttp.request(path,undefined,f.owner.access_token,'GET')).headers.get('etag');
      const response=await publicHttp.request(path,body,f.owner.access_token,method,extra);
      assert.ok([200,201].includes(response.status),JSON.stringify({path,status:response.status,body:response.body}));return response.body;
    };

    await t.test('RAG-11 actual company aliases and public hours persist while the index worker is offline',async()=>{
      for(const path of ['/merchants/me/store-settings','/merchants/'+own+'/store-settings','/settings/store']){
        await request(path,{company:{description:'Current presentation '+path,serviceNames:['Initial consultation','Follow-up']},
          businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}]});
      }
      assert.equal((await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings.company.description,'Current presentation /settings/store');
      const legacy=await f.prisma.publicSourceWork.findMany({where:{merchantId:own,sourceType:'company',sourceVersion:{not:{startsWith:'public-v1:'}}}});
      assert.equal(legacy.length,3);assert.ok(legacy.every(item=>item.status==='pending'&&item.sourceId===own));
      assert.equal(await f.prisma.publicSourceWork.count({where:{merchantId:own,sourceType:'company',sourceVersion:{startsWith:'public-v1:'}}}),0);
      const hours=await expectCurrent('business_hours',own);assert.deepEqual(hours.source.publicData.hours,[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}]);
      await as(own,()=>reconcile.reconcile(own));
      const company=await expectCurrent('company',own);assert.deepEqual(company.source.publicData.serviceNames,['Initial consultation','Follow-up']);
      assert.equal(await f.prisma.publicSourceWork.count({where:{merchantId:own,sourceVersion:{not:{startsWith:'public-v1:'}},status:{not:'completed'}}}),0);
    });

    await t.test('RAG-01 ordinary service and professional editors persist their public projection and link',async()=>{
      category=await request('/merchants/'+own+'/categories',{name:'Public consulting',slug:'public-consulting'},'POST');
      service=await request('/merchants/'+own+'/products',{name:'Public consultation',description:'Published service introduction',type:'service',categoryId:category.id,
        metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:[{sku:'synthetic-public-service',attributes:{},basePriceInCents:12000,stockQuantity:5}]},'POST');
      assert.equal((await expectCurrent('service',service.id)).source.publicData.name,'Public consultation');
      professional=await request('/merchants/'+own+'/service-professionals',{...f.profile,publicName:'Public professional',productIds:[service.id]},'POST');
      assert.equal((await expectCurrent('professional',professional.id)).source.publicData.name,'Public professional');
      assert.deepEqual((await expectCurrent('service',service.id)).source.publicData.professionals,[{id:professional.id,name:'Public professional'}]);
    });

    await t.test('RAG-11 public professional and category edits update the existing linked service evidence',async()=>{
      const before=(await expectCurrent('service',service.id)).work;
      professional=await request('/merchants/'+own+'/service-professionals/'+professional.id,{expectedVersion:professional.version,publicName:'Updated public professional'},'PATCH');
      const linked=await expectCurrent('service',service.id);assert.notEqual(linked.work.sourceHash,before.sourceHash);
      assert.deepEqual(linked.source.publicData.professionals,[{id:professional.id,name:'Updated public professional'}]);
      await request('/merchants/'+own+'/categories/'+category.id,{name:'Updated public category'});
      assert.equal((await expectCurrent('service',service.id)).source.publicData.category.name,'Updated public category');
    });

    await t.test('RAG-11 ordinary company name and category editors update the canonical presentation',async()=>{
      const original=await expectCurrent('company',own);
      await request('/merchants/me/name',{name:'Updated public business'});
      const named=await expectCurrent('company',own);
      assert.equal(named.source.publicData.name,'Updated public business');
      assert.notEqual(named.work.sourceHash,original.work.sourceHash);
      const categoryName='consulting'; // Real UpdateMerchantThemeUseCase whitelist.
      await request('/merchants/me/store-category',{storeCategory:categoryName});
      assert.equal((await expectCurrent('company',own)).source.publicData.storeCategory,categoryName);
    });

    await t.test('RAG-11 actual variant replacement retires old IDs and updates the public publication and details',async()=>{
      const before=await expectCurrent('service',service.id);
      const replacement=await request('/merchants/'+own+'/products/'+service.id+'/variants',{
        variants:[{sku:'synthetic-public-service-republished',attributes:{},basePriceInCents:12500,stockQuantity:5}],
        product:{isActive:false},
      });
      assert.equal(replacement.variants.length,1);
      const variants=await f.prisma.productVariant.findMany({where:{productId:service.id}});
      assert.equal(variants.filter(row=>!row.isActive).length,1,'The original variant is retained as retired history');
      const retired=await expectCurrent('service',service.id);
      assert.equal(retired.source.publicationState,'withdrawn');assert.equal(retired.source.text,'');
      assert.notEqual(retired.work.sourceHash,before.work.sourceHash);
      const saved=await request('/merchants/'+own+'/products/'+service.id+'/variants',{
        variants:[{id:replacement.variants[0].id,sku:'synthetic-public-service-republished',attributes:{},basePriceInCents:12500,stockQuantity:5}],
        product:{isActive:true,description:'Current public service after replacement'},
      });
      assert.equal(saved.variants.length,1);
      const published=await expectCurrent('service',service.id);
      assert.equal(published.source.publicationState,'published');
      assert.match(published.source.text,/Current public service after replacement/);
      const variantId=saved.variants[0].id;
      await request('/merchants/'+own+'/products/'+service.id+'/variants/'+variantId,{sku:'synthetic-public-service-renamed'});
      assert.deepEqual((await expectCurrent('service',service.id)).work,published.work,'A private SKU change does not alter public service text');
      await request('/merchants/'+own+'/products/'+service.id+'/variants/'+variantId,{basePriceInCents:13000});
      assert.deepEqual((await expectCurrent('service',service.id)).work,published.work,'Live price changes stay outside knowledge-source revisions');
      await request('/merchants/'+own+'/products/'+service.id,{description:'Updated public service introduction'});
      assert.match((await expectCurrent('service',service.id)).source.text,/Updated public service introduction/);
    });

    await t.test('RAG-11 actual FAQ replacement and empty-list removal retain individual source identities',async()=>{
      await request('/support/settings',{faqItems:[{id:'public-faq',question:'How does the business work?',answer:'Published answer'}]});
      assert.equal((await expectCurrent('faq','public-faq')).source.publicData.answer,'Published answer');
      await request('/support/settings',{faqItems:[{id:'public-faq',question:'How does the business work?',answer:'Updated published answer'}]});
      assert.equal((await expectCurrent('faq','public-faq')).source.publicData.answer,'Updated published answer');
      await request('/support/settings',{faqItems:[]});
      assert.equal(await read('faq','public-faq'),null);
      const retired=await latest('faq','public-faq');assert.ok(retired);assert.equal(retired.publicationState,'withdrawn');
      const discovered=await as(own,()=>pages.pageIdentities(own,'faq'));assert.ok(discovered.sourceIds.includes('public-faq'));
      const restart=new PublicBusinessReconciler(pages,jobs);await as(own,()=>restart.reconcile(own));
      assert.deepEqual(await latest('faq','public-faq'),retired);
    });

    await t.test('RAG-02 unchanged legacy FAQ collection survives discovery while actual public edits invalidate it offline',async()=>{
      const item={id:'public-faq-preserved-legacy',question:'Public legacy question',answer:'Current public legacy answer'};
      await request('/support/settings',{faqItems:[item]});
      const seed=()=>f.prisma.knowledgeChunk.create({data:{merchantId:own,sourceType:'faq',sourceId:'faq-collection',
        content:'P: '+item.question+'\nR: '+item.answer,embedding:'[]',metadata:{question:item.question,itemId:item.id}}});
      const legacy=await seed();
      // Named historical private-only metadata must not become source content
      // or force removal of an unchanged valid legacy representation.
      await f.prisma.supportSetting.update({where:{merchantId:own},data:{faqItems:[{...item,privateMemo:'SYNTHETIC-PRIVATE-FAQ-MEMO'}]}});
      await request('/support/settings',{faqItems:[item]});
      const ids=await as(own,()=>pages.pageIdentities(own,'faq'));
      assert.equal(ids.sourceIds.includes(item.id),true);assert.equal(ids.sourceIds.includes('faq-collection'),false);
      await as(own,()=>reconcile.reconcile(own));
      assert.deepEqual(await f.prisma.knowledgeChunk.findUnique({where:{id:legacy.id}}),legacy);
      assert.equal(await f.prisma.publicSourceWork.count({where:{merchantId:own,sourceType:'faq',sourceId:'faq-collection'}}),0);
      assert.equal(JSON.stringify(await read('faq',item.id)).includes('SYNTHETIC-PRIVATE-FAQ-MEMO'),false);
      await request('/support/settings',{faqItems:[{...item,answer:'Updated public legacy answer'}]});
      assert.equal(await f.prisma.knowledgeChunk.findUnique({where:{id:legacy.id}}),null);
      const clear=await seed();await request('/support/settings',{faqItems:[]});
      assert.equal(await f.prisma.knowledgeChunk.findUnique({where:{id:clear.id}}),null);
      await request('/support/settings',{faqItems:[item]});const removed=await seed();
      const {PrismaSupportSettingsRepository}=await import('../dist/modules/support/infrastructure/prisma-support-settings.repository.js');
      await as(own,()=>new PrismaSupportSettingsRepository(scoped).delete(own));
      assert.equal(await f.prisma.knowledgeChunk.findUnique({where:{id:removed.id}}),null);
      assert.equal(await read('faq',item.id),null);
    });

    await t.test('RAG-01 a real individual FAQ named faq-collection remains discoverable and current',async()=>{
      const item={id:'faq-collection',question:'Real individual public question',answer:'Real individual public answer'};
      await request('/support/settings',{faqItems:[item]});
      assert.equal((await as(own,()=>pages.pageIdentities(own,'faq'))).sourceIds.includes(item.id),true);
      await as(own,()=>reconcile.reconcile(own));
      const current=await expectCurrent('faq',item.id);
      assert.equal(current.source.publicationState,'published');assert.equal(current.source.publicData.answer,item.answer);
      await request('/support/settings',{faqItems:[]});
      assert.equal((await latest('faq',item.id)).publicationState,'withdrawn');
    });

    await t.test('RAG-11 actual policy editor and store-settings policy aliases feed the same canonical source',async()=>{
      await request('/knowledge/policies',{general:'Published business terms',returns:'Published returns policy'});
      assert.equal((await expectCurrent('policy','general')).source.publicData.content,'Published business terms');
      assert.equal((await expectCurrent('policy','returns')).source.publicData.content,'Published returns policy');
      await request('/merchants/me/store-settings',{policies:{returns:'Updated public returns'}});
      assert.equal((await expectCurrent('policy','returns')).source.publicData.content,'Updated public returns');
      await request('/knowledge/policies',{general:''});
      assert.equal((await expectCurrent('policy','general')).source.publicationState,'withdrawn');
    });

    await t.test('RAG-02 professional withdrawal and category removal immediately change canonical service evidence',async()=>{
      professional=await request('/merchants/'+own+'/service-professionals/'+professional.id+'/deactivate',{expectedVersion:professional.version},'POST');
      assert.equal((await expectCurrent('professional',professional.id)).source.publicationState,'withdrawn');
      assert.deepEqual((await expectCurrent('service',service.id)).source.publicData.professionals,[]);
      await request('/merchants/'+own+'/categories/'+category.id,undefined,'DELETE');
      assert.equal(Object.hasOwn((await expectCurrent('service',service.id)).source.publicData,'category'),false);
      await request('/merchants/'+own+'/products/'+service.id,undefined,'DELETE');
      assert.equal((await expectCurrent('service',service.id)).source.publicationState,'withdrawn');
    });

    await t.test('RAG-11 adjacent settings writers lock before merging concurrent public company data',async()=>{
      for(const [path,body]of [
        ['/auth/me',{name:'Synthetic owner after lock',phone:'11999990000'}],
        ['/merchants/me/rules',{policies:{privacyUrl:'https://public.example.test/privacy'}}],
        ['/merchants/'+own+'/store-settings/seo',{seo:{title:'Synthetic current public title'}}],
        ['/merchants/me/cross-sell-config',{enabled:false,limits:{cooldownSeconds:321}}],
      ]){
        await publicHttp.ready(f.owner.access_token);
        let release,readyResolve,readyReject,holderPid;
        const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),hold=new Promise(resolve=>{release=resolve;});
        const names=['Concurrent public service '+path];
        const holder=f.prisma.$transaction(async tx=>{
          const [identity]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;holderPid=identity.pid;
          // Allows the idempotency/audit FK's KEY SHARE, but blocks the actual
          // canonical writer's SELECT FOR UPDATE before its JSON read.
          await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own} FOR NO KEY UPDATE`;
          const current=await tx.merchant.findUnique({where:{id:own}});
          await tx.merchant.update({where:{id:own},data:{storeSettings:{...current.storeSettings,company:{...current.storeSettings.company,serviceNames:names}}}});
          readyResolve();await hold;
        });
        void holder.catch(readyReject);
        let pending,waiting=false,response;
        try{
          await ready;pending=publicHttp.request(path,body,f.owner.access_token,'PUT');
          const deadline=Date.now()+2000;
          do{waiting=Number(await f.runtime.db.sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ${holderPid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND position('SELECT' in upper(query))>0 AND position('merchants' in query)>0 AND position('FOR UPDATE' in upper(query))>0`))>0;}while(!waiting&&Date.now()<deadline);
        }finally{release();const settled=await Promise.allSettled([holder,...(pending?[pending]:[])]);if(pending&&settled[1].status==='fulfilled')response=settled[1].value;}
        await holder;assert.ok(response);assert.equal(response.status,200);assert.equal(waiting,true,'Exact PostgreSQL blocker must prove the JSON writer waits before reading');
        const stored=(await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings;
        assert.deepEqual(stored.company.serviceNames,names);
        if(path==='/auth/me'){assert.equal(stored.owner_name,body.name);assert.equal(stored.owner_phone,body.phone);}
        else if(path==='/merchants/me/rules')assert.equal(stored.checkoutPolicyLinks.privacyUrl,body.policies.privacyUrl);
        else if(body.seo)assert.equal(stored.seo.title,body.seo.title);
        else assert.equal(stored.crossSell.limits.cooldownSeconds,body.limits.cooldownSeconds);
      }
    });

    await t.test('RAG-11 queue and invalidation failures roll back actual company and policy source writers',async()=>{
      for(const [type,path,body]of [
        ['company','/merchants/me/store-settings',{company:{description:'Must roll back public presentation'}}],
        ['policy','/knowledge/policies',{general:'Must roll back public policy'}],
      ]){
        const snapshot=async()=>({merchant:await f.prisma.merchant.findUnique({where:{id:own}}),policy:await f.prisma.merchantPolicy.findUnique({where:{merchantId:own}}),
          work:await f.prisma.publicSourceWork.findMany({where:{merchantId:own},orderBy:{id:'asc'}}),chunks:await f.prisma.knowledgeChunk.findMany({where:{merchantId:own},orderBy:{id:'asc'}})});
        const before=await snapshot();
        await f.runtime.db.sql(`CREATE FUNCTION synthetic_source_writer_failure_t65() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id=${sqlText(own)} AND NEW.source_type::text=${sqlText(type)} THEN RAISE EXCEPTION 'synthetic_source_work_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_source_writer_failure_t65 BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION synthetic_source_writer_failure_t65();`);
        try{
          const response=await publicHttp.request(path,body,f.owner.access_token,'PUT',{'idempotency-key':'synthetic-failed-edit-'+(++sequence)});assert.equal(response.status,500);
          assert.deepEqual(await snapshot(),before);
        }finally{await f.runtime.db.sql('DROP TRIGGER synthetic_source_writer_failure_t65 ON public_source_work; DROP FUNCTION synthetic_source_writer_failure_t65();');}
      }
    });

    await t.test('RAG-01 scoped SQL pages include legacy current and missing identities without losing the last page',async()=>{
      const ids=Array.from({length:105},(_,index)=>'legacy-public-professional-'+String(index).padStart(3,'0'));
      await f.prisma.serviceProfessional.createMany({data:ids.map(id=>({id,merchantId:own,publicName:'Draft '+id,timeZone:'UTC',isActive:false,isPublished:false}))});
      await f.prisma.serviceProfessional.create({data:{id:'foreign-professional-for-page',merchantId:foreign,publicName:'Foreign published name',timeZone:'UTC',isPublished:true}});
      await f.prisma.publicSourceWork.create({data:{merchantId:own,sourceType:'professional',sourceId:'missing-professional-for-page',sourceVersion:'legacy-dirty-identity',sourceHash:'0'.repeat(64),publicationState:'withdrawn'}});
      const found=[],seen=new Set();let cursor;
      for(let page=0;page<4;page++){
        const result=await as(own,()=>pages.pageIdentities(own,'professional',cursor,100));
        assert.ok(result.sourceIds.length<=100);found.push(...result.sourceIds);
        if(!result.nextCursor)break;
        assert.equal(seen.has(result.nextCursor),false);seen.add(result.nextCursor);cursor=result.nextCursor;
      }
      assert.equal(new Set(found).size,found.length);
      assert.deepEqual([...found].sort(),[professional.id,...ids,'missing-professional-for-page'].sort());
      assert.equal(found.includes('foreign-professional-for-page'),false);
      await as(own,()=>new PublicBusinessReconciler(pages,jobs).reconcile(own));
      const missing=await latest('professional','missing-professional-for-page');assert.ok(missing);assert.equal(missing.publicationState,'withdrawn');
      for(const id of ids){const current=await expectCurrent('professional',id);assert.equal(current.source.publicationState,'withdrawn');assert.equal(current.source.text,'');}
    });

    await t.test('RAG-07 foreign and absent reconciliation scopes cannot discover or mutate this business',async()=>{
      const before=await f.prisma.publicSourceWork.findMany({where:{merchantId:own},orderBy:{id:'asc'}});
      await assert.rejects(pages.pageIdentities(own,'company'),/public_source_foreign_tenant/);
      await assert.rejects(as(foreign,()=>pages.pageIdentities(own,'company')),/public_source_foreign_tenant/);
      await assert.rejects(as(foreign,()=>reconcile.reconcile(own)),/public_source_foreign_tenant/);
      assert.deepEqual(await f.prisma.publicSourceWork.findMany({where:{merchantId:own},orderBy:{id:'asc'}}),before);
      assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);
    });
    await t.test('RAG-02 offline modality round trip retains historical names and queues fresh professional evidence',async()=>{
      const profile=await request('/merchants/'+own+'/service-professionals',{...f.profile,publicName:'Public profile across modality change'},'POST');
      const indexed=(await expectCurrent('professional',profile.id)).work;
      await f.prisma.publicSourceWork.update({where:{id:indexed.id},data:{status:'completed',indexedAt:new Date(),embeddingModel:'synthetic-history-only',embeddingDimensions:384}});
      const historical=await f.prisma.publicSourceWork.findUnique({where:{id:indexed.id}});
      await f.prisma.knowledgeChunk.create({data:{merchantId:own,sourceType:'professional',sourceId:profile.id,content:'Synthetic previously indexed public profile',embedding:'[]',metadata:{sourceHash:indexed.sourceHash,sourceVersion:indexed.sourceVersion}}});
      const company=(await f.prisma.merchant.findUnique({where:{id:own}})).storeSettings.company;
      assert.ok(company.serviceNames.length>0);
      await request('/merchants/me/business-mode',{expectedBusinessMode:'services',businessMode:'products'});
      const products=await f.prisma.merchant.findUnique({where:{id:own}});
      assert.equal(products.businessMode,'products');assert.deepEqual(products.storeSettings.company,company);
      assert.equal(Object.hasOwn((await read('company',own)).publicData,'serviceNames'),false);
      assert.equal((await read('professional',profile.id)).publicationState,'withdrawn');
      assert.equal(await f.prisma.knowledgeChunk.count({where:{merchantId:own,sourceType:{in:['professional','service']}}}),0);
      const first=await f.prisma.publicSourceWork.findMany({where:{merchantId:own,sourceType:'professional',sourceId:profile.id,sourceVersion:{startsWith:'publication-dirty-v1:'}}});
      assert.equal(first.length,1);assert.equal(first[0].status,'pending');
      await request('/merchants/me/business-mode',{expectedBusinessMode:'products',businessMode:'services'});
      const dirty=await f.prisma.publicSourceWork.findMany({where:{merchantId:own,sourceType:'professional',sourceId:profile.id,sourceVersion:{startsWith:'publication-dirty-v1:'}}});
      assert.equal(dirty.length,2);assert.ok(dirty.every(row=>row.status==='pending'));
      assert.equal((await read('professional',profile.id)).sourceHash,indexed.sourceHash);
      await as(own,()=>reconcile.reconcile(own));
      const current=await expectCurrent('professional',profile.id);
      assert.equal(current.source.publicationState,'published');assert.notEqual(current.work.id,indexed.id);
      assert.equal(current.work.sourceHash,indexed.sourceHash);assert.equal(current.work.status,'pending');
      assert.deepEqual(await f.prisma.publicSourceWork.findUnique({where:{id:indexed.id}}),historical,'Completed historical revisions are never reopened');
      assert.equal(await f.prisma.publicSourceWork.count({where:{merchantId:own,sourceType:'professional',sourceId:profile.id,sourceVersion:{startsWith:'publication-dirty-v1:'},status:{not:'completed'}}}),0);
      assert.deepEqual((await read('company',own)).publicData.serviceNames,company.serviceNames);
    });

    await exerciseBusinessPublicationCases(t,f);
    await exerciseCatalogWriterCases(t,f);
    await exerciseFaqPolicyWriterCases(t,f);
    await exerciseCategoryFanoutCases(t,f);
    assert.ok(await f.prisma.aiGovernanceDecision.count({where:{merchantId:own,source:'product_seo',allowed:false}})>0);
  }finally{await f.close();}
});
