import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

// Actual owned PostgreSQL/canonical queue, request-start, locks and projection.
// This companion does not claim HTTP/provider authentication; the HTTP entry does.
test('T55 original operator receipt settlement on actual PostgreSQL',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createOperatorDeliveryDbFixture();
  try{
    const{WhatsAppSupportDeliveryService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-support-delivery.service.js');
    const{TwilioSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/twilio-sender.adapter.js');
    const service=new WhatsAppSupportDeliveryService(f.scoped,f.contexts);
    const meta=(value,status='read',id='synthetic-meta-receipt',extra={})=>({id,status,biz_opaque_callback_data:value.deliveryId,recipient_id:value.session.buyerPhone,...extra});
    const receipt=(value,status='read',id='synthetic-meta-receipt',extra={})=>service.reconcileMeta(value.config,value.config.credentials.phoneNumberId,meta(value,status,id,extra));
    const snapshot=async value=>({...await f.read(value),events:(await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'support.case.changed'},orderBy:{eventId:'asc'}}))
      .filter(event=>event.payload.messageId===value.message.id).map(({eventId,eventType,payload})=>({eventId,eventType,payload}))});
    const started=async(options={})=>{const value=await f.make(options);let requests=0;
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;return{status:'unknown',messageId:''};}));
      await consumer.handle(value.event);assert.equal(requests,1);return{value,consumer,requests:()=>requests};};

    await t.test('read settles an actual unknown attempt and duplicate/weaker receipts leave all message private and event state unchanged',async()=>{
      const{value,consumer,requests}=await started(),before=await f.preserved(value);
      assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
      assert.equal(await receipt(value),true);
      assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'read',revision:2,providerMessageId:'synthetic-meta-receipt'});
      const settled=await snapshot(value);
      for(const status of ['read','delivered','sent','failed']){assert.equal(await receipt(value,status),true);assert.deepEqual(await snapshot(value),settled);}
      await consumer.handle(value.event);assert.equal(requests(),1);assert.deepEqual(await f.preserved(value),before);
    });
    await t.test('an early authenticated result settles the original request before the SDK response without issuing another request',async()=>{
      const value=await f.make(),began=deferred(),release=deferred();let requests=0;
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;began.resolve();await release.promise;return{status:'unknown',messageId:''};}));
      const running=consumer.handle(value.event);
      try{await began.promise;assert.equal(await receipt(value,'read','synthetic-early-receipt'),true);
        assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'read',revision:1,providerMessageId:'synthetic-early-receipt'});
      }finally{release.resolve();await running;}
      assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'read',revision:1,providerMessageId:'synthetic-early-receipt'});assert.equal(requests,1);
    });
    await t.test('a real deferred COMMIT failure after request start can be reconciled only by the original receipt without a retry',async()=>{
      const value=await f.make();let requests=0,injections=0,insertReturned=false,commitFailed=false;
      assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
      await f.db.sql("CREATE TABLE synthetic_operator_receipt_commit(id TEXT PRIMARY KEY); CREATE FUNCTION synthetic_operator_receipt_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_operator_receipt_commit_rollback'; END $$; CREATE CONSTRAINT TRIGGER synthetic_operator_receipt_commit_rollback AFTER INSERT ON synthetic_operator_receipt_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_operator_receipt_commit_failure();");
      const original=f.bindings.withReadLock.bind(f.bindings),delegating={withReadLock:async(scope,work)=>{
        try{return await original(scope,async(tx,locked)=>{const result=await work(tx,locked);
          if(requests===1&&injections===0&&result?.submission===true){injections++;await tx.$executeRaw`INSERT INTO synthetic_operator_receipt_commit(id) VALUES (${value.message.id})`;insertReturned=true;}
          return result;
        });}catch(error){if(injections===1&&insertReturned){assert.match(String(error)+' '+JSON.stringify(error?.meta??{}),/synthetic_operator_receipt_commit_rollback/);commitFailed=true;}throw error;}
      }};
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'synthetic-uncommitted-provider-result'};}),delegating);
      try{
        await consumer.handle(value.event);assert.equal(requests,1);assert.equal(injections,1);assert.equal(insertReturned,true);assert.equal(commitFailed,true);
        const before=await f.read(value);assert.equal(before.delivery.response.submission.requestInvoked,true);assert.equal(before.delivery.response.submission.commitUnknown,true);
        assert.deepEqual(before.message.metadata.delivery,{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
        assert.deepEqual(await f.raw.$queryRaw`SELECT id FROM synthetic_operator_receipt_commit`,[]);
        assert.equal(await receipt(value,'read','synthetic-committed-receipt'),true);
        assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'read',revision:2,providerMessageId:'synthetic-committed-receipt'});
        await consumer.handle(value.event);assert.equal(requests,1);
      }finally{await f.db.sql('DROP TABLE synthetic_operator_receipt_commit; DROP FUNCTION synthetic_operator_receipt_commit_failure();');}
    });
    await t.test('wrong tenant config account recipient provider ID and absent attempt cannot mutate an original command',async()=>{
      const{value}=await started(),before=await snapshot(value);
      assert.equal(await f.as(f.foreign,()=>receipt(value)),false);
      assert.equal(await service.reconcileMeta({...value.config,id:'foreign-config'},value.config.credentials.phoneNumberId,meta(value)),false);
      assert.equal(await service.reconcileMeta(value.config,'different-account',meta(value)),false);
      assert.equal(await receipt(value,'read','synthetic-meta-receipt',{recipient_id:'5511000000000'}),false);
      assert.deepEqual(await snapshot(value),before);
      assert.equal(await receipt(value),true);const settled=await snapshot(value);
      assert.equal(await receipt(value,'read','conflicting-provider-id'),false);assert.deepEqual(await snapshot(value),settled);
      const queued=await f.make(),untouched=await snapshot(queued);assert.equal(await receipt(queued),false);assert.deepEqual(await snapshot(queued),untouched);
    });
    await t.test('a fully recorded attempt durably denied before request start cannot be upgraded by a signed correlation selector',async()=>{
      const value=await f.make(),prepared=deferred(),release=deferred();let requests=0;
      const sender=f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'must-not-start'};});
      const consumer=f.consumer({sendText:async input=>{prepared.resolve();await release.promise;return sender.sendText(input);}});
      const running=consumer.handle(value.event);
      try{await prepared.promise;await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:{...value.config.credentials,accessToken:'synthetic-rotated-before-start'}}});}
      finally{release.resolve();await running;}
      const before=await snapshot(value);assert.equal(requests,0);assert.equal(before.delivery.response.submission.requestInvoked,false);
      assert.deepEqual(before.message.metadata.delivery,{status:'failed',revision:1,providerMessageId:null,errorCode:'channel_context_changed'});
      assert.equal(await receipt(value),false);assert.deepEqual(await snapshot(value),before);assert.equal(requests,0);
    });
    await t.test('closing or replacing the current human epoch does not redirect or erase an original historical receipt',async()=>{
      const{value,requests}=await started();
      await f.as(value.actor,()=>f.bindings.withReadLock(value.scope,async(tx,locked)=>{
        await tx.whatsAppHandoffBinding.update({where:{id:locked.binding.id},data:{mode:'ai',epoch:locked.binding.epoch+1,assignedOperatorId:null}});
        await tx.supportTicket.update({where:{id:value.ticket.id},data:{status:'closed',resolvedAt:new Date()}});
      }));
      const historical=await f.preserved(value);assert.equal(await receipt(value,'delivered'),true);
      assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'delivered',revision:2,providerMessageId:'synthetic-meta-receipt'});
      assert.deepEqual(await f.preserved(value),historical);assert.equal(requests(),1);
    });
    await t.test('a known provider ID must identify exactly one original support attempt when no opaque selector exists',async()=>{
      const value=await f.make();
      const message=await f.as(value.actor,()=>f.queue.execute({merchantId:value.actor.merchantId,ticketId:value.ticket.id,senderType:'merchant',
        content:'A second canonical original command',clientMessageId:randomUUID()},{principal:value.principal}));
      const{PrismaOutboxRepository}=await import('../dist/shared/messaging/infrastructure/prisma-outbox.repository.js');
      const claim=(await new PrismaOutboxRepository(f.raw).claimBatch(50)).find(row=>row.envelope.correlation_id==='support_message:'+message.id);assert.ok(claim);
      const envelope=claim.envelope,event={eventId:envelope.event_id,eventType:envelope.event_type,merchantId:envelope.merchant_id,
        schemaVersion:envelope.schema_version,correlationId:envelope.correlation_id,causationId:envelope.causation_id,payload:envelope.payload};
      Object.defineProperty(event,'deliveryLeaseToken',{value:claim.leaseToken});
      const other={...value,message,deliveryId:'support_message:'+message.id,event};let requests=0;
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'synthetic-ambiguous-receipt'};}));
      await consumer.handle(value.event);await consumer.handle(other.event);assert.equal(requests,2);
      const before=[await snapshot(value),await snapshot(other)];
      assert.equal(await service.reconcileMeta(value.config,value.config.credentials.phoneNumberId,{id:'synthetic-ambiguous-receipt',status:'read'}),false);
      assert.deepEqual([await snapshot(value),await snapshot(other)],before);
    });
    await t.test('a final receipt realtime-outbox failure rolls back public and private state; a later real receipt does not resend',async()=>{
      const{value,requests}=await started(),before=await snapshot(value),preserved=await f.preserved(value);
      await f.db.sql("CREATE FUNCTION synthetic_reject_operator_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='support.case.changed' AND NEW.payload->>'event'='delivery' AND NEW.payload->>'messageId'=TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic_operator_receipt_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_operator_receipt_rollback BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_operator_receipt('"+value.message.id+"');");
      try{await assert.rejects(receipt(value),error=>/synthetic_operator_receipt_rollback/.test(String(error)+' '+JSON.stringify(error?.meta??{})));assert.deepEqual(await snapshot(value),before);}
      finally{await f.db.sql('DROP TRIGGER synthetic_operator_receipt_rollback ON outbox_messages; DROP FUNCTION synthetic_reject_operator_receipt();');}
      assert.equal(await receipt(value),true);assert.equal(requests(),1);assert.deepEqual(await f.preserved(value),preserved);
    });
    await t.test('a new Twilio request carries only public callback selectors and persists the original sender across a same-account credential rotation',async child=>{
      const value=await f.make({provider:'TWILIO'}),providerId='SM'+randomUUID().replaceAll('-',''),requests=[];
      const old=process.env.API_PUBLIC_URL;process.env.API_PUBLIC_URL='https://synthetic-callback.example.test';
      const repo={findById:id=>f.raw.whatsAppChannelConfig.findUnique({where:{id}}),findByDeviceId:deviceId=>f.raw.whatsAppChannelConfig.findFirst({where:{deviceId}})};
      child.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url:String(url),options});return new Response(JSON.stringify({sid:providerId}),{status:200});});
      try{await f.consumer(new TwilioSenderAdapter(repo)).handle(value.event);}
      finally{if(old===undefined)delete process.env.API_PUBLIC_URL;else process.env.API_PUBLIC_URL=old;}
      assert.equal(requests.length,1);const form=Object.fromEntries(new URLSearchParams(requests[0].options.body));
      assert.deepEqual(form,{To:'whatsapp:+'+value.session.buyerPhone,From:value.config.credentials.senderId,Body:value.content,
        StatusCallback:'https://synthetic-callback.example.test/v1/webhooks/whatsapp/twilio/status?configId='+encodeURIComponent(value.config.id)+'&correlationId='+encodeURIComponent(value.deliveryId)});
      const saved=await f.read(value);assert.equal(saved.delivery.response.submission.sender,value.config.whatsappNumber);
      assert.equal(saved.delivery.response.submission.providerAccountId,value.config.credentials.accountSid);
      const rotated={...value.config,credentials:{...value.config.credentials,authToken:'synthetic-rotated-token'}};
      await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:rotated.credentials}});
      const incoming={provider:'TWILIO',providerAccountId:value.config.credentials.accountSid,providerMessageId:providerId,status:'read',correlationId:value.deliveryId,
        recipient:'+'+value.session.buyerPhone,sender:value.config.whatsappNumber};
      assert.equal(await service.reconcile(rotated,incoming),true);assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'read',revision:2,providerMessageId:providerId});
      assert.equal(requests.length,1);
    });
  }finally{await f.close();}
});
