import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {insert,at,baselineSnapshot} from './service-migration-fixture.mjs';

test('T63',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  let prisma;
  try{
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const tenant=new TenantContextService(),scoped=registerTenantMiddleware(prisma,tenant),sources=new PrismaPublicBusinessSources(scoped,tenant);
    const canary='PRIVATE-SYNTHETIC-SOURCE-CANARY',contexts=[];
    const as=(merchantId,work)=>tenant.run({merchantId,userId:'synthetic-source-reader',role:'system'},work);
    const read=(merchantId,type,id)=>as(merchantId,()=>sources.read(merchantId,type,id));
    const values=[['clinic','Synthetic clinic','Neurology','Public clinic information'],
      ['salon','Synthetic salon','Beauty','Public haircut and hair care information'],
      ['consulting','Synthetic consulting','Consulting','Public business consulting information']];
    for(const [id,name,category,description] of values){
      const merchantId='public-'+id;
      await prisma.merchant.create({data:{id:merchantId,name,storeCategory:category,businessMode:'services',businessModeSelectedAt:new Date(),
        storeSettings:{company:{description,serviceNames:['Public '+id+' introduction','Public '+id+' follow-up'],phone:'+5521999990000',address:{street:'Synthetic public street',city:'Synthetic city'}},
          businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}],privateCredentials:{token:canary},internalNotes:canary}}});
      await prisma.merchantUser.create({data:{id:merchantId+'-owner',merchantId,email:canary+'-'+id+'@example.test',passwordHash:canary,role:'owner'}});
      const cat=await prisma.productCategory.create({data:{id:merchantId+'-category',merchantId,name:category,slug:id,description:'Public category'}});
      await prisma.product.create({data:{id:merchantId+'-service',merchantId,name:'Public '+id+' service',description:'Published service description',type:'service',categoryId:cat.id,
        metadata:{serviceType:'presencial',serviceSchedule:{durationMinutes:30,slots:[{id:canary,date:'2030-01-02',startTime:'10:00'}]},privateNotes:canary},
        variants:{create:{id:merchantId+'-variant',sku:merchantId+'-sku',price:{create:{basePriceInCents:34999}},stock:{create:{quantity:37}}}}}});
      const professional=await prisma.serviceProfessional.create({data:{id:merchantId+'-professional',merchantId,publicName:'Public '+id+' professional',
        publicProfile:{description:'Public biography',specialties:[category],privateNotes:canary,patients:[canary]},timeZone:'America/Sao_Paulo',isPublished:true}});
      await prisma.professionalService.create({data:{merchantId,professionalId:professional.id,productId:merchantId+'-service'}});
      await prisma.supportSetting.create({data:{merchantId,faqItems:[{id:'public-faq',question:'How does '+name+' work?',answer:description,privateNotes:canary}]}});
      await prisma.merchantPolicy.create({data:{merchantId,general:'Public '+id+' policy'}});
      contexts.push({merchantId,name,category,description});
    }
    const prior=[insert('merchants',{id:'base-products',name:'Synthetic preserved products',updated_at:at}),
      insert('products',{id:'base-physical',merchant_id:'base-products',name:'Preserved product',type:'physical',updated_at:at}),
      insert('product_variants',{id:'base-physical-variant',product_id:'base-physical',sku:'preserved-sku',updated_at:at}),
      insert('product_prices',{id:'base-physical-price',variant_id:'base-physical-variant',base_price_in_cents:10999,updated_at:at}),
      insert('product_stock',{id:'base-stock',variant_id:'base-physical-variant',quantity:9,reserved:2,updated_at:at}),
      insert('storefront_carts',{id:'base-cart',merchant_id:'base-products',session_id:'base-cart-ref',items:[{sku:'preserved-sku',quantity:2,unitPriceCents:10999}],total:21998,updated_at:at,expires_at:'2031-01-01T00:00:00Z'})];
    await runtime.db.sql(prior.join('\n'));
    const commerceBefore=await baselineSnapshot(runtime.db);
    for(const context of contexts){
      await t.test('RAG-01 RAG-07 six canonical public source types for '+context.name,async()=>{
        const {merchantId,name,category,description}=context;
        const company=await read(merchantId,'company',merchantId),hours=await read(merchantId,'business_hours',merchantId),
          professional=await read(merchantId,'professional',merchantId+'-professional'),service=await read(merchantId,'service',merchantId+'-service'),
          faq=await read(merchantId,'faq','public-faq'),policy=await read(merchantId,'policy','general');
        assert.deepEqual(company.publicData,{name,storeCategory:category,description,serviceNames:['Public '+merchantId.slice(7)+' introduction','Public '+merchantId.slice(7)+' follow-up'],phone:'+5521999990000',address:{street:'Synthetic public street',city:'Synthetic city'}});
        assert.ok(company.text.includes('Public '+merchantId.slice(7)+' introduction'));
        assert.deepEqual(hours.publicData.hours,[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}]);
        assert.deepEqual(professional.publicData,{name:'Public '+merchantId.slice(7)+' professional',description:'Public biography',specialties:[category],timeZone:'America/Sao_Paulo'});
        assert.equal(service.publicData.durationMinutes,30);assert.equal(service.publicData.serviceType,'presencial');
        assert.deepEqual(service.publicData.category,{id:merchantId+'-category',name:category});
        assert.deepEqual(service.publicData.professionals,[{id:merchantId+'-professional',name:professional.publicData.name}]);
        assert.deepEqual(faq.publicData,{question:'How does '+name+' work?',answer:description});
        assert.equal(policy.publicData.content,'Public '+merchantId.slice(7)+' policy');
        for(const result of [company,hours,professional,service,faq,policy]){
          assert.equal(result.merchantId,merchantId);assert.equal(result.publicationState,'published');
          assert.match(result.sourceHash,/^[a-f0-9]{64}$/);assert.ok(result.sourceVersion);assert.ok(result.text);
          assert.equal(JSON.stringify(result).includes(canary),false);assert.equal(Object.hasOwn(result.publicData,'price'),false);
          assert.equal(Object.hasOwn(result.publicData,'stock'),false);assert.equal(Object.hasOwn(result.publicData,'slots'),false);
        }
      });
    }
    await t.test('RAG-07 rejects absent and foreign tenant context before public company lookup',async()=>{
      await assert.rejects(sources.read('public-clinic','company','public-clinic'),/public_source_foreign_tenant/);
      await assert.rejects(as('public-salon',()=>sources.read('public-clinic','company','public-clinic')),/public_source_foreign_tenant/);
      assert.equal(await read('public-salon','professional','public-clinic-professional'),null);
      assert.equal(await read('public-salon','service','public-clinic-service'),null);
      assert.equal(await read('public-salon','company','public-clinic'),null);
    });
    await t.test('RAG-01 canonical edit and explicit public contact change current hash without auth fallback',async()=>{
      const before=await read('public-clinic','company','public-clinic');
      const merchant=await prisma.merchant.findUnique({where:{id:'public-clinic'}});
      await prisma.merchant.update({where:{id:merchant.id},data:{storeSettings:{...merchant.storeSettings,company:{...merchant.storeSettings.company,description:'Changed public presentation',email:'public-contact@example.test'}}}});
      const after=await read(merchant.id,'company',merchant.id);
      assert.equal(after.publicData.description,'Changed public presentation');assert.equal(after.publicData.email,'public-contact@example.test');
      assert.notEqual(after.sourceHash,before.sourceHash);assert.equal(JSON.stringify(after).includes(canary),false);
      const updated=await prisma.merchant.findUnique({where:{id:merchant.id}});
      await prisma.merchant.update({where:{id:merchant.id},data:{storeSettings:{...updated.storeSettings,privateCredentials:{token:'different-private-token'}}}});
      assert.equal((await read(merchant.id,'company',merchant.id)).sourceHash,after.sourceHash);
    });
    await t.test('RAG-10 immediate withdrawal of professional and relationship is canonical',async()=>{
      const before=await read('public-clinic','service','public-clinic-service');
      await prisma.serviceProfessional.update({where:{id:'public-clinic-professional'},data:{isPublished:false,version:{increment:1}}});
      const professional=await read('public-clinic','professional','public-clinic-professional');
      assert.equal(professional.publicationState,'withdrawn');assert.equal(professional.text,'');assert.deepEqual(professional.publicData,{});
      const service=await read('public-clinic','service','public-clinic-service');
      assert.deepEqual(service.publicData.professionals,[]);assert.notEqual(service.sourceHash,before.sourceHash);
    });
    await t.test('RAG-01 a legacy public introduction remains readable without changing write validation',async()=>{
      const row=await prisma.merchant.findUnique({where:{id:'public-clinic'}}),description='Legacy public company introduction. '.repeat(40);
      assert.ok(description.length>1200);
      await prisma.merchant.update({where:{id:row.id},data:{storeSettings:{...row.storeSettings,company:{...row.storeSettings.company,description}}}});
      const result=await read(row.id,'company',row.id);
      assert.equal(result.publicData.description,description.trim());assert.ok(result.text.includes(description.trim()));
      assert.equal(result.publicationState,'published');assert.equal(JSON.stringify(result).includes(canary),false);
    });
    await t.test('RAG-10 canonical modality withdraws service knowledge despite stale published flags',async()=>{
      const published=new Map();
      for(const [type,id] of [['professional','public-salon-professional'],['service','public-salon-service']])
        published.set(type,await read('public-salon',type,id));
      await prisma.merchant.update({where:{id:'public-salon'},data:{businessMode:'products'}});
      const withdrawn=new Map();
      for(const [type,id] of [['professional','public-salon-professional'],['service','public-salon-service']]){
        const result=await read('public-salon',type,id);assert.equal(result.publicationState,'withdrawn');assert.equal(result.text,'');assert.deepEqual(result.publicData,{});
        assert.notEqual(result.sourceVersion,published.get(type).sourceVersion);withdrawn.set(type,result);
      }
      assert.equal((await read('public-salon','company','public-salon')).publicationState,'published');
      const company=await read('public-salon','company','public-salon');
      assert.equal(Object.hasOwn(company.publicData,'serviceNames'),false);assert.equal(company.text.includes('Public salon introduction'),false);
      assert.deepEqual((await prisma.merchant.findUnique({where:{id:'public-salon'}})).storeSettings.company.serviceNames,['Public salon introduction','Public salon follow-up']);
      await prisma.merchant.update({where:{id:'public-salon'},data:{businessMode:'services'}});
      for(const [type,id] of [['professional','public-salon-professional'],['service','public-salon-service']]){
        const result=await read('public-salon',type,id);
        assert.equal(result.publicationState,'published');assert.equal(result.sourceHash,published.get(type).sourceHash);
        assert.notEqual(result.sourceVersion,withdrawn.get(type).sourceVersion);
        assert.notEqual(result.sourceVersion,published.get(type).sourceVersion,'Reopening publication cannot adopt the old work identity');
      }
      assert.deepEqual((await read('public-salon','company','public-salon')).publicData.serviceNames,['Public salon introduction','Public salon follow-up']);
    });
    await t.test('RAG-07 rejects a foreign category even when legacy global FK permits it',async()=>{
      await prisma.product.update({where:{id:'public-clinic-service'},data:{categoryId:'public-consulting-category'}});
      await assert.rejects(read('public-clinic','service','public-clinic-service'),/public_source_foreign_tenant/);
      await prisma.product.update({where:{id:'public-clinic-service'},data:{categoryId:'public-clinic-category'}});
    });
    await t.test('RAG-10 explicit policy removal does not resurrect old policy text',async()=>{
      const row=await prisma.merchant.findUnique({where:{id:'public-consulting'}});
      await prisma.merchant.update({where:{id:row.id},data:{storeSettings:{...row.storeSettings,policies:{general:''}}}});
      const result=await read(row.id,'policy','general');assert.equal(result.publicationState,'withdrawn');assert.equal(result.text,'');assert.deepEqual(result.publicData,{});
      assert.equal((await prisma.merchantPolicy.findUnique({where:{merchantId:row.id}})).general,'Public consulting policy');
    });
    await t.test('RAG-10 service publication follows active variants without inventing price or stock requirements',async()=>{
      const before=await read('public-consulting','service','public-consulting-service');
      await prisma.productVariant.create({data:{id:'public-consulting-second-variant',productId:'public-consulting-service',sku:'public-consulting-second',isActive:false}});
      assert.equal((await read('public-consulting','service','public-consulting-service')).publicationState,'published','An inactive sibling does not withdraw another active variant');
      await prisma.productVariant.update({where:{id:'public-consulting-variant'},data:{isActive:false}});
      const withdrawn=await read('public-consulting','service','public-consulting-service');
      assert.equal(withdrawn.publicationState,'withdrawn');assert.deepEqual(withdrawn.publicData,{});assert.equal(withdrawn.text,'');
      assert.notEqual(withdrawn.sourceHash,before.sourceHash);assert.notEqual(withdrawn.sourceVersion,before.sourceVersion);
      assert.deepEqual((await read('public-consulting','company','public-consulting')).publicData.serviceNames,['Public consulting introduction','Public consulting follow-up'],'The informational business list is independent of catalog scheduling offers');
      await prisma.productVariant.update({where:{id:'public-consulting-second-variant'},data:{isActive:true}});
      const published=await read('public-consulting','service','public-consulting-service');
      assert.equal(published.publicationState,'published');assert.equal(published.sourceHash,before.sourceHash);
      assert.notEqual(published.sourceVersion,withdrawn.sourceVersion);assert.notEqual(published.sourceVersion,before.sourceVersion);
      assert.equal(await prisma.productPrice.findUnique({where:{variantId:'public-consulting-second-variant'}}),null,'Public description does not manufacture a price');
      assert.equal(await prisma.productStock.count({where:{variantId:'public-consulting-second-variant'}}),0,'Public service information does not require physical stock');
    });
    await t.test('RAG-01 duplicate FAQ identity is ambiguous and missing source remains missing',async()=>{
      await prisma.supportSetting.update({where:{merchantId:'public-consulting'},data:{faqItems:[{id:'duplicated',question:'Question one?',answer:'Answer one'},{id:'duplicated',question:'Question two?',answer:'Answer two'}]}});
      await assert.rejects(read('public-consulting','faq','duplicated'),/public_source_ambiguous/);
      assert.equal(await read('public-consulting','faq','not-found'),null);
      assert.equal(await read('public-consulting','policy','providerToken'),null);
      assert.equal(await read('public-consulting','service','base-physical'),null);
    });
    await t.test('REG-01 source reads preserve canonical product cart price stock and source work',async()=>{
      assert.deepEqual(await baselineSnapshot(runtime.db),commerceBefore);
      assert.equal(await prisma.publicSourceWork.count(),0);assert.equal(await prisma.knowledgeChunk.count(),0);
      assert.equal(await prisma.serviceAppointment.count(),0);assert.equal(await prisma.paymentIntent.count(),0);
      assert.equal(runtime.evidence().canonicalAppModule,true);assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().authOverrides,false);
      assert.equal(runtime.evidence().providerCalls,0);
    });
  }finally{if(prisma)await prisma.$disconnect();await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
