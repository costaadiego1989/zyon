import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {lockCatalogMerchant} from '../dist/shared/persistence/catalog-stock-ledger.js';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';
import {createProductCatalogViewer} from './product-catalog-read.viewer.mjs';
const classification={schemaVersion:2,domain:'STORE_COMMERCE',intent:'ADD_CART',confidence:1,requiresTool:true,
  needsProductDiscovery:false,shoppingPhase:null,serviceRequest:null,serviceAction:null};
export async function createProductCartJourney(channel,scenario){
  assert.ok(['storefront','whatsapp'].includes(channel)&&['mutations','crosssell'].includes(scenario));
  const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',
    ...(channel==='storefront'?{buyerBooking:true,buyerBrowser:true,modelScript:Array.from({length:scenario==='mutations'?3:2},()=>({phase:'storefront.intent',response:classification}))}:{whatsapp:{marketingOpening:true,marketingOpeningPurpose:'c60-cart'},c60MetaCapabilitiesFixture:'owned-c60-commerce-empty-v1',c60RecoveryTemplateMonitorFixture:'manual-only-v1'})});
  let db,next,viewer,closed=false;
  const close=async()=>{if(closed)return;closed=true;const errors=[];for(const surface of[viewer,next])try{await surface?.close();}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'cart_journey_cleanup_failed');
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const register=async name=>{const response=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({merchant_name:name,email:randomUUID()+'@buyer-journey.example.test',password:'SyntheticCartMerchant123!',business_mode:'products'})});assert.equal(response.status,201);return(await response.json()).merchant_id;};
    const merchantId=await register('Carrinho próprio local'),foreignMerchantId=await register('Carrinho externo sintético'),slug='c60-cart-'+randomUUID(),prefix='c60c_'+runtime.db.runId.replaceAll('-','');
    const ids=Object.fromEntries(['a','b','c','d','e','out','foreign'].map(key=>[key,prefix+'-'+key])),variants=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,id+'-v'])),
      names={a:'Kit Base',b:'Cabo Complementar',c:'Estojo Complementar',d:'Carregador Base',e:'Suporte Complementar',out:'Sem Estoque',foreign:'Produto Externo'};
    const rules={maxDiscountPercent:10,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,
      couponBoxEnabled:false,autonomousEngineEnabled:false,freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'consultative',originZip:'01310000'};
    const cs={enabled:scenario==='crosssell',touchpoints:{browsing:false,pre_cart:false,post_cart:true,pre_checkout:false,pre_payment:false,post_purchase:false},
      strategies:['complementary'],limits:{maxSuggestionsPerSession:3,cooldownSeconds:0},discount:{enabled:true,mode:'percent',percent:10},display:{mode:'interstitial'}};
    for(const[id,storeSlug]of[[merchantId,slug],[foreignMerchantId,slug+'-foreign']]){
      await db.merchant.update({where:{id},data:{plan:'STORE_ONLY',storeSlug,storeSettings:{registration_pending:false,plan_selection_pending:false,crossSell:id===merchantId?cs:{...cs,enabled:false},company:{description:'Loja sintética local para validar carrinho e complementos.'}}}});
      await db.merchantBillingSubscription.upsert({where:{merchantId:id},create:{merchantId:id,planKey:'scale',status:'active'},update:{planKey:'scale',status:'active'}});
      await db.merchantRule.upsert({where:{merchantId:id},create:{merchantId:id,...rules},update:rules});
    }
    const prices={a:4000,b:2000,c:1000,d:3000,e:1500,out:500,foreign:500};
    await db.$transaction(async tx=>{
      for(const id of[merchantId,foreignMerchantId].sort())await lockCatalogMerchant(tx,id);
      for(const key of Object.keys(ids))await tx.product.create({data:{id:ids[key],merchantId:key==='foreign'?foreignMerchantId:merchantId,name:names[key],type:'physical',isActive:true,
        description:'Produto sintético publicado: '+names[key]+'.',variants:{create:{id:variants[key],sku:variants[key],isActive:true,
          price:{create:{basePriceInCents:prices[key],costInCents:200,currency:'BRL'}},stock:{create:{quantity:key==='out'?0:20,reserved:0}}}}}});
      for(const id of[merchantId,foreignMerchantId]){
        const location=await tx.inventoryLocation.create({data:{merchantId:id,name:'Estoque principal',kind:'warehouse',isDefault:true}});
        for(const key of Object.keys(ids).filter(key=>(key==='foreign'?foreignMerchantId:merchantId)===id))
          await tx.inventoryItem.create({data:{merchantId:id,sku:variants[key],productName:names[key],locationId:location.id,
            quantity:key==='out'?0:20,reserved:0,avgCostCents:200,salePriceCents:prices[key]}});
      }
    });
    const promotionIds={ab:prefix+'-ab',bc:prefix+'-bc',de:prefix+'-de'};
    if(scenario==='crosssell')for(const[key,source,recommended,discount]of[['ab','a',[variants.out,variants.foreign,variants.b],10],['bc','b',[variants.c],10],['de','d',[variants.e],0]]){
      await db.crossSellPromotion.create({data:{id:promotionIds[key],merchantId,name:'Regra sintética '+key,trigger:{sku_in_cart:[variants[source]]},recommendedSkus:recommended,
        discountPercent:discount,maxDiscountPercent:discount,status:'active',startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+3600000)}});
    }
    const scope={merchantId:{in:[merchantId,foreignMerchantId]}};
    const state=async()=>{
      const rows=await db.storefrontCart.findMany({where:{merchantId},orderBy:{sessionId:'asc'}});assert.ok(rows.length<=1,'cart_journey_ambiguous_canonical_cart');
      const row=rows[0];if(!row)return{cartId:null,items:[],total:0,discount:0};assert.ok(Array.isArray(row.items));
      if(row.items.some(item=>item?.crossSellIntent!==undefined)){
        await import('reflect-metadata');
        const {PrismaStorefrontCrossSellCartAdapter}=await import('../dist/modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.js');
        const projected=await new PrismaStorefrontCrossSellCartAdapter(db).project({merchantId,cartId:row.sessionId});
        return{cartId:projected.sessionId,items:structuredClone(projected.items),total:projected.total,discount:projected.discount};
      }
      return{cartId:row.sessionId,items:structuredClone(row.items),total:row.total,discount:row.discount};
    };
    const snapshot=async()=>({products:await db.product.findMany({where:scope,select:{id:true,merchantId:true,name:true,type:true,isActive:true,variants:{select:{id:true,sku:true,isActive:true,price:{select:{basePriceInCents:true,costInCents:true,currency:true}}},orderBy:{id:'asc'}}},orderBy:{id:'asc'}}),
      stock:await db.productStock.findMany({where:{variant:{product:scope}},orderBy:{id:'asc'}}),
      orders:await db.completedOrder.count({where:{merchantId}}),intents:await db.paymentIntent.count({where:{merchantId}}),appointments:await db.serviceAppointment.count({where:{merchantId}}),
      receipts:await db.attendanceReceipt.count({where:{merchantId}}),inventory:await db.inventoryMovement.count({where:{merchantId}}),
      suggestions:await db.crossSellSuggestion.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      financialEvents:await db.outboxMessage.findMany({where:{merchantId,OR:[{eventType:{startsWith:'payment.'}},{eventType:{startsWith:'order.'}}]},select:{eventId:true,eventType:true,payload:true},orderBy:{eventId:'asc'}})});
    assert.deepEqual(await state(),{cartId:null,items:[],total:0,discount:0});
    let origin,deviceId,buyerPhone;
    if(channel==='storefront'){
      await db.merchantInstallation.create({data:{merchantId,name:'Owned cart Next',environment:'live',status:'active',widgetVersion:'v2',allowedOrigins:[BUYER_STOREFRONT_ORIGIN]}});
      next=await runtime.buyerBooking.openStorefront();assert.equal(next.origin,BUYER_STOREFRONT_ORIGIN);origin=next.origin;
    }else{
      const phoneNumberId='900064000001';deviceId='META_CLOUD:'+prefix+'-config';buyerPhone='5511998000064';
      await db.whatsAppChannelConfig.create({data:{id:prefix+'-config',merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',deviceId,credentials:{phoneNumberId,wabaId:'900064999',accessToken:'synthetic-no-external-meta-secret'}}});
      viewer=await createProductCatalogViewer({runtime,db,merchantId,deviceId,phoneNumberId,buyerPhone});origin=viewer.origin;
    }
    return Object.freeze({channel,scenario,origin,slug,merchantId,ids,variants,names,prices,promotionIds,state,snapshot,close,
      evidence:()=>runtime.evidence(),async view(){assert.equal(channel,'whatsapp');const row=await db.whatsAppSession.findFirst({where:{merchantId,deviceId,buyerPhone,status:'active'}});
        assert.ok(row?.conversationState?.view,'cart_real_meta_view_required');return structuredClone(row.conversationState.view);}});
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'cart_journey_setup_cleanup_failed');}throw error;}
}