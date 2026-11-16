import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function waitFor(work,label){const end=Date.now()+5000;do{const value=await work();if(value)return value;await pause(10);}while(Date.now()<end);assert.fail(label);}

// HUM05/HUM07: real PG/tenant middleware, canonical claim/queue/consumer and
// request-start transaction. Captured callbacks are local, not Meta delivery.
test('T54 original operator request authority and uncertain recovery',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createOperatorDeliveryDbFixture(),unhandled=[];
  const rejection=error=>unhandled.push(error);process.on('unhandledRejection',rejection);
  try{
    for(const [label,result,status,errorCode]of [
      ['provider acceptance',{status:'sent',messageId:'synthetic-accepted'},'accepted',undefined],
      ['definitive provider rejection',{status:'failed',messageId:''},'failed','provider_rejected'],
      ['uncertain provider timeout',{status:'unknown',messageId:''},'unknown','submission_unknown'],
    ])await t.test(label+' changes the original message once without inventing delivery',async()=>{
      const value=await f.make(),before=await f.preserved(value),captured=[];
      const consumer=f.consumer(f.submissionSender(async(input,scope)=>{captured.push({input,scope});return result;}));
      await consumer.handle(value.event);const after=await f.read(value);
      assert.equal(captured.length,1);assert.equal(captured[0].input.text,value.content);assert.equal(captured[0].input.toNumber,'+'+value.session.buyerPhone);
      assert.equal(captured[0].input.deviceId,value.session.deviceId);assert.equal(captured[0].input.correlationId,value.deliveryId);
      assert.deepEqual(after.message.metadata.delivery,{status,revision:1,providerMessageId:result.messageId||null,...(errorCode?{errorCode}:{})});
      assert.equal(after.delivery.state,status);assert.equal(after.delivery.providerMessageId,result.messageId||null);
      assert.deepEqual(after.delivery.response.delivery,after.message.metadata.delivery);assert.deepEqual(await f.preserved(value),before);
      const snapshot=await f.read(value);await consumer.handle(value.event);assert.equal(captured.length,1);assert.deepEqual(await f.read(value),snapshot);
      const events=await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'support.case.changed'}});
      assert.equal(events.filter(event=>event.payload.event==='delivery'&&event.payload.messageId===value.message.id).length,1);
    });
    await t.test('simultaneous exact dispatch duplicates share one request and one accepted state',async()=>{
      const value=await f.make(),began=deferred(),release=deferred();let requests=0;
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;began.resolve();await release.promise;return{status:'queued',messageId:'synthetic-concurrent'};}));
      const first=consumer.handle(value.event),second=consumer.handle(value.event);
      try{assert.equal(first,second);await began.promise;assert.equal(requests,1);release.resolve();await Promise.all([first,second]);}
      finally{release.resolve();await first;}
      assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'accepted',revision:1,providerMessageId:'synthetic-concurrent'});assert.equal(requests,1);
    });
    await t.test('disabled connection and expired authenticated service window fail before any request',async()=>{
      for(const options of [{offline:true},{expired:true}]){
        const value=await f.make(options),before=await f.preserved(value);let requests=0;
        if(options.offline)await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{enabled:false}});
        await f.consumer(f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'must-not-send'};})).handle(value.event);
        const after=await f.read(value);assert.equal(requests,0);assert.deepEqual(after.message.metadata.delivery,
          {status:'failed',revision:1,providerMessageId:null,errorCode:options.offline?'channel_offline':'service_window_unavailable'});
        assert.deepEqual(await f.preserved(value),before);
      }
    });
    await t.test('Bubble and a forged device cannot claim an unavailable outbound account',async()=>{
      const value=await f.make({provider:'BUBBLEWHATS'});let senderCalls=0;
      const consumer=f.consumer({sendText:async()=>{senderCalls++;return{status:'sent',messageId:'must-not-send'};}});
      const before=await f.preserved(value);await consumer.handle(value.event);
      assert.equal(senderCalls,0);assert.deepEqual((await f.read(value)).message.metadata.delivery,
        {status:'failed',revision:1,providerMessageId:null,errorCode:'channel_identity_unavailable'});assert.deepEqual(await f.preserved(value),before);
      const forged=await f.make({provider:'BUBBLEWHATS'});
      const row=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:forged.deliveryId}});
      await f.raw.whatsAppDelivery.update({where:{id:forged.deliveryId},data:{response:{...row.response,authority:{...row.response.authority,deviceId:'forged-device'}}}});
      const snapshot=await f.read(forged);await assert.rejects(consumer.handle(forged.event),/operator_original_command_required/);
      assert.deepEqual(await f.read(forged),snapshot);assert.equal(senderCalls,0);
    });
    await t.test('a replaced dispatch lease and a foreign tenant frame cannot mutate or send',async()=>{
      const value=await f.make(),before=await f.read(value),preserved=await f.preserved(value);let requests=0;
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'must-not-send'};}));
      await assert.rejects(f.as(f.foreign,()=>consumer.handle(value.event)),/operator_dispatch_scope_mismatch/);
      await f.raw.outboxMessage.update({where:{eventId:value.event.eventId},data:{leaseToken:'replacement-lease'}});
      await assert.rejects(consumer.handle(value.event),/operator_dispatch_lease_lost/);assert.equal(requests,0);
      assert.deepEqual(await f.read(value),before);assert.deepEqual(await f.preserved(value),preserved);
    });
    for(const mutation of ['epoch','credentials','account','recipient'])await t.test('final request fence rejects '+mutation+' changed during preparation',async()=>{
      const value=await f.make(),began=deferred(),release=deferred();let requests=0;
      const underlying=f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'must-not-send'};});
      const consumer=f.consumer({sendText:async input=>{began.resolve();await release.promise;return underlying.sendText(input);}});
      const running=consumer.handle(value.event);
      try{
        await began.promise;
        if(mutation==='epoch')await f.as(value.actor,()=>f.bindings.withReadLock(value.scope,async(tx,locked)=>{
          await tx.whatsAppHandoffBinding.update({where:{id:locked.binding.id},data:{mode:'ai',epoch:locked.binding.epoch+1,assignedOperatorId:null}});
          await tx.supportTicket.update({where:{id:value.ticket.id},data:{status:'closed',resolvedAt:new Date()}});
        }));
        if(mutation==='credentials'||mutation==='account')await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{credentials:{...value.config.credentials,
          ...(mutation==='credentials'?{accessToken:'rotated-secret'}:{phoneNumberId:'200001'})}}});
        if(mutation==='recipient')await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{buyerPhone:'5511999990000'}});
        const afterMutation=await f.preserved(value);release.resolve();await running;
        const saved=await f.read(value);assert.equal(requests,0);assert.equal(saved.delivery.state,'failed');assert.equal(saved.message.metadata.delivery.providerMessageId,null);
        assert.equal(saved.message.metadata.delivery.errorCode,mutation==='epoch'||mutation==='recipient'?'conversation_changed':'channel_context_changed');
        assert.deepEqual(await f.preserved(value),afterMutation);
      }finally{release.resolve();await running;}
    });
    await t.test('clock is read after a real config lock wait and refuses an expired original lease',async()=>{
      const value=await f.make(),began=deferred(),release=deferred(),locked=deferred(),unlock=deferred();let requests=0;
      const sender=f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'must-not-send'};});
      const consumer=f.consumer({sendText:async input=>{began.resolve();await release.promise;return sender.sendText(input);}});
      const running=consumer.handle(value.event);let holder;
      try{
        await began.promise;
        holder=f.raw.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM whatsapp_channel_configs WHERE id=${value.scope.configId} FOR UPDATE`;locked.resolve();await unlock.promise;});
        await locked.promise;release.resolve();
        const waiters=await waitFor(()=>f.raw.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM whatsapp_channel_configs%FOR SHARE%'`
          .then(rows=>rows.length?rows:undefined),'final config lock waiter not observed');assert.ok(waiters.length>=1);
        await f.raw.$executeRaw`UPDATE outbox_messages SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE event_id=${value.event.eventId}`;
        unlock.resolve();await holder;await running;
        assert.equal(requests,0);assert.deepEqual((await f.read(value)).message.metadata.delivery,
          {status:'failed',revision:1,providerMessageId:null,errorCode:'dispatch_lease_lost'});
      }finally{release.resolve();unlock.resolve();if(holder)await holder;await running;}
    });
    await t.test('a started response may settle its exact historical attempt after close without sending again',async()=>{
      const value=await f.make({actor:f.products,postSale:true}),began=deferred(),release=deferred();let requests=0;
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;began.resolve();await release.promise;return{status:'sent',messageId:'synthetic-late-result'};}));
      const running=consumer.handle(value.event);
      try{
        await began.promise;
        await f.as(value.actor,()=>f.bindings.withReadLock(value.scope,async(tx,locked)=>{
          await tx.whatsAppHandoffBinding.update({where:{id:locked.binding.id},data:{mode:'ai',epoch:locked.binding.epoch+1,assignedOperatorId:null}});
          await tx.supportTicket.update({where:{id:value.ticket.id},data:{status:'closed',resolvedAt:new Date()}});
        }));
        const afterClose=await f.preserved(value);release.resolve();await running;
        assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'accepted',revision:1,providerMessageId:'synthetic-late-result'});
        await consumer.handle(value.event);assert.equal(requests,1);assert.deepEqual(await f.preserved(value),afterClose);
      }finally{release.resolve();await running;}
    });
    await t.test('abandoned preparing evidence becomes unknown with zero fresh requests',async()=>{
      const value=await f.make(),row=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.deliveryId}});let requests=0;
      await f.raw.whatsAppDelivery.update({where:{id:value.deliveryId},data:{state:'preparing',processingToken:'original-abandoned-attempt',
        response:{...row.response,submission:{attemptToken:'original-abandoned-attempt',outboxEventId:value.event.eventId,outboxLeaseToken:value.event.deliveryLeaseToken,phase:'preparing'}}}});
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'must-not-send'};}));
      await consumer.handle(value.event);assert.equal(requests,0);
      assert.deepEqual((await f.read(value)).message.metadata.delivery,{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
      const after=await f.read(value);await consumer.handle(value.event);assert.deepEqual(await f.read(value),after);assert.equal(requests,0);
    });
    await t.test('final projection SQL failure rolls back delivery message and realtime outbox without repeating the request',async()=>{
      const value=await f.make(),before=await f.preserved(value);let requests=0;
      await f.db.sql("CREATE FUNCTION synthetic_reject_operator_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='support.case.changed' AND NEW.payload->>'event'='delivery' AND NEW.payload->>'messageId'=TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic_operator_projection_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_operator_projection_rollback BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_operator_projection('"+value.message.id+"');");
      const consumer=f.consumer(f.submissionSender(async()=>{requests++;return{status:'sent',messageId:'synthetic-unsaved-acceptance'};}));
      try{
        await assert.rejects(consumer.handle(value.event),error=>/synthetic_operator_projection_rollback/.test(String(error)+' '+JSON.stringify(error?.meta??{})));
        const rolledBack=await f.read(value);assert.equal(requests,1);assert.equal(rolledBack.delivery.state,'started');
        assert.equal(rolledBack.delivery.providerMessageId,null);assert.equal(rolledBack.delivery.response.submission.phase,'started');
        assert.deepEqual(rolledBack.message.metadata.delivery,{status:'queued',revision:0,providerMessageId:null});
        assert.deepEqual(rolledBack.delivery.response.delivery,rolledBack.message.metadata.delivery);
        const events=await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'support.case.changed'}});
        assert.equal(events.filter(event=>event.payload.event==='delivery'&&event.payload.messageId===value.message.id).length,0);
        assert.deepEqual(await f.preserved(value),before);
      }finally{await f.db.sql('DROP TRIGGER synthetic_operator_projection_rollback ON outbox_messages; DROP FUNCTION synthetic_reject_operator_projection();');}
      await consumer.handle(value.event);assert.equal(requests,1);assert.deepEqual((await f.read(value)).message.metadata.delivery,
        {status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
      assert.deepEqual(await f.preserved(value),before);
    });
    await new Promise(setImmediate);assert.deepEqual(unhandled,[]);
  }finally{process.off('unhandledRejection',rejection);await f.close();console.log(JSON.stringify({operatorRequestCleanup:{errors:0,bridge:f.db.bridgeStatus(),actualProviderCalls:0}}));}
});
