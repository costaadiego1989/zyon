import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {lockCatalogMerchant} from '../dist/shared/persistence/catalog-stock-ledger.js';
import {BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';
import {createProductCatalogViewer} from './product-catalog-read.viewer.mjs';

const classification={schemaVersion:2,domain:'STORE_COMMERCE',intent:'PRODUCT_SEARCH',confidence:1,
  requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:null,serviceAction:null};
const rules={maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,
  allowBonusItem:false,allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,autonomousEngineEnabled:false,
  freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,
  blockedRegions:[],brandVoice:'Cordial',originZip:'01310000'};

/** S1 only: original real runtime/Next or signed WhatsApp ingress. Seed static
 * catalog/config preconditions; never cart/session/token/payment/order results.
 * Both merchants are registered by real Auth HTTP, not by a fake principal. */
export async function createProductCatalogReadJourney(channel,scenario){
  assert.ok(['storefront','whatsapp'].includes(channel)&&['ten','empty'].includes(scenario),'catalog_read_scenario_invalid');
  const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',
    modelScript:[{phase:'storefront.intent',response:classification}],
    ...(channel==='storefront'?{buyerBooking:true,buyerBrowser:true}:{whatsapp:{marketingOpening:true,marketingOpeningPurpose:'c60-catalog'},c60MetaCapabilitiesFixture:'owned-c60-catalog-empty-v1',c60RecoveryTemplateMonitorFixture:'manual-only-v1'})});
  let db,next,viewer,closed=false;
  const close=async()=>{if(closed)return;closed=true;const errors=[];
    for(const surface of[viewer,next])try{await surface?.close();}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'catalog_read_owned_cleanup_failed');
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const evidence=runtime.evidence();assert.equal(evidence.canonicalAppModule,true);assert.equal(evidence.providerCalls,0);
    assert.equal(evidence.authOverrides,false);assert.equal(evidence.repositoryOverrides,false);
    assert.deepEqual(evidence.localStorefrontRoutingProfile,{configured:'structured',observed:'structured',binding:'original_adapter_constructor',selectorActive:true});
    assert.equal(Object.hasOwn(evidence,'localServiceReleaseFixture'),false);assert.equal(Object.hasOwn(evidence,'localCapturedProductPayments'),false);
    const register=async(label)=>{
      const response=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({merchant_name:label,
          email:randomUUID()+'@buyer-journey.example.test',password:'SyntheticCatalogMerchant123!',business_mode:'products'})});
      assert.equal(response.status,201);const auth=await response.json();assert.ok(typeof auth.access_token==='string'&&typeof auth.merchant_id==='string');
      return auth.merchant_id;
    };
    const merchantId=await register('Catálogo próprio local'),foreignMerchantId=await register('Catálogo externo sintético');
    const slug='c60-catalog-'+randomUUID(),prefix='c60_'+runtime.db.runId.replaceAll('-','');
    for(const[id,storeSlug]of[[merchantId,slug],[foreignMerchantId,slug+'-foreign']]){
      await db.merchant.update({where:{id},data:{plan:'STORE_ONLY',storeSlug,
        storeSettings:{company:{description:'Catálogo sintético local para validação de leitura.'},registration_pending:false,plan_selection_pending:false}}});
      await db.merchantBillingSubscription.upsert({where:{merchantId:id},create:{merchantId:id,planKey:'scale',status:'active'},update:{planKey:'scale',status:'active'}});
      await db.merchantRule.upsert({where:{merchantId:id},create:{merchantId:id,...rules},update:rules});
    }
    const ownCount=scenario==='ten'?10:0,foreignNames=[];
    for(const[id,count,key,label]of[[merchantId,ownCount,'own','Catálogo próprio'],[foreignMerchantId,2,'foreign','Catálogo externo']]){
      for(let index=1;index<=count;index++){
        const number=String(index).padStart(2,'0'),productId=prefix+'-'+key+'-p'+number,name=label+' '+number;
        if(key==='foreign')foreignNames.push(name);
        await db.$transaction(async tx=>{
      await lockCatalogMerchant(tx,id);
      await tx.product.create({data:{id:productId,merchantId:id,name,type:'physical',isActive:true,
          description:'Produto sintético de catálogo. Dados atuais verificados pelo leitor original.',
          variants:{create:{id:productId+'-v',sku:prefix+'-'+key+'-'+number,isActive:true,
            price:{create:{basePriceInCents:1500+index*100,currency:'BRL'}},stock:{create:{quantity:10,reserved:0}}}}}});
      const location=await tx.inventoryLocation.findFirst({where:{merchantId:id,isDefault:true,isActive:true},orderBy:{id:'asc'}})
        ??await tx.inventoryLocation.create({data:{merchantId:id,name:'Estoque principal',kind:'warehouse',isDefault:true,isActive:true}});
      await tx.inventoryItem.create({data:{merchantId:id,locationId:location.id,sku:prefix+'-'+key+'-'+number,productName:name,quantity:10,reserved:0,salePriceCents:1500+index*100}});
    });
      }
    }
    const catalogRows=()=>db.product.findMany({where:{merchantId:{in:[merchantId,foreignMerchantId]}},
      select:{id:true,merchantId:true,name:true,type:true,isActive:true,description:true,
        variants:{select:{id:true,sku:true,isActive:true,price:{select:{basePriceInCents:true,currency:true}},
          stock:{select:{id:true,quantity:true,reserved:true}}},orderBy:{id:'asc'}}},orderBy:{id:'asc'}});
    const canonicalCatalog=async()=>{
      const rows=await db.product.findMany({where:{merchantId,isActive:true},include:{variants:{include:{price:true,stock:true}}},orderBy:{id:'asc'}});
      return rows.map(row=>{assert.equal(row.type,'physical');assert.equal(row.variants.length,1);const variant=row.variants[0];
        const available=variant.stock.reduce((sum,stock)=>sum+stock.quantity-stock.reserved,0);
        assert.ok(variant.isActive&&variant.price?.currency==='BRL'&&available>0,'catalog_read_static_facts_invalid');
        return{id:row.id,name:row.name,variantId:variant.id,priceInCents:variant.price.basePriceInCents};});
    };
    const snapshot=async()=>({catalog:await catalogRows(),
      stock:await db.productStock.findMany({where:{variant:{product:{merchantId:{in:[merchantId,foreignMerchantId]}}}},orderBy:{id:'asc'}}),
      orders:await db.completedOrder.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      intents:await db.paymentIntent.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      appointments:await db.serviceAppointment.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      receipts:await db.attendanceReceipt.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      inventory:await db.inventoryMovement.count({where:{merchantId}}),
      carts:await db.storefrontCart.findMany({where:{merchantId},select:{sessionId:true,items:true,total:true},orderBy:{sessionId:'asc'}}),
      financialEvents:await db.outboxMessage.findMany({where:{merchantId,OR:[{eventType:{startsWith:'payment.'}},{eventType:{startsWith:'order.'}}]},
        select:{eventId:true,eventType:true,payload:true,correlationId:true,causationId:true},orderBy:{eventId:'asc'}})});
    let origin,deviceId,buyerPhone;
    if(channel==='storefront'){
      await db.merchantInstallation.create({data:{merchantId,name:'Owned catalog Next',environment:'live',status:'active',widgetVersion:'v2',allowedOrigins:[BUYER_STOREFRONT_ORIGIN]}});
      next=await runtime.buyerBooking.openStorefront();assert.equal(next.origin,BUYER_STOREFRONT_ORIGIN);origin=next.origin;
    }else{
      const phoneNumberId='900060000001';deviceId='META_CLOUD:'+prefix+'-config';buyerPhone='5511998000060';
      await db.whatsAppChannelConfig.create({data:{id:prefix+'-config',merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',deviceId,
        credentials:{phoneNumberId,wabaId:'900060999',accessToken:'synthetic-no-external-meta-secret'}}});
      viewer=await createProductCatalogViewer({runtime,db,merchantId,deviceId,phoneNumberId,buyerPhone});origin=viewer.origin;
    }
    assert.equal((await canonicalCatalog()).length,ownCount);
    return Object.freeze({channel,scenario,origin,slug,merchantId,foreignNames:Object.freeze(foreignNames),runId:runtime.db.runId,
      canonicalCatalog,snapshot,close,evidence:()=>({api:runtime.evidence(),...(next?{next:next.evidence()}:{}),
        transport:channel==='storefront'?'actual_compiled_next_controlled_classifier':'signed_meta_ingress_captured_sender_local_viewer'}),
      async currentMetaView(){assert.equal(channel,'whatsapp');const row=await db.whatsAppSession.findFirst({where:{merchantId,deviceId,buyerPhone,status:'active'}});
        const state=row?.conversationState;assert.ok(state&&typeof state==='object'&&state.view&&Array.isArray(state.view.blocks),'catalog_read_real_view_required');
        return structuredClone(state.view);},
    });
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'catalog_read_setup_cleanup_failed');}throw error;}
}