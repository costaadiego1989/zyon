import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';
import {createProductCatalogViewer} from './product-catalog-read.viewer.mjs';
import {PasswordHasher} from '../dist/modules/auth/domain/services/password-hasher.service.js';
const intent={schemaVersion:2,domain:'STORE_COMMERCE',intent:'ADD_CART',confidence:1,requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:null,serviceAction:null};
export async function createProductPaymentJourney(channel,scenario){
  assert.ok(['storefront','whatsapp'].includes(channel)&&['pix','switch'].includes(scenario));
  const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',postalFixture:'owned-two-zips-v1',capturedProductPayments:true,
    ...(channel==='storefront'?{buyerBooking:true,buyerBrowser:true,modelScript:[{phase:'storefront.intent',response:intent}]}:{whatsapp:true,c60MetaCapabilitiesFixture:'owned-c60-commerce-empty-v1',c60RecoveryTemplateMonitorFixture:'manual-only-v1'})});
  let db,next,viewer,closed=false;
  const close=async()=>{if(closed)return;closed=true;const errors=[];for(const resource of[viewer,next])try{await resource?.close();}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'payment_journey_cleanup_failed');
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const request=async(path,body,auth,method='POST')=>{const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','idempotency-key':randomUUID(),...(auth?{authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};};
    const own=await request('/auth/register',{merchant_name:'Pagamentos locais próprios',email:randomUUID()+'@buyer-journey.example.test',password:'SyntheticDeliveryOwner123!',business_mode:'products'});
    const other=await request('/auth/register',{merchant_name:'Outra loja sintética',email:randomUUID()+'@buyer-journey.example.test',password:'SyntheticDeliveryOther123!',business_mode:'products'});
    assert.equal(own.status,201);assert.equal(other.status,201);const merchantId=own.body.merchant_id,foreignMerchantId=other.body.merchant_id,slug='c60-payment-'+randomUUID(),prefix='c60p_'+runtime.db.runId.replaceAll('-','');
    const names={product:'Kit de cuidados sintético',buyer:'Cliente Sintético',home:'Casa',work:'Trabalho'},phone=channel==='storefront'?'11998000064':'5511998000064',email=randomUUID()+'@buyer-journey.example.test';
    const addresses={home:{zip:'01310100',street:'Rua Casa Sintética',number:'10',complement:'',neighborhood:'Centro',city:'São Paulo',state:'SP'},
      work:{zip:'01310200',street:'Rua Trabalho Sintético',number:'20',complement:'',neighborhood:'Jardins',city:'São Paulo',state:'SP'}};
    const rules={maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,autonomousEngineEnabled:false,
      freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'Cordial',originZip:addresses.home.zip};
    for(const[mid,storeSlug]of[[merchantId,slug],[foreignMerchantId,slug+'-other']]){
      await db.merchant.update({where:{id:mid},data:{plan:'STORE_ONLY',storeSlug,melhorEnvioEnabled:false,storeSettings:{registration_pending:false,plan_selection_pending:false,crossSell:{enabled:false},company:{description:'Dados de demonstração sintéticos.',address:{zip:addresses.home.zip,city:'São Paulo',state:'SP'}}}}});
      await db.merchantBillingSubscription.upsert({where:{merchantId:mid},create:{merchantId:mid,planKey:'scale',status:'active'},update:{planKey:'scale',status:'active'}});
      await db.merchantRule.upsert({where:{merchantId:mid},create:{merchantId:mid,...rules},update:rules});
    }
    await db.ownDeliveryConfig.create({data:{merchantId,enabled:true,mode:'neighborhood',flatPriceCents:null,freeAboveCents:null,neighborhoods:[{name:'Centro',priceCents:750},{name:'Jardins',priceCents:1250}],estimatedValue:1,estimatedUnit:'days'}});
    const productId=prefix+'-product',variantId=prefix+'-variant';
    await db.product.create({data:{id:productId,merchantId,name:names.product,type:'physical',isActive:true,description:'Produto sintético para validar contato e entrega.',variants:{create:{id:variantId,sku:variantId,isActive:true,price:{create:{basePriceInCents:4000,costInCents:1000,currency:'BRL'}},stock:{create:{quantity:20,reserved:0}}}}}});
    // Only static account/profile/address facts. The password is verified by the
    // real login use case, then the real guarded profile writer encrypts PII.
    let buyerId;
    {
      const password='SyntheticBuyerDelivery123!',account=await db.buyerAccount.create({data:{email,displayName:names.buyer,passwordHash:await new PasswordHasher().hash(password)}});buyerId=account.globalUserId;
      const auth=await request('/buyer/login',{email,password});assert.equal(auth.status,201);assert.equal(auth.body.global_user_id??auth.body.globalUserId,buyerId);
      const saved=await request('/buyer/me/profile',{cpf:'52998224725',address:addresses.home,phone},auth.body.accessToken,'PATCH');assert.equal(saved.status,200);
      const raw=await db.buyerAccount.findUnique({where:{globalUserId:buyerId}});assert.match(raw.cpf,/^pii_v1:/);{assert.match(raw.phone,/^pii_v1:/);assert.ok(raw.phoneLookupHash);}
      for(const[key,address]of Object.entries(addresses))await db.buyerAddress.create({data:{id:prefix+'-'+key,globalUserId:buyerId,label:names[key],...address,isDefault:key==='home'}});
    }
    const foreign=await db.buyerAccount.create({data:{email:randomUUID()+'@buyer-journey.example.test',displayName:'Pessoa de outra conta',passwordHash:null}});
    await db.buyerAddress.create({data:{id:prefix+'-foreign-address',globalUserId:foreign.globalUserId,label:'Endereço de outra conta',...addresses.work,isDefault:true}});
    // Static source inventory, never a sale result. Real inventory consumer owns
    // subsequent decrement/projection/movement/receipt after the real event.
    const location=await db.inventoryLocation.create({data:{merchantId,name:'Depósito sintético S5',isDefault:true,isActive:true}});
    await db.inventoryItem.create({data:{merchantId,locationId:location.id,sku:variantId,productName:names.product,quantity:20,reserved:0}});
    await db.product.create({data:{id:prefix+'-foreign-product',merchantId:foreignMerchantId,name:'Produto de outra empresa',type:'physical',isActive:true,
      variants:{create:{id:prefix+'-foreign-variant',sku:prefix+'-foreign-variant',isActive:true,price:{create:{basePriceInCents:9900,currency:'BRL'}},stock:{create:{quantity:10,reserved:0}}}}}});
    await runtime.productPayments.bind(own.body.access_token);

    const cart=async()=>{const rows=await db.storefrontCart.findMany({where:{merchantId}});assert.ok(rows.length<=1,'delivery_ambiguous_cart');const row=rows[0];return row?{cartId:row.sessionId,items:structuredClone(row.items),total:row.total,discount:row.discount}:null;};
    const checkout=async()=>{
      const ownedCart=await cart();if(!ownedCart)return null;
      const rows=await db.checkoutSession.findMany({where:{merchantId,cart:{path:['cart_ref'],equals:ownedCart.cartId}}});
      assert.ok(rows.length<=1,'delivery_ambiguous_checkout');const row=rows[0];if(!row)return null;
      assert.equal(row.merchantId,merchantId);assert.equal(row.cart.source,'storefront');assert.equal(row.cart.cart_ref,ownedCart.cartId);
      return structuredClone(row);
    };
    const book=async()=>buyerId?db.buyerAddress.findMany({where:{globalUserId:buyerId},orderBy:{id:'asc'}}):[];
    const snapshot=async()=>({stock:await db.productStock.findMany({where:{variant:{product:{merchantId}}},orderBy:{id:'asc'}}),foreignAddress:await db.buyerAddress.findUnique({where:{id:prefix+'-foreign-address'}}),
      orders:await db.completedOrder.count({where:{merchantId}}),intents:await db.paymentIntent.count({where:{merchantId}}),appointments:await db.serviceAppointment.count({where:{merchantId}}),receipts:await db.attendanceReceipt.count({where:{merchantId}}),inventory:await db.inventoryMovement.count({where:{merchantId}}),
      quotes:await db.shippingQuote.findMany({where:{merchantId},orderBy:{createdAt:'asc'}}),financialEvents:await db.outboxMessage.findMany({where:{merchantId,OR:[{eventType:{startsWith:'payment.'}},{eventType:{startsWith:'order.'}}]},select:{eventId:true,eventType:true,payload:true},orderBy:{eventId:'asc'}})});
    const finance=async()=>({
      intents:await db.paymentIntent.findMany({where:{merchantId},select:{id:true,merchantId:true,sessionId:true,method:true,status:true,currency:true,
        amountCents:true,approvedAmountCents:true,providerPaymentId:true,buyerFacing:true,creation:true,amountBreakdown:true,statusHistory:true},orderBy:{id:'asc'}}),
      orders:await db.completedOrder.findMany({where:{merchantId},select:{id:true,sessionId:true,externalOrderId:true,orderTotal:true,status:true,currency:true,lineItemsJson:true,shippingCents:true},orderBy:{id:'asc'}}),
      stock:await db.productStock.findMany({where:{variantId},select:{id:true,quantity:true,reserved:true},orderBy:{id:'asc'}}),
      inventory:await db.inventoryItem.findMany({where:{merchantId},select:{id:true,sku:true,quantity:true,reserved:true},orderBy:{id:'asc'}}),
      movements:await db.inventoryMovement.findMany({where:{merchantId},select:{id:true,itemId:true,kind:true,quantity:true,reason:true,externalRef:true,source:true},orderBy:{id:'asc'}}),
      sales:await db.inventorySaleReceipt.findMany({where:{merchantId},select:{id:true,orderId:true,payloadHash:true,payload:true,result:true},orderBy:{id:'asc'}}),
      settlements:await db.paymentSettlement.findMany({where:{merchantId},include:{entries:{orderBy:{sequence:'asc'}}},orderBy:[{paymentIntentId:'asc'},{sequence:'asc'}]}),
      events:await db.outboxMessage.findMany({where:{merchantId},select:{eventId:true,eventType:true,correlationId:true,causationId:true,payload:true},orderBy:{eventId:'asc'}}),
      appointments:await db.serviceAppointment.count({where:{merchantId}}),attendanceReceipts:await db.attendanceReceipt.count({where:{merchantId}}),
    });

    assert.equal(await cart(),null);assert.equal(await checkout(),null);assert.equal((await snapshot()).quotes.length,0);
    let origin,deviceId;
    if(channel==='storefront'){await db.merchantInstallation.create({data:{merchantId,name:'Owned contact delivery Next',environment:'live',status:'active',widgetVersion:'v2',allowedOrigins:[BUYER_STOREFRONT_ORIGIN]}});
      next=await runtime.buyerBooking.openStorefront();assert.equal(next.origin,BUYER_STOREFRONT_ORIGIN);origin=next.origin;
    }else{const phoneNumberId='900064000002',configId=prefix+'-wa';deviceId='META_CLOUD:'+configId;
      await db.whatsAppChannelConfig.create({data:{id:configId,merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',deviceId,credentials:{phoneNumberId,wabaId:'900064999',accessToken:'synthetic-no-external-meta-secret'}}});
      viewer=await createProductCatalogViewer({runtime,db,merchantId,deviceId,phoneNumberId,buyerPhone:phone,paymentLinks:true});origin=viewer.origin;}
    return Object.freeze({channel,scenario,origin,slug,merchantId,productId,variantId,names,phone,email,buyerId,addresses,cart,checkout,book,snapshot,finance,close,
      async notify(intentId){assert.ok((await finance()).intents.some(row=>row.id===intentId));return runtime.productPayments.notify(intentId,'matching');},
      emailCode:()=>{assert.equal(channel,'storefront');return runtime.buyerBooking.emailCode(email).code;},
      postal:()=>runtime.postal.events(),evidence:()=>({api:runtime.evidence(),postal:runtime.postal.evidence(),...(next?{next:next.evidence(),email:runtime.buyerBooking.browserEvidence()}:{})}),
      async view(){assert.equal(channel,'whatsapp');const row=await db.whatsAppSession.findFirst({where:{merchantId,deviceId,buyerPhone:phone,status:'active'}});assert.ok(row?.conversationState?.view);return structuredClone(row.conversationState.view);}});
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'payment_journey_setup_cleanup_failed');}throw error;}
}
