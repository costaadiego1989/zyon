import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

// Real compiled Meta/Twilio adapters and final PG transaction. Only fetch is
// scoped to this direct-composition test, never the real AppModule worker.
test('T54 actual adapter request start and SQL uncertainty',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createOperatorDeliveryDbFixture(),unhandled=[];
  const rejection=error=>unhandled.push(error);process.on('unhandledRejection',rejection);
  try{
    const{MetaCloudSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.js');
    const{TwilioSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/twilio-sender.adapter.js');
    const configRepo={findById:id=>f.raw.whatsAppChannelConfig.findUnique({where:{id}}),
      findByDeviceId:deviceId=>f.raw.whatsAppChannelConfig.findFirst({where:{deviceId}})};
    for(const provider of ['META_CLOUD','TWILIO'])await t.test(provider+' submits the canonical original text and account once',async child=>{
      const value=await f.make({provider}),before=await f.preserved(value),requests=[];
      const sender=provider==='META_CLOUD'?new MetaCloudSenderAdapter(configRepo):new TwilioSenderAdapter(configRepo);
      child.mock.method(globalThis,'fetch',async(url,options)=>{
        requests.push({url:String(url),options});
        return new Response(JSON.stringify(provider==='META_CLOUD'?{messages:[{id:'synthetic-meta-accepted'}]}:{sid:'synthetic-twilio-accepted'}),
          {status:200,headers:{'content-type':'application/json'}});
      });
      const consumer=f.consumer(sender);await consumer.handle(value.event);assert.equal(requests.length,1);
      const request=requests[0];assert.equal(request.options.method,'POST');assert.equal(request.options.redirect,'error');
      if(provider==='META_CLOUD'){
        assert.equal(request.url,'https://graph.facebook.com/v23.0/100001/messages');
        assert.equal(request.options.headers.Authorization,'Bearer '+value.config.credentials.accessToken);
        assert.deepEqual(JSON.parse(request.options.body),{messaging_product:'whatsapp',to:value.session.buyerPhone,biz_opaque_callback_data:value.deliveryId,
          type:'text',text:{body:value.content}});
      }else{
        assert.equal(request.url,'https://api.twilio.com/2010-04-01/Accounts/'+value.config.credentials.accountSid+'/Messages.json');
        assert.equal(request.options.headers.Authorization,'Basic '+Buffer.from(value.config.credentials.accountSid+':'+value.config.credentials.authToken).toString('base64'));
        assert.deepEqual(Object.fromEntries(new URLSearchParams(request.options.body)),{To:'whatsapp:+'+value.session.buyerPhone,
          From:value.config.credentials.senderId,Body:value.content});
      }
      const saved=await f.read(value);assert.deepEqual(saved.message.metadata.delivery,{status:'accepted',revision:1,
        providerMessageId:provider==='META_CLOUD'?'synthetic-meta-accepted':'synthetic-twilio-accepted'});
      await consumer.handle(value.event);assert.equal(requests.length,1);assert.deepEqual(await f.preserved(value),before);
    });
    for(const provider of ['META_CLOUD','TWILIO'])await t.test(provider+' credential rotation during awaited lookup suppresses the physical callback',async child=>{
      const value=await f.make({provider}),read=deferred(),release=deferred();let requests=0;
      child.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('must_not_start_rotated_request');});
      const paused={...configRepo,findById:async id=>{const snapshot=await configRepo.findById(id);read.resolve();await release.promise;return snapshot;}};
      const sender=provider==='META_CLOUD'?new MetaCloudSenderAdapter(paused):new TwilioSenderAdapter(paused),consumer=f.consumer(sender);
      const running=consumer.handle(value.event);
      try{
        await read.promise;await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{credentials:{...value.config.credentials,
          ...(provider==='META_CLOUD'?{accessToken:'rotated-meta'}:{authToken:'rotated-twilio'})}}});
        const before=await f.preserved(value);release.resolve();await running;
        assert.equal(requests,0);assert.deepEqual((await f.read(value)).message.metadata.delivery,
          {status:'failed',revision:1,providerMessageId:null,errorCode:'channel_context_changed'});assert.deepEqual(await f.preserved(value),before);
      }finally{release.resolve();await running;}
    });
    for(const [label,status,body,expected]of [
      ['definitive rejection',400,{error:'synthetic'},'failed'],
      ['server timeout',408,{error:'synthetic'},'unknown'],
      ['invalid provider identifier',200,{sid:{forged:'object'}},'unknown'],
    ])await t.test('Twilio '+label+' keeps a truthful terminal state without a blind retry',async child=>{
      const value=await f.make({provider:'TWILIO'});let requests=0;
      child.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});});
      const consumer=f.consumer(new TwilioSenderAdapter(configRepo));await consumer.handle(value.event);const after=await f.read(value);
      assert.deepEqual(after.message.metadata.delivery,{status:expected,revision:1,providerMessageId:null,
        errorCode:expected==='failed'?'provider_rejected':'submission_unknown'});
      await consumer.handle(value.event);assert.equal(requests,1);assert.deepEqual(await f.read(value),after);
    });
    await t.test('SQL COMMIT failure after physical request start rolls back the marker and remains unknown',async child=>{
      const value=await f.make(),before=await f.preserved(value);let requests=0,injections=0,insertReturned=false,commitFailed=false;
      assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
      await f.db.sql("CREATE TABLE synthetic_operator_commit(id TEXT PRIMARY KEY); CREATE FUNCTION synthetic_operator_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_operator_commit_rollback'; END $$; CREATE CONSTRAINT TRIGGER synthetic_operator_commit_rollback AFTER INSERT ON synthetic_operator_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_operator_commit_failure();");
      child.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(JSON.stringify({messages:[{id:'synthetic-physical-result'}]}),{status:200,headers:{'content-type':'application/json'}});});
      const original=f.bindings.withReadLock.bind(f.bindings),wrapped={withReadLock:async(scope,work)=>{
        try{return await original(scope,async(tx,locked)=>{
          const result=await work(tx,locked);
          if(requests===1&&injections===0&&result?.submission===true){injections++;await tx.$executeRaw`INSERT INTO synthetic_operator_commit(id) VALUES (${value.message.id})`;insertReturned=true;}
          return result;
        });}catch(error){if(injections===1&&insertReturned){assert.match(String(error)+' '+JSON.stringify(error?.meta??{}),/synthetic_operator_commit_rollback/);commitFailed=true;}throw error;}
      }};
      const consumer=f.consumer(new MetaCloudSenderAdapter(configRepo),wrapped);await consumer.handle(value.event);
      assert.equal(requests,1);assert.equal(injections,1);assert.equal(insertReturned,true);assert.equal(commitFailed,true);
      assert.deepEqual(await f.raw.$queryRaw`SELECT id FROM synthetic_operator_commit`,[]);
      const after=await f.read(value);assert.deepEqual(after.message.metadata.delivery,{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
      assert.equal(after.delivery.response.submission.requestInvoked,true);assert.equal(after.delivery.response.submission.commitUnknown,true);
      assert.equal(after.delivery.response.submission.outboxEventId,value.event.eventId);assert.equal(after.delivery.response.submission.outboxLeaseToken,value.event.deliveryLeaseToken);
      assert.equal(Object.hasOwn(after.delivery.response,'receipt'),false);await consumer.handle(value.event);assert.equal(requests,1);
      assert.deepEqual(await f.read(value),after);assert.deepEqual(await f.preserved(value),before);
    });
    await t.test('another valid leased event cannot adopt the original private command',async()=>{
      const value=await f.make(),original=await f.raw.outboxMessage.findUniqueOrThrow({where:{eventId:value.event.eventId}}),eventId=randomUUID(),token=randomUUID();let calls=0;
      await f.raw.outboxMessage.create({data:{eventId,eventType:original.eventType,schemaVersion:original.schemaVersion,merchantId:original.merchantId,
        occurredAt:original.occurredAt,correlationId:original.correlationId,causationId:original.causationId,producer:original.producer,payload:original.payload,
        status:'processing',attempts:1,leaseToken:token,leaseExpiresAt:new Date(Date.now()+30_000)}});
      const forged={...value.event,eventId};Object.defineProperty(forged,'deliveryLeaseToken',{value:token});
      const before=await f.read(value),consumer=f.consumer({sendText:async()=>{calls++;return{status:'sent',messageId:'must-not-send'};}});
      await assert.rejects(consumer.handle(forged),/operator_original_command_required/);assert.equal(calls,0);assert.deepEqual(await f.read(value),before);
    });
    await new Promise(setImmediate);assert.deepEqual(unhandled,[]);
  }finally{process.off('unhandledRejection',rejection);await f.close();console.log(JSON.stringify({operatorAdapterCleanup:{errors:0,bridge:f.db.bridgeStatus(),actualExternalProviderCalls:0}}));}
});
