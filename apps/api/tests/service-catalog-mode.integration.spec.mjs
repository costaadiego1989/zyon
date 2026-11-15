import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T17',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  let prisma;
  try{
    const {PrismaClient}=await import('@prisma/client');
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    const {PrismaProductRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-product.repository.js');
    const {CatalogVariantService}=await import('../dist/modules/catalog/application/services/catalog-variant.service.js');
    const repo=new PrismaProductRepository(prisma),editor=new CatalogVariantService(prisma,{});
    const request=async(path,body,token,method='POST')=>{
      const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json','idempotency-key':randomUUID(),...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,body:await response.json()};
    };
    const register=async(mode,suffix=mode)=>{
      const response=await request('/auth/register',{merchant_name:'Synthetic '+suffix,email:suffix+'-catalog@example.test',password:'SyntheticPassword123!',business_mode:mode});
      assert.equal(response.status,201,JSON.stringify(response));
      const auth=response.body;
      await prisma.merchant.update({where:{id:auth.merchant_id},data:{plan:'STORE_ONLY'}});
      await prisma.merchantBillingSubscription.upsert({where:{merchantId:auth.merchant_id},create:{merchantId:auth.merchant_id,planKey:'starter',status:'active'},update:{planKey:'starter',status:'active'}});
      return auth;
    };
    const products=await register('products'),services=await register('services');
    let sequence=0;
    const offer=(type,sku='sku-'+(++sequence))=>({name:'Synthetic '+type,type,variants:[{sku,attributes:{},basePriceInCents:12500,weightGrams:200,stockQuantity:5}]});
    const publicOffer=type=>({...offer(type),variants:offer(type).variants.map(v=>({sku:v.sku,attributes:v.attributes,base_price_in_cents:v.basePriceInCents,weight_grams:v.weightGrams,stock_quantity:v.stockQuantity}))});
    const ownPath=auth=>'/merchants/'+auth.merchant_id+'/products';
    const saved=[];
    await t.test('signup followed by dashboard and public API create enforces each business mode',async()=>{
      for(const auth of [products,services])for(const type of ['physical','digital','food','service']){
        const compatible=(auth===services)===(type==='service');
        for(const source of ['dashboard','public']){
          const before=await prisma.product.count({where:{merchantId:auth.merchant_id}});
          const response=await request(source==='dashboard'?ownPath(auth):'/v1/products',source==='dashboard'?offer(type):publicOffer(type),auth.access_token);
          assert.equal(response.status,compatible?201:409,JSON.stringify({source,type,response}));
          assert.equal(await prisma.product.count({where:{merchantId:auth.merchant_id}}),before+(compatible?1:0));
          if(compatible){const row=await prisma.product.findFirst({where:{merchantId:auth.merchant_id,type},orderBy:{createdAt:'desc'},include:{variants:{include:{price:true}}}});assert.equal(row.type,type);assert.equal(row.variants[0].price.basePriceInCents,12500);saved.push({auth,row});}
          else assert.match(JSON.stringify(response.body),/catalog_business_mode_conflict/);
        }
      }
    });
    await t.test('update publication and variant editors cannot publish an incompatible offer',async()=>{
      for(const auth of [products,services]){
        const row=saved.find(s=>s.auth===auth).row;
        const incompatible=auth===services?'physical':'service',before=await prisma.product.findUnique({where:{id:row.id}});
        for(const [path,body,method]of [[ownPath(auth)+'/'+row.id,{type:incompatible},'PUT'],['/v1/products/'+row.id,{type:incompatible},'PATCH'],[ownPath(auth)+'/'+row.id+'/variants',{product:{type:incompatible},variants:row.variants.map(v=>({id:v.id,sku:v.sku,attributes:{},basePriceInCents:12500,weightGrams:200}))},'PUT']]){
          const response=await request(path,body,auth.access_token,method);assert.equal(response.status,409,JSON.stringify(response));
          assert.deepEqual(await prisma.product.findUnique({where:{id:row.id}}),before);
        }
        // Explicit synthetic legacy state, representing offers retained by migration.
        const legacy=await prisma.product.create({data:{merchantId:auth.merchant_id,name:'Legacy incompatible',type:incompatible,isActive:false,variants:{create:{sku:'legacy-'+auth.merchant_id,price:{create:{basePriceInCents:500}},stock:{create:{quantity:2}}}}},include:{variants:true}});
        for(const [path,body,method]of [[ownPath(auth)+'/'+legacy.id,{isActive:true},'PUT'],['/v1/products/'+legacy.id,{is_active:true},'PATCH'],[ownPath(auth)+'/'+legacy.id+'/variants/'+legacy.variants[0].id,{basePriceInCents:700},'PUT']]){
          const response=await request(path,body,auth.access_token,method);assert.equal(response.status,409,JSON.stringify(response));
          assert.equal((await prisma.product.findUnique({where:{id:legacy.id}})).isActive,false);
          assert.equal((await prisma.productPrice.findUnique({where:{variantId:legacy.variants[0].id}})).basePriceInCents,500);
        }
        const withdraw=await request(ownPath(auth)+'/'+legacy.id,{isActive:false},auth.access_token,'PUT');assert.equal(withdraw.status,200,JSON.stringify(withdraw));
      }
    });
    await t.test('direct canonical writers and duplicate-SKU import reject bypass and rollback',async()=>{
      for(const auth of [products,services]){
        const incompatible=auth===services?'physical':'service';
        await assert.rejects(repo.create({merchantId:auth.merchant_id,...offer(incompatible)}),/catalog_business_mode_conflict/);
        const legacy=await prisma.product.findFirst({where:{merchantId:auth.merchant_id,type:incompatible,isActive:false},include:{variants:true}});
        const before=await prisma.productVariant.count({where:{productId:legacy.id}});
        await assert.rejects(repo.addVariant(auth.merchant_id,legacy.id,offer(incompatible).variants[0]),/catalog_business_mode_conflict/);
        await assert.rejects(repo.updateVariantBySku(auth.merchant_id,legacy.variants[0].sku,{productName:'Must roll back',basePriceInCents:999}),/catalog_business_mode_conflict/);
        await assert.rejects(editor.replace(auth.merchant_id,legacy.id,offer(incompatible).variants),/catalog_business_mode_conflict/);
        assert.equal(await prisma.productVariant.count({where:{productId:legacy.id}}),before);
        assert.equal((await prisma.product.findUnique({where:{id:legacy.id}})).name,'Legacy incompatible');
      }
    });
    await t.test('real CSV import command preserves products and refuses physical import into services',async()=>{
      const {PrismaImportJobRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-import-job.repository.js');
      const {ProcessSpreadsheetImportUseCase}=await import('../dist/modules/catalog/application/use-cases/process-spreadsheet-import.use-case.js');
      const {AddProductUseCase}=await import('../dist/modules/catalog/application/use-cases/add-product.use-case.js');
      const {CsvXlsxParserAdapter}=await import('../dist/modules/catalog/infrastructure/csv-xlsx-parser.adapter.js');
      const {DeterministicColumnMapper}=await import('../dist/modules/catalog/infrastructure/adapters/deterministic-column-mapper.adapter.js');
      const jobs=new PrismaImportJobRepository(prisma);
      // No external SEO model is part of catalog admission. Canonical persistence,
      // parser, mapper and importer remain real and use this owned database.
      const add=new AddProductUseCase(repo,{execute:async()=>({})});
      const process=new ProcessSpreadsheetImportUseCase(jobs,new CsvXlsxParserAdapter(),new DeterministicColumnMapper(),add,repo);
      for(const auth of [products,services]){
        const buffer=Buffer.from('name,sku,price,peso g,stock\nSynthetic import,import-'+auth.merchant_id+',25,200,4');
        // A separate real Growth account tests HTTP upload entitlement without
        // changing the SEO entitlement of prior CRUD actors mid-background work.
        const uploader=await register(auth===products?'products':'services',auth===products?'upload-products':'upload-services');
        await prisma.merchantBillingSubscription.update({where:{merchantId:uploader.merchant_id},data:{planKey:'growth'}});
        const uploaded=await request(ownPath(uploader)+'/import',{fileName:'synthetic.csv',mimeType:'text/csv',base64:buffer.toString('base64')},uploader.access_token);
        assert.equal(uploaded.status,201,JSON.stringify(uploaded));
        assert.equal((await prisma.importJob.findUnique({where:{id:uploaded.body.jobId}})).merchantId,uploader.merchant_id);
        const job=await jobs.create({merchantId:auth.merchant_id,fileName:'synthetic-direct.csv'});
        await process.execute({jobId:job.id,merchantId:auth.merchant_id,buffer,mimeType:'text/csv'});
        const stored=await prisma.importJob.findUnique({where:{id:job.id}});
        assert.equal(stored.successRows,auth===products?1:0,JSON.stringify(stored.errors));assert.equal(stored.failedRows,auth===services?1:0,JSON.stringify(stored.errors));
        assert.equal(await prisma.productVariant.count({where:{sku:'import-'+auth.merchant_id,product:{merchantId:auth.merchant_id}}}),auth===products?1:0);
        if(auth===services)assert.match(JSON.stringify(stored.errors),/catalog_business_mode_conflict/);
        if(auth===products){const again=await jobs.create({merchantId:auth.merchant_id,fileName:'synthetic-repeat.csv'});await process.execute({jobId:again.id,merchantId:auth.merchant_id,buffer:Buffer.from(buffer.toString().replace(',25,',',31,')),mimeType:'text/csv'});assert.equal((await prisma.importJob.findUnique({where:{id:again.id}})).successRows,1);assert.equal((await prisma.productVariant.findFirst({where:{sku:'import-'+auth.merchant_id},include:{price:true}})).price.basePriceInCents,3100);}
      }
    });
    await t.test('ERP physical snapshot has the same guard and rejected new offer rolls back',async()=>{
      const {ErpSyncService}=await import('../dist/modules/inventory/application/services/erp-sync.service.js');
      for(const auth of [products,services]){
        const connection=await prisma.erpConnection.create({data:{merchantId:auth.merchant_id,provider:'tiny',directionMode:'erp_source_of_truth',status:'connected'}});
        const snapshot={externalProductId:'external-'+auth.merchant_id,externalLocationId:'default',sku:'erp-'+auth.merchant_id,productName:'Synthetic ERP',quantity:2,salePriceCents:1000};
        const sync=new ErpSyncService(prisma),before=await prisma.inventoryItem.count({where:{merchantId:auth.merchant_id}});
        if(auth===services)await assert.rejects(sync.applySnapshot(connection,snapshot,new Date()),/catalog_business_mode_conflict/);
        else await sync.applySnapshot(connection,snapshot,new Date());
        assert.equal(await prisma.productVariant.count({where:{sku:snapshot.sku,product:{merchantId:auth.merchant_id}}}),auth===products?1:0);
        assert.equal(await prisma.inventoryItem.count({where:{merchantId:auth.merchant_id}}),before+(auth===products?1:0));
      }
    });
    await t.test('ambiguous legacy classification blocks new state while preserving history and withdrawal',async()=>{
      const row=saved.find(s=>s.auth===products&&s.row.type==='physical').row;
      const snapshot={productId:row.id,type:row.type,price:row.variants[0].price.basePriceInCents};
      await prisma.paymentIntent.create({data:{id:'synthetic-existing',merchantId:products.merchant_id,sessionId:'synthetic-existing',idempotencyKey:'synthetic-existing',amountCents:12500,currency:'BRL',method:'pix',status:'pending',creation:{syntheticSnapshot:snapshot}}});
      await prisma.merchant.update({where:{id:products.merchant_id},data:{businessModeNeedsReview:true}});
      const rejected=await request(ownPath(products),offer('physical'),products.access_token);assert.equal(rejected.status,409);assert.match(JSON.stringify(rejected.body),/classification_required/);
      const detail=await request(ownPath(products)+'/'+row.id,undefined,products.access_token,'GET');assert.equal(detail.status,200);
      const withdraw=await request(ownPath(products)+'/'+row.id,{isActive:false},products.access_token,'PUT');assert.equal(withdraw.status,200);
      const intent=await prisma.paymentIntent.findUnique({where:{id:'synthetic-existing'}});assert.equal(intent.status,'pending');assert.deepEqual(intent.creation.syntheticSnapshot,snapshot);
      assert.equal((await prisma.productPrice.findUnique({where:{variantId:row.variants[0].id}})).basePriceInCents,12500);
    });
    await t.test('foreign and anonymous writes leave canonical state unchanged',async()=>{
      const before=await prisma.product.count({where:{merchantId:products.merchant_id}});
      assert.equal((await request(ownPath(products),offer('service'),services.access_token)).status,403);
      assert.equal((await request(ownPath(products),offer('physical'))).status,401);
      assert.equal(await prisma.product.count({where:{merchantId:products.merchant_id}}),before);
    });
    await t.test('legacy reservation evidence without any current service offer still requires classification',async()=>{
      const auth=await register('products','legacy-reservation');
      await prisma.merchant.update({where:{id:auth.merchant_id},data:{businessModeSelectedAt:null,businessModeNeedsReview:false,storeSettings:{}}});
      await prisma.checkoutSession.create({data:{merchantId:auth.merchant_id,sessionId:'synthetic-historical-session',globalUserId:'synthetic-historical-buyer',conversationId:'synthetic-historical-conversation',cart:{currency:'BRL',total:50,items:[]},customer:{fullName:'Synthetic historical buyer'},createdAt:new Date('2020-01-01T08:00:00Z'),updatedAt:new Date('2020-01-01T08:00:00Z')}});
      await prisma.completedOrder.create({data:{id:'synthetic-historical-order',merchantId:auth.merchant_id,sessionId:'synthetic-historical-session',externalOrderId:'synthetic-historical-order',orderTotal:50,currency:'BRL',completedAt:new Date('2020-01-01T09:00:00Z')}});
      await prisma.serviceReservation.create({data:{id:'synthetic-historical-reservation',merchantId:auth.merchant_id,orderId:'synthetic-historical-order',unitId:'synthetic-historical-unit',resourceId:'synthetic-historical-resource',startsAt:new Date('2020-01-01T10:00:00Z'),endsAt:new Date('2020-01-01T10:30:00Z'),status:'reserved'}});
      assert.equal(await prisma.product.count({where:{merchantId:auth.merchant_id}}),0);
      const response=await request(ownPath(auth),offer('physical'),auth.access_token);assert.equal(response.status,409,JSON.stringify(response));assert.match(JSON.stringify(response.body),/classification_required/);
      assert.equal(await prisma.product.count({where:{merchantId:auth.merchant_id}}),0);assert.equal(await prisma.serviceReservation.count({where:{merchantId:auth.merchant_id}}),1);
    });
    await t.test('catalog admission reads mode after acquiring the canonical merchant lock',async()=>{
      const auth=await register('products','catalog-mode-race');let release,locked;
      const ready=new Promise(resolve=>locked=resolve),allowCommit=new Promise(resolve=>release=resolve);
      const changing=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM merchants WHERE id=${auth.merchant_id} FOR UPDATE`;locked();await allowCommit;await tx.merchant.update({where:{id:auth.merchant_id},data:{businessMode:'services'}});},{timeout:15_000});
      await ready;const creating=request(ownPath(auth),offer('physical'),auth.access_token);creating.catch(()=>{});
      let waiting=false;
      try{for(let attempt=0;attempt<30;attempt++){if(Number(await runtime.db.sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM merchants%'"))>0){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(waiting,true,'catalog request must reach and wait on the merchant row lock');}finally{release();}
      await changing;const response=await creating;assert.equal(response.status,409,JSON.stringify(response));assert.match(JSON.stringify(response.body),/catalog_business_mode_conflict/);assert.equal(await prisma.product.count({where:{merchantId:auth.merchant_id}}),0);assert.equal((await prisma.merchant.findUnique({where:{id:auth.merchant_id}})).businessMode,'services');
    });
    await t.test('unfinished password and OAuth registration cannot publish a default-mode offer',async()=>{
      for(const flag of ['registration_pending','oauth_registration_pending']){
        const auth=await register('products','pending-'+flag);
        await prisma.merchant.update({where:{id:auth.merchant_id},data:{businessModeSelectedAt:null,businessModeNeedsReview:false,storeSettings:{[flag]:true}}});
        const response=await request(ownPath(auth),{...offer('physical'),registration_pending:false,business_mode:'products'},auth.access_token);assert.equal(response.status,409,JSON.stringify(response));assert.match(JSON.stringify(response.body),/business_mode_selection_required/);
        assert.equal(await prisma.product.count({where:{merchantId:auth.merchant_id}}),0);assert.equal(await prisma.inventoryItem.count({where:{merchantId:auth.merchant_id}}),0);assert.equal(await prisma.inventoryLocation.count({where:{merchantId:auth.merchant_id}}),0);
        const merchant=await prisma.merchant.findUnique({where:{id:auth.merchant_id}});assert.equal(merchant.businessModeSelectedAt,null);assert.equal(merchant.storeSettings[flag],true);
      }
    });
    await t.test('ordinary legacy products preserve physical catalog creation without forced conversion',async()=>{
      const auth=await register('products','ordinary-legacy-products');
      await prisma.merchant.update({where:{id:auth.merchant_id},data:{businessModeSelectedAt:null,businessModeNeedsReview:false,storeSettings:{}}});
      const response=await request(ownPath(auth),offer('physical','ordinary-legacy-sku'),auth.access_token);assert.equal(response.status,201,JSON.stringify(response));
      const product=await prisma.product.findFirst({where:{merchantId:auth.merchant_id},include:{variants:{include:{stock:true,price:true}}}});assert.equal(product.type,'physical');assert.equal(product.variants[0].stock[0].quantity,5);assert.equal(product.variants[0].price.basePriceInCents,12500);
      const merchant=await prisma.merchant.findUnique({where:{id:auth.merchant_id}});assert.equal(merchant.businessMode,'products');assert.equal(merchant.businessModeSelectedAt,null);assert.equal(merchant.businessModeNeedsReview,false);
    });
    assert.equal(runtime.evidence().providerCalls,0);
    assert.deepEqual(runtime.evidence().embeddingRuntime,{allowRemoteModels:false});
  }finally{if(prisma)await prisma.$disconnect();await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
