import assert from 'node:assert/strict';
import test from 'node:test';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T50',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHandoffFixture({provider:'META_CLOUD',whatsapp:{voiceTranscripts:{'12345':'Quero adicionar outro produto'}}});
  try{
    const sent=()=>f.runtime.whatsapp.events().filter(event=>['sendText','sendMedia'].includes(event.kind));
    const interpreted=()=>f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret');
    const originals=new Map();
    const message=(value,id,kind='text',body='Mais informações para o atendente')=>{
      if(originals.has(id))return structuredClone(originals.get(id));
      const payload={entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:f.metaPhoneNumberId(value.actor)},messages:[{
        id,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:kind,
        ...(kind==='text'?{text:{body}}:kind==='interactive'?{interactive:{button_reply:{id:'zyon:'+'a'.repeat(32),title:body}}}:{audio:{id:body,mime_type:'audio/ogg'}}),
      }]}}]}]};originals.set(id,structuredClone(payload));return payload;
    };
    const post=async payload=>{const body=JSON.stringify(payload);return fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body,signal:AbortSignal.timeout(15_000)});};
    const wait=async(predicate,label)=>{const end=Date.now()+15_000;do{const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);assert.fail(label);};
    const processed=id=>wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:id}});if(row&&['dead','blocked'].includes(row.status))assert.fail(row.lastError);return row?.status==='processed'?row:undefined;},'input not processed '+id);
    const waiting=await f.thread(f.owner,'waiting'),human=await f.thread(f.products,'human');
    const setup=async value=>{const ticket=await f.ticket(value,'active-'+value.session.id);const result=await f.as(value.actor,()=>f.repo.begin(value.scope,ticket.id,0));return result.state;};
    const one=await setup(waiting),two=await setup(human);
    // Identified human-state fixture. T52 separately proves authenticated claim.
    await f.raw.whatsAppHandoffBinding.update({where:{id:two.id},data:{mode:'human',epoch:2,assignedOperatorId:'synthetic-operator'}});
    // Identified historical commerce fixtures, not financial/booking admission.
    // Incoming human messages must preserve existing state, not only zero rows.
    await f.raw.paymentIntent.create({data:{id:'router-existing-payment',merchantId:f.owner.merchantId,sessionId:waiting.session.checkoutSessionId,
      idempotencyKey:'router-existing-payment',amountCents:5000,currency:'BRL',method:'pix',status:'pending',providerPaymentId:'synthetic-existing-payment'}});
    await f.raw.product.create({data:{id:'router-existing-service',merchantId:f.owner.merchantId,name:'Synthetic existing service',type:'service',
      variants:{create:{id:'router-existing-variant',sku:'router-existing-variant',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}}});
    await f.raw.serviceProfessional.create({data:{id:'router-existing-professional',merchantId:f.owner.merchantId,publicName:'Synthetic professional',timeZone:'UTC'}});
    await f.raw.professionalService.create({data:{merchantId:f.owner.merchantId,professionalId:'router-existing-professional',productId:'router-existing-service'}});
    await f.raw.serviceAppointment.create({data:{id:'router-existing-appointment',merchantId:f.owner.merchantId,professionalId:'router-existing-professional',productId:'router-existing-service',variantId:'router-existing-variant',
      buyerGlobalUserId:'synthetic-buyer-'+f.owner.merchantId,customerSnapshot:{name:'Synthetic buyer'},startsAt:new Date('2030-01-01T10:00:00Z'),endsAt:new Date('2030-01-01T10:30:00Z'),timeZone:'UTC',durationMinutes:30,
      priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{paymentMode:'at_attendance',holdEnabled:false},origin:'manual',operationalStatus:'scheduled',confirmedAt:new Date('2029-12-01T10:00:00Z'),idempotencyKey:'router-existing-appointment',requestFingerprint:'synthetic-router-existing'}});
    const commerce=async value=>({checkout:await f.raw.checkoutSession.findFirst({where:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}}),
      state:(await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}})).conversationState,
      postSale:(await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}})).postSaleContext,
      payments:await f.raw.paymentIntent.findMany({orderBy:{id:'asc'}}),appointments:await f.raw.serviceAppointment.findMany({orderBy:{id:'asc'}}),nps:await f.raw.npsResponse.count(),usage:await f.raw.aiUsageEvent.count()});
    const beforeWaiting=await commerce(waiting),beforeHuman=await commerce(human);
    await t.test('waiting and claimed conversations persist exact text only to their authenticated ticket with no response',async()=>{
      for(const[value,id,epoch,ticket]of [[waiting,'waiting-text',1,one.ticketId],[human,'human-text',2,two.ticketId]]){
        const body='Mensagem integral para a equipe '+value.actor.merchantId;
        assert.equal((await post(message(value,id,'text',body))).status,200);const inbox=await processed(id);
        const rows=await f.raw.supportTicketMessage.findMany({where:{ticketId:ticket}});assert.equal(rows.length,1);assert.equal(rows[0].content,body);
        assert.deepEqual(rows[0].metadata,{kind:'whatsapp_incoming',schemaVersion:1,configId:value.scope.configId,whatsappSessionId:value.session.id,inboxId:inbox.id,origin:'text',bindingId:value===waiting?one.id:two.id,epoch});
        assert.equal(inbox.responseState.purpose,'human_received');assert.equal(inbox.responseState.phase,'complete');assert.equal(inbox.responseState.receipt.messageId,rows[0].id);assert.equal(inbox.responseState.receipt.epoch,epoch);
        const events=await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'support.case.changed'}});
        assert.equal(events.filter(event=>event.payload.messageId===rows[0].id&&event.payload.event==='message').length,1);
      }
      assert.deepEqual(sent(),[]);assert.deepEqual(interpreted(),[]);assert.deepEqual(await commerce(waiting),beforeWaiting);assert.deepEqual(await commerce(human),beforeHuman);
    });
    await t.test('exact webhook duplicates do not append messages/events and conflicting replay cannot replace the input',async()=>{
      const count=await f.raw.supportTicketMessage.count(),events=await f.raw.outboxMessage.count();
      assert.equal((await post(message(waiting,'waiting-text'))).status,200);await processed('waiting-text');
      const changed=message(waiting,'waiting-text');changed.entry[0].changes[0].value.messages[0].text.body='Do not overwrite the original';assert.equal((await post(changed)).status,409);
      assert.equal(await f.raw.supportTicketMessage.count(),count);assert.equal(await f.raw.outboxMessage.count(),events);assert.deepEqual(sent(),[]);
    });
    await t.test('raw voice references and old cart buttons reach the person without ASR, post-sale or cart actions',async()=>{
      assert.equal((await post(message(waiting,'waiting-audio','audio','12345'))).status,200);const voice=await processed('waiting-audio');
      const row=await f.raw.supportTicketMessage.findFirst({where:{metadata:{path:['inboxId'],equals:voice.id}}});
      assert.equal(row.content,'Enviei um anexo para ajudar na compra');assert.equal(row.metadata.origin,'media');assert.deepEqual(row.metadata.media,{inboxId:voice.id});assert.equal(voice.payload.metaMedia.id,'12345');
      assert.equal((await post(message(human,'human-old-button','interactive','Adicionar ao carrinho'))).status,200);const button=await processed('human-old-button');
      const saved=await f.raw.supportTicketMessage.findFirst({where:{metadata:{path:['inboxId'],equals:button.id}}});assert.equal(saved.content,'Adicionar ao carrinho');assert.equal(saved.metadata.origin,'button');
      assert.deepEqual(sent(),[]);assert.deepEqual(interpreted(),[]);assert.deepEqual(await commerce(waiting),beforeWaiting);assert.deepEqual(await commerce(human),beforeHuman);
    });
    await t.test('long authenticated text is retained without the outgoing operator message limit',async()=>{
      const body='a'.repeat(15_500);assert.equal((await post(message(waiting,'waiting-long','text',body))).status,200);const inbox=await processed('waiting-long');
      assert.equal((await f.raw.supportTicketMessage.findFirst({where:{metadata:{path:['inboxId'],equals:inbox.id}}})).content,body);assert.deepEqual(sent(),[]);
    });
    await t.test('an actual outbox rejection rolls back the message and retains the original durable input for retry',async()=>{
      const before=await f.raw.supportTicketMessage.count(),id='waiting-outbox-failure';
      await f.runtime.db.sql("CREATE FUNCTION synthetic_router_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='support.case.changed' THEN RAISE EXCEPTION 'synthetic_router_rejected'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_router_reject BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_router_reject();");
      try{
        assert.equal((await post(message(waiting,id,'text','Conteúdo que deve permanecer registrado'))).status,200);
        const inbox=await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:id}});return row?.status==='pending'&&row.attempts===1?row:undefined;},'failed input not retained');
        assert.equal(inbox.payload.body,'Conteúdo que deve permanecer registrado');assert.equal(inbox.responseState,null);assert.equal(await f.raw.supportTicketMessage.count(),before);assert.deepEqual(sent(),[]);assert.deepEqual(await commerce(waiting),beforeWaiting);
      }finally{await f.runtime.db.sql('DROP TRIGGER synthetic_router_reject ON outbox_messages; DROP FUNCTION synthetic_router_reject();');}
      await f.raw.whatsAppWebhookInbox.updateMany({where:{eventId:id},data:{availableAt:new Date(0)}});const recovered=await processed(id);
      assert.equal(recovered.attempts,2);assert.equal(await f.raw.supportTicketMessage.count(),before+1);assert.deepEqual(sent(),[]);
    });
    await t.test('restart replay after close cannot regenerate or reassign an already captured input to a new epoch',async()=>{
      const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:'waiting-text'}}),count=await f.raw.supportTicketMessage.count();
      // Identified lifecycle fixture; T56 supplies the public close command.
      await f.raw.$transaction(async tx=>{await tx.supportTicket.update({where:{id:one.ticketId},data:{status:'closed'}});await tx.whatsAppHandoffBinding.update({where:{id:one.id},data:{mode:'ai',epoch:2,ticketId:null,assignedOperatorId:null}});await tx.whatsAppWebhookInbox.update({where:{id:row.id},data:{status:'pending',processedAt:null,availableAt:new Date(0)}});});
      const replay=await processed('waiting-text');assert.equal(replay.attempts,2);assert.equal(replay.responseState.receipt.epoch,1);assert.equal(replay.responseState.receipt.ticketId,one.ticketId);
      assert.equal(await f.raw.supportTicketMessage.count(),count);assert.deepEqual(sent(),[]);assert.deepEqual(interpreted(),[]);assert.deepEqual(await commerce(waiting),beforeWaiting);
    });
    await t.test('an old initial notice is consumed after takeover instead of resuming against a newer binding epoch',async()=>{
      const value=await f.thread(f.owner,'old-initial'),payload=message(value,'old-initial-input','text','Quero falar com atendente');assert.equal((await post(payload)).status,200);const inbox=await processed('old-initial-input');
      const binding=await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:value.session.id}}),count=sent().length,rows=await f.raw.supportTicketMessage.count();assert.equal(count,1);
      await f.raw.whatsAppHandoffBinding.update({where:{id:binding.id},data:{mode:'human',epoch:binding.epoch+1,assignedOperatorId:'synthetic-operator'}});
      await f.raw.whatsAppWebhookInbox.update({where:{id:inbox.id},data:{status:'pending',processedAt:null,availableAt:new Date(0),responseState:{...inbox.responseState,phase:'prepared',sent:[]}}});
      const retry=await processed('old-initial-input');assert.equal(retry.responseState.purpose,'human_received');assert.equal(retry.responseState.receipt.epoch,1);assert.equal(sent().length,count);assert.equal(await f.raw.supportTicketMessage.count(),rows);
    });
    await t.test('an uncertain old handoff notice never adopts a later ticket or pays to reinterpret its input',async()=>{
      const value=await f.thread(f.owner,'uncertain-notice');
      await f.runtime.db.sql("CREATE FUNCTION synthetic_notice_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='support.case.changed' THEN RAISE EXCEPTION 'synthetic_notice_rejected'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_notice_reject BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_notice_reject();");
      let inbox;
      try{
        assert.equal((await post(message(value,'uncertain-notice-input','text','Quero falar com atendente'))).status,200);inbox=await processed('uncertain-notice-input');
        assert.equal(inbox.responseState.handoff.confirmed,false);
      }finally{await f.runtime.db.sql('DROP TRIGGER synthetic_notice_reject ON outbox_messages; DROP FUNCTION synthetic_notice_reject();');}
      const later=await setup(value),count=sent().length;
      await f.raw.whatsAppWebhookInbox.update({where:{id:inbox.id},data:{status:'pending',processedAt:null,availableAt:new Date(0),responseState:{...inbox.responseState,phase:'prepared',sent:[]}}});
      const retry=await processed('uncertain-notice-input');assert.equal(retry.responseState.purpose,'human_received');
      assert.deepEqual(retry.responseState.receipt,{inboxId:inbox.id,sessionId:value.session.id,bindingId:null,ticketId:null,epoch:null});
      assert.equal(await f.raw.supportTicketMessage.count({where:{ticketId:later.ticketId}}),0);assert.equal(sent().length,count);assert.deepEqual(interpreted(),[]);
    });
    await t.test('legacy BubbleWhats human input is acknowledged internally without a fabricated outgoing delivery',async()=>{
      const value=await f.thread(f.products,'legacy'),deviceId='synthetic-bubble-device',secret='synthetic-bubble-secret';
      await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{provider:'BUBBLEWHATS',deviceId,webhookSecret:secret}});
      await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{deviceId}});value.session.deviceId=deviceId;value.routeInput.deviceId=deviceId;
      const binding=await setup(value),payload={id:'legacy-human-message',deviceID:deviceId,fromNumber:value.session.buyerPhone,isGroup:false,timestamp:Date.now(),messageType:'audio',body:'Mensagem de voz para o atendente',url:'https://example.invalid/synthetic.ogg',mimetype:'audio/ogg'};
      const request=()=>fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/bubblewhats/messages',{method:'POST',headers:{'content-type':'application/json','x-webhook-secret':secret},body:JSON.stringify(payload),signal:AbortSignal.timeout(15_000)});
      const count=sent().length;assert.equal((await request()).status,200);const inbox=await processed(payload.id),delivery=await f.raw.whatsAppDelivery.findUnique({where:{id:inbox.id}});
      assert.equal(delivery.state,'acknowledged');assert.equal(delivery.providerMessageId,null);assert.equal(delivery.response.purpose,'human_received');assert.equal(delivery.response.receipt.ticketId,binding.ticketId);
      const row=await f.raw.supportTicketMessage.findFirst({where:{ticketId:binding.ticketId}});assert.equal(row.content,payload.body);assert.equal(row.metadata.origin,'media');assert.deepEqual(row.metadata.media,{inboxId:inbox.id});
      assert.equal((await request()).status,200);assert.equal(await f.raw.supportTicketMessage.count({where:{ticketId:binding.ticketId}}),1);assert.equal(sent().length,count);assert.deepEqual(interpreted(),[]);
      await f.raw.whatsAppWebhookInbox.update({where:{id:inbox.id},data:{status:'pending',processedAt:null,availableAt:new Date(0)}});await processed(payload.id);
      assert.equal((await f.raw.whatsAppDelivery.findUnique({where:{id:inbox.id}})).state,'acknowledged');assert.equal(sent().length,count);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(await f.raw.aiUsageEvent.count(),0);
  }finally{await f.close();}
});
