import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

test('T51 original-turn transaction and request admission',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const {WhatsAppAiDispatchFence}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-ai-dispatch-fence.js');
    const {PrismaWhatsAppHandoffRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js');
    const {WhatsAppTurnContext}=await import('../dist/modules/whatsapp-channel/domain/services/whatsapp-turn-context.js');
    const {currentWhatsAppExecution,startWhatsAppRequest}=await import('../dist/shared/whatsapp/whatsapp-automation-context.js');
    const {withStorefrontCart}=await import('../dist/modules/storefront/infrastructure/repositories/storefront-cart-transaction.js');
    const {readNormalCheckoutSourceProjection}=await import('../dist/shared/persistence/storefront-normal-checkout-read.js');
    const {saveWhatsAppResponseWithin}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js');
    const bindings=new PrismaWhatsAppHandoffRepository(f.scoped),turns=new WhatsAppTurnContext();
    const fence=new WhatsAppAiDispatchFence(f.scoped,bindings,turns);
    const configId='fence-config',deviceId='META_CLOUD:'+configId;
    await f.raw.whatsAppChannelConfig.create({data:{id:configId,merchantId:f.owner.merchantId,deviceId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',credentials:{phoneNumberId:'100001'}}});
    let suffix=0;
    async function seed(stream,configured={configId,deviceId,provider:'META_CLOUD'}){
      const id=randomUUID(),leaseToken=randomUUID(),phone='551199999'+String(++suffix).padStart(4,'0');
      const state={version:1,conversationId:'conversation-'+id,stage:'store',history:[],revision:'',page:0,previousViews:[]};
      const session=await f.raw.whatsAppSession.create({data:{merchantId:f.owner.merchantId,deviceId:configured.deviceId,buyerPhone:phone,status:'active',conversationState:state}});
      const payload={merchantId:f.owner.merchantId,deviceId:configured.deviceId,fromNumber:phone,body:'Synthetic request',messageType:'text',timestamp:Date.now(),provider:configured.provider};
      const row=await f.raw.whatsAppWebhookInbox.create({data:{id,dedupKey:id,eventId:id,kind:'message',merchantId:f.owner.merchantId,configId:configured.configId,deviceId:configured.deviceId,
        streamKey:stream??phone,payload,payloadHash:id,status:'processing',leaseToken,leaseExpiresAt:new Date(Date.now()+120_000),attempts:1}});
      const claim={...row,payload,responseState:undefined};
      const scope={merchantId:f.owner.merchantId,configId:configured.configId,whatsappSessionId:session.id};
      const turn={scope,inboxId:id,leaseToken,conversationId:state.conversationId,message:payload.body,origin:'text'};
      const run=work=>f.as(f.owner,()=>turns.run(turn,()=>fence.run(claim,work)));
      const human=async()=>{
        const ticket=await f.raw.supportTicket.create({data:{id:randomUUID(),createdAt:new Date(),merchantId:f.owner.merchantId,sessionId:session.id,source:'whatsapp',status:'open',buyerMessage:'Synthetic request'}});
        return f.as(f.owner,()=>bindings.begin(scope,ticket.id,0));
      };
      return {claim,session,state,scope,run,human};
    }

    await t.test('implicit0 is durable and a takeover blocks the actual cart transaction without creating a default binding',async()=>{
      const x=await seed();
      await x.run(async()=>{
        const authority=currentWhatsAppExecution().authority;
        assert.equal(authority.bindingId,null);assert.equal(authority.epoch,0);
        assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:x.session.id}}),0);
        const persisted=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}});
        assert.deepEqual(persisted.responseState.aiAuthority,authority);
        const handoff=await x.human();assert.equal(handoff.state.epoch,1);
        await assert.rejects(withStorefrontCart(f.scoped,f.owner.merchantId,x.state.conversationId,async()=>{}),/whatsapp_ai_turn_suppressed/);
        await assert.rejects(f.scoped.$transaction(tx=>readNormalCheckoutSourceProjection(tx,{merchantId:f.owner.merchantId,cartId:x.state.conversationId})),/whatsapp_ai_turn_suppressed/);
        assert.equal(await f.raw.storefrontCart.count({where:{merchantId:f.owner.merchantId,sessionId:x.state.conversationId}}),0);
      });
    });

    await t.test('a request started before takeover may finish later, while its next request is refused',async()=>{
      const x=await seed(),started=deferred(),result=deferred();let attempts=0;
      const pending=x.run(async()=>{
        const first=startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},()=>{attempts++;started.resolve();return result.promise;});
        assert.equal(await first,'historical-result');
        await assert.rejects(startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},async()=>{attempts++;return'forbidden';}),/whatsapp_ai_turn_suppressed/);
      });
      try {
        await Promise.race([started.promise,pending.then(()=>{throw new Error('request_case_closed_before_start');})]);
        await x.human(); // Finishes while the first result promise remains unresolved.
      } finally { result.resolve('historical-result');await pending; }
      assert.equal(attempts,1);
    });

    for(const preparation of ['credentials','media'])await t.test('the actual Meta sender rechecks original authority after '+preparation+' preparation',async st=>{
      const x=await seed(),preparing=deferred(),release=deferred();let calls=0;
      const config={id:configId,merchantId:f.owner.merchantId,provider:'META_CLOUD',status:'ACTIVE',enabled:true,
        credentials:{phoneNumberId:'100001',wabaId:'100002',accessToken:'synthetic-local-only'}};
      // Direct-adapter local transport probe. This is not the AppModule HTTP
      // fixture, Graph delivery, a media download or a provider credential.
      st.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({messages:[{id:'synthetic-provider-id'}]});});
      const {MetaCloudSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.js');
      const sender=new MetaCloudSenderAdapter({findById:async()=>{
        if(preparation==='credentials'){preparing.resolve();await release.promise;}return config;
      }},{prepare:async()=>{preparing.resolve();await release.promise;return'100003';}});
      const input={merchantId:f.owner.merchantId,deviceId,toNumber:x.session.buyerPhone,text:'Synthetic local response',
        ...(preparation==='media'?{uiMessage:{type:'image',media:{link:'https://images.unsplash.com/synthetic.jpg'}}}:{})};
      const pending=x.run(()=>sender.sendText(input));
      void pending.catch(()=>{});
      try{
        await Promise.race([preparing.promise,pending.then(()=>{throw new Error('adapter_case_closed_before_preparation');})]);
        await x.human();
      }finally{release.resolve();await pending;}
      const result=await pending;
      assert.equal(result.messageId,'');assert.equal(calls,0);
      assert.equal(await f.raw.aiUsageEvent.count(),0);
    });

    await t.test('a partial presentation and its deferred retry retain the original epoch between messages',async st=>{
      const x=await seed();let calls=0,original;
      st.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({messages:[{id:'synthetic-first-message'}]});});
      const {MetaCloudSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.js');
      const sender=new MetaCloudSenderAdapter({findById:async()=>({id:configId,merchantId:f.owner.merchantId,provider:'META_CLOUD',status:'ACTIVE',enabled:true,
        credentials:{phoneNumberId:'100001',wabaId:'100002',accessToken:'synthetic-local-only'}})});
      const input={deviceId,toNumber:x.session.buyerPhone,text:'First local message'};
      await x.run(async()=>{
        original=currentWhatsAppExecution().authority;
        assert.deepEqual(await sender.sendText(input),{messageId:'synthetic-first-message',status:'sent'});
        await x.human();
        assert.equal((await sender.sendText({...input,text:'Forbidden second message'})).messageId,'');
      });
      await f.as(f.owner,()=>fence.restore(x.claim,original,async()=>assert.equal((await sender.sendText({...input,text:'Forbidden deferred retry'})).messageId,'')));
      assert.equal(calls,1);
      assert.deepEqual((await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}})).responseState.aiAuthority,original);
    });

    await t.test('atomic context application rolls back the WA state when its receipt cannot persist',async()=>{
      const x=await seed();
      const checkoutId='checkout-'+x.claim.id;
      await f.raw.checkoutSession.create({data:{merchantId:f.owner.merchantId,sessionId:checkoutId,globalUserId:'synthetic-buyer',conversationId:x.state.conversationId,
        cart:{items:[],total:0,currency:'BRL'},createdAt:new Date(),updatedAt:new Date()}});
      const next={...x.state,checkoutSessionId:checkoutId,stage:'checkout',revision:x.claim.id};
      await x.run(async()=>{
        await f.scoped.$transaction(async tx=>assert.equal(await saveWhatsAppResponseWithin(tx,x.claim,{phase:'prepared',state:next}),true));
        await f.db.sql(`CREATE FUNCTION reject_fence_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${x.claim.id}' AND NEW.response_state ? 'ownContextReceipt' THEN RAISE EXCEPTION 'controlled_receipt_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_fence_receipt BEFORE UPDATE ON whatsapp_webhook_inbox FOR EACH ROW EXECUTE FUNCTION reject_fence_receipt();`);
        try{await assert.rejects(fence.applyPrepared(x.claim,next,{phase:'prepared',state:next}),/controlled_receipt_failure/);}
        finally{await f.db.sql('DROP TRIGGER reject_fence_receipt ON whatsapp_webhook_inbox; DROP FUNCTION reject_fence_receipt();');}
        const unchanged=await f.raw.whatsAppSession.findUnique({where:{id:x.session.id}});
        assert.equal(unchanged.checkoutSessionId,null);assert.deepEqual(unchanged.conversationState,x.state);
        assert.equal((await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}})).responseState.ownContextReceipt,undefined);
        await fence.applyPrepared(x.claim,next,{phase:'prepared',state:next});
        const saved=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}});
        assert.equal(saved.responseState.aiAuthority.checkoutSessionId,null);
        assert.equal(saved.responseState.ownContextReceipt.to.checkoutSessionId,checkoutId);
        assert.equal(await startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},async()=>true),true);
        await f.raw.whatsAppSession.update({where:{id:x.session.id},data:{conversationState:{...next,revision:'newer-applied-turn'}}});
        await assert.rejects(startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},async()=>true),/whatsapp_ai_turn_suppressed/);
      });
    });

    await t.test('an empty legacy revision is superseded by a newer applied inbox, not a merely received input',async()=>{
      const x=await seed();let attempts=0;
      await x.run(async()=>{
        const newerId=randomUUID(),newerToken=randomUUID();
        const newer=await f.raw.whatsAppWebhookInbox.create({data:{id:newerId,dedupKey:newerId,eventId:newerId,kind:'message',merchantId:x.claim.merchantId,
          configId,deviceId,streamKey:x.claim.streamKey,payload:x.claim.payload,payloadHash:newerId,status:'processing',leaseToken:newerToken,
          leaseExpiresAt:new Date(Date.now()+120_000),attempts:1,createdAt:new Date(x.claim.createdAt.getTime()+1)}});
        assert.equal(await startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},async()=>{attempts++;return'not-applied-yet';}),'not-applied-yet');
        // A second authenticated invocation runs in its own ALS branch rather
        // than replacing the first turn's server capability.
        const {withoutWhatsAppExecutionForVerifiedOperation}=await import('../dist/shared/whatsapp/whatsapp-automation-context.js');
        const nextClaim={...newer,payload:x.claim.payload,responseState:undefined};
        await withoutWhatsAppExecutionForVerifiedOperation(()=>turns.run({scope:x.scope,inboxId:newerId,leaseToken:newerToken,
          conversationId:x.state.conversationId,message:x.claim.payload.body,origin:'text'},()=>fence.run(nextClaim,
          ()=>withStorefrontCart(f.scoped,f.owner.merchantId,x.state.conversationId,async()=>{}))));
        assert.equal((await f.raw.whatsAppSession.findUnique({where:{id:x.session.id}})).conversationState.revision,'');
        await assert.rejects(startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},async()=>{attempts++;return'forbidden';}),/whatsapp_ai_turn_suppressed/);
        assert.equal(attempts,1);
      });
    });

    await t.test('renewal invalidates original context even while no handoff binding has ever existed',async()=>{
      const x=await seed();
      await x.run(async()=>{
        await f.raw.whatsAppSession.update({where:{id:x.session.id},data:{conversationState:{...x.state,conversationId:'renewed-conversation'}}});
        await assert.rejects(startWhatsAppRequest({kind:'model',merchantId:f.owner.merchantId},async()=>assert.fail('renewed turn cannot submit')),
          /whatsapp_ai_turn_suppressed/);
        assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:x.session.id}}),0);
      });
    });

    await t.test('final PSP initiation requires this checkout and its exact durable creation lease, then stops after takeover',async()=>{
      const x=await seed(),sessionId='psp-checkout-'+x.claim.id,intentId='psp-'+x.claim.id,leaseToken=randomUUID();let starts=0;
      await f.raw.checkoutSession.create({data:{merchantId:f.owner.merchantId,sessionId,globalUserId:'synthetic-buyer',conversationId:x.state.conversationId,
        cart:{items:[],total:3,currency:'BRL'},createdAt:new Date(),updatedAt:new Date()}});
      await f.raw.whatsAppSession.update({where:{id:x.session.id},data:{checkoutSessionId:sessionId}});
      await f.raw.paymentIntent.create({data:{id:intentId,merchantId:f.owner.merchantId,sessionId,idempotencyKey:intentId,amountCents:300,currency:'BRL',method:'pix',status:'pending',
        creation:{state:'in_flight',leaseToken,leaseUntil:new Date(Date.now()+60_000).toISOString(),firstAttemptAt:new Date().toISOString(),
          input:{merchantId:f.owner.merchantId,sessionId,intentId,amountCents:300,currency:'BRL',method:'pix'}}}});
      const {withWhatsAppPaymentCreation,startWhatsAppPaymentRequest}=await import('../dist/shared/whatsapp/whatsapp-automation-context.js');
      await x.run(async()=>{
        await assert.rejects(withWhatsAppPaymentCreation({merchantId:f.owner.merchantId,intentId,sessionId,creationLeaseToken:'wrong-lease'},
          ()=>startWhatsAppPaymentRequest(f.owner.merchantId,async()=>{starts++;return'forbidden';})),/whatsapp_ai_turn_suppressed/);
        assert.equal(starts,0);
        assert.equal(await withWhatsAppPaymentCreation({merchantId:f.owner.merchantId,intentId,sessionId,creationLeaseToken:leaseToken},
          ()=>startWhatsAppPaymentRequest(f.owner.merchantId,async()=>{starts++;return'local-provider-start';})),'local-provider-start');
        await x.human();
        await assert.rejects(withWhatsAppPaymentCreation({merchantId:f.owner.merchantId,intentId,sessionId,creationLeaseToken:leaseToken},
          ()=>startWhatsAppPaymentRequest(f.owner.merchantId,async()=>{starts++;return'forbidden-after-takeover';})),/whatsapp_ai_turn_suppressed/);
        assert.equal(starts,1);
        const persisted=await f.raw.paymentIntent.findUnique({where:{id:intentId}});
        assert.equal(persisted.status,'pending');assert.equal(persisted.providerPaymentId,null);assert.equal(persisted.creation.leaseToken,leaseToken);
      });
    });

    await t.test('the real service admission refuses the obsolete WhatsApp turn while an independent storefront booking remains valid',async()=>{
      const x=await seed();
      const {admitServiceAppointment}=await import('../dist/shared/bookings/service-appointment-admission.service.js');
      const date=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,10);
      await f.raw.professionalAvailability.createMany({data:Array.from({length:7},(_,weekday)=>({merchantId:f.owner.merchantId,
        professionalId:f.professional.id,weekday,startMinute:600,endMinute:660,timeZone:'UTC'}))});
      const input={...f.selection,date,startsAt:date+'T10:00:00.000Z',endsAt:date+'T10:30:00.000Z',professionalVersion:1,policyVersion:1,
        priceInCents:5000,currency:'BRL',customer:{name:'Synthetic buyer',phone:'+'+x.session.buyerPhone},buyerGlobalUserId:'synthetic-buyer',
        origin:'whatsapp',actorId:'synthetic-buyer',idempotencyKey:'suppressed-booking-'+x.claim.id,confirmation:{kind:'at_attendance'}};
      await x.run(async()=>{
        await x.human();
        await assert.rejects(f.scoped.$transaction(tx=>admitServiceAppointment(tx,input)),/whatsapp_ai_turn_suppressed/);
      });
      assert.equal(await f.raw.serviceAppointment.count({where:{merchantId:f.owner.merchantId,idempotencyKey:input.idempotencyKey}}),0);
      assert.equal(await f.raw.appointmentAudit.count({where:{merchantId:f.owner.merchantId,commandId:input.idempotencyKey}}),0);
      assert.equal(await f.raw.outboxMessage.count({where:{merchantId:f.owner.merchantId,causationId:input.idempotencyKey}}),0);
      const independent={...input,origin:'storefront',idempotencyKey:'independent-booking-'+x.claim.id};
      const result=await f.as(f.owner,()=>f.scoped.$transaction(tx=>admitServiceAppointment(tx,independent)));
      assert.equal(result.appointment.operationalStatus,'scheduled');assert.equal(result.appointment.idempotencyKey,independent.idempotencyKey);
      assert.equal(await f.raw.serviceAppointment.count({where:{merchantId:f.owner.merchantId,idempotencyKey:independent.idempotencyKey}}),1);
    });

    await t.test('professional checkout uses the original transaction authority and stops after human takeover',async()=>{
      const x=await seed(),sessionId='professional-checkout-'+x.claim.id;
      const {ServiceSlotHoldsService}=await import('../dist/shared/bookings/service-slot-holds.service.js');
      const {professionalSlotId}=await import('../dist/shared/bookings/service-checkout-selection.js');
      const {canonicalizeProfessionalServiceCart}=await import('../dist/shared/bookings/service-checkout-cart.js');
      const {toCheckoutSession}=await import('../dist/modules/checkout/infrastructure/prisma/checkout-session.mapper.js');
      const date=new Date(Date.now()+8*24*60*60*1000).toISOString().slice(0,10);
      const selected={...f.selection,date,startsAt:date+'T10:00:00.000Z',endsAt:date+'T10:30:00.000Z',
        professionalVersion:1,policyVersion:1,timeZone:'UTC',durationMinutes:30};
      const {merchantId,...schedule}=selected;
      const cart={currency:'BRL',total:50,items:[{sku:f.selection.productId,name:'Canonical service',product_id:f.selection.productId,
        variantId:f.selection.variantId,quantity:1,price:50,productType:'service',fulfillmentStrategy:'scheduled_service',
        fulfillmentSchedule:{...schedule,slotId:professionalSlotId(merchantId,selected)}}]};
      const row=await f.raw.checkoutSession.create({data:{merchantId,sessionId,globalUserId:'synthetic-buyer',conversationId:x.state.conversationId,
        cart,createdAt:new Date(),updatedAt:new Date()}});
      const session=toCheckoutSession(row),holds=new ServiceSlotHoldsService(f.scoped);
      const appointments=await f.raw.serviceAppointment.count({where:{merchantId}});
      await x.run(async()=>{
        const authority=currentWhatsAppExecution().authority;
        const prepared=await holds.prepareProfessionalCheckout(session);
        assert.equal(prepared.paymentMode,'at_attendance');assert.equal(prepared.policyVersion,1);
        assert.equal(prepared.requiresHold,false);assert.equal(prepared.hold,undefined);
        assert.deepEqual(prepared.selections,[{...schedule,slotId:cart.items[0].fulfillmentSchedule.slotId,
          priceInCents:5000,currency:'BRL',productName:'Canonical service',professionalName:'Synthetic first professional'}]);
        const inbox=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}});
        assert.deepEqual(inbox.responseState.aiEffectReceipt,{version:1,inboxId:x.claim.id,authority});
        assert.deepEqual(inbox.responseState.aiAuthority,authority);
        const quotation=await f.scoped.$transaction(tx=>canonicalizeProfessionalServiceCart(tx,merchantId,session.cart));
        assert.equal(quotation.total,50);assert.equal(quotation.items[0].name,'Canonical service');
        await x.human();
        for(const method of ['acquire','prepareProfessionalCheckout','assertBeforePayment','get','state'])
          await assert.rejects(holds[method](session),/whatsapp_ai_turn_suppressed/,method);
        await assert.rejects(f.scoped.$transaction(tx=>canonicalizeProfessionalServiceCart(tx,merchantId,session.cart)),/whatsapp_ai_turn_suppressed/);
      });
      assert.deepEqual(await f.raw.checkoutSession.findUnique({where:{merchantId_sessionId:{merchantId,sessionId}}}),row);
      assert.equal(await f.raw.serviceAppointment.count({where:{merchantId}}),appointments);
      assert.equal(await f.raw.paymentIntent.count({where:{merchantId,sessionId}}),0);
      const independent=await f.as(f.owner,()=>holds.prepareProfessionalCheckout(session));
      assert.equal(independent.requiresHold,false);assert.equal(independent.selections[0].professionalId,f.professional.id);
    });

    for(const forwarded of [false,true])await t.test('live legacy suppression finishes only its own delivery with forwarded='+forwarded,async()=>{
      const configured={configId,deviceId:'legacy-device-'+randomUUID(),provider:'TWILIO'};
      await f.raw.whatsAppChannelConfig.update({where:{id:configId},data:{deviceId:configured.deviceId,provider:'TWILIO',credentials:{accountSid:'AC'+'a'.repeat(32),authToken:'synthetic-local-token'}}});
      try{
      const x=await seed(undefined,configured);let sends=0;
      const {WhatsAppDeliveryService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-delivery.service.js');
      const {WhatsAppHumanMessageRouter}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-human-message-router.js');
      const {PrismaWhatsAppWebhookInbox}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js');
      const delivery=new WhatsAppDeliveryService(f.scoped,{sendText:async()=>{sends++;return{status:'queued',messageId:'forbidden'};}},fence);
      const router=new WhatsAppHumanMessageRouter(bindings,turns,delivery,new PrismaWhatsAppWebhookInbox(f.scoped));
      const outcome=await f.as(f.owner,()=>delivery.process(x.claim,()=>x.run(async()=>{
        const takeover=await x.human();let receipt;
        if(forwarded){
          const routed=await router.routeSuppressed({...x.claim.payload,inboxClaim:x.claim},{bindingId:takeover.state.id,ticketId:takeover.state.ticketId,epoch:takeover.state.epoch});
          assert.equal(routed.kind,'received');receipt=routed.receipt;
        }
        await fence.suppress(x.claim,receipt);
      }),async()=>true)).then(()=>({ok:true}),error=>({ok:false,message:error.message}));
      assert.deepEqual(outcome,{ok:true});
      const stored=await f.raw.whatsAppDelivery.findUnique({where:{id:x.claim.id}});
      assert.equal(stored.state,forwarded?'acknowledged':'suppressed');assert.equal(stored.providerMessageId,null);assert.equal(sends,0);
      const inbox=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}});
      assert.equal(inbox.responseState.purpose,forwarded?'human_received':'ai_suppressed');
      assert.deepEqual(stored.response.aiAuthority,inbox.responseState.aiAuthority);
      if(forwarded){assert.deepEqual(stored.response.receipt,inbox.responseState.receipt);assert.equal(await f.raw.supportTicketMessage.count({where:{ticketId:stored.response.receipt.ticketId}}),1);}
      }finally{await f.raw.whatsAppChannelConfig.update({where:{id:configId},data:{deviceId,provider:'META_CLOUD',credentials:{phoneNumberId:'100001'}}});}
    });

    await t.test('terminal suppression never resolves an already uncertain provider submission',async()=>{
      const x=await seed();let sends=0;
      const {WhatsAppDeliveryService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-delivery.service.js');
      const delivery=new WhatsAppDeliveryService(f.scoped,{sendText:async()=>{sends++;return{status:'queued',messageId:'forbidden'};}},fence);
      await x.run(()=>fence.suppress(x.claim));
      await f.raw.whatsAppDelivery.create({data:{id:x.claim.id,merchantId:f.owner.merchantId,configId:x.scope.configId,deviceId:x.session.deviceId,
        state:'submission_unknown',processingToken:x.claim.leaseToken,response:{aiAuthority:(await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}})).responseState.aiAuthority}}});
      await assert.rejects(f.as(f.owner,()=>delivery.process(x.claim,async()=>assert.fail('unknown delivery must not rerun generation'),async()=>true)),/whatsapp_delivery_requires_reconciliation/);
      assert.equal((await f.raw.whatsAppDelivery.findUnique({where:{id:x.claim.id}})).state,'submission_unknown');assert.equal(sends,0);
    });

    for(const fault of ['epoch','missing_binding','foreign_binding'])await t.test('a confirmed historical notice cannot mint a receipt from mismatched original '+fault,async()=>{
      const x=await seed();
      await f.raw.buyerIdentity.create({data:{merchantId:f.owner.merchantId,identityKey:'phone:'+x.session.buyerPhone,globalUserId:'synthetic-buyer-'+x.claim.id}});
      const {persistWhatsAppSupportIntake}=await import('../dist/modules/support/application/whatsapp-support-intake.js');
      const intake=await x.run(()=>persistWhatsAppSupportIntake(bindings,{scope:x.scope,inboxId:x.claim.id,leaseToken:x.claim.leaseToken,
        message:x.claim.payload.body,origin:'text'}));
      const captured=(await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}})).responseState;
      const notice={confirmed:true,ticketId:intake.ticketId,bindingId:intake.binding.id,epoch:intake.binding.epoch,reply:'Synthetic previously prepared notice'};
      if(fault==='epoch')notice.epoch++;
      if(fault==='missing_binding')delete notice.bindingId;
      if(fault==='foreign_binding')notice.bindingId='foreign-binding-id';
      await f.raw.whatsAppHandoffBinding.update({where:{id:intake.binding.id},data:{mode:'human',epoch:intake.binding.epoch+1,assignedOperatorId:'synthetic-operator'}});
      await f.raw.whatsAppWebhookInbox.update({where:{id:x.claim.id},data:{responseState:{...captured,purpose:'human_handoff',phase:'prepared',sessionId:x.session.id,handoff:notice}}});
      const before={binding:await f.raw.whatsAppHandoffBinding.findUnique({where:{id:intake.binding.id}}),
        session:await f.raw.whatsAppSession.findUnique({where:{id:x.session.id}}),messages:await f.raw.supportTicketMessage.count(),events:await f.raw.outboxMessage.count()};
      assert.equal(await f.as(f.owner,()=>fence.consumeHandoffReplay(x.claim)),true);
      const stored=(await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}})).responseState;
      assert.equal(stored.purpose,'ai_suppressed');assert.equal(stored.receipt,undefined);assert.deepEqual(stored.aiAuthority,captured.aiAuthority);
      let forwarded=0;
      assert.equal(await f.as(f.owner,()=>fence.withSuppressedInput(x.claim,captured.aiAuthority,async()=>{forwarded++;})),undefined);
      assert.equal(forwarded,0);
      assert.deepEqual(await f.raw.whatsAppHandoffBinding.findUnique({where:{id:intake.binding.id}}),before.binding);
      assert.deepEqual(await f.raw.whatsAppSession.findUnique({where:{id:x.session.id}}),before.session);
      assert.equal(await f.raw.supportTicketMessage.count(),before.messages);assert.equal(await f.raw.outboxMessage.count(),before.events);
    });

    for(const rotation of ['To','SID','token','SID_upgrade'])await t.test('the final Twilio SDK boundary refuses '+rotation+' rotation during preparation',async st=>{
      const configured={configId,deviceId:'twilio:'+configId,provider:'TWILIO'},number='+5511988880001';
      const credentials={authToken:'synthetic-local-token',...(rotation==='SID_upgrade'?{}:{accountSid:'AC'+'a'.repeat(32),senderId:'whatsapp:'+number})};
      await f.raw.whatsAppChannelConfig.update({where:{id:configId},data:{deviceId:configured.deviceId,provider:'TWILIO',whatsappNumber:number,credentials}});
      const x=await seed(undefined,configured),preparing=deferred(),release=deferred();let requests=0,pending;
      const {TwilioSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/twilio-sender.adapter.js');
      const {decodeWhatsAppCredentials}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/whatsapp-credential-codec.js');
      st.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({sid:'forbidden-local-request'});});
      const sender=new TwilioSenderAdapter({findById:async()=>{
        preparing.resolve();await release.promise;
        const config=await f.raw.whatsAppChannelConfig.findUnique({where:{id:configId}});
        return{...config,credentials:decodeWhatsAppCredentials(config.credentials)};
      }});
      try{
        pending=x.run(()=>sender.sendText({deviceId:configured.deviceId,toNumber:x.session.buyerPhone,text:'Obsolete original connection'}));
        void pending.catch(()=>{});
        await Promise.race([preparing.promise,pending.then(()=>{throw new Error('twilio_case_closed_before_prepare');})]);
        const changed=rotation==='To'?{whatsappNumber:'+5511988880002',credentials:{...credentials,senderId:'whatsapp:+5511988880002'}}
          :rotation==='SID'?{credentials:{...credentials,accountSid:'AC'+'b'.repeat(32)}}
          :rotation==='token'?{credentials:{...credentials,authToken:'synthetic-rotated-token'}}
          :{credentials:{...credentials,accountSid:'AC'+'a'.repeat(32),senderId:'whatsapp:'+number}};
        await f.raw.whatsAppChannelConfig.update({where:{id:configId},data:changed});
        release.resolve();assert.equal((await pending).messageId,'');assert.equal(requests,0);
        const saved=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}});
        assert.match(saved.responseState.aiAuthority.accountId,rotation==='SID_upgrade'?/^twilio:number:/:/^twilio:account:/);
      }finally{
        release.resolve();if(pending)await pending.catch(()=>{});
        await f.raw.whatsAppChannelConfig.update({where:{id:configId},data:{deviceId,provider:'META_CLOUD',whatsappNumber:null,credentials:{phoneNumberId:'100001'}}});
      }
    });

    for(const scenario of ['before_transport','unknown_started','late_accounting'])await t.test('the existing durable ASR attempt remains authoritative across '+scenario,async()=>{
      const x=await seed(),ready=deferred(),release=deferred();let starts=0;
      const {AiMeteringService}=await import('../dist/modules/ai-metering/ai-metering.service.js');
      const model='synthetic-'+x.claim.id,key='whatsapp-audio:'+createHash('sha256').update(x.claim.id).digest('hex');
      await f.raw.aiPriceVersion.create({data:{version:model,model,provider:'openai',channel:'voice',component:'transcription',currency:'USD',
        effectiveFrom:new Date(0),source:'synthetic-local',rates:{input:'1250000',output:'5000000'}}});
      let firstAuthorization=true;
      // Governance is an explicit local port in this direct-service SQL test;
      // the HTTP suite retains the actual AppModule authorization providers.
      const meter=new AiMeteringService(f.raw,{},null,{authorize:async()=>{
        if(scenario==='before_transport'&&firstAuthorization){firstAuthorization=false;ready.resolve();await release.promise;}
        return{actorId:'synthetic-buyer',actorRole:'buyer'};
      }});
      const request=()=>{
        const body=new FormData();body.set('model',model);body.set('response_format','json');body.set('file',new Blob(['synthetic-local-audio']),'voice.ogg');
        return meter.fetchTranscription({merchantId:f.owner.merchantId,conversationId:x.state.conversationId,source:'voice_whatsapp_audio',costCenter:'voice'},
          'https://api.openai.com/v1/audio/transcriptions',{method:'POST',body}, {model,idempotencyKey:key},async()=>{
            starts++;ready.resolve();await release.promise;
            if(scenario==='unknown_started')throw new Error('synthetic_transport_result_unknown');
            return Response.json({text:'Synthetic authorized result',usage:{input_tokens:100,output_tokens:20,total_tokens:120}});
          });
      };
      const pending=x.run(request).then(value=>({value}),error=>({error}));
      try{await Promise.race([ready.promise,pending.then(()=>{throw new Error('asr_case_closed_before_barrier');})]);await x.human();}
      finally{release.resolve();await pending;}
      const result=await pending,row=await f.raw.aiUsageEvent.findUnique({where:{idempotencyKey:key}});
      assert.ok(row);assert.equal(row.merchantId,f.owner.merchantId);assert.equal(row.conversationId,x.state.conversationId);
      if(scenario==='before_transport'){
        assert.match(result.error.message,/whatsapp_ai_turn_suppressed/);assert.equal(starts,0);
        assert.equal(row.executionStatus,'suppressed');assert.equal(row.costStatus,'not_submitted');assert.equal(row.costMicros,0n);
      }else if(scenario==='unknown_started'){
        assert.match(result.error.message,/audio_transcription_provider_unavailable/);assert.equal(starts,1);assert.equal(row.executionStatus,'unknown');
      }else{
        assert.equal(result.value.status,200);assert.equal(starts,1);assert.equal(row.executionStatus,'succeeded');assert.equal(row.usageKnown,true);assert.ok(row.costMicros>0n);
      }
      await assert.rejects(request(),/audio_transcription_already_attempted/);
      assert.equal(starts,scenario==='before_transport'?0:1);
      assert.equal(await f.raw.aiUsageEvent.count({where:{idempotencyKey:key}}),1);
      const persisted=JSON.stringify(row,(_,value)=>typeof value==='bigint'?String(value):value);
      assert.equal(persisted.includes('Synthetic authorized result'),false);assert.equal(persisted.includes('synthetic-local-audio'),false);
    });

    await t.test('clock after an actual inbox row wait rejects the expired lease without a binding or authority',async()=>{
      const x=await seed(),observer=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}}),holderClient=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}});
      const ready=deferred(),release=deferred();let holder,pending;
      try{
        holder=holderClient.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM whatsapp_webhook_inbox WHERE id=${x.claim.id} FOR UPDATE`;
          const[connection]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid,clock_timestamp() AS now`;
          const expiresAt=new Date(connection.now.getTime()+2000);
          await tx.whatsAppWebhookInbox.update({where:{id:x.claim.id},data:{leaseExpiresAt:expiresAt}});
          ready.resolve({pid:connection.pid,expiresAt});await release.promise;
        },{timeout:15_000});
        const locked=await Promise.race([ready.promise,holder.then(()=>{throw new Error('controlled_holder_closed_before_ready');})]);
        pending=x.run(async()=>assert.fail('expired lease cannot enter generation')).then(()=>({ok:true}),error=>({ok:false,message:error.message}));
        const deadline=Date.now()+4000;let waiter;
        while(Date.now()<deadline){
          const rows=await observer.$queryRaw`SELECT pid,clock_timestamp() AS observed FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND ${locked.pid}=ANY(pg_blocking_pids(pid))`;
          if(rows.length){waiter=rows[0];break;}await new Promise(resolve=>setTimeout(resolve,15));
        }
        assert.ok(waiter,'capture must wait on the controlled inbox row');
        assert.ok(waiter.observed<locked.expiresAt,'lease must still be live when the SQL wait is observed');
        let expired=false;
        while(Date.now()<deadline){const[row]=await observer.$queryRaw`SELECT clock_timestamp()>${locked.expiresAt}::timestamptz AS expired`;if(row.expired){expired=true;break;}await new Promise(resolve=>setTimeout(resolve,15));}
        assert.equal(expired,true);release.resolve();await holder;
        assert.match((await pending).message,/whatsapp_inbox_lease_lost/);
        assert.equal((await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}})).responseState,null);
        assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:x.session.id}}),0);
      }finally{release.resolve();if(holder)await holder.catch(()=>{});if(pending)await pending;await holderClient.$disconnect();await observer.$disconnect();}
    });
    await t.test('local confirmation uses the actual original transaction authority before replay or new booking',async()=>{
      const x=await seed(),merchantId=f.owner.merchantId;
      const {confirmServiceAppointment}=await import('../dist/modules/checkout/application/confirm-service-appointment.use-case.js');
      const {paymentCartFingerprint}=await import('../dist/modules/checkout/domain/services/payment-cart-fingerprint.js');
      const {professionalSlotId}=await import('../dist/shared/bookings/service-checkout-selection.js');
      const prepare=async(day,suffix)=>{
        const sessionId='local-confirmation-'+suffix+'-'+x.claim.id,date=new Date(Date.now()+day*86400000).toISOString().slice(0,10);
        const selected={...f.selection,date,startsAt:date+'T10:00:00.000Z',endsAt:date+'T10:30:00.000Z',
          professionalVersion:1,policyVersion:1,timeZone:'UTC',durationMinutes:30};
        const{merchantId:ignored,...schedule}=selected;
        const cart={currency:'BRL',total:50,items:[{sku:f.selection.productId,name:'Canonical service',product_id:f.selection.productId,
          variantId:f.selection.variantId,price:50,quantity:1,productType:'service',fulfillmentStrategy:'scheduled_service',
          fulfillmentSchedule:{...schedule,slotId:professionalSlotId(merchantId,selected)}}]};
        await f.raw.checkoutSession.create({data:{merchantId,sessionId,globalUserId:'synthetic-buyer',conversationId:x.state.conversationId,
          cart,createdAt:new Date(),updatedAt:new Date(),customer:{fullName:'Synthetic confirmation buyer',phone:'+'+x.session.buyerPhone}}});
        return{buyer:{merchantId,sessionId,globalUserId:'synthetic-buyer',origin:'whatsapp'},
          command:{commandId:'local-confirmation-'+suffix+'-'+x.claim.id,cartFingerprint:paymentCartFingerprint({cart})}};
      };
      const first=await prepare(12,'first'),second=await prepare(13,'second'),store=()=>{throw new Error('hold_off_redis_must_not_be_used');};
      const confirm=value=>f.scoped.$transaction(tx=>confirmServiceAppointment(tx,value.buyer,value.command,{store}));
      let committed;
      await x.run(async()=>{
        const authority=currentWhatsAppExecution().authority;
        committed=await confirm(first);
        assert.equal(committed.replayed,false);assert.equal(committed.appointments[0].operationalStatus,'scheduled');
        assert.equal(committed.appointments[0].payments[0].status,'pending');assert.equal(committed.appointments[0].payments[0].paymentIntentId,null);
        const inbox=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:x.claim.id}});
        assert.deepEqual(inbox.responseState.aiEffectReceipt,{version:1,inboxId:x.claim.id,authority});
        await x.human();
        const before={appointments:await f.raw.serviceAppointment.findMany({where:{merchantId},orderBy:{id:'asc'}}),
          payments:await f.raw.appointmentPayment.findMany({where:{merchantId},orderBy:{id:'asc'}}),
          audit:await f.raw.appointmentAudit.findMany({where:{merchantId},orderBy:{id:'asc'}}),
          events:await f.raw.outboxMessage.findMany({where:{merchantId,producer:'service-booking'},orderBy:{eventId:'asc'}})};
        await assert.rejects(confirm(first),/whatsapp_ai_turn_suppressed/);
        await assert.rejects(confirm({...second,buyer:{...second.buyer,origin:'storefront'}}),/whatsapp_ai_turn_suppressed/);
        assert.deepEqual({appointments:await f.raw.serviceAppointment.findMany({where:{merchantId},orderBy:{id:'asc'}}),
          payments:await f.raw.appointmentPayment.findMany({where:{merchantId},orderBy:{id:'asc'}}),
          audit:await f.raw.appointmentAudit.findMany({where:{merchantId},orderBy:{id:'asc'}}),
          events:await f.raw.outboxMessage.findMany({where:{merchantId,producer:'service-booking'},orderBy:{eventId:'asc'}})},before);
        assert.equal(await f.raw.paymentIntent.count({where:{merchantId,sessionId:second.buyer.sessionId}}),0);
      });
      const replay=await f.as(f.owner,()=>confirm(first));assert.equal(replay.replayed,true);
      assert.equal(replay.appointments[0].id,committed.appointments[0].id);
      const independent=await f.as(f.owner,()=>confirm(second));assert.equal(independent.replayed,false);
      assert.equal(independent.appointments[0].operationalStatus,'scheduled');assert.equal(independent.appointments[0].payments[0].status,'pending');
    });
  }finally{await f.close();}
});
