import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {lockCatalogMerchant} from '../dist/shared/persistence/catalog-stock-ledger.js';
import {BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';
import {createProductCatalogViewer} from './product-catalog-read.viewer.mjs';
const classify=intent=>({phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_COMMERCE',intent,confidence:1,requiresTool:true,
  needsProductDiscovery:false,shoppingPhase:null,serviceRequest:null,serviceAction:null}});
const readTurn=(name,args,contextText,review=true)=>[classify(name==='compare_products'?'COMPARE_PRODUCTS':'COMPLEX_QUESTION'),
  {phase:'storefront.sales',productReadToolCall:{name,args,contextText}},
  {phase:'storefront.sales',response:{schemaVersion:1,message:'Consulte os dados publicados abaixo.'}},
  ...(review?[{phase:'storefront.reply-review',response:{schemaVersion:1,verdict:'ALLOW',confidence:1}}]:[])];
const rules={maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,
  allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,autonomousEngineEnabled:false,freeShippingMinCartValue:0,
  maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'Cordial',originZip:'01310000'};
export async function createProductDiscoveryReadJourney(channel,surface){
  assert.ok(['storefront','whatsapp'].includes(channel)&&['categories','comparison','reviews'].includes(surface));
  const prefix='c60d_'+randomUUID().replaceAll('-',''),ids={a:prefix+'-a',b:prefix+'-b',c:prefix+'-c',foreign:prefix+'-foreign'},
    names={a:'Fone Aurora',b:'Fone Brisa',c:'Cabo Solar',foreign:'Fone Externo'};
  const opening=channel==='storefront'&&surface!=='categories'?[classify('PRODUCT_SEARCH')]:[];
  const modelScript=[...opening,...(surface==='categories'?(channel==='storefront'?readTurn('list_categories',{},'Categorias'):[]):
    surface==='comparison'?[...readTurn('compare_products',{productId:ids.a,includeSimilar:true},names.a),
      ...readTurn('compare_products',{productNames:[names.a,names.foreign],includeSimilar:false},names.a,false)]:
      channel==='storefront'?[...readTurn('get_reviews',{productId:ids.a},names.a),
        ...readTurn('get_reviews',{productId:ids.a,filter:'positive'},names.a),...readTurn('get_reviews',{productId:ids.a,filter:'negative'},names.a)]:[])];
  const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',
    ...(modelScript.length?{modelScript}:{}),...(channel==='storefront'?{buyerBooking:true,buyerBrowser:true}:{whatsapp:true,c60MetaCapabilitiesFixture:'owned-c60-discovery-empty-v1',c60RecoveryTemplateMonitorFixture:'manual-only-v1'})});
  let db,next,viewer,closed=false;
  const close=async()=>{if(closed)return;closed=true;const errors=[];for(const item of[viewer,next])try{await item?.close();}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'discovery_read_cleanup_failed');assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const register=async name=>{const response=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({merchant_name:name,email:randomUUID()+'@buyer-journey.example.test',password:'SyntheticDiscoveryMerchant123!',business_mode:'products'})});
      assert.equal(response.status,201);return(await response.json()).merchant_id;};
    const merchantId=await register('Descoberta própria local'),foreignMerchantId=await register('Descoberta externa sintética'),slug='c60-discovery-'+randomUUID();
    for(const[id,storeSlug]of[[merchantId,slug],[foreignMerchantId,slug+'-foreign']]){
      await db.merchant.update({where:{id},data:{plan:'STORE_ONLY',storeSlug,storeSettings:{registration_pending:false,plan_selection_pending:false,company:{description:'Catálogo sintético local de tecnologia.'}}}});
      await db.merchantBillingSubscription.upsert({where:{merchantId:id},create:{merchantId:id,planKey:'scale',status:'active'},update:{planKey:'scale',status:'active'}});
      await db.merchantRule.upsert({where:{merchantId:id},create:{merchantId:id,...rules},update:rules});
    }
    const categoryIds={audio:prefix+'-audio',cables:prefix+'-cables',foreign:prefix+'-foreign-category'};
    for(const[id,owner,name]of[[categoryIds.audio,merchantId,'Áudio'],[categoryIds.cables,merchantId,'Cabos'],[categoryIds.foreign,foreignMerchantId,'Categoria Externa']])
      await db.productCategory.create({data:{id,merchantId:owner,name,slug:id,isActive:true}});
    for(const[key,price,category,attributes]of[['a',4500,'audio',{cor:'Preto',conectividade:'Bluetooth'}],['b',8500,'audio',{cor:'Branco',conectividade:'USB'}],['c',1900,'cables',{cor:'Azul'}],['foreign',1000,'foreign',{cor:'Externa'}]]){
      const owner=key==='foreign'?foreignMerchantId:merchantId;
      await db.$transaction(async tx=>{
      await lockCatalogMerchant(tx,owner);
      await tx.product.create({data:{id:ids[key],merchantId:owner,categoryId:categoryIds[category],name:names[key],type:'physical',isActive:true,
        description:'Descrição sintética publicada de '+names[key]+'.',variants:{create:{id:ids[key]+'-v',sku:ids[key],attributes,isActive:true,
          price:{create:{basePriceInCents:price,costInCents:500,currency:'BRL'}},stock:{create:{quantity:10,reserved:0}}}}}});
      const location=await tx.inventoryLocation.findFirst({where:{merchantId:owner,isDefault:true,isActive:true},orderBy:{id:'asc'}})
        ??await tx.inventoryLocation.create({data:{merchantId:owner,name:'Estoque principal',kind:'warehouse',isDefault:true,isActive:true}});
      await tx.inventoryItem.create({data:{merchantId:owner,locationId:location.id,sku:ids[key],productName:names[key],quantity:10,reserved:0,avgCostCents:500,salePriceCents:price}});
    });
    }
    const base=Date.parse('2026-01-10T12:00:00Z');
    for(let index=0;index<12;index++)await db.productReview.create({data:{id:prefix+'-r'+String(index).padStart(2,'0'),merchantId,productId:ids.a,
      buyerId:prefix+'-buyer'+index,rating:index%2?2:5,text:'Comentário público '+String(index).padStart(2,'0'),approved:true,verified:false,moderationStatus:'approved',createdAt:new Date(base+index*60000)}});
    await db.productReview.create({data:{id:prefix+'-hidden',merchantId,productId:ids.a,buyerId:prefix+'-hidden-buyer',rating:1,text:'Comentário não publicado',approved:false,verified:false,moderationStatus:'pending'}});
    await db.productReview.create({data:{id:prefix+'-foreign-review',merchantId:foreignMerchantId,productId:ids.a,buyerId:prefix+'-foreign-buyer',rating:1,text:'Comentário de outra loja',approved:true,verified:false,moderationStatus:'approved'}});
    for(let index=0;index<2;index++)await db.productReview.create({data:{id:prefix+'-brisa'+index,merchantId,productId:ids.b,buyerId:prefix+'-b'+index,rating:index?4:5,text:'Brisa publicada '+index,approved:true,verified:false,moderationStatus:'approved'}});
    const scope={merchantId:{in:[merchantId,foreignMerchantId]}};
    const products=async categoryId=>(await db.product.findMany({where:{merchantId,isActive:true,...(categoryId?{categoryId}:{})},include:{variants:{include:{price:true,stock:true}},reviews:true},orderBy:{id:'asc'}})).map(product=>{
      assert.equal(product.variants.length,1);const variant=product.variants[0],publicReviews=product.reviews.filter(r=>(r.merchantId===merchantId||r.merchantId===null)&&r.approved&&(r.moderationStatus==='approved'||r.moderationStatus===null)&&r.rating>=1&&r.rating<=5);
      return{id:product.id,name:product.name,categoryId:product.categoryId,price:variant.price.basePriceInCents,attributes:variant.attributes,
        inStock:variant.stock.reduce((sum,row)=>sum+row.quantity-row.reserved,0)>0,rating:publicReviews.length?publicReviews.reduce((sum,row)=>sum+row.rating,0)/publicReviews.length:undefined};});
    const categories=async()=>{const rows=await db.productCategory.findMany({where:{merchantId,isActive:true},include:{_count:{select:{products:{where:{isActive:true}}}}},orderBy:{id:'asc'}});return rows.map(row=>({id:row.id,name:row.name,productCount:row._count.products}));};
    const reviewPage=async(filter,cursor)=>{
      const rows=await db.productReview.findMany({where:{productId:ids.a,approved:true,AND:[{OR:[{merchantId},{merchantId:null}]},{OR:[{moderationStatus:'approved'},{moderationStatus:null}]}],
        rating:{gte:filter==='positive'?4:1,lte:filter==='negative'?2:5}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
      const all=rows.map(row=>({id:'review:'+row.id,rating:row.rating,text:row.text,date:row.createdAt.toISOString().slice(0,10)}));
      const offset=cursor?all.findIndex(row=>row.id===cursor)+1:0;if(cursor)assert.ok(offset>0);const page=all.slice(offset,offset+10);
      return{reviews:page,totalReviews:all.length,averageRating:Math.round(all.reduce((sum,row)=>sum+row.rating,0)/all.length*10)/10,
        nextCursor:offset+10<all.length?page.at(-1).id:undefined};};
    assert.equal(await db.productTestimonial.count({where:{product:scope}}),0);
    const snapshot=async()=>({products:await db.product.findMany({where:scope,include:{variants:{include:{price:true,stock:true}}},orderBy:{id:'asc'}}),
      categories:await db.productCategory.findMany({where:scope,orderBy:{id:'asc'}}),reviews:await db.productReview.findMany({where:{product:scope},orderBy:{id:'asc'}}),
      orders:await db.completedOrder.count({where:{merchantId}}),intents:await db.paymentIntent.count({where:{merchantId}}),appointments:await db.serviceAppointment.count({where:{merchantId}}),
      receipts:await db.attendanceReceipt.count({where:{merchantId}}),inventory:await db.inventoryMovement.count({where:{merchantId}}),
      carts:await db.storefrontCart.findMany({where:{merchantId},select:{sessionId:true,items:true,total:true},orderBy:{sessionId:'asc'}}),
      financialEvents:await db.outboxMessage.findMany({where:{merchantId,OR:[{eventType:{startsWith:'payment.'}},{eventType:{startsWith:'order.'}}]},select:{eventId:true,eventType:true,payload:true},orderBy:{eventId:'asc'}})});
    let origin,deviceId,buyerPhone;
    if(channel==='storefront'){await db.merchantInstallation.create({data:{merchantId,name:'Owned discovery Next',environment:'live',status:'active',widgetVersion:'v2',allowedOrigins:[BUYER_STOREFRONT_ORIGIN]}});
      next=await runtime.buyerBooking.openStorefront();assert.equal(next.origin,BUYER_STOREFRONT_ORIGIN);origin=next.origin;
    }else{const phoneNumberId='900063000001';deviceId='META_CLOUD:'+phoneNumberId;buyerPhone='5511998000063';
      await db.whatsAppChannelConfig.create({data:{id:prefix+'-config',merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',deviceId,
        credentials:{phoneNumberId,wabaId:'900063999',accessToken:'synthetic-no-external-meta-secret'}}});
      viewer=await createProductCatalogViewer({runtime,db,merchantId,deviceId,phoneNumberId,buyerPhone});origin=viewer.origin;}
    return Object.freeze({channel,surface,origin,slug,merchantId,ids,names,categoryIds,products,categories,reviewPage,snapshot,close,
      evidence:()=>runtime.evidence(),modelEvents:()=>runtime.storefrontQueryModel.events(),
      async view(){assert.equal(channel,'whatsapp');const row=await db.whatsAppSession.findFirst({where:{merchantId,deviceId,buyerPhone,status:'active'}});
        assert.ok(row?.conversationState?.view&&Array.isArray(row.conversationState.view.blocks),'discovery_real_meta_view_required');return structuredClone(row.conversationState.view);},
    });
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'discovery_setup_cleanup_failed');}throw error;}
}