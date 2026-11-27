import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';

export async function createHandoffFixture(options={}){
  assert.ok(Object.keys(options).every(key=>['whatsapp','provider','recoveryTemplateMonitorFixture'].includes(key)));
  const provider=options.provider??'TWILIO';assert.ok(['TWILIO','META_CLOUD'].includes(provider));
  const runtime=await createServiceTestRuntime({local:true,...(options.whatsapp?{whatsapp:options.whatsapp}:{}),
    ...(options.recoveryTemplateMonitorFixture===undefined?{}:{recoveryTemplateMonitorFixture:options.recoveryTemplateMonitorFixture})});
  let raw;
  try{
    raw=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaWhatsAppHandoffRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js');
    const {PrismaWhatsAppSessionRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-session.repository.js');
    const {RouteToSessionUseCase}=await import('../dist/modules/whatsapp-channel/application/use-cases/route-to-session.use-case.js');
    const contexts=new TenantContextService(),scoped=registerTenantMiddleware(raw,contexts);
    const owner={merchantId:'handoff-services',userId:'synthetic-owner',role:'owner'},products={merchantId:'handoff-products',userId:'synthetic-products',role:'owner'};
    const metaIds=new Map([[owner.merchantId,'90001001'],[products.merchantId,'90001002']]);
    for(const actor of [owner,products]){
      await raw.merchant.create({data:{id:actor.merchantId,name:'Synthetic '+actor.merchantId,businessMode:actor===owner?'services':'products',businessModeSelectedAt:new Date()}});
      // Synthetic routing identifiers only; no live Meta credential. The
      // explicit fixture supplies local sender/media transports when requested.
      await raw.whatsAppChannelConfig.create({data:{id:actor.merchantId+'-config',merchantId:actor.merchantId,provider,enabled:true,status:'ACTIVE',credentials:provider==='META_CLOUD'?{phoneNumberId:metaIds.get(actor.merchantId)}:{}}});
    }
    const as=(actor,work)=>contexts.run(actor,work);
    const repo=new PrismaWhatsAppHandoffRepository(scoped),sessions=new PrismaWhatsAppSessionRepository(scoped),route=new RouteToSessionUseCase(sessions,scoped);
    let next=1000;
    const thread=async(actor,suffix)=>{
      const buyerPhone='551199999'+String(next++),checkoutSessionId=actor.merchantId+'-checkout-'+suffix;
      const buyerId='synthetic-buyer-'+actor.merchantId,configId=actor.merchantId+'-config',deviceId=provider+':'+configId;
      await raw.buyerIdentity.create({data:{merchantId:actor.merchantId,identityKey:'phone:'+buyerPhone,globalUserId:buyerId}});
      const cart={items:[{productId:'synthetic-existing-product',variantId:'synthetic-existing-variant',quantity:2,unitPrice:3}],total:6,currency:'BRL'};
      await raw.checkoutSession.create({data:{merchantId:actor.merchantId,sessionId:checkoutSessionId,globalUserId:buyerId,conversationId:'checkout-conversation-'+suffix,cart,customer:{fullName:'Synthetic Buyer',email:'synthetic@example.invalid'},chatHistory:[{role:'user',content:'Existing checkout context'}],createdAt:new Date(),updatedAt:new Date()}});
      const conversationState={version:1,conversationId:'store-conversation-'+suffix,stage:'checkout',history:[{role:'user',content:'Preserve private context'}],revision:'revision-'+suffix,page:0,previousViews:[]};
      const postSaleContext={stage:'awaiting_nps',orderId:'synthetic-existing-order',buyerId,askedAt:new Date().toISOString()};
      const session=await raw.whatsAppSession.create({data:{merchantId:actor.merchantId,buyerPhone,deviceId,checkoutSessionId,currentOptions:['Existing option'],previousOptions:['Previous option'],currentPage:2,conversationState,postSaleContext}});
      return {actor,session,scope:{merchantId:actor.merchantId,configId,whatsappSessionId:session.id},routeInput:{merchantId:actor.merchantId,deviceId,fromNumber:buyerPhone}};
    };
    const ticket=async(value,suffix,extra={})=>raw.supportTicket.create({data:{id:value.actor.merchantId+'-ticket-'+suffix,merchantId:value.actor.merchantId,sessionId:value.session.id,buyerMessage:'Synthetic request for a person',source:'whatsapp',status:'open',createdAt:new Date(),...extra}});
    const close=async()=>{
      const errors=[];
      try{await raw.$disconnect();}catch(error){errors.push(error);}
      try{await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}catch(error){errors.push(error);}
      if(errors.length)throw new AggregateError(errors,'handoff_fixture_cleanup_failed');
    };
    return {runtime,raw,scoped,contexts,owner,products,repo,sessions,route,as,thread,ticket,PrismaWhatsAppHandoffRepository,metaPhoneNumberId:actor=>metaIds.get(actor.merchantId),close};
  }catch(error){
    const errors=[error];
    try{if(raw)await raw.$disconnect();}catch(cleanup){errors.push(cleanup);}
    try{await runtime.close();}catch(cleanup){errors.push(cleanup);}
    throw errors.length===1?error:new AggregateError(errors,'handoff_fixture_setup_cleanup_failed');
  }
}
