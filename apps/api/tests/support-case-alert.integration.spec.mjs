// Criterion-derived SQL/inbox/outbox/local-transport proof. Never a live Meta send.
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('HUM-10 one durable private staff alert per canonical creation episode',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const recipient='+5511999999999',unknownRecipient='+5511999999998';
  const f=await createHandoffFixture({provider:'META_CLOUD',whatsapp:{operatorOutcomesByRecipient:{[recipient.slice(1)]:{status:'sent',messageId:'synthetic-staff-alert-accepted'},[unknownRecipient.slice(1)]:{status:'unknown',messageId:''}}}});
  try{
    const {persistWhatsAppSupportIntake}=await import('../dist/modules/support/application/whatsapp-support-intake.js');
    const {staffAlertId,STAFF_ALERT_REQUESTED}=await import('../dist/modules/support/domain/support-case-alert.js');
    const {SupportCaseAlertDeliveryService}=await import('../dist/modules/support/application/services/support-case-alert-delivery.service.js');
    const prefix='support_case_alert:',captured=()=>f.runtime.whatsapp.events().filter(e=>e.kind==='sendText'&&e.input.correlationId?.startsWith(prefix));
    const wait=async(work,label)=>{const end=Date.now()+15_000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};
    // Canonical owned precondition, before activating fake local credentials.
    // Background approval work stays inactive; the monitor and network trap do not change.
    const {PrismaRecoveryTemplateLifecycleRepository}=await import('../dist/modules/whatsapp-templates/infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js');
    const {WHATSAPP_TEMPLATE_TYPES}=await import('../dist/modules/whatsapp-templates/domain/catalog/template-types.js');
    const initializer=new PrismaRecoveryTemplateLifecycleRepository(f.raw);
    for(const actor of [f.owner,f.products])for(const type of WHATSAPP_TEMPLATE_TYPES)await initializer.ensure(actor.merchantId,type);
    const templateScope={merchantId:{in:[f.owner.merchantId,f.products.merchantId]},type:{in:[...WHATSAPP_TEMPLATE_TYPES]},channel:'whatsapp'};
    await f.raw.postSaleMessageTemplate.updateMany({where:templateScope,data:{isActive:false,metaNextCheckAt:null}});
    assert.equal(await f.raw.postSaleMessageTemplate.count({where:templateScope}),WHATSAPP_TEMPLATE_TYPES.length*2);
    assert.equal(await f.raw.postSaleMessageTemplate.count({where:{...templateScope,isActive:true}}),0);
    for(const actor of [f.owner,f.products])await f.raw.whatsAppChannelConfig.update({where:{id:actor.merchantId+'-config'},data:{credentials:{phoneNumberId:f.metaPhoneNumberId(actor),wabaId:'90001999',accessToken:'synthetic-staff-alert-token'}}});
    const seedWindow=async(actor,phone=recipient)=>{
      const current=await f.raw.whatsAppChannelConfig.findUniqueOrThrow({where:{id:actor.merchantId+'-config'}});
      const id=randomUUID(),body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:current.credentials.phoneNumberId},messages:[{id,from:phone.slice(1),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Falar com atendente'}}]}}]}]});
      const response=await fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body});
      assert.equal(response.status,200);await response.body?.cancel();
      await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:id}});assert.ok(!row||!['dead','blocked'].includes(row.status));return row?.status==='processed';},'staff recipient authenticated window');
    };
    const input=async(value,origin='text')=>{
      const id=randomUUID(),leaseToken=randomUUID(),payload={merchantId:value.actor.merchantId,deviceId:value.session.deviceId,provider:'META_CLOUD',fromNumber:value.session.buyerPhone,timestamp:Date.now(),body:'Sensitive customer detail must stay only in ticket',ignored:false};
      await f.raw.whatsAppWebhookInbox.create({data:{id,dedupKey:id,eventId:id,kind:'message',merchantId:value.actor.merchantId,configId:value.scope.configId,deviceId:value.session.deviceId,streamKey:createHash('sha256').update(id).digest('hex'),payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),status:'processing',leaseToken,leaseExpiresAt:new Date(Date.now()+60_000)}});
      return{scope:value.scope,inboxId:id,leaseToken,message:payload.body,origin};
    };
    // Construct the existing canonical repository; no new route/body authority.
    const {PrismaWhatsAppHandoffRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js');
    const bindings=new PrismaWhatsAppHandoffRepository(f.scoped);
    const run=(value,args)=>f.as(value.actor,()=>persistWhatsAppSupportIntake(bindings,args));
    const terminal=async id=>wait(async()=>{const row=await f.raw.whatsAppDelivery.findUnique({where:{id}});return row&& !['queued','preparing','started'].includes(row.state)?row:undefined;},'staff alert terminal state');
    const setRecipient=(actor,phone)=>f.raw.supportNotificationSetting.update({where:{merchantId:actor.merchantId},data:{fallbackWhatsapp:phone,version:{increment:1}}});
    const deferred=async(actor,suffix)=>{
      await f.runtime.db.sql("CREATE FUNCTION synthetic_defer_staff_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='whatsapp.support.case_alert.requested' THEN NEW.next_attempt_at=clock_timestamp()+interval '7 days'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_defer_staff_alert BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_defer_staff_alert();");
      try{const value=await f.thread(actor,suffix),args=await input(value),result=await run(value,args),id=staffAlertId(actor.merchantId,result.ticketId,1);
        const event=await f.raw.outboxMessage.findFirstOrThrow({where:{eventType:STAFF_ALERT_REQUESTED,correlationId:id}});return{value,args,result,id,event};
      }finally{await f.runtime.db.sql('DROP TRIGGER synthetic_defer_staff_alert ON outbox_messages; DROP FUNCTION synthetic_defer_staff_alert();');}
    };
    const release=async value=>{await f.raw.outboxMessage.update({where:{eventId:value.event.eventId},data:{nextAttemptAt:new Date()}});return terminal(value.id);};
    await seedWindow(f.owner);await seedWindow(f.products);
    for(const actor of [f.owner,f.products])await f.raw.supportNotificationSetting.create({data:{merchantId:actor.merchantId,fallbackWhatsapp:recipient}});
    let first,command,receipt;
    await t.test('new canonical intake commits one private receipt/event and submits minimal notice to configured recipient',async()=>{
      first=await f.thread(f.owner,'staff-alert');command=await input(first);const before=await f.raw.checkoutSession.findUnique({where:{merchantId_sessionId:{merchantId:f.owner.merchantId,sessionId:first.session.checkoutSessionId}}});
      const result=await run(first,command);assert.equal(result.created,true);receipt=staffAlertId(f.owner.merchantId,result.ticketId,result.binding.epoch);
      const row=await terminal(receipt);assert.equal(row.state,'accepted');assert.equal(row.response.delivery.status,'accepted');assert.equal(row.response.authority.recipient,recipient);assert.equal(row.response.authority.creationEpoch,1);
      const sends=captured().filter(e=>e.input.correlationId===receipt);assert.equal(sends.length,1);assert.equal(sends[0].input.toNumber,recipient);assert.equal(sends[0].input.deviceId,first.session.deviceId);
      assert.match(sends[0].input.text,/#whatsapp-seller\?tab=conversations&ticketId=/);assert.doesNotMatch(sends[0].input.text,/Sensitive|customer|buyer|token/);assert.equal(sends[0].input.text.includes(first.session.buyerPhone),false);assert.equal(sends[0].input.text.includes(recipient),false);
      assert.equal(await f.raw.outboxMessage.count({where:{eventType:STAFF_ALERT_REQUESTED,correlationId:receipt}}),1);assert.deepEqual(await f.raw.checkoutSession.findUnique({where:{merchantId_sessionId:{merchantId:f.owner.merchantId,sessionId:first.session.checkoutSessionId}}}),before);
    });
    await t.test('replayed and competing active text/button/voice intake cannot create a second episode alert',async()=>{
      const before=captured().length;const results=await Promise.all([run(first,command),run(first,await input(first,'button')),run(first,await input(first,'voice'))]);
      for(const result of results)assert.equal(result.created,false);assert.equal(await f.raw.whatsAppDelivery.count({where:{id:receipt}}),1);assert.equal(await f.raw.outboxMessage.count({where:{eventType:STAFF_ALERT_REQUESTED,correlationId:receipt}}),1);assert.equal(captured().length,before);
    });
    await t.test('delivery receipt settles only original account/recipient and is monotonic without another request',async()=>{
      const row=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:receipt}}),config=await f.raw.whatsAppChannelConfig.findUniqueOrThrow({where:{id:row.configId}}),service=new SupportCaseAlertDeliveryService(f.scoped,f.contexts),count=captured().length;
      assert.equal(await service.reconcileMeta(config,f.metaPhoneNumberId(f.owner),{id:row.providerMessageId,status:'read',recipient_id:'5511999998888',biz_opaque_callback_data:receipt}),false);
      assert.equal(await service.reconcileMeta(config,f.metaPhoneNumberId(f.owner),{id:row.providerMessageId,status:'read',recipient_id:recipient.slice(1),biz_opaque_callback_data:receipt}),true);
      const read=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:receipt}});assert.equal(read.state,'read');
      await service.reconcileMeta(config,f.metaPhoneNumberId(f.owner),{id:row.providerMessageId,status:'sent',recipient_id:recipient.slice(1),biz_opaque_callback_data:receipt});assert.deepEqual(await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:receipt}}),read);assert.equal(captured().length,count);
    });
    await t.test('another business mode has its own canonical episode and destination authority',async()=>{
      const value=await f.thread(f.products,'staff-products'),result=await run(value,await input(value)),id=staffAlertId(f.products.merchantId,result.ticketId,1);assert.notEqual(id,receipt);assert.equal((await terminal(id)).state,'accepted');assert.equal(captured().filter(e=>e.input.correlationId===id).length,1);
    });
    await t.test('missing recipient is durably unavailable without borrowing company phone or changing the ticket',async()=>{
      await f.raw.supportNotificationSetting.update({where:{merchantId:f.owner.merchantId},data:{fallbackWhatsapp:null,version:{increment:1}}});
      const value=await f.thread(f.owner,'staff-missing'),result=await run(value,await input(value)),id=staffAlertId(f.owner.merchantId,result.ticketId,1);assert.equal((await terminal(id)).state,'unavailable');assert.equal(captured().filter(e=>e.input.correlationId===id).length,0);assert.equal((await f.raw.supportTicket.findUniqueOrThrow({where:{id:result.ticketId}})).status,'open');
    });
    await t.test('uncertain provider acceptance retains one immutable attempt and never resends on incoming replay',async()=>{
      await seedWindow(f.owner,unknownRecipient);await setRecipient(f.owner,unknownRecipient);
      const value=await f.thread(f.owner,'staff-unknown'),args=await input(value),result=await run(value,args),id=staffAlertId(f.owner.merchantId,result.ticketId,1),row=await terminal(id);
      assert.equal(row.state,'unknown');assert.equal(row.response.submission.requestInvoked,true);assert.equal(captured().filter(e=>e.input.correlationId===id).length,1);
      await run(value,args);await run(value,await input(value,'voice'));assert.deepEqual(await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id}}),row);assert.equal(captured().filter(e=>e.input.correlationId===id).length,1);
      assert.equal((await f.raw.supportTicket.findUniqueOrThrow({where:{id:result.ticketId}})).status,'open');
    });
    await t.test('a cleared or changed setting before dispatch does not retarget the original queued alert',async()=>{
      await setRecipient(f.owner,recipient);const value=await deferred(f.owner,'staff-setting-change');await setRecipient(f.owner,unknownRecipient);
      const row=await release(value);assert.equal(row.state,'unavailable');assert.equal(row.response.authority.recipient,recipient);assert.equal(captured().filter(e=>e.input.correlationId===value.id).length,0);assert.equal((await f.raw.supportTicket.findUniqueOrThrow({where:{id:value.result.ticketId}})).status,'open');
    });
    for(const phase of ['preparing','started'])await t.test('recovery from durable '+phase+' records unknown without another physical request',async()=>{
      await setRecipient(f.owner,recipient);const value=await deferred(f.owner,'staff-recovery-'+phase),original=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.id}});
      await f.raw.whatsAppDelivery.update({where:{id:value.id},data:{state:phase,processingToken:'synthetic-abandoned-attempt'}});
      const row=await release(value);assert.equal(row.state,'unknown');assert.deepEqual(row.response.authority,original.response.authority);assert.equal(captured().filter(e=>e.input.correlationId===value.id).length,0);
    });
    await t.test('another tenant recipient window and inactive template cannot authorize a staff send',async()=>{
      const isolatedRecipient='+5531999999999';await seedWindow(f.products,isolatedRecipient);await setRecipient(f.owner,isolatedRecipient);
      const value=await f.thread(f.owner,'staff-other-window'),result=await run(value,await input(value)),id=staffAlertId(f.owner.merchantId,result.ticketId,1);
      assert.equal((await terminal(id)).state,'unavailable');assert.equal(captured().filter(e=>e.input.correlationId===id).length,0);
    });
    await t.test('a closed case loses unsent alert authority without reopening its ticket',async()=>{
      await setRecipient(f.owner,recipient);const value=await deferred(f.owner,'staff-closed');await f.raw.supportTicket.update({where:{id:value.result.ticketId},data:{status:'closed'}});
      assert.equal((await release(value)).state,'unavailable');assert.equal((await f.raw.supportTicket.findUniqueOrThrow({where:{id:value.result.ticketId}})).status,'closed');assert.equal(captured().filter(e=>e.input.correlationId===value.id).length,0);
    });
    await t.test('claim epoch progression does not replace the frozen creation identity or duplicate its alert',async()=>{
      await setRecipient(f.owner,recipient);const value=await deferred(f.owner,'staff-claimed');
      // Existing actual claim HTTP tests retain the actor/auth proof. This SQL
      // precondition isolates the alert's response to the canonical post-claim state.
      await f.raw.$transaction([f.raw.whatsAppHandoffBinding.update({where:{id:value.result.binding.id},data:{mode:'human',epoch:2,assignedOperatorId:'synthetic-existing-operator'}}),f.raw.supportTicket.update({where:{id:value.result.ticketId},data:{status:'in_progress',assignedTo:'synthetic-existing-operator'}})]);
      const row=await release(value);assert.equal(row.state,'accepted');assert.equal(row.response.authority.creationEpoch,1);assert.equal(await f.raw.outboxMessage.count({where:{eventType:STAFF_ALERT_REQUESTED,correlationId:value.id}}),1);assert.equal(captured().filter(e=>e.input.correlationId===value.id).length,1);
    });
    await t.test('credential rotation invalidates an unsent intent but historical same-account receipt still settles its original attempt',async()=>{
      await setRecipient(f.owner,recipient);const value=await deferred(f.owner,'staff-credentials'),config=await f.raw.whatsAppChannelConfig.findUniqueOrThrow({where:{id:value.value.scope.configId}}),rotated={...config,credentials:{...config.credentials,accessToken:'synthetic-rotated-token'}};
      await f.raw.whatsAppChannelConfig.update({where:{id:config.id},data:{credentials:rotated.credentials}});
      assert.equal((await release(value)).state,'unavailable');assert.equal(captured().filter(e=>e.input.correlationId===value.id).length,0);
      const original=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:receipt}}),service=new SupportCaseAlertDeliveryService(f.scoped,f.contexts);
      assert.equal(await service.reconcileMeta(rotated,f.metaPhoneNumberId(f.owner),{id:original.providerMessageId,status:'read',recipient_id:recipient.slice(1),biz_opaque_callback_data:receipt}),true);
    });
    await t.test('atomic alert persistence failure rolls back the new case and binding',async()=>{
      await f.runtime.db.sql("CREATE FUNCTION synthetic_fail_staff_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id LIKE 'support_case_alert:%' THEN RAISE EXCEPTION 'synthetic_staff_alert_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_fail_staff_alert BEFORE INSERT ON whatsapp_deliveries FOR EACH ROW EXECUTE FUNCTION synthetic_fail_staff_alert();");
      try{const value=await f.thread(f.owner,'staff-rollback'),args=await input(value);await assert.rejects(run(value,args),/synthetic_staff_alert_failure/);assert.equal(await f.raw.supportTicket.count({where:{sessionId:value.session.id}}),0);assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:value.session.id}}),0);}finally{await f.runtime.db.sql('DROP TRIGGER synthetic_fail_staff_alert ON whatsapp_deliveries; DROP FUNCTION synthetic_fail_staff_alert();');}
    });
    await t.test('F100-3 inert legacy Twilio SID cannot poison a Meta original receipt account',async()=>{
      await setRecipient(f.owner,recipient);const raw=await f.raw.whatsAppChannelConfig.findUniqueOrThrow({where:{id:f.owner.merchantId+'-config'}});
      const config=await f.raw.whatsAppChannelConfig.update({where:{id:raw.id},data:{credentials:{...raw.credentials,accountSid:'AC'+'a'.repeat(32)}}});
      const value=await f.thread(f.owner,'staff-meta-legacy-sid'),result=await run(value,await input(value)),id=staffAlertId(f.owner.merchantId,result.ticketId,1),row=await terminal(id);
      assert.equal(row.state,'accepted');assert.equal(row.response.authority.providerAccountId,f.metaPhoneNumberId(f.owner));assert.equal(row.response.submission.providerAccountId,f.metaPhoneNumberId(f.owner));
      const service=new SupportCaseAlertDeliveryService(f.scoped,f.contexts),status={id:row.providerMessageId,status:'read',recipient_id:recipient.slice(1),biz_opaque_callback_data:id};
      assert.equal(await service.reconcileMeta(config,'90009999',status),false);assert.equal(await service.reconcileMeta(config,f.metaPhoneNumberId(f.owner),{...status,recipient_id:'5511999990000'}),false);
      assert.equal(await service.reconcileMeta(config,f.metaPhoneNumberId(f.owner),{...status,biz_opaque_callback_data:'support_case_alert:'+'f'.repeat(64)}),false);
      assert.equal(await service.reconcileMeta(config,f.metaPhoneNumberId(f.owner),status),true);assert.equal((await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id}})).state,'read');assert.equal(captured().filter(e=>e.input.correlationId===id).length,1);
    });
    await t.test('F100-1 a signed fallback inbound on A cannot open account B, while a new signed B window can',async()=>{
      await setRecipient(f.owner,recipient);const old=await f.raw.whatsAppChannelConfig.findUniqueOrThrow({where:{id:f.owner.merchantId+'-config'}}),accountB='90001009';
      await f.raw.whatsAppChannelConfig.update({where:{id:old.id},data:{credentials:{...old.credentials,phoneNumberId:accountB}}});
      const before=await f.thread(f.owner,'staff-account-b-with-window-a'),first=await run(before,await input(before)),firstId=staffAlertId(f.owner.merchantId,first.ticketId,1);
      assert.equal((await terminal(firstId)).state,'unavailable');assert.equal(captured().filter(e=>e.input.correlationId===firstId).length,0);
      await seedWindow(f.owner,recipient);
      const after=await f.thread(f.owner,'staff-account-b-with-window-b'),second=await run(after,await input(after)),secondId=staffAlertId(f.owner.merchantId,second.ticketId,1),row=await terminal(secondId);
      assert.equal(row.state,'accepted');assert.equal(row.response.authority.accountId,accountB);assert.equal(row.response.submission.providerAccountId,accountB);assert.equal(captured().filter(e=>e.input.correlationId===secondId).length,1);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
  }finally{await f.close();}
});
