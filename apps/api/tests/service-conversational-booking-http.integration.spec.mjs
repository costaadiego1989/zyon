import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {Redis} from 'ioredis';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {businessDateKey} from '../src/shared/analytics/business-period.js';

const offer={productId:'dispatch-service',variantId:'dispatch-variant'},professionalId='dispatch-professional';
const date=businessDateKey(new Date(Date.now()+2*86400000));
const promiseCanary='Seu horário está confirmado e pago. MODEL_PROMISE_MUST_BE_DISCARDED';
const serviceNames=['get_service_professionals','get_service_dates','get_service_slots','resolve_service_selection'];
const classification=(action='browse')=>({schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:1,requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:'live_facts',serviceAction:action});
const turn=(name,args,extra={})=>[{phase:'storefront.intent',response:classification(name==='resolve_service_selection'?'select':'browse')},{phase:'storefront.sales',serviceToolCall:{name,args,...(extra.narration?{narration:extra.narration}:{})},...(extra.hold?{hold:true}:{})}];
const script=()=>[
 ...turn('get_service_professionals',offer),
 ...turn('get_service_professionals',offer,{narration:promiseCanary}),
 ...turn('get_service_dates',{...offer,professionalId,fromDate:date,toDate:date}),
 ...turn('get_service_slots',{...offer,professionalId,date}),
 ...turn('resolve_service_selection',{...offer,professionalName:'Dra. Ana Costa',date:{kind:'absolute',value:date},time:{kind:'exact',value:'10:00'}},{narration:promiseCanary}),
 ...turn('get_service_slots',{...offer,professionalId,date}),
 ...turn('get_service_professionals',offer),
 ...turn('get_service_slots',{...offer,professionalId,date},{hold:true}),
];
async function fixture(modelScript){
 const runtime=await createServiceTestRuntime({local:true,buyerBooking:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',modelScript,serviceReleaseFixture:'matching'});let db,redis;
 try{
  db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});redis=new Redis(runtime.redis.url,{maxRetriesPerRequest:0,retryStrategy:()=>null,connectTimeout:5000,commandTimeout:5000});
  assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);assert.equal(await redis.get('aacp:synthetic:run'),runtime.redis.runId);
  const evidence=runtime.evidence();assert.equal(evidence.canonicalAppModule,true);assert.equal(evidence.authOverrides,false);assert.equal(evidence.repositoryOverrides,false);assert.equal(evidence.providerCalls,0);assert.deepEqual(evidence.localProviderOverrides,[]);assert.deepEqual(evidence.localModelOverrides,['QueryKnowledgeUseCase.embeddingService','storefront.STOREFRONT_PROVIDER_FETCH_FACTORY']);
  const origin='https://conversational-booking.example.test',password='SyntheticDispatchBuyer123!';
  const request=async(path,body,headers={},method='POST')=>{const correlationId=randomUUID(),response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','idempotency-key':randomUUID(),'x-correlation-id':correlationId,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json(),correlationId};};
  const company=async(label,mode='services')=>{
   const registered=await request('/auth/register',{merchant_name:'Synthetic '+label,email:label+'@conversational-booking.example.test',password,business_mode:mode});assert.equal(registered.status,201);const auth=registered.body,merchantId=auth.merchant_id;
   await db.merchant.update({where:{id:merchantId},data:{plan:'STORE_ONLY',storeSettings:{company:{description:'Empresa sintética de '+(mode==='services'?'atendimentos agendados':'produtos')+'.'}}}});
   await db.merchantBillingSubscription.upsert({where:{merchantId},create:{merchantId,planKey:'growth',status:'active'},update:{planKey:'growth',status:'active'}});
   await db.merchantRule.create({data:{merchantId,maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,autonomousEngineEnabled:false,freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'Cordial',originZip:'01310000'}});
   if(mode==='services'){const policy=await request('/merchants/me/service-business-policy',{expectedVersion:0,holdEnabled:false,paymentMode:'at_attendance',admissionsEnabled:true},{authorization:'Bearer '+auth.access_token},'PUT');assert.equal(policy.status,200);}
   const conversation=await request('/storefront/conversations',{merchant_id:merchantId},{origin});assert.equal(conversation.status,201);
   const cartRef=conversation.body.conversation_id;
   // This existing private issuer path preserves accepted T40 explicit grants.
   // T45's separate guest/login native proves missing-grant derivation.
   const issued=await runtime.buyerBooking.issue({merchantId,body:{cart_ref:cartRef,conversation_token:conversation.body.conversation_token,allowed_origin:origin,ttl_seconds:60,scopes:['checkout:start','checkout:track','appointments:confirm']}});assert.equal(issued.status,201);
   await db.storefrontCart.create({data:{merchantId,sessionId:cartRef,expiresAt:new Date(Date.now()+86400000)}});
   return{merchantId,auth,cartRef,conversationToken:conversation.body.conversation_token,embedToken:issued.body.embed_session_token};
  };
  const buyer=async()=>{const{PasswordHasher}=await import('../dist/modules/auth/domain/services/password-hasher.service.js');const account=await db.buyerAccount.create({data:{globalUserId:'buyer_'+randomUUID().replaceAll('-',''),email:randomUUID()+'@dispatch-buyer.example.test',passwordHash:await new PasswordHasher().hash(password),displayName:'Synthetic buyer'}});const login=await request('/buyer/login',{email:account.email,password});assert.equal(login.status,201);return{account,token:login.body.accessToken};};
  const headers=(c,b)=>({origin,authorization:'Bearer '+c.conversationToken,...(b?{'x-buyer-authorization':'Bearer '+b.token,'x-aacp-embed-token':c.embedToken}:{})});
  const say=(c,text,b,extra={},custom={})=>request('/storefront/conversations/'+c.cartRef+'/messages',{user_message:text,cart_id:c.cartRef,history:[],...extra},{...headers(c,b),...custom});
  const bookingHeaders=(c,b)=>({origin,'x-aacp-embed-token':c.embedToken,'x-buyer-access-token':b.token});
  const snapshot=async()=>({appointments:await db.serviceAppointment.findMany({orderBy:{id:'asc'}}),balances:await db.appointmentPayment.findMany({orderBy:{id:'asc'}}),reservations:await db.serviceReservation.findMany({orderBy:{id:'asc'}}),payments:await db.paymentIntent.count(),orders:await db.completedOrder.count(),stock:await db.inventoryMovement.count(),checkouts:await db.checkoutSession.findMany({select:{merchantId:true,sessionId:true,globalUserId:true,cart:true},orderBy:{id:'asc'}})});
  const close=async()=>{const errors=[];try{await redis.quit();redis.disconnect();}catch(error){errors.push(error);}try{await db.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'conversational_booking_owned_cleanup_failed');};
  return{runtime,db,redis,origin,request,company,buyer,headers,say,bookingHeaders,snapshot,close};
 }catch(error){const errors=[error];try{redis?.disconnect();}catch(cleanup){errors.push(cleanup);}try{await db?.$disconnect();}catch(cleanup){errors.push(cleanup);}try{await runtime.close();}catch(cleanup){errors.push(cleanup);}throw new AggregateError(errors,'conversational_booking_setup_cleanup_failed');}
}
function block(result,kind){assert.equal(result.status,201);const found=result.body.blocks.filter(value=>value.type==='service_booking');assert.equal(found.length,1);assert.equal(found[0].data.kind,kind);assert.equal(result.body.message.includes(promiseCanary),false);assert.doesNotMatch(result.body.message,/seu horário está confirmado e pago/i);return found[0].data;}
function publicOnly(result,secrets){const json=JSON.stringify(result.body);for(const value of secrets.filter(Boolean))assert.equal(json.includes(value),false);for(const key of['parent_cart_fingerprint','cart_fingerprint','buyer_access_token','embed_session_token','ownerHash','generation','privateLease'])assert.equal(json.includes('"'+key+'"'),false);}
async function scriptObserved(runtime,step){const end=Date.now()+5000;do{const event=runtime.storefrontQueryModel.events().find(e=>e.result?.scriptStep===step);if(event)return event;await pause(10);}while(Date.now()<end);assert.fail('actual_model_script_step_not_observed');}

test('T43 public conversational scheduling reaches real service tools and keeps authenticated confirmation separate',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
 const f=await fixture(script());try{
  const own=await f.company('own'),foreign=await f.company('foreign');
  await f.db.product.create({data:{id:offer.productId,merchantId:own.merchantId,name:'Consulta canônica',type:'service',metadata:{serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:20,slots:[]}},variants:{create:{id:offer.variantId,sku:'DISPATCH-SERVICE',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}}});
  await f.db.serviceProfessional.create({data:{id:professionalId,merchantId:own.merchantId,publicName:'Dra. Ana Costa',timeZone:'America/Sao_Paulo',version:4,isActive:true,isPublished:true}});
  await f.db.professionalService.create({data:{merchantId:own.merchantId,professionalId,productId:offer.productId}});
  await f.db.professionalAvailability.createMany({data:Array.from({length:7},(_,weekday)=>({merchantId:own.merchantId,professionalId,weekday,startMinute:600,endMinute:720,timeZone:'America/Sao_Paulo'}))});
  const before=await f.snapshot();let buyer,proposal,publicReadToken,publicChoice;
  await t.test('actual guest turn and anonymous embed GETs expose published professionals dates and slots without buyer identity',async()=>{
   const result=await f.say(own,'Gostaria de agendar uma consulta. Quais profissionais atendem?');
   const guest=block(result,'professionals');assert.deepEqual(guest.professionals.map(p=>({id:p.id,name:p.name,version:p.version})),[{id:professionalId,name:'Dra. Ana Costa',version:4}]);assert.equal(guest.context.productId,offer.productId);assert.equal(guest.context.variantId,offer.variantId);
   const issued=await f.runtime.buyerBooking.issue({merchantId:own.merchantId,body:{cart_ref:own.cartRef,conversation_token:own.conversationToken,allowed_origin:f.origin,ttl_seconds:900,scopes:['checkout:start','checkout:track']}});assert.equal(issued.status,201);publicReadToken=issued.body.embed_session_token;
   const headers={origin:f.origin,authorization:'Bearer '+publicReadToken};
   const roster=await f.request('/embed/service-booking/professionals?'+new URLSearchParams(offer),undefined,headers,'GET');assert.equal(roster.status,200);assert.deepEqual(roster.body.professionals,guest.professionals);
   const dates=await f.request('/embed/service-booking/dates?'+new URLSearchParams({...offer,professionalId,fromDate:date,toDate:date}),undefined,headers,'GET');assert.equal(dates.status,200);assert.deepEqual(dates.body.dates,[date]);assert.equal(dates.body.time_zone,'America/Sao_Paulo');assert.equal(dates.body.professional_version,4);assert.equal(dates.body.policy_version,1);
   const slots=await f.request('/embed/service-booking/slots?'+new URLSearchParams({...offer,professionalId,date}),undefined,headers,'GET');assert.equal(slots.status,200);assert.equal(slots.body.selections.length,6);publicChoice=slots.body.selections[0];assert.equal(publicChoice.startsAt,date+'T13:00:00.000Z');assert.equal(publicChoice.priceInCents,5000);assert.equal(publicChoice.durationMinutes,20);assert.equal(publicChoice.timeZone,'America/Sao_Paulo');
   for(const response of[result,roster,dates,slots])publicOnly(response,[own.embedToken,own.conversationToken,publicReadToken]);
   assert.deepEqual(await f.snapshot(),before);
  });
  buyer=await f.buyer();
  await t.test('readonly embed plus verified buyer is forbidden from private select and prepare without an issuer upgrade',async()=>{
   const headers={origin:f.origin,authorization:'Bearer '+publicReadToken,'x-buyer-access-token':buyer.token};
   for(const [path,body]of[['select',{selection:publicChoice}],['prepare',{selection:publicChoice,parent_cart_fingerprint:'a'.repeat(64)}]]){
    const denied=await f.request('/embed/service-booking/'+path,body,headers);assert.equal(denied.status,403);assert.ok(JSON.stringify(denied.body).includes('service_booking_write_scope_required'));assert.deepEqual(await f.snapshot(),before);
   }
  });
  await t.test('forged conversation, origin, body merchant/cart and merchant-role buyer proof cannot reach booking writes',async()=>{
   const count=f.runtime.storefrontQueryModel.counts();
   for(const [body,custom,status]of[[{}, {authorization:'Bearer forged'},401],[{merchant_id:foreign.merchantId},{},403],[{cart_id:foreign.cartRef},{},403],[{}, {origin:'https://foreign.example.test'},401],[{}, {authorization:'Bearer '+own.auth.access_token},401]]){const denied=await f.say(own,'Quero agendar',buyer,body,custom);assert.equal(denied.status,status);}
   const wrongRole=await f.request('/embed/service-booking/professionals?'+new URLSearchParams(offer),undefined,{...f.bookingHeaders(own,buyer),'x-buyer-access-token':own.auth.access_token},'GET');assert.equal(wrongRole.status,401);
   assert.deepEqual(f.runtime.storefrontQueryModel.counts(),count);assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('natural authenticated roster, dates and slots contain current SQL facts and genuine optional context',async()=>{
   const professionals=block(await f.say(own,'Quais profissionais posso escolher para essa consulta?',buyer),'professionals');assert.deepEqual(professionals.professionals.map(p=>({id:p.id,name:p.name,version:p.version})),[{id:professionalId,name:'Dra. Ana Costa',version:4}]);assert.equal(professionals.context.productId,offer.productId);assert.equal(professionals.context.variantId,offer.variantId);assert.equal(professionals.context.serviceName,'Consulta canônica');
   const dates=block(await f.say(own,'Quais datas a Dra. Ana Costa tem para essa consulta?',buyer),'dates');assert.deepEqual(dates.dates,[date]);assert.equal(dates.context.professional.id,professionalId);assert.equal(dates.professional_version,4);assert.equal(dates.policy_version,1);
   await f.db.productPrice.update({where:{variantId:offer.variantId},data:{basePriceInCents:7000}});
   const slots=block(await f.say(own,'Mostre os horários dessa consulta no dia '+date,buyer),'slots');assert.ok(slots.selections.length);assert.ok(slots.selections.every(s=>s.priceInCents===7000&&s.currency==='BRL'&&s.professionalId===professionalId&&s.professionalVersion===4&&s.policyVersion===1&&s.timeZone==='America/Sao_Paulo'));assert.equal(slots.selections[0].startsAt,date+'T13:00:00.000Z');assert.equal(slots.context.serviceName,'Consulta canônica');assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('model paid/confirmed narration and browser flags cannot prepare or confirm the canonical proposal',async()=>{
   const result=await f.say(own,'Quero consultar com a Dra. Ana Costa no dia '+date+', às 10h.',buyer,{paid:true,confirmed:true,serviceAction:'select',global_user_id:'forged-buyer',scopes:['appointments:confirm']});proposal=block(result,'selection');
   assert.equal(proposal.requiresRevalidation,true);assert.equal(proposal.authorizesConfirmation,false);assert.equal(proposal.authorizesPayment,false);assert.equal(proposal.action,'review_service_booking');assert.equal(proposal.selection.priceInCents,7000);assert.equal(proposal.selection.professionalId,professionalId);assert.equal(proposal.serviceName,'Consulta canônica');assert.equal(proposal.professionalName,'Dra. Ana Costa');assert.match(result.body.message,/ainda não foi confirmado/);publicOnly(result,[own.embedToken,own.conversationToken,buyer.token]);assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('genuine foreign and tampered embed capabilities yield authentication UI through the real tool bridge',async()=>{
   block(await f.say(own,'Pode consultar esses horários para mim?',buyer,{}, {'x-aacp-embed-token':foreign.embedToken}),'authentication_required');
   block(await f.say(own,'Quais profissionais posso escolher?',buyer,{}, {'x-aacp-embed-token':own.embedToken+'tampered'}),'authentication_required');assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('expiry during a held real model call is checked again before the canonical service read',async()=>{
   const shortened=await f.runtime.buyerBooking.shorten({token:own.embedToken,seconds:5,merchantId:own.merchantId,cartRef:own.cartRef,origin:f.origin});
   const pending=f.say(own,'Confira de novo os horários para essa consulta.',buyer,{}, {'x-aacp-embed-token':shortened.token});let held,assertionError;
   const end=Date.now()+5000;do{held=f.runtime.storefrontQueryModel.events().find(e=>e.result?.scriptStep===16&&e.result?.held===true);if(!held)await pause(10);}while(!held&&Date.now()<end);
   try{assert.ok(held);assert.ok(Math.floor(Date.now()/1000)<shortened.expiresAtUnix,'original capability must still be live when the real model awaits');const wait=(shortened.expiresAtUnix+1)*1000+25-Date.now();if(wait>0)await pause(wait);}catch(error){assertionError=error;}finally{if(held)f.runtime.modelScript.release(16);}
   const result=await pending;if(assertionError)throw assertionError;block(result,'authentication_required');assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('only separate authenticated select/prepare/confirm gestures persist one unpaid local appointment',async()=>{
   const selected=await f.request('/embed/service-booking/select',{selection:proposal.selection},f.bookingHeaders(own,buyer));assert.equal(selected.status,201);assert.match(selected.body.parent_cart_fingerprint,/^[a-f0-9]{64}$/);assert.deepEqual(await f.snapshot(),before);
   const prompts=JSON.stringify(f.runtime.storefrontQueryModel.events().filter(e=>e.kind==='providerFetch').map(e=>e.input.messages));for(const secret of[selected.body.parent_cart_fingerprint,own.embedToken,own.conversationToken,buyer.token])assert.equal(prompts.includes(secret),false);
   const prepared=await f.request('/embed/service-booking/prepare',{selection:selected.body.selection,parent_cart_fingerprint:selected.body.parent_cart_fingerprint},f.bookingHeaders(own,buyer));assert.equal(prepared.status,201);assert.equal(prepared.body.confirmed,false);assert.equal(prepared.body.payment_mode,'at_attendance');assert.equal(await f.db.serviceAppointment.count(),0);
   const command={session_id:prepared.body.session_id,command_id:randomUUID(),cart_fingerprint:prepared.body.cart_fingerprint};const result=await f.request('/embed/service-appointments/confirm',command,f.bookingHeaders(own,buyer));assert.equal(result.status,201);assert.equal(result.body.appointments.length,1);const appointment=result.body.appointments[0];assert.equal(appointment.operationalStatus,'scheduled');assert.equal(appointment.priceInCents,7000);assert.equal(appointment.payments[0].status,'pending');assert.equal(appointment.payments[0].receivedAt,null);assert.equal(await f.db.paymentIntent.count(),0);assert.equal(await f.db.inventoryMovement.count(),0);
   const committed=await f.snapshot(),retry=await f.request('/embed/service-appointments/confirm',command,f.bookingHeaders(own,buyer));assert.equal(retry.status,201);assert.equal(retry.body.replayed,true);assert.equal(retry.body.appointments[0].id,appointment.id);assert.deepEqual(await f.snapshot(),committed);
  });
  const events=f.runtime.storefrontQueryModel.events(),sales=events.filter(e=>e.kind==='providerFetch'&&e.input.phase==='storefront.sales');assert.equal(sales.length,8);assert.deepEqual(sales.map(e=>e.result.serviceToolCall.name),['get_service_professionals','get_service_professionals','get_service_dates','get_service_slots','resolve_service_selection','get_service_slots','get_service_professionals','get_service_slots']);
  for(const event of sales){for(const name of serviceNames)assert.ok(event.input.toolNames.includes(name));for(const forbidden of['add_item_to_cart','create_checkout_session','prepare_service_booking','confirm_service_booking','create_payment'])assert.equal(event.input.toolNames.includes(forbidden),false);}
  const decisions=await f.db.aiGovernanceDecision.findMany({where:{merchantId:own.merchantId,source:'storefront_agent'}});assert.equal(decisions.length,16);assert.ok(decisions.every(d=>d.allowed&&d.actorRole==='buyer'));assert.equal(await f.db.aiGovernanceDecision.count({where:{merchantId:foreign.merchantId,source:'storefront_agent'}}),0);
  assert.equal(f.runtime.storefrontQueryModel.counts().queryEmbeddings,0,'operational availability is not sourced from vectors');assert.equal(f.runtime.evidence().providerCalls,0);assert.deepEqual(await f.redis.keys('service-slots:{'+createHash('sha256').update(own.merchantId).digest('hex')+'}:*'),[]);
 }finally{await f.close();}
});

test('T47 product conversation and invalid scheduling arguments preserve commerce and authority',{timeout:SERVICE_LOCAL_TEST_MS},async()=>{
 const reply='Posso ajudar você a conhecer os produtos da loja.';
 const modelScript=[{phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:1,requiresTool:false,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:null,serviceAction:null}},{phase:'storefront.sales',response:{schemaVersion:1,message:reply}},{phase:'storefront.reply-review',response:{schemaVersion:1,verdict:'ALLOW',confidence:1}},...turn('get_service_professionals',{...offer,merchantId:'forged-merchant',cartRef:'forged-cart',paid:true})];
 const f=await fixture(modelScript);try{
  const own=await f.company('products','products'),buyer=await f.buyer();await f.db.product.create({data:{id:'dispatch-physical',merchantId:own.merchantId,name:'Produto preservado',type:'physical',variants:{create:{id:'dispatch-physical-variant',sku:'PHYSICAL-DISPATCH',price:{create:{basePriceInCents:1000,currency:'BRL'}},stock:{create:{quantity:12,reserved:2}}}}}});
  await f.db.storefrontCart.update({where:{merchantId_sessionId:{merchantId:own.merchantId,sessionId:own.cartRef}},data:{items:[{productId:'dispatch-physical',variantId:'dispatch-physical-variant',sku:'PHYSICAL-DISPATCH',name:'Produto preservado',quantity:1,unitPriceCents:1000}],total:1000}});
  // Establish the real authenticated recovery projection before testing commerce preservation.
  const beforeBinding=await f.snapshot(),beforeBindingStock=await f.db.productStock.findMany();
  assert.deepEqual(beforeBinding,{appointments:[],balances:[],reservations:[],payments:0,orders:0,stock:0,checkouts:[]});
  assert.equal(await f.db.attendanceReceipt.count(),0);assert.equal(await f.db.inventorySaleReceipt.count(),0);
  const bound=await f.request('/storefront/conversations/'+own.cartRef+'/events',{event:'auth_identity_confirmed'},f.headers(own,buyer));
  assert.equal(bound.status,201);assert.deepEqual(bound.body,{tracked:true,event:'auth_identity_confirmed',conversation_id:own.cartRef});
  const afterBinding=await f.snapshot();for(const key of['appointments','balances','reservations','payments','orders','stock'])assert.deepEqual(afterBinding[key],beforeBinding[key]);
  assert.equal(afterBinding.checkouts.length,1);assert.equal(afterBinding.checkouts[0].merchantId,own.merchantId);assert.equal(afterBinding.checkouts[0].sessionId,own.cartRef);assert.equal(afterBinding.checkouts[0].globalUserId,buyer.account.globalUserId);
  const boundCart=await f.db.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:own.merchantId,sessionId:own.cartRef}}});assert.deepEqual(afterBinding.checkouts[0].cart,{items:boundCart.items,total:boundCart.total,discount:boundCart.discount,couponCode:boundCart.couponCode,freeShipping:boundCart.freeShipping});
  assert.deepEqual(await f.db.productStock.findMany(),beforeBindingStock);assert.equal(await f.db.attendanceReceipt.count(),0);assert.equal(await f.db.inventorySaleReceipt.count(),0);
  const stock=await f.db.productStock.findMany(),cart=await f.db.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:own.merchantId,sessionId:own.cartRef}}}),domain=await f.snapshot();
  const result=await f.say(own,'Gostaria de conversar sobre o catálogo e entender como escolher.',buyer);assert.equal(result.status,201);assert.equal(result.body.message,reply);assert.equal(result.body.blocks.some(b=>b.type==='service_booking'),false);
  await scriptObserved(f.runtime,3);const sales=f.runtime.storefrontQueryModel.events().filter(e=>e.kind==='providerFetch'&&e.input.phase==='storefront.sales');assert.equal(sales.length,1);for(const name of serviceNames)assert.equal(sales[0].input.toolNames.includes(name),false);for(const name of['search_products','get_product_details','list_categories'])assert.ok(sales[0].input.toolNames.includes(name));
  const blocked=await f.request('/embed/service-booking/professionals?'+new URLSearchParams({productId:'dispatch-physical',variantId:'dispatch-physical-variant'}),undefined,f.bookingHeaders(own,buyer),'GET');assert.equal(blocked.status,409);assert.deepEqual(await f.db.productStock.findMany(),stock);const after=await f.db.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:own.merchantId,sessionId:own.cartRef}}});for(const key of['merchantId','sessionId','items','total','discount','couponCode','freeShipping'])assert.deepEqual(after[key],cart[key]);assert.deepEqual(await f.snapshot(),domain);assert.equal(f.runtime.evidence().providerCalls,0);
  const services=await f.company('invalid-tool-services');
  await f.db.product.create({data:{id:offer.productId,merchantId:services.merchantId,name:'Serviço válido antes da negativa',type:'service',metadata:{serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:20,slots:[]}},variants:{create:{id:offer.variantId,sku:'INVALID-ARG-CONTROL',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}}});
  await f.db.serviceProfessional.create({data:{id:professionalId,merchantId:services.merchantId,publicName:'Profissional canônico da negativa',timeZone:'America/Sao_Paulo',isPublished:true}});await f.db.professionalService.create({data:{merchantId:services.merchantId,professionalId,productId:offer.productId}});
  const validRead=await f.request('/embed/service-booking/professionals?'+new URLSearchParams(offer),undefined,f.bookingHeaders(services,buyer),'GET');assert.equal(validRead.status,200);assert.equal(validRead.body.professionals.length,1);const beforeInvalid=await f.snapshot();
  const invalid=await f.say(services,'Gostaria de conhecer os profissionais para agendar um atendimento.',buyer);assert.equal(invalid.status,201);assert.equal(invalid.body.blocks.some(b=>b.type==='service_booking'),false);assert.match(invalid.body.message,/não consegui confirmar/);assert.deepEqual(await f.snapshot(),beforeInvalid);
  await scriptObserved(f.runtime,5);const last=f.runtime.storefrontQueryModel.events().filter(e=>e.kind==='providerFetch'&&e.input.phase==='storefront.sales').at(-1);assert.equal(last.result.serviceToolCall.name,'get_service_professionals');assert.equal(last.result.serviceToolCall.args.merchantId,'forged-merchant');assert.ok(last.input.toolNames.includes('get_service_professionals'));assert.equal(f.runtime.evidence().providerCalls,0);
 }finally{await f.close();}
});
