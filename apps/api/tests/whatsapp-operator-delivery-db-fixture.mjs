import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';

/** Owned PG only. Canonical queue/claim/repository/consumer classes, no HTTP
 * authorization claim. Authenticated inbox records are explicit fixture data;
 * the AppModule companion separately exercises real authenticated HTTP. */
export async function createOperatorDeliveryDbFixture(){
  const f=await createAgendaDbFixture();
  try{
    const [{TenantContextService},{registerTenantMiddleware},{PrismaWhatsAppHandoffRepository},
      {SendTicketMessageUseCase},{ClaimWhatsAppConversationUseCase},{WhatsAppSupportOutboxConsumer},
      {PrismaOutboxRepository},{InMemoryDomainEventBus},submission]=await Promise.all([
      import('../dist/shared/tenant/tenant-context.service.js'),
      import('../dist/shared/persistence/tenant.middleware.js'),
      import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js'),
      import('../dist/modules/support/application/send-ticket-message.use-case.js'),
      import('../dist/modules/support/application/claim-whatsapp-conversation.use-case.js'),
      import('../dist/modules/whatsapp-channel/application/services/whatsapp-support-outbox.consumer.js'),
      import('../dist/shared/messaging/infrastructure/prisma-outbox.repository.js'),
      import('../dist/shared/events/in-memory-domain-event-bus.js'),
      import('../dist/shared/whatsapp/whatsapp-automation-context.js'),
    ]);
    const contexts=new TenantContextService(),scoped=registerTenantMiddleware(f.raw,contexts),bindings=new PrismaWhatsAppHandoffRepository(scoped);
    const events=new InMemoryDomainEventBus(),queue=new SendTicketMessageUseCase(scoped,bindings),claim=new ClaimWhatsAppConversationUseCase(scoped,bindings);
    const outbox=new PrismaOutboxRepository(f.raw),as=(actor,work)=>contexts.run(actor,work);
    let sequence=1000;
    async function make(options={}){
      const template=options.actor??f.owner,provider=options.provider??'META_CLOUD',suffix=randomUUID(),configId='operator-'+suffix,deviceId=provider+':'+configId;
      const actor={merchantId:'operator-tenant-'+suffix,userId:'operator-user-'+suffix,role:template.role};
      const originalMerchant=await f.raw.merchant.findUniqueOrThrow({where:{id:template.merchantId}});
      await f.raw.merchant.create({data:{id:actor.merchantId,name:'Synthetic operator company',businessMode:originalMerchant.businessMode,businessModeSelectedAt:new Date()}});
      await f.raw.merchantUser.create({data:{id:actor.userId,merchantId:actor.merchantId,email:actor.userId+'@operator.example.test',role:actor.role}});
      const credentials=provider==='META_CLOUD'?{phoneNumberId:'100001',wabaId:'100002',accessToken:'synthetic-secret-'+suffix}
        :provider==='TWILIO'?{accountSid:'AC'+suffix.replaceAll('-',''),authToken:'synthetic-secret-'+suffix,senderId:'whatsapp:+5511999880001'}:{};
      const config=await f.raw.whatsAppChannelConfig.create({data:{id:configId,merchantId:actor.merchantId,deviceId,provider,
        enabled:true,status:'ACTIVE',whatsappNumber:'+5511999880001',credentials}});
      const checkoutId='operator-checkout-'+suffix;
      await f.raw.checkoutSession.create({data:{merchantId:actor.merchantId,sessionId:checkoutId,globalUserId:'synthetic-buyer-'+suffix,cart:{items:[],currency:'BRL',total:0},
        conversationId:'original-checkout-'+suffix,chatHistory:[{role:'user',content:'Preserved context'}],createdAt:new Date(),updatedAt:new Date()}});
      const session=await f.raw.whatsAppSession.create({data:{merchantId:actor.merchantId,deviceId,buyerPhone:'551199999'+String(sequence++),
        checkoutSessionId:checkoutId,status:options.postSale?'completed':'active',conversationState:{version:1,conversationId:'original-'+suffix,revision:'original-revision'},
        ...(options.postSale?{postSaleContext:{stage:'awaiting_nps',orderId:'synthetic-existing-order'}}:{})}});
      const scope={merchantId:actor.merchantId,configId,whatsappSessionId:session.id};
      const ticket=await f.raw.supportTicket.create({data:{id:'operator-ticket-'+suffix,merchantId:actor.merchantId,sessionId:session.id,
        source:'whatsapp',status:'open',buyerMessage:'Synthetic request',createdAt:new Date()}});
      const principal={kind:'human',tenantId:actor.merchantId,userId:actor.userId,email:actor.userId+'@operator.example.test',role:actor.role};
      await as(actor,()=>bindings.begin(scope,ticket.id,0));
      await as(actor,()=>claim.execute(principal,ticket.id,{expectedEpoch:1}));
      const content='*Synthetic operator* '+suffix,clientMessageId=randomUUID();
      const message=await as(actor,()=>queue.execute({merchantId:actor.merchantId,ticketId:ticket.id,senderType:'merchant',content,clientMessageId},{principal}));
      const timestamp=Date.now()-(options.expired?25*60*60*1000:0);
      const streamKey=createHash('sha256').update(JSON.stringify([actor.merchantId,configId,'message',session.buyerPhone])).digest('hex');
      const inbox=await f.raw.whatsAppWebhookInbox.create({data:{id:randomUUID(),dedupKey:'operator-inbox-'+suffix,eventId:'operator-inbox-'+suffix,
        merchantId:actor.merchantId,configId,deviceId,kind:'message',streamKey,status:'complete',payloadHash:suffix,
        payload:{merchantId:actor.merchantId,deviceId,provider,fromNumber:session.buyerPhone,body:'Synthetic authenticated incoming',messageType:'text',timestamp}}});
      const claims=await outbox.claimBatch(50),deliveryId='support_message:'+message.id;
      const original=claims.find(candidate=>candidate.envelope.correlation_id===deliveryId);assert.ok(original,'canonical_operator_outbox_claim_required');
      const envelope=original.envelope,event={eventId:envelope.event_id,eventType:envelope.event_type,merchantId:envelope.merchant_id,
        correlationId:envelope.correlation_id,causationId:envelope.causation_id,schemaVersion:envelope.schema_version,payload:envelope.payload};
      Object.defineProperty(event,'deliveryLeaseToken',{value:original.leaseToken,enumerable:false,writable:false,configurable:false});
      return {actor,config,scope,session,ticket,principal,message,inbox,event,claim:original,deliveryId,content,clientMessageId};
    }
    const consumer=(sender,repo=bindings)=>new WhatsAppSupportOutboxConsumer(scoped,repo,sender,events,contexts);
    const submissionSender=(submit)=>({sendText:async input=>{
      const scope=submission.currentWhatsAppSubmissionScope();assert.ok(scope&&Object.isFrozen(scope));
      assert.equal(input.deviceId,scope.deviceId);assert.equal(input.provider,scope.provider);assert.equal(input.toNumber,scope.recipient);assert.equal(input.correlationId,scope.messageId);
      return submission.startWhatsAppRequest(scope,()=>submit(input,scope));
    },sendMedia:async()=>{throw new Error('operator_text_only');}});
    const read=async value=>({message:await f.raw.supportTicketMessage.findUniqueOrThrow({where:{id:value.message.id}}),
      delivery:await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.deliveryId}})});
    const preserved=async value=>({session:await f.raw.whatsAppSession.findUniqueOrThrow({where:{id:value.session.id}}),
      checkout:await f.raw.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}}}),
      binding:await f.raw.whatsAppHandoffBinding.findUniqueOrThrow({where:{whatsappSessionId_merchantId:{merchantId:value.actor.merchantId,whatsappSessionId:value.session.id}}}),
      ticket:await f.raw.supportTicket.findUniqueOrThrow({where:{id:value.ticket.id}})});
    return {...f,contexts,scoped,bindings,events,queue,as,make,consumer,submissionSender,submission,read,preserved};
  }catch(error){await f.close();throw error;}
}
