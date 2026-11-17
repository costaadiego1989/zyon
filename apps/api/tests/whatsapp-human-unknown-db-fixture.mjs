import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';

/** Independent regression fixture on committed T49-T55 classes, without adopting
 * pending T57/Root71. DB-only authorization boundary, actual receipt owners,
 * actual Meta adapter. A negative generation sentinel supplies no authority. */
export async function createHumanUnknownDbFixture(){
  const f=await createAgendaDbFixture();
  try{
    const [{PrismaWhatsAppHandoffRepository},{SupportHandoffService},{SupportTicketEventPublisher},
      {PrismaSupportTicketRepository},{WhatsAppTurnContext},{WhatsAppAiDispatchFence},{PrismaWhatsAppConfigRepository},{MetaCloudSenderAdapter},
      {WhatsAppDeliveryService},{SendWhatsAppResponseUseCase},{HandleMetaConversationUseCase},{HandleIncomingMessageUseCase},
      {PrismaWhatsAppSessionRepository},{PrismaWhatsAppWebhookInbox,loadWhatsAppInboxTurnWithin},{RouteToSessionUseCase},
      {WhatsAppHumanIntakeService},{WhatsAppHumanMessageRouter},execution]=await Promise.all([
      import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js'),
      import('../dist/modules/support/application/support-handoff.service.js'),import('../dist/modules/support/application/support-ticket-event.publisher.js'),
      import('../dist/modules/support/infrastructure/prisma-support-ticket.repository.js'),
      import('../dist/modules/whatsapp-channel/domain/services/whatsapp-turn-context.js'),import('../dist/modules/whatsapp-channel/application/services/whatsapp-ai-dispatch-fence.js'),
      import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-config.repository.js'),import('../dist/modules/whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.js'),
      import('../dist/modules/whatsapp-channel/application/services/whatsapp-delivery.service.js'),import('../dist/modules/whatsapp-channel/application/use-cases/send-whatsapp-response.use-case.js'),
      import('../dist/modules/whatsapp-channel/application/use-cases/handle-meta-conversation.use-case.js'),import('../dist/modules/whatsapp-channel/application/use-cases/handle-incoming-message.use-case.js'),
      import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-session.repository.js'),import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js'),
      import('../dist/modules/whatsapp-channel/application/use-cases/route-to-session.use-case.js'),import('../dist/modules/whatsapp-channel/application/services/whatsapp-human-intake.service.js'),
      import('../dist/modules/whatsapp-channel/application/services/whatsapp-human-message-router.js'),import('../dist/shared/whatsapp/whatsapp-automation-context.js'),
    ]);
    const bindings=new PrismaWhatsAppHandoffRepository(f.scoped),turns=new WhatsAppTurnContext();
    const fence=new WhatsAppAiDispatchFence(f.scoped,bindings,turns),configs=new PrismaWhatsAppConfigRepository(f.scoped);
    const handoff=new SupportHandoffService(new PrismaSupportTicketRepository(f.scoped),new SupportTicketEventPublisher(),f.scoped,bindings,turns);
    async function seed(value){
      const id=randomUUID(),leaseToken=randomUUID(),body='Solicitação humana sintética atual';
      const payload={merchantId:value.actor.merchantId,deviceId:value.config.deviceId,provider:'META_CLOUD',fromNumber:value.session.buyerPhone,body,messageType:'text',timestamp:Date.now()};
      const streamKey=createHash('sha256').update(JSON.stringify([value.actor.merchantId,value.config.id,'message',value.session.buyerPhone])).digest('hex');
      const row=await f.raw.whatsAppWebhookInbox.create({data:{id,dedupKey:id,eventId:id,merchantId:value.actor.merchantId,configId:value.config.id,deviceId:value.config.deviceId,
        kind:'message',streamKey,payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),status:'processing',leaseToken,leaseExpiresAt:new Date(Date.now()+120_000),attempts:1}});
      const claim={...row,payload,responseState:undefined},current=await f.raw.whatsAppSession.findUniqueOrThrow({where:{id:value.session.id}});
      const turn={scope:value.scope,inboxId:id,leaseToken,conversationId:current.conversationState.conversationId,message:body,origin:'text'};
      return{...value,claim,turn,run:work=>f.as(value.actor,()=>turns.run(turn,()=>fence.run(claim,work)))};
    }
    const intake=async value=>{
      const result=await handoff.createWhatsAppHandoff(value.turn);
      return{confirmed:true,reply:result.reply,ticketId:result.ticketId,bindingId:result.binding.id,epoch:result.binding.epoch};
    };
    let sequence=1000;
    async function subject(){
      const suffix=randomUUID(),actor={merchantId:'t109-'+suffix,userId:'t109-owner-'+suffix,role:'owner'};
      await f.raw.merchant.create({data:{id:actor.merchantId,name:'Synthetic T109 company',businessMode:'products',businessModeSelectedAt:new Date()}});
      await f.raw.merchantUser.create({data:{id:actor.userId,merchantId:actor.merchantId,email:actor.userId+'@synthetic.example.test',role:'owner'}});
      const configId='t109-config-'+suffix,deviceId='META_CLOUD:'+configId;
      const config=await f.raw.whatsAppChannelConfig.create({data:{id:configId,merchantId:actor.merchantId,deviceId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',
        credentials:{phoneNumberId:'100001',wabaId:'100002',accessToken:'synthetic-local-t109'}}});
      const sessions=new PrismaWhatsAppSessionRepository(f.scoped),route=new RouteToSessionUseCase(sessions,f.scoped),phone='551199999'+String(++sequence);
      const routed=await f.as(actor,()=>route.execute({merchantId:actor.merchantId,deviceId,fromNumber:phone}));
      assert.equal(routed.isNew,true);assert.ok(routed.whatsappSession.conversationState);
      const checkoutId='t109-checkout-'+suffix,state={...routed.whatsappSession.conversationState,stage:'checkout',revision:'t109-original-'+suffix};
      // Declared checkout fixture, before authority capture; real buyer from the
      // actual route and actual session repository. No binding mode/epoch write.
      await f.raw.checkoutSession.create({data:{merchantId:actor.merchantId,sessionId:checkoutId,globalUserId:routed.buyerData.globalUserId,conversationId:state.conversationId,
        cart:{items:[{productId:'synthetic-product',variantId:'synthetic-variant',quantity:2,unitPrice:300}],total:600,currency:'BRL'},chatHistory:[{role:'user',content:'Preserved checkout'}],createdAt:new Date(),updatedAt:new Date()}});
      await f.as(actor,()=>sessions.update(routed.whatsappSession.id,{checkoutSessionId:checkoutId,conversationState:state}));
      const session=await f.raw.whatsAppSession.findUniqueOrThrow({where:{id:routed.whatsappSession.id}}),scope={merchantId:actor.merchantId,configId,whatsappSessionId:session.id};
      assert.equal(await f.as(actor,()=>bindings.get(scope)),null,'implicitAI0 must not be a fabricated human-to-AI transition');
      return seed({actor,config,scope,session});
    }
    async function unknownAttempt(kind,st){
      assert.ok(['meta','legacy'].includes(kind));const value=await subject();let attempts=0,models=0,notice;
      st.mock.method(globalThis,'fetch',async(input,init)=>{assert.equal(new URL(String(input)).hostname,'graph.facebook.com');assert.equal(init.method,'POST');attempts++;
        return Response.json({error:{message:'Synthetic unknown result'}},{status:500});});
      const sender=new MetaCloudSenderAdapter(configs),delivery=new WhatsAppDeliveryService(f.scoped,sender,fence),send=new SendWhatsAppResponseUseCase(sender,delivery);
      const sessions=new PrismaWhatsAppSessionRepository(f.scoped),inbox=new PrismaWhatsAppWebhookInbox(f.scoped),route=new RouteToSessionUseCase(sessions,f.scoped);
      const conversation={respondStore:async()=>{models++;assert.fail('unknown receipt cannot regenerate');}};
      const meta=new HandleMetaConversationUseCase(conversation,sessions,inbox,send,undefined,undefined,undefined,undefined,fence);
      const human=new WhatsAppHumanIntakeService(handoff,turns,delivery),router=new WhatsAppHumanMessageRouter(bindings,turns,delivery,inbox);
      const incoming=new HandleIncomingMessageUseCase(route,send,sessions,conversation,undefined,meta,human,router,fence),input=claim=>({...claim.payload,inboxClaim:claim});
      const owned=claim=>f.scoped.$transaction(async tx=>Boolean(await loadWhatsAppInboxTurnWithin(tx,claim)));
      const disposition=async work=>{try{await work();return{ok:true};}catch(error){return{ok:false,code:/^whatsapp_[a-z0-9_]{1,90}$/.test(error.message)?error.message:'other'};}};
      const first=await f.as(value.actor,()=>disposition(()=>kind==='meta'?value.run(async()=>{
        const routed=await route.execute({merchantId:value.actor.merchantId,deviceId:value.config.deviceId,fromNumber:value.session.buyerPhone});
        notice=await intake(value);await meta.sendHandoffNotice(input(value.claim),routed,notice);
      }):delivery.process(value.claim,()=>value.run(async()=>{
        const original=execution.currentWhatsAppExecution().authority;notice=await intake(value);
        await fence.notice(value.claim,original,notice,()=>send.execute({merchantId:value.actor.merchantId,provider:'META_CLOUD',deviceId:value.config.deviceId,toNumber:value.session.buyerPhone,text:notice.reply}));
      }),()=>owned(value.claim))));
      const stored=async()=>kind==='meta'?(await f.raw.whatsAppWebhookInbox.findUniqueOrThrow({where:{id:value.claim.id}})).responseState:f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.claim.id}});
      const replay=()=>f.as(value.actor,()=>disposition(async()=>{const row=await f.raw.whatsAppWebhookInbox.findUniqueOrThrow({where:{id:value.claim.id}}),claim={...row,payload:value.claim.payload};
        if(kind==='meta')await incoming.execute(input(claim));else await delivery.process(claim,async()=>assert.fail('unknown delivery cannot regenerate'),()=>owned(claim));}));
      const snapshot=async()=>({ticket:await f.raw.supportTicket.findUniqueOrThrow({where:{id:notice.ticketId}}),checkout:await f.raw.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}}}),
        messages:await f.raw.supportTicketMessage.findMany({where:{ticketId:notice.ticketId},orderBy:{id:'asc'}}),binding:await f.raw.whatsAppHandoffBinding.findUniqueOrThrow({where:{id:notice.bindingId}})});
      return{value,notice,first,stored,replay,snapshot,physicalAttempts:()=>attempts,modelCalls:()=>models};
    }
    return{...f,unknownAttempt};
  }catch(error){await f.close();throw error;}
}
