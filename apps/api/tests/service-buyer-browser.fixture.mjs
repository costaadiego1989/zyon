import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {lockCatalogMerchant} from '../dist/shared/persistence/catalog-stock-ledger.js';
import {BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';
import {PasswordHasher} from '../dist/modules/auth/domain/services/password-hasher.service.js';

const offer={productId:'t93-browser-service',variantId:'t93-browser-variant'};
const classification={schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:1,
  requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:'live_facts',serviceAction:'browse'};
const turn=()=>[{phase:'storefront.intent',response:classification},
  {phase:'storefront.sales',serviceToolCall:{name:'get_service_professionals',args:offer}}];

/** A new real API/SQL/Redis and compiled Next per browser case. Static catalog,
 * account and installation rows are declared synthetic preconditions; no
 * appointment, balance, receipt, session token or service result is seeded. */
export async function createBuyerBrowserJourney(scenario){
  assert.ok(['local','online','empty','conflict','expired','products'].includes(scenario),'buyer_browser_scenario_invalid');
  const mode=scenario==='products'?'products':'services';
  const runtime=await createServiceTestRuntime({local:true,buyerBooking:true,buyerBrowser:true,serviceReleaseFixture:'matching',
    storefrontQueryModel:true,storefrontRoutingProfile:'structured',modelScript:[...turn(),...turn()]});let db,next;
  const close=async()=>{const errors=[];try{await next?.close();}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'buyer_browser_owned_cleanup_failed');
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    assert.equal(runtime.evidence().canonicalAppModule,true);assert.equal(runtime.evidence().authOverrides,false);
    assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().providerCalls,0);
    assert.deepEqual(runtime.evidence().localBuyerTransportOverrides,['buyer-account.EMAIL_OTP_PROVIDER']);
    const request=async(path,body,auth,method='POST')=>{
      const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{'content-type':'application/json','idempotency-key':body?.commandId??randomUUID(),
          ...(auth?{authorization:'Bearer '+auth.access_token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,body:await response.json()};
    };
    const ownerEmail=randomUUID()+'@buyer-journey.example.test';
    const company=await request('/auth/register',{merchant_name:'Atendimento comprador local',email:ownerEmail,
      password:'SyntheticBrowserMerchant123!',business_mode:mode});assert.equal(company.status,201);
    const auth=company.body,merchantId=auth.merchant_id,slug='buyer-journey-'+randomUUID();
    await db.merchant.update({where:{id:merchantId},data:{plan:'STORE_ONLY',storeSlug:slug,
      storeSettings:{company:{description:'Empresa sintética de serviços agendados.'},registration_pending:false,plan_selection_pending:false}}});
    await db.merchantBillingSubscription.upsert({where:{merchantId},create:{merchantId,planKey:'scale',status:'active'},update:{planKey:'scale',status:'active'}});
    await db.merchantInstallation.create({data:{merchantId,name:'Owned buyer browser',environment:'live',status:'active',widgetVersion:'v2',allowedOrigins:[BUYER_STOREFRONT_ORIGIN]}});
    await db.merchantRule.create({data:{merchantId,maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,
      allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,
      autonomousEngineEnabled:false,freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,
      offerExpirationMinutes:10,blockedRegions:[],brandVoice:'Cordial',originZip:'01310000'}});
    const createProduct=client=>client.product.create({data:{id:offer.productId,merchantId,name:mode==='products'?'Produto físico local':'Consulta de orientação',type:mode==='products'?'physical':'service',isActive:true,
      ...(mode==='services'?{metadata:{serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:30,slots:[]}}}:{}),
      variants:{create:{id:offer.variantId,sku:'T93-BROWSER',isActive:true,price:{create:{basePriceInCents:5000,currency:'BRL'}},
        ...(mode==='products'?{stock:{create:{quantity:10,reserved:0}}}:{})}}}});
    if(mode==='products')await db.$transaction(async tx=>{
      await lockCatalogMerchant(tx,merchantId);await createProduct(tx);
      const location=await tx.inventoryLocation.findFirst({where:{merchantId:merchantId,isDefault:true,isActive:true},orderBy:{id:'asc'}})
        ??await tx.inventoryLocation.create({data:{merchantId:merchantId,name:'Estoque principal',kind:'warehouse',isDefault:true,isActive:true}});
      await tx.inventoryItem.create({data:{merchantId:merchantId,locationId:location.id,sku:'T93-BROWSER',productName:mode==='products'?'Produto físico local':'Consulta de orientação',quantity:10,reserved:0,salePriceCents:5000}});
    });else await createProduct(db);
    const professionalId='t93-browser-professional';
    if(mode==='services'){
      await db.serviceProfessional.create({data:{id:professionalId,merchantId,publicName:'Profissional Ana',timeZone:'America/Sao_Paulo',isActive:true,isPublished:true}});
      await db.professionalService.create({data:{merchantId,professionalId,productId:offer.productId}});
      if(scenario!=='empty')await db.professionalAvailability.createMany({data:Array.from({length:7},(_,weekday)=>({merchantId,professionalId,
        weekday,startMinute:600,endMinute:720,timeZone:'America/Sao_Paulo'}))});
      const policy=await request('/merchants/me/service-business-policy',{expectedVersion:0,paymentMode:scenario==='online'?'online':'at_attendance',
        holdEnabled:false,holdMinutes:null,admissionsEnabled:true},auth,'PUT');assert.equal(policy.status,200);
    }
    if(scenario==='online')await db.merchantPaymentConnection.create({data:{merchantId,provider:'asaas',environment:'sandbox',
      status:'active',chargesEnabled:true,payoutsEnabled:false,externalAccountId:'synthetic-no-external-account'}});
    const email=randomUUID()+'@buyer-journey.example.test',account=await db.buyerAccount.create({data:{email,displayName:'Comprador local',passwordHash:await new PasswordHasher().hash(randomUUID()+randomUUID())}});
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'})
      .format(new Date(Date.now()+2*86400000));
    next=await runtime.buyerBooking.openStorefront();assert.equal(next.origin,BUYER_STOREFRONT_ORIGIN);
    const snapshot=async()=>({appointments:await db.serviceAppointment.findMany({where:{merchantId},include:{payments:true},orderBy:{id:'asc'}}),
      intents:await db.paymentIntent.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      receipts:await db.attendanceReceipt.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      audits:await db.appointmentAudit.findMany({where:{merchantId},orderBy:{commandId:'asc'}}),
      events:await db.outboxMessage.findMany({where:{merchantId,producer:'service-booking'},select:{eventId:true,eventType:true,correlationId:true,causationId:true,payload:true},orderBy:{eventId:'asc'}}),
      stock:await db.productStock.findMany({where:{variant:{product:{merchantId}}},orderBy:{id:'asc'}}),
      carts:await db.storefrontCart.findMany({where:{merchantId},select:{sessionId:true,items:true,total:true},orderBy:{sessionId:'asc'}}),
      inventory:await db.inventoryMovement.count({where:{merchantId}})});
    return Object.freeze({origin:next.origin,runId:runtime.db.runId,merchantId,slug,email,buyerId:account.globalUserId,
      date,professionalId,offer,scenario,snapshot,close,evidence:()=>({api:runtime.evidence(),next:next.evidence(),email:runtime.buyerBooking.browserEvidence()}),
      emailCode:()=>runtime.buyerBooking.emailCode(email).code,
      async prepareServedOwnerDashboard(){
        // Opt-in T93 setup: the same actual OWNER created above and the same
        // completed-onboarding/subscription preconditions used by T75/T79.
        // No session, authorization role or booking result is manufactured.
        assert.equal(mode,'services');
        const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
        const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
        await runtime.db.sql(`UPDATE merchants SET store_settings=coalesce(store_settings,'{}'::jsonb)||'{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${quote(merchantId)};
          INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${quote(merchantId)},${quote(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
          UPDATE merchant_billing_subscriptions SET current_period_end=now()+interval '30 days',trial_ends_at=NULL,updated_at=now() WHERE merchant_id=${quote(merchantId)};
          INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${quote(merchantId)},'[]'::jsonb,1,${quote(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
        const checkout=await request('/checkout-settings',undefined,auth,'GET');assert.equal(checkout.status,200);
        const profile=await request('/merchants/me',undefined,auth,'GET');assert.equal(profile.status,200);
        assert.equal((profile.body.data??profile.body).businessMode,'services');
        assert.equal(String((profile.body.data??profile.body).role).toUpperCase(),'OWNER');
        return Object.freeze({apiOrigin:runtime.apiOrigin,email:ownerEmail,password:'SyntheticBrowserMerchant123!',merchantId});
      },
      async expireObservedAccess(observed){
        assert.equal(observed.body.merchant_id,merchantId);assert.equal(observed.body.allowed_origin,BUYER_STOREFRONT_ORIGIN);
        assert.ok(typeof observed.body.cart_ref==='string'&&typeof observed.conversationToken==='string'
          &&typeof observed.body.buyer_access_token==='string'&&typeof observed.embedToken==='string');
        // Renew the ACTUAL observed capability through the original issuer at
        // its real default continuation window, retaining previous nonce/cart/buyer. Then use
        // the existing only-reduce-expiry fixture; no new signer/issuer/control.
        const originalClaims=JSON.parse(Buffer.from(observed.embedToken.split('.')[0],'base64url').toString('utf8'));
        const issued=await runtime.buyerBooking.issue({merchantId,body:{cart_ref:observed.body.cart_ref,
          conversation_token:observed.conversationToken,allowed_origin:BUYER_STOREFRONT_ORIGIN,
          buyer_access_token:observed.body.buyer_access_token,previous_embed_token:observed.embedToken,ttl_seconds:60,
          scopes:['checkout:start','checkout:track','appointments:confirm','payment:intents:read']}});assert.equal(issued.status,201);
        const renewedClaims=JSON.parse(Buffer.from(issued.body.embed_session_token.split('.')[0],'base64url').toString('utf8'));
        for(const field of['merchantId','storefrontCartRef','allowedOrigin','nonce','issuedAtUnix','environment','installationId','aiUserId'])
          assert.ok(renewedClaims[field]===originalClaims[field],'buyer_browser_real_renewal_binding_changed');
        assert.ok(['checkout:start','appointments:confirm','payment:intents:read'].every(scope=>renewedClaims.scopes.includes(scope)),'buyer_browser_real_renewal_scope_required');
        assert.ok(renewedClaims.scopes.every(scope=>originalClaims.scopes.includes(scope)),'buyer_browser_real_renewal_scope_increased');
        return runtime.buyerBooking.shorten({token:issued.body.embed_session_token,seconds:3,merchantId,
          cartRef:observed.body.cart_ref,origin:BUYER_STOREFRONT_ORIGIN});
      },
      async occupy(selection){
        assert.equal(selection.productId,offer.productId);assert.equal(selection.variantId,offer.variantId);
        const result=await request(`/merchants/${merchantId}/service-appointments/manual`,{commandId:randomUUID(),...offer,
          professionalId:selection.professionalId,expectedProfessionalVersion:selection.professionalVersion,
          expectedPolicyVersion:selection.policyVersion,startsAt:selection.startsAt,
          customer:{kind:'contact',name:'Concorrente local',email:'concorrente@buyer-journey.example.test'}},auth);
        assert.equal(result.status,201);return result.body.appointment.id;
      },
    });
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'buyer_browser_setup_cleanup_failed');}throw error;}
}
