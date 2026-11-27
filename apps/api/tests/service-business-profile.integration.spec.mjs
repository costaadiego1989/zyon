import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {insert} from './service-migration-fixture.mjs';

const password='SyntheticPassword123!';
const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";
test('T9',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true,serviceReleaseFixture:'matching'});
  try{
    const request=async(path,body,token,method='POST')=>{
      const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,body:await response.json()};
    };
    const register=async(email,mode)=>{
      const response=await request('/auth/register',{merchant_name:'Synthetic profile '+mode,email,password,business_mode:mode});
      assert.equal(response.status,201,JSON.stringify(response));return response.body;
    };
    const profile=async token=>{const response=await request('/merchants/me',undefined,token,'GET');assert.equal(response.status,200,JSON.stringify(response));return response.body;};
    const product=await register('profile-products@example.test','products');
    await t.test('product fields survive reload and new login with additive capabilities',async()=>{
      await runtime.db.sql(`UPDATE merchants SET store_category='electronics',budget_mode_enabled=true,store_settings='{"company":{"description":"Synthetic retained company"}}'::jsonb,
        melhor_envio_access_token='private-profile-canary',melhor_envio_refresh_token='private-profile-canary' WHERE id=${sqlText(product.merchant_id)}`);
      const before=await profile(product.access_token);
      const login=await request('/auth/login',{email:'profile-products@example.test',password});assert.equal(login.status,201);
      const after=await profile(login.body.access_token);
      for(const field of ['id','name','slug','storeCategory','plan','budgetModeEnabled','storeSettings','theme','role','userId'])assert.deepEqual(after[field],before[field],field);
      assert.equal(after.id,product.merchant_id);assert.equal(after.role,'owner');assert.equal(after.storeCategory,'electronics');
      assert.equal(after.budgetModeEnabled,true);assert.equal(after.storeSettings.company.description,'Synthetic retained company');
      assert.equal(after.businessMode,'products');assert.equal(after.businessModeSelectionState,'selected');
      assert.equal(after.policyVersion,null);assert.equal(after.servicePolicy,null);assert.equal(after.servicePolicyStatus,'unconfigured');
      assert.deepEqual(after.capabilities,{products:true,serviceAdministration:false,serviceBooking:false,reconcileExisting:true});
      assert.equal(JSON.stringify(after).includes('private-profile-canary'),false);
      assert.equal(Object.hasOwn(after,'businessModeSelectedAt'),false);
    });
    const service=await register('profile-services@example.test','services');
    await t.test('service policy version is canonical and admissions remain independent',async()=>{
      const unconfigured=await profile(service.access_token);assert.equal(unconfigured.businessMode,'services');
      assert.equal(unconfigured.capabilities.serviceAdministration,true);assert.equal(unconfigured.capabilities.serviceBooking,false);
      assert.equal(unconfigured.bookingBlockReason,'policy_not_configured');
      await runtime.db.sql(insert('service_business_policies',{merchant_id:service.merchant_id,admissions_enabled:true,hold_enabled:false,payment_mode:'at_attendance',version:3,configured_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'}));
      const login=await request('/auth/login',{email:'profile-services@example.test',password});assert.equal(login.status,201);
      const configured=await profile(login.body.access_token);assert.equal(configured.policyVersion,3);
      assert.deepEqual(configured.servicePolicy,{holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',admissionsEnabled:true});
      assert.equal(configured.capabilities.serviceBooking,true);assert.equal(configured.bookingBlockReason,null);
      await runtime.db.sql(`UPDATE service_business_policies SET admissions_enabled=false WHERE merchant_id=${sqlText(service.merchant_id)}`);
      const disabled=await profile(login.body.access_token);assert.equal(disabled.policyVersion,3);
      assert.equal(disabled.servicePolicy.admissionsEnabled,false);assert.equal(disabled.capabilities.serviceBooking,false);
      assert.equal(disabled.capabilities.reconcileExisting,true);assert.equal(disabled.bookingBlockReason,'admissions_disabled');
    });
    await t.test('role and plan remain separate from business mode',async()=>{
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_category='electronics' WHERE id=${sqlText(service.merchant_id)};
        UPDATE merchant_users SET role='admin' WHERE id=${sqlText(service.user_id)};
        UPDATE merchant_team_members SET role='ADMIN' WHERE user_id=${sqlText(service.user_id)};`);
      const login=await request('/auth/login',{email:'profile-services@example.test',password});assert.equal(login.status,201);
      const after=await profile(login.body.access_token);assert.equal(after.role,'admin');assert.equal(after.plan,'STORE_ONLY');
      assert.equal(after.businessMode,'services');assert.equal(after.capabilities.products,false);assert.equal(after.capabilities.serviceAdministration,true);
    });
    await t.test('legacy service evidence is read from actual offers and reservations',async()=>{
      await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,business_mode_needs_review=false WHERE id=${sqlText(product.merchant_id)};`);
      let legacy=await profile(product.access_token);assert.equal(legacy.businessModeSelectionState,'legacy');assert.equal(legacy.capabilities.products,true);
      await runtime.db.sql(insert('products',{id:'profile-legacy-service',merchant_id:product.merchant_id,name:'Synthetic legacy service',type:'service',updated_at:'2030-01-01T00:00:00Z'}));
      legacy=await profile(product.access_token);assert.equal(legacy.businessModeSelectionState,'review_required');assert.equal(legacy.bookingBlockReason,'classification_required');
      await runtime.db.sql("DELETE FROM products WHERE id='profile-legacy-service';"+
        insert('checkout_sessions',{id:'profile-legacy-checkout',merchant_id:product.merchant_id,session_id:'profile-legacy-session',global_user_id:'synthetic-profile-buyer',conversation_id:'synthetic-profile-conversation',cart:{items:[]},created_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'})+
        insert('completed_orders',{id:'profile-legacy-order',merchant_id:product.merchant_id,session_id:'profile-legacy-session',external_order_id:'synthetic-profile-order',order_total:1,currency:'BRL',completed_at:'2030-01-01T00:00:00Z'})+
        insert('service_reservations',{id:'profile-legacy-reservation',merchant_id:product.merchant_id,order_id:'profile-legacy-order',unit_id:'profile-legacy-unit',resource_id:'legacy-explicit-resource',starts_at:'2030-01-02T10:00:00Z',ends_at:'2030-01-02T10:30:00Z',status:'reserved'}));
      legacy=await profile(product.access_token);assert.equal(legacy.businessModeSelectionState,'review_required');
      assert.equal(legacy.capabilities.serviceBooking,false);assert.equal(legacy.capabilities.reconcileExisting,true);
    });
    await t.test('authenticated profile cannot select a foreign tenant',async()=>{
      const response=await request('/merchants/me?merchant_id='+service.merchant_id,undefined,product.access_token,'GET');
      assert.ok([400,403].includes(response.status),JSON.stringify(response));
      const anonymous=await request('/merchants/me',undefined,undefined,'GET');assert.equal(anonymous.status,401);
      assert.equal((await profile(product.access_token)).id,product.merchant_id);
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});

// REG02: real canonical repository and owned SQL; no rendered cursor/result fixture.
test('REG02 canonical product pagination requires a remaining row for every continuation',{timeout:SERVICE_LOCAL_TEST_MS},async()=>{
  const runtime=await createServiceTestRuntime({local:true});let prisma;
  try{
    await import('reflect-metadata');const {PrismaClient}=await import('@prisma/client');
    const {PrismaProductRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-product.repository.js');
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const register=async label=>{
      const response=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json'},body:JSON.stringify({merchant_name:'Synthetic pagination '+label,
          email:'pagination-'+label+'@buyer-journey.example.test',password,business_mode:'products'})});
      assert.equal(response.status,201);return(await response.json()).merchant_id;
    };
    const merchantId=await register('own'),foreignMerchantId=await register('foreign'),repo=new PrismaProductRepository(prisma);
    const prefix='pagination-'+runtime.db.runId.replaceAll('-',''),id=index=>prefix+'-own-'+String(index).padStart(2,'0');
    const row=index=>({id:id(index),merchantId,name:'Synthetic catalog '+index,type:'physical',isActive:true,
      createdAt:new Date(Date.UTC(2030,0,1,0,0,index))});
    assert.equal(await prisma.product.count({where:{merchantId}}),0);
    await prisma.product.createMany({data:[
      {...row(21),id:prefix+'-foreign',merchantId:foreignMerchantId},
      {...row(22),id:prefix+'-inactive',isActive:false},
      {...row(23),id:prefix+'-deleted',deletedAt:new Date('2030-01-02T00:00:00Z')},
    ]});
    const request={merchantId,query:'*',isActiveOnly:true,limit:10};let seeded=0;
    const assertPage=(result,expected,total,next)=>{
      assert.deepEqual(result.products.map(product=>product.id),expected);assert.equal(result.total,total);assert.equal(result.nextCursor,next);
      for(const product of result.products){assert.equal(product.merchantId,merchantId);assert.equal(product.isActive,true);}
    };
    for(const total of [10,11,20]){
      await prisma.product.createMany({data:Array.from({length:total-seeded},(_,index)=>row(seeded+index+1))});seeded=total;
      const expected=Array.from({length:total},(_,index)=>id(total-index)),first=await repo.search(request);
      assertPage(first,expected.slice(0,10),total,total>10?expected[9]:undefined);
      if(total>10){
        const last=await repo.search({...request,cursor:first.nextCursor});assertPage(last,expected.slice(10),total,undefined);
      }
      if(total===20){
        assertPage(await repo.search({...request,offset:0}),expected.slice(0,10),total,expected[9]);
        assertPage(await repo.search({...request,offset:10}),expected.slice(10),total,undefined);
        assertPage(await repo.search({...request,offset:20}),[],total,undefined);
      }
    }
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{try{await prisma?.$disconnect();}finally{await runtime.close();}}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});

// REG02: SQL NULL is absence at the existing ProductEntity boundary; quote guards remain strict.
test('REG02 uncategorized catalog products retain the optional category contract through canonical cart and cross-sell quote',{timeout:SERVICE_LOCAL_TEST_MS},async()=>{
  const runtime=await createServiceTestRuntime({local:true});let prisma;
  try{
    await import('reflect-metadata');const {PrismaClient}=await import('@prisma/client');
    const {PrismaProductRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-product.repository.js');
    const {PrismaStorefrontCartRepository}=await import('../dist/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.js');
    const {PrismaStorefrontCrossSellCartAdapter}=await import('../dist/modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.js');
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const prefix='category-'+runtime.db.runId.replaceAll('-','');
    const register=async label=>{
      const response=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json'},body:JSON.stringify({merchant_name:'Synthetic category '+label,
          email:prefix+'-'+label+'@buyer-journey.example.test',password,business_mode:'products'})});
      assert.equal(response.status,201);return(await response.json()).merchant_id;
    };
    const merchantId=await register('own'),foreignMerchantId=await register('foreign');
    const rules={maxDiscountPercent:10,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,
      couponBoxEnabled:false,autonomousEngineEnabled:false,freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'consultative',originZip:'01310000'};
    await prisma.merchantRule.upsert({where:{merchantId},create:{merchantId,...rules},update:rules});
    const categoryId=prefix+'-category';await prisma.productCategory.create({data:{id:categoryId,merchantId,name:'Synthetic actual category',slug:prefix+'-category'}});
    const create=async(key,price,category)=>prisma.product.create({data:{id:prefix+'-'+key,merchantId,name:'Synthetic '+key,type:'physical',isActive:true,
      ...(category===undefined?{}:{categoryId:category}),variants:{create:{id:prefix+'-'+key+'-v',sku:prefix+'-'+key+'-sku',isActive:true,
        price:{create:{basePriceInCents:price,costInCents:200,currency:'BRL'}},stock:{create:{quantity:20,reserved:0}}}}}});
    const rawHost=await create('host',4000),rawTarget=await create('target',2000),rawCategorized=await create('categorized',1000,categoryId);
    assert.equal(rawHost.categoryId,null);assert.equal(rawTarget.categoryId,null);
    const products=new PrismaProductRepository(prisma),host=await products.findById(merchantId,rawHost.id),target=await products.findById(merchantId,rawTarget.id);
    assert.ok(host&&target);assert.equal(host.categoryId,undefined);assert.equal(target.categoryId,undefined);
    assert.equal((await products.findById(merchantId,rawCategorized.id)).categoryId,categoryId);
    assert.equal(await products.findById(foreignMerchantId,rawHost.id),null);
    const source=host.variants[0],recommended=target.variants[0],promotionId=prefix+'-promotion',cartId=prefix+'-cart';
    await prisma.crossSellPromotion.create({data:{id:promotionId,merchantId,name:'Synthetic category complement',trigger:{sku_in_cart:[source.sku]},recommendedSkus:[recommended.sku],
      discountPercent:10,maxDiscountPercent:10,status:'active',startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+3600000)}});
    const carts=new PrismaStorefrontCartRepository(prisma),adapter=new PrismaStorefrontCrossSellCartAdapter(prisma),scope={merchantId,cartId};
    await carts.addItem(merchantId,cartId,{variantId:source.id,productId:host.id,sku:source.sku,name:host.name,categoryId:host.categoryId,quantity:1,unitPriceCents:source.basePriceInCents});
    const stored=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}});
    assert.equal(Object.hasOwn(stored.items[0],'categoryId'),false);assert.equal(stored.total,4000);
    const request={variantId:recommended.id,promotionId,quantity:1},quote=await adapter.quote(scope,request);
    assert.equal(quote.merchantId,merchantId);assert.equal(quote.cartId,cartId);assert.equal(quote.productId,target.id);assert.equal(quote.variantId,recommended.id);
    assert.equal(quote.originalUnitPriceCents,2000);assert.equal(quote.maximumUnitPriceCents,1800);assert.equal(quote.quote.subtotalCents,5800);
    assert.equal(Object.hasOwn(quote.cartBasis.items[0],'categoryId'),false);
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}}),stored);
    const review=error=>error?.getStatus?.()===422&&error.getResponse()?.code==='cross_sell_quote_review_required';
    // Explicit historical fixture: the previous productive mapper saved this JSON NULL.
    const legacyItems=stored.items.map(item=>({...item,categoryId:null}));
    await prisma.storefrontCart.update({where:{merchantId_sessionId:{merchantId,sessionId:cartId}},data:{items:legacyItems}});
    const legacyStored=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}});
    assert.equal(legacyStored.items[0].categoryId,null);
    const legacyProjection=await adapter.project(scope);assert.equal(legacyProjection.total,4000);
    assert.equal(Object.hasOwn(legacyProjection.items[0],'categoryId'),false);
    const legacyQuote=await adapter.quote(scope,request);assert.deepEqual(legacyQuote,quote);
    assert.equal(Object.hasOwn(legacyQuote.cartBasis.items[0],'categoryId'),false);
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}}),legacyStored);
    // Public expectedQuote remains strict: only the internal persisted reader accepts legacy NULL absence.
    await assert.rejects(adapter.accept(scope,{expectedQuote:{...legacyQuote,cartBasis:{...legacyQuote.cartBasis,items:legacyQuote.cartBasis.items.map(item=>({...item,categoryId:null}))}}}));
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}}),legacyStored);
    const malformedItems=legacyItems.map(item=>({...item,categoryId:17}));
    await prisma.storefrontCart.update({where:{merchantId_sessionId:{merchantId,sessionId:cartId}},data:{items:malformedItems}});
    const malformedStored=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}});
    await assert.rejects(adapter.project(scope),review);await assert.rejects(adapter.quote(scope,request),review);
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}}),malformedStored);
    await prisma.storefrontCart.update({where:{merchantId_sessionId:{merchantId,sessionId:cartId}},data:{items:legacyItems}});
    const ready=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}});
    await assert.rejects(adapter.quote({merchantId:foreignMerchantId,cartId},request),review);
    await prisma.productStock.updateMany({where:{variantId:recommended.id},data:{quantity:0}});
    await assert.rejects(adapter.quote(scope,request),review);
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}}),ready);
    await prisma.productStock.updateMany({where:{variantId:recommended.id},data:{quantity:20}});
    // JSON transport omits no hidden undefined key; a real accept revalidates and commits this same quote once.
    assert.deepEqual(await adapter.accept(scope,{expectedQuote:JSON.parse(JSON.stringify(legacyQuote))}),{version:1,status:'accepted',...scope});
    const accepted=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}});
    assert.equal(accepted.items.find(item=>item.variantId===recommended.id).unitPriceCents,2000);
    const finalProjection=await adapter.project(scope);assert.equal(finalProjection.total,5800);
    assert.equal(finalProjection.items.find(item=>item.variantId===recommended.id).unitPriceCents,1800);
    assert.equal(Object.hasOwn(finalProjection.items.find(item=>item.variantId===source.id),'categoryId'),false);
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}}),accepted);
    for(const model of['completedOrder','paymentIntent','inventoryMovement','serviceAppointment'])assert.equal(await prisma[model].count({where:{merchantId}}),0);
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{try{await prisma?.$disconnect();}finally{await runtime.close();}}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
