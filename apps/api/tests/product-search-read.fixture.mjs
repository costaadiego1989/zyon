import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {lockCatalogMerchant} from '../dist/shared/persistence/catalog-stock-ledger.js';
import {BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';
import {createProductCatalogViewer} from './product-catalog-read.viewer.mjs';

const classifier={schemaVersion:2,domain:'STORE_COMMERCE',intent:'PRODUCT_SEARCH',confidence:1,requiresTool:true,
  needsProductDiscovery:true,shoppingPhase:'search',serviceRequest:null,serviceAction:null};
const plan=ceiling=>({schemaVersion:1,plan:{version:1,query:'fone',discountOnly:null,recovery:null,minPriceCents:null,maxPriceCents:ceiling,
  minRating:4,minPriceExclusive:null,maxPriceExclusive:null,minRatingExclusive:null,attributes:[],attributeAnyOf:null,
  sortBy:'price_asc',delivery:null,unsupportedCriteria:[]}});
const rules={maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,
  allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,autonomousEngineEnabled:false,freeShippingMinCartValue:0,
  maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'Cordial',originZip:'01310000'};

/** Static owned canonical facts only. Original AppModule and quoted SQL read
 * produce every actual result; no model product/price/card/cart result exists. */
export async function createProductSearchReadJourney(channel,scenario){
  assert.ok(['storefront','whatsapp'].includes(channel)&&['positive','noeligible'].includes(scenario));
  const ceilings=scenario==='positive'?[10000,5000]:[10000];
  const modelScript=ceilings.flatMap(ceiling=>[{phase:'storefront.intent',response:classifier},{phase:'storefront.shopping-plan',response:plan(ceiling)}]);
  const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',modelScript,
    ...(channel==='storefront'?{buyerBooking:true,buyerBrowser:true}:{whatsapp:{marketingOpening:true,marketingOpeningPurpose:'c60-search'},c60MetaCapabilitiesFixture:'owned-c60-search-empty-v1',c60RecoveryTemplateMonitorFixture:'manual-only-v1'})});
  let db,next,viewer,closed=false;
  const close=async()=>{if(closed)return;closed=true;const errors=[];
    for(const surface of[viewer,next])try{await surface?.close();}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'search_read_owned_cleanup_failed');
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const initial=runtime.evidence();assert.equal(initial.canonicalAppModule,true);assert.equal(initial.authOverrides,false);assert.equal(initial.repositoryOverrides,false);
    assert.equal(initial.providerCalls,0);assert.deepEqual(initial.localStorefrontRoutingProfile,
      {configured:'structured',observed:'structured',binding:'original_adapter_constructor',selectorActive:true});
    const register=async name=>{const response=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({merchant_name:name,
        email:randomUUID()+'@buyer-journey.example.test',password:'SyntheticSearchMerchant123!',business_mode:'products'})});
      assert.equal(response.status,201);const auth=await response.json();assert.equal(typeof auth.merchant_id,'string');return auth.merchant_id;};
    const merchantId=await register('Busca própria local'),foreignMerchantId=await register('Busca externa sintética');
    const slug='c60-search-'+randomUUID(),prefix='c60s_'+runtime.db.runId.replaceAll('-','');
    for(const[id,storeSlug]of[[merchantId,slug],[foreignMerchantId,slug+'-foreign']]){
      await db.merchant.update({where:{id},data:{plan:'STORE_ONLY',storeSlug,
        storeSettings:{company:{description:'Loja sintética de fones para leitura local.'},registration_pending:false,plan_selection_pending:false}}});
      await db.merchantBillingSubscription.upsert({where:{merchantId:id},create:{merchantId:id,planKey:'scale',status:'active'},update:{planKey:'scale',status:'active'}});
      await db.merchantRule.upsert({where:{merchantId:id},create:{merchantId:id,...rules},update:rules});
    }
    const rows=[
      {key:'aurora',price:scenario==='positive'?4500:12500,ratings:[5,4]},
      {key:'brisa',price:scenario==='positive'?8500:13500,ratings:[4,4]},
      {key:'acima',price:14000,ratings:[5,5]},
      {key:'nota-baixa',price:2500,ratings:[1,2]},
      {key:'nao-publicado',price:3000,ratings:[5,5],approved:false},
      {key:'sem-estoque',price:4000,ratings:[5,5],stock:0},
      {key:'inativo',price:1000,ratings:[5,5],active:false},
      {key:'estrangeiro',price:1000,ratings:[5,5],foreign:true},
    ];
    const foreignNames=[];
    for(const row of rows){
      const owner=row.foreign?foreignMerchantId:merchantId,id=prefix+'-'+row.key,name='Fone '+row.key+' sintético';if(row.foreign)foreignNames.push(name);
      await db.$transaction(async tx=>{
      await lockCatalogMerchant(tx,owner);
      await tx.product.create({data:{id,merchantId:owner,name,type:'physical',isActive:row.active!==false,
        description:'Fone sintético local; preço, estoque e avaliações vêm do cadastro canônico.',
        variants:{create:{id:id+'-v',sku:id,isActive:true,price:{create:{basePriceInCents:row.price,costInCents:500,currency:'BRL'}},
          stock:{create:{quantity:row.stock??10,reserved:0}}}}}});
      const location=await tx.inventoryLocation.findFirst({where:{merchantId:owner,isDefault:true,isActive:true},orderBy:{id:'asc'}})
        ??await tx.inventoryLocation.create({data:{merchantId:owner,name:'Estoque principal',kind:'warehouse',isDefault:true,isActive:true}});
      await tx.inventoryItem.create({data:{merchantId:owner,locationId:location.id,sku:id,productName:name,quantity:row.stock??10,reserved:0,avgCostCents:500,salePriceCents:row.price}});
    });
      for(const[index,rating]of row.ratings.entries())await db.productReview.create({data:{id:id+'-r'+index,merchantId:owner,productId:id,
        buyerId:prefix+'-reviewer'+index,rating,text:'Avaliação sintética '+rating,approved:row.approved!==false,
        moderationStatus:row.approved===false?'pending':'approved',verified:false}});
      // A hidden negative cannot lower a published rating; it is a visibility decoy.
      if(row.key==='aurora')await db.productReview.create({data:{id:id+'-hidden',merchantId:owner,productId:id,buyerId:prefix+'-hidden',
        rating:1,text:'Rascunho sintético não publicado',approved:false,moderationStatus:'pending',verified:false}});
    }
    const scope={merchantId:{in:[merchantId,foreignMerchantId]}};
    const catalog=()=>db.product.findMany({where:scope,include:{variants:{include:{price:true,stock:true},orderBy:{id:'asc'}}},orderBy:{id:'asc'}});
    const reviews=()=>db.productReview.findMany({where:{product:scope},orderBy:{id:'asc'}});
    const eligible=async ceiling=>{
      const products=await db.product.findMany({where:{merchantId,isActive:true},include:{variants:{include:{price:true,stock:true}},reviews:true}});
      const result=[];
      for(const product of products){
        const visible=product.reviews.filter(review=>(review.merchantId===merchantId||review.merchantId===null)&&review.approved
          &&(review.moderationStatus==='approved'||review.moderationStatus===null)&&review.rating>=1&&review.rating<=5);
        if(!visible.length||!product.name.toLowerCase().includes('fone'))continue;
        const rating=visible.reduce((sum,review)=>sum+review.rating,0)/visible.length;if(rating<4)continue;
        for(const variant of product.variants){
          const stock=variant.stock.reduce((sum,item)=>sum+item.quantity-item.reserved,0);
          if(!variant.isActive||stock<=0||variant.price?.currency!=='BRL'||variant.price.basePriceInCents>ceiling)continue;
          result.push({id:product.id,name:product.name,variantId:variant.id,price:variant.price.basePriceInCents,rating,reviewCount:visible.length});
        }
      }
      return result.sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id));
    };
    const snapshot=async()=>({catalog:await catalog(),reviews:await reviews(),
      stock:await db.productStock.findMany({where:{variant:{product:scope}},orderBy:{id:'asc'}}),
      orders:await db.completedOrder.findMany({where:{merchantId},orderBy:{id:'asc'}}),intents:await db.paymentIntent.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      appointments:await db.serviceAppointment.findMany({where:{merchantId},orderBy:{id:'asc'}}),receipts:await db.attendanceReceipt.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      inventory:await db.inventoryMovement.count({where:{merchantId}}),carts:await db.storefrontCart.findMany({where:{merchantId},select:{sessionId:true,items:true,total:true},orderBy:{sessionId:'asc'}}),
      financialEvents:await db.outboxMessage.findMany({where:{merchantId,OR:[{eventType:{startsWith:'payment.'}},{eventType:{startsWith:'order.'}}]},
        select:{eventId:true,eventType:true,payload:true,correlationId:true,causationId:true},orderBy:{eventId:'asc'}})});
    assert.equal(await db.productTestimonial.count({where:{product:scope}}),0,'fixture_has_no_unaccounted_review_source');
    let origin,deviceId,buyerPhone;
    if(channel==='storefront'){
      await db.merchantInstallation.create({data:{merchantId,name:'Owned search Next',environment:'live',status:'active',widgetVersion:'v2',allowedOrigins:[BUYER_STOREFRONT_ORIGIN]}});
      next=await runtime.buyerBooking.openStorefront();assert.equal(next.origin,BUYER_STOREFRONT_ORIGIN);origin=next.origin;
    }else{
      const phoneNumberId='900062000001',configId=prefix+'-config';deviceId='META_CLOUD:'+configId;buyerPhone='5511998000062';
      await db.whatsAppChannelConfig.create({data:{id:configId,merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',deviceId,
        credentials:{phoneNumberId,wabaId:'900062999',accessToken:'synthetic-no-external-meta-secret'}}});
      viewer=await createProductCatalogViewer({runtime,db,merchantId,deviceId,phoneNumberId,buyerPhone});origin=viewer.origin;
    }
    assert.equal((await eligible(10000)).length,scenario==='positive'?2:0);
    return Object.freeze({channel,scenario,origin,slug,merchantId,foreignNames:Object.freeze(foreignNames),eligible,snapshot,close,
      evidence:()=>({api:runtime.evidence(),...(next?{next:next.evidence()}:{}),transport:channel==='storefront'
        ?'actual_compiled_next_controlled_classifier_planner':'signed_meta_ingress_captured_sender_local_viewer'}),
      assertModelTrace(turns){const events=runtime.storefrontQueryModel.events().filter(event=>event.kind==='providerFetch');
        assert.deepEqual(events.map(event=>event.input.phase),Array.from({length:turns},()=>['storefront.intent','storefront.shopping-plan']).flat());
        for(let index=0;index<turns;index++){const actual=events[index*2+1].result.response;assert.deepEqual(actual,plan(ceilings[index]));}
      },
      async currentMetaView(){assert.equal(channel,'whatsapp');const row=await db.whatsAppSession.findFirst({where:{merchantId,deviceId,buyerPhone,status:'active'}});
        const state=row?.conversationState;assert.ok(state&&typeof state==='object'&&state.view&&Array.isArray(state.view.blocks),'search_real_meta_view_required');return structuredClone(state.view);},
    });
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'search_read_setup_cleanup_failed');}throw error;}
}