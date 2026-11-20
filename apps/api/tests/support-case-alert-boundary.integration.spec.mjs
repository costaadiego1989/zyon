import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

// Actual owned SQL/claim/consumer and last-start boundary. Authentication is
// covered by the AppModule companion, not fabricated by these fixture rows.
test('HUM-10 last request boundary retains the original durable staff authority',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const [{TenantContextService},{registerTenantMiddleware},{PrismaWhatsAppHandoffRepository},{persistWhatsAppSupportIntake},
      {PrismaOutboxRepository},{InMemoryDomainEventBus},{SupportCaseAlertConsumer},{ManageSupportNotificationSettingsUseCase},submission]=await Promise.all([
      import('../dist/shared/tenant/tenant-context.service.js'),import('../dist/shared/persistence/tenant.middleware.js'),
      import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js'),
      import('../dist/modules/support/application/whatsapp-support-intake.js'),import('../dist/shared/messaging/infrastructure/prisma-outbox.repository.js'),
      import('../dist/shared/events/in-memory-domain-event-bus.js'),import('../dist/modules/support/application/services/support-case-alert.consumer.js'),
      import('../dist/modules/support/application/manage-support-notification-settings.use-case.js'),import('../dist/shared/whatsapp/whatsapp-automation-context.js')]);
    const contexts=new TenantContextService(),scoped=registerTenantMiddleware(f.raw,contexts),bindings=new PrismaWhatsAppHandoffRepository(scoped),outbox=new PrismaOutboxRepository(f.raw),events=new InMemoryDomainEventBus();
    const make=async()=>{
      const key=randomUUID(),merchantId='staff-boundary-'+key,configId='staff-config-'+key,deviceId='META_CLOUD:'+configId,phone='+5511999999988',buyerPhone='5511999998877';
      const actor={merchantId,userId:'synthetic-background-test',role:'owner'};
      await f.raw.merchant.create({data:{id:merchantId,name:'Synthetic staff company',businessMode:'services',businessModeSelectedAt:new Date()}});
      const config=await f.raw.whatsAppChannelConfig.create({data:{id:configId,merchantId,provider:'META_CLOUD',deviceId,enabled:true,status:'ACTIVE',credentials:{phoneNumberId:'90001001',wabaId:'90001999',accessToken:'synthetic-boundary-secret'}}});
      await f.raw.supportNotificationSetting.create({data:{merchantId,fallbackWhatsapp:phone}});
      await f.raw.buyerIdentity.create({data:{merchantId,identityKey:'phone:'+buyerPhone,globalUserId:'synthetic-buyer-'+key}});
      const session=await f.raw.whatsAppSession.create({data:{merchantId,deviceId,buyerPhone,conversationState:{version:1,conversationId:'conversation-'+key,revision:'revision-'+key}}}),id=randomUUID(),leaseToken=randomUUID();
      const payload={merchantId,deviceId,provider:'META_CLOUD',fromNumber:buyerPhone,timestamp:Date.now(),ignored:false};
      await f.raw.whatsAppWebhookInbox.create({data:{id,dedupKey:id,eventId:id,merchantId,configId,deviceId,kind:'message',streamKey:key,payloadHash:key,payload,status:'processing',leaseToken,leaseExpiresAt:new Date(Date.now()+60_000)}});
      const windowId=randomUUID(),streamKey=createHash('sha256').update(JSON.stringify([merchantId,configId,'message',phone.slice(1)])).digest('hex');
      await f.raw.whatsAppWebhookInbox.create({data:{id:windowId,dedupKey:windowId,eventId:windowId,merchantId,configId,deviceId,kind:'message',streamKey,payloadHash:windowId,status:'processed',payload:{...payload,fromNumber:phone,authenticatedAccount:{provider:'META_CLOUD',accountId:'90001001'}}}});
      const result=await contexts.run(actor,()=>persistWhatsAppSupportIntake(bindings,{scope:{merchantId,configId,whatsappSessionId:session.id},inboxId:id,leaseToken,message:'Sensitive original customer request',origin:'text'}));
      const claims=await outbox.claimBatch(50),claim=claims.find(value=>value.envelope.event_type==='whatsapp.support.case_alert.requested'&&value.envelope.causation_id===result.ticketId);assert.ok(claim);
      const e=claim.envelope,event={eventId:e.event_id,eventType:e.event_type,merchantId:e.merchant_id,schemaVersion:e.schema_version,correlationId:e.correlation_id,causationId:e.causation_id,payload:e.payload};
      Object.defineProperty(event,'deliveryLeaseToken',{value:claim.leaseToken});
      return{actor,config,session,result,claim,event,id:e.correlation_id,phone};
    };
    const start=async value=>{
      let prepared,release;const ready=new Promise(resolve=>{prepared=resolve;}),gate=new Promise(resolve=>{release=resolve;}),requests=[];
      const sender={sendText:async input=>{const scope=submission.currentWhatsAppSubmissionScope();assert.ok(scope);prepared();await gate;
        return submission.startWhatsAppRequest(scope,async()=>{requests.push(structuredClone(input));return{status:'sent',messageId:'synthetic-boundary-'+randomUUID()};});}};
      const consumer=new SupportCaseAlertConsumer(scoped,bindings,sender,{sendTemplate:async()=>{assert.fail('recipient window must use the original session');}},events,contexts);
      const work=consumer.handle(value.event);await ready;return{consumer,work,release,requests};
    };
    const read=value=>f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.id}});
    await t.test('setting clear after prepare prevents physical start and retains the original recipient evidence',async()=>{
      const value=await make(),running=await start(value),settings=new ManageSupportNotificationSettingsUseCase(scoped,contexts);
      try{await contexts.run(value.actor,()=>settings.save(value.actor.merchantId,{fallbackPhone:null}));}finally{running.release();}
      await running.work;const row=await read(value);assert.equal(row.state,'unavailable');assert.equal(row.response.authority.recipient,value.phone);assert.deepEqual(running.requests,[]);assert.equal((await f.raw.supportTicket.findUniqueOrThrow({where:{id:value.result.ticketId}})).status,'open');
    });
    await t.test('same-account token rotation after prepare cannot replace the captured credential digest',async()=>{
      const value=await make(),running=await start(value);
      try{await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:{...value.config.credentials,accessToken:'synthetic-new-secret'}}});}finally{running.release();}
      await running.work;assert.equal((await read(value)).state,'unavailable');assert.deepEqual(running.requests,[]);
    });
    await t.test('a lease expiring during asynchronous preparation is rechecked with the fresh SQL clock before start',async()=>{
      const value=await make(),running=await start(value);
      try{await f.raw.outboxMessage.update({where:{eventId:value.event.eventId},data:{leaseExpiresAt:new Date(0)}});}finally{running.release();}
      await running.work;assert.equal((await read(value)).state,'unavailable');assert.deepEqual(running.requests,[]);
    });
    await t.test('lost SQL commit after local provider acceptance records unknown and never automatically resends',async()=>{
      const value=await make();
      await f.db.sql("CREATE FUNCTION synthetic_staff_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='started' AND NEW.id LIKE 'support_case_alert:%' THEN RAISE EXCEPTION 'synthetic_staff_commit_failure'; END IF; RETURN NULL; END $$; CREATE CONSTRAINT TRIGGER synthetic_staff_commit_failure AFTER UPDATE ON whatsapp_deliveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_staff_commit_failure();");
      let running;
      try{running=await start(value);running.release();await running.work;}finally{await f.db.sql('DROP TRIGGER synthetic_staff_commit_failure ON whatsapp_deliveries; DROP FUNCTION synthetic_staff_commit_failure();');}
      const row=await read(value);assert.equal(row.state,'unknown');assert.equal(row.response.submission.commitUnknown,true);assert.equal(row.response.submission.requestInvoked,true);assert.equal(running.requests.length,1);
      await running.consumer.handle(value.event);assert.equal(running.requests.length,1);assert.deepEqual(await read(value),row);
    });
    await t.test('ordinary valid submission uses one original attempt without claiming delivery or copying customer text',async()=>{
      const value=await make(),running=await start(value);running.release();await running.work;
      const row=await read(value);assert.equal(row.state,'accepted');assert.equal(row.response.delivery.status,'accepted');assert.equal(row.response.submission.requestInvoked,true);assert.equal(running.requests.length,1);assert.equal(running.requests[0].toNumber,value.phone);assert.doesNotMatch(running.requests[0].text,/Sensitive original customer request/);assert.equal(row.response.authority.creationEpoch,1);
    });
  }finally{await f.close();}
});
