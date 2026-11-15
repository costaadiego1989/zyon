import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T49',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHandoffFixture({provider:'META_CLOUD',whatsapp:{voiceTranscripts:{'12345':'Quero falar com um atendente','55555':'5, excelente experiência'}}});
  try{
    const submissions=()=>f.runtime.whatsapp.events().filter(event=>['sendText','sendMedia'].includes(event.kind));
    const originalMessages=new Map();
    const message=(value,id,kind='text',text='Quero falar com um atendente')=>{
      if(originalMessages.has(id))return structuredClone(originalMessages.get(id));
      const payload={entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:f.metaPhoneNumberId(value.actor)},messages:[{
      id,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:kind,
      ...(kind==='text'?{text:{body:text}}:kind==='interactive'?{interactive:{button_reply:{id:'synthetic-human-control',title:'Falar com atendente'}}}:{audio:{id:text,mime_type:'audio/ogg'}}),
      }]}}]}]};
      originalMessages.set(id,structuredClone(payload));return payload;
    };
    const post=async(payload,valid=true)=>{const body=JSON.stringify(payload);return fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':valid?f.runtime.whatsapp.signature(body):'sha256='+'0'.repeat(64)},body,redirect:'error',signal:AbortSignal.timeout(15_000)});};
    const wait=async(predicate,label)=>{const end=Date.now()+15_000;let value;do{value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);assert.fail(label);};
    const processed=id=>wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:id}});if(row&&['dead','blocked'].includes(row.status))assert.fail('inbox failed '+row.lastError);return row?.status==='processed'?row:undefined;},'inbox not processed '+id);
    const checkout=value=>f.raw.checkoutSession.findFirst({where:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}});
    const textThread=await f.thread(f.owner,'intake-text'),productThread=await f.thread(f.products,'intake-products');
    const widget=await f.ticket(textThread,'existing-widget',{source:'widget',sessionId:'synthetic-widget-conversation',buyerId:'synthetic-buyer-'+f.owner.merchantId});
    await t.test('full AppModule uses only the declared local provider overrides and retains real auth/repositories',async()=>{
      assert.deepEqual(f.runtime.evidence().localProviderOverrides,['whatsapp-channel.WHATSAPP_SENDER_PORT','MetaInboundMediaAdapter']);
      assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);
      assert.equal(f.runtime.evidence().providerCalls,0);assert.deepEqual(submissions(),[]);
    });
    await t.test('invalid signature is rejected before durable intake, ticket or submission',async()=>{
      const before=await f.raw.whatsAppWebhookInbox.count(),tickets=await f.raw.supportTicket.count();
      const response=await post(message(textThread,'synthetic-invalid-signature'),false);assert.equal(response.status,401);
      assert.equal(await f.raw.whatsAppWebhookInbox.count(),before);assert.equal(await f.raw.supportTicket.count(),tickets);assert.deepEqual(submissions(),[]);
    });
    await t.test('signed text during checkout atomically binds a new WhatsApp case instead of the buyer-wide widget case',async()=>{
      const before=await checkout(textThread),response=await post(message(textThread,'synthetic-text-intake'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true});
      const inbox=await processed('synthetic-text-intake'),binding=await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:textThread.session.id}});
      assert.equal(binding.mode,'waiting_human');assert.equal(binding.epoch,1);assert.equal(binding.merchantId,f.owner.merchantId);assert.equal(binding.configId,textThread.scope.configId);assert.notEqual(binding.ticketId,widget.id);
      const ticket=await f.raw.supportTicket.findUnique({where:{id:binding.ticketId}});assert.equal(ticket.source,'whatsapp');assert.equal(ticket.sessionId,textThread.session.id);assert.equal(ticket.status,'open');
      const rows=await f.raw.supportTicketMessage.findMany({where:{ticketId:ticket.id}});assert.equal(rows.length,1);assert.equal(rows[0].content,'Quero falar com um atendente');
      assert.deepEqual(rows[0].metadata,{kind:'whatsapp_intake',schemaVersion:1,configId:textThread.scope.configId,whatsappSessionId:textThread.session.id,inboxId:inbox.id,origin:'text',epoch:1});
      const events=await f.raw.outboxMessage.findMany({where:{merchantId:f.owner.merchantId,eventType:'support.case.changed'}});
      assert.equal(events.filter(event=>event.payload.ticketId===ticket.id&&event.payload.event==='created').length,1);assert.equal(events.filter(event=>event.payload.ticketId===ticket.id&&event.payload.event==='message'&&event.payload.messageId===rows[0].id).length,1);
      assert.deepEqual(await checkout(textThread),before);assert.deepEqual((await f.raw.whatsAppSession.findUnique({where:{id:textThread.session.id}})).conversationState,textThread.session.conversationState);
      const sent=submissions();assert.equal(sent.length,1);assert.equal(sent[0].input.toNumber,'+'+textThread.session.buyerPhone);assert.equal(sent[0].input.deviceId,textThread.session.deviceId);
      assert.match(sent[0].input.uiMessage.text.body,/Atendimento humano solicitado/);assert.equal(sent[0].result.status,'queued');assert.equal(inbox.responseState.handoff.ticketId,ticket.id);
    });
    await t.test('duplicate HTTP replay does not create another ticket, message, outbox event or local submission',async()=>{
      const before={tickets:await f.raw.supportTicket.count(),messages:await f.raw.supportTicketMessage.count(),events:await f.raw.outboxMessage.count({where:{eventType:'support.case.changed'}}),sent:submissions().length};
      const response=await post(message(textThread,'synthetic-text-intake'));assert.equal(response.status,200);await processed('synthetic-text-intake');
      assert.equal(await f.raw.supportTicket.count(),before.tickets);assert.equal(await f.raw.supportTicketMessage.count(),before.messages);assert.equal(await f.raw.outboxMessage.count({where:{eventType:'support.case.changed'}}),before.events);assert.equal(submissions().length,before.sent);
      const altered=message(textThread,'synthetic-text-intake');altered.entry[0].changes[0].value.messages[0].text.body='Altered replay must not replace the original';
      assert.equal((await post(altered)).status,409);
      assert.equal((await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:'synthetic-text-intake'}})).payload.body,'Quero falar com um atendente');
      assert.equal(await f.raw.supportTicketMessage.count(),before.messages);assert.equal(submissions().length,before.sent);
    });
    await t.test('the native button label works for products and cannot accept free merchant/source ownership',async()=>{
      const before=await checkout(productThread),payload=message(productThread,'synthetic-product-button','interactive');
      Object.assign(payload.entry[0].changes[0].value.messages[0],{merchantId:f.owner.merchantId,source:'widget',ticketId:widget.id});
      assert.equal((await post(payload)).status,200);const inbox=await processed('synthetic-product-button');
      const binding=await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:productThread.session.id}});
      assert.equal(binding.merchantId,f.products.merchantId);assert.equal(binding.mode,'waiting_human');assert.notEqual(binding.ticketId,widget.id);
      const rows=await f.raw.supportTicketMessage.findMany({where:{ticketId:binding.ticketId}});assert.equal(rows.length,1);assert.equal(rows[0].metadata.origin,'button');assert.equal(rows[0].metadata.inboxId,inbox.id);
      assert.deepEqual(await checkout(productThread),before);assert.equal(inbox.payload.merchantId,f.products.merchantId);assert.equal(Object.hasOwn(inbox.payload,'ticketId'),false);
    });
    await t.test('same buyer in a different WhatsApp thread gets a different exact conversation binding',async()=>{
      const value=await f.thread(f.owner,'another-thread');assert.equal((await post(message(value,'synthetic-other-thread'))).status,200);await processed('synthetic-other-thread');
      const one=await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:textThread.session.id}}),other=await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:value.session.id}});
      assert.notEqual(one.ticketId,other.ticketId);assert.equal((await f.raw.supportTicket.findUnique({where:{id:other.ticketId}})).sessionId,value.session.id);
    });
    await t.test('authorized synthetic voice persists its exact transcript once and bypasses pending post-sale collection',async()=>{
      const value=await f.thread(f.owner,'voice'),before=await checkout(value),calls=f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret').length;
      const response=await post(message(value,'synthetic-voice-intake','audio','12345'));assert.equal(response.status,200);const inbox=await processed('synthetic-voice-intake');
      const binding=await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:value.session.id}}),rows=await f.raw.supportTicketMessage.findMany({where:{ticketId:binding.ticketId}});
      assert.equal(rows.length,1);assert.equal(rows[0].content,'Quero falar com um atendente');assert.equal(rows[0].metadata.origin,'voice');assert.equal(rows[0].metadata.inboxId,inbox.id);
      const voice=f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret');assert.equal(voice.length,calls+1);assert.equal(voice.at(-1).result.scope.inboxId,inbox.id);assert.equal(voice.at(-1).result.scope.conversationId,value.session.conversationState.conversationId);
      assert.deepEqual(await checkout(value),before);assert.equal(await f.raw.npsResponse.count({where:{merchantId:f.owner.merchantId}}),0);
      const n=voice.length;assert.equal((await post(message(value,'synthetic-voice-intake','audio','12345'))).status,200);await processed('synthetic-voice-intake');assert.equal(f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret').length,n);
    });
    await t.test('body and MIME labels alone cannot become authorized speech or create a handoff',async()=>{
      const value=await f.thread(f.products,'unread-voice');await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{postSaleContext:Prisma.DbNull}});
      const start=submissions().length;
      const payload=message(value,'synthetic-unread-voice','audio','99999');payload.entry[0].changes[0].value.messages[0].text={body:'Quero falar com atendente'};
      assert.equal((await post(payload)).status,200);await processed('synthetic-unread-voice');
      assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:value.session.id}}),0);assert.equal(await f.raw.supportTicket.count({where:{sessionId:value.session.id}}),0);
      const replies=submissions().slice(start).map(event=>event.input.uiMessage?.text?.body??event.input.uiMessage?.interactive?.body?.text??'').join('\n');
      assert.match(replies,/Não consegui transcrever/);assert.doesNotMatch(replies,/Atendimento humano solicitado/);
    });
    await t.test('authorized ordinary voice is consumed by the existing post-sale path without a second interpretation',async()=>{
      const value=await f.thread(f.products,'voice-rating'),calls=f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret').length,before=await checkout(value);
      assert.equal((await post(message(value,'synthetic-voice-rating','audio','55555'))).status,200);await processed('synthetic-voice-rating');
      const result=await f.raw.npsResponse.findFirst({where:{merchantId:f.products.merchantId,buyerId:value.session.postSaleContext.buyerId,orderId:value.session.postSaleContext.orderId}});
      assert.ok(result);assert.equal(result.score,10);assert.equal(result.classification,'promoter');assert.equal(result.feedback,', excelente experiência');
      assert.equal((await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}})).postSaleContext,null);
      assert.equal(f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret').length,calls+1);assert.deepEqual(await checkout(value),before);
    });
    await t.test('optional appointment context requires its canonical buyer and policy and never performs a booking or financial command',async()=>{
      // Identified historical seed, not a booking-admission or channel proof.
      const value=await f.thread(f.owner,'appointment-context'),productId='synthetic-handoff-service',professionalId='synthetic-handoff-professional',variantId='synthetic-handoff-variant';
      await f.raw.product.create({data:{id:productId,merchantId:f.owner.merchantId,name:'Synthetic historical service',type:'service',variants:{create:{id:variantId,sku:variantId,price:{create:{basePriceInCents:5000,currency:'BRL'}}}}}});
      await f.raw.serviceProfessional.create({data:{id:professionalId,merchantId:f.owner.merchantId,publicName:'Synthetic professional',timeZone:'UTC'}});
      await f.raw.professionalService.create({data:{merchantId:f.owner.merchantId,professionalId,productId}});
      const base={merchantId:f.owner.merchantId,professionalId,productId,variantId,customerSnapshot:{name:'Synthetic buyer'},startsAt:new Date('2030-01-01T10:00:00Z'),endsAt:new Date('2030-01-01T10:30:00Z'),timeZone:'UTC',durationMinutes:30,priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{paymentMode:'at_attendance',holdEnabled:false},origin:'manual',requestFingerprint:'synthetic-handoff'};
      const owner=await f.raw.serviceAppointment.create({data:{...base,idempotencyKey:'synthetic-handoff-owner',buyerGlobalUserId:'synthetic-buyer-'+f.owner.merchantId}});
      const other=await f.raw.serviceAppointment.create({data:{...base,idempotencyKey:'synthetic-handoff-other',buyerGlobalUserId:'synthetic-another-buyer'}});
      const unclassified=await f.raw.serviceAppointment.create({data:{...base,idempotencyKey:'synthetic-handoff-unclassified'}});
      const payload={merchantId:f.owner.merchantId,deviceId:value.session.deviceId,fromNumber:'+'+value.session.buyerPhone,body:'Quero remarcar meu atendimento',messageType:'text',provider:'META_CLOUD',timestamp:Date.now()};
      const inboxId=randomUUID(),leaseToken=randomUUID(),hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      await f.raw.whatsAppWebhookInbox.create({data:{id:inboxId,dedupKey:inboxId,eventId:inboxId,kind:'message',merchantId:f.owner.merchantId,configId:value.scope.configId,deviceId:value.session.deviceId,streamKey:inboxId,payload,payloadHash:hash,status:'processing',leaseToken,leaseExpiresAt:new Date(Date.now()+120_000)}});
      const {persistWhatsAppSupportIntake}=await import('../dist/modules/support/application/whatsapp-support-intake.js');
      const input={scope:value.scope,inboxId,leaseToken,message:payload.body,origin:'text',appointmentId:owner.id,policyVersion:1};
      const before=await f.raw.serviceAppointment.findMany({where:{professionalId},orderBy:{id:'asc'}}),payments=await f.raw.appointmentPayment.count(),audits=await f.raw.appointmentAudit.count();
      for(const extra of [{appointmentId:other.id},{appointmentId:unclassified.id},{policyVersion:2},{leaseToken:randomUUID()}]){
        await assert.rejects(f.as(f.owner,()=>persistWhatsAppSupportIntake(f.repo,{...input,...extra})),/whatsapp_handoff_(appointment|inbox)_not_found/);
        assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:value.session.id}}),0);
      }
      const result=await f.as(f.owner,()=>persistWhatsAppSupportIntake(f.repo,input));
      const saved=await f.raw.supportTicketMessage.findUnique({where:{id:result.messageId}});
      assert.equal(saved.metadata.appointmentId,owner.id);assert.equal(saved.metadata.policyVersion,1);assert.equal(saved.content,payload.body);
      assert.deepEqual(await f.raw.serviceAppointment.findMany({where:{professionalId},orderBy:{id:'asc'}}),before);assert.equal(await f.raw.appointmentPayment.count(),payments);assert.equal(await f.raw.appointmentAudit.count(),audits);
    });
    await t.test('an actual outbox write rejection rolls back case/message/binding and sends only an unconfirmed notice',async()=>{
      const value=await f.thread(f.owner,'rollback'),before=await checkout(value),count=await f.raw.supportTicket.count(),start=submissions().length;
      await f.runtime.db.sql("CREATE FUNCTION synthetic_intake_outbox_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id='handoff-services' AND NEW.event_type='support.case.changed' THEN RAISE EXCEPTION 'synthetic_intake_outbox_rejected'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_intake_outbox_reject BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_intake_outbox_reject();");
      try{
        assert.equal((await post(message(value,'synthetic-outbox-rejection'))).status,200);const inbox=await processed('synthetic-outbox-rejection');
        assert.equal(await f.raw.supportTicket.count(),count);assert.equal(await f.raw.supportTicketMessage.count({where:{ticket:{sessionId:value.session.id}}}),0);
        assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:value.session.id}}),0);assert.deepEqual(await checkout(value),before);
        assert.equal(inbox.responseState.handoff.confirmed,false);const sent=submissions().slice(start);assert.equal(sent.length,1);
        assert.match(sent[0].input.uiMessage.text.body,/Não consegui confirmar o encaminhamento/);assert.doesNotMatch(sent[0].input.uiMessage.text.body,/Atendimento humano solicitado/);
      }finally{await f.runtime.db.sql('DROP TRIGGER synthetic_intake_outbox_reject ON outbox_messages; DROP FUNCTION synthetic_intake_outbox_reject();');}
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.ok(submissions().every(event=>event.result.status==='queued'));
  }finally{await f.close();}
});
