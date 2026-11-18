import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {Redis} from 'ioredis';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {createServiceTestRedis} from './service-test-redis.mjs';
import {assertSyntheticRedisIdentity} from './local-disposable-redis.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('T56 two real relays deliver each canonical resumed intent once on shared owned SQL and Redis',{timeout:SERVICE_LOCAL_TEST_MS},async()=>{
  assert.equal(process.env.REDIS_URL,undefined);
  let f,redis,secondClient,primary;const relays=[],dispatchers=[],release=deferred(),nodes=new Map();
  try{
    f=await createOperatorDeliveryDbFixture();redis=await createServiceTestRedis();
    const marker=new Redis(redis.url,{lazyConnect:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
    try{await marker.connect();assertSyntheticRedisIdentity(redis.url,redis.runId,await marker.get('aacp:synthetic:run'));}
    finally{if(marker.status!=='end')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('resume_marker_close_required')),5000);
      marker.once('end',()=>{clearTimeout(timer);resolve();});marker.disconnect();});}
    assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
    const [{PrismaClient},{TenantContextService},{registerTenantMiddleware},{PrismaWhatsAppHandoffRepository},{CloseWhatsAppConversationUseCase},
      {WhatsAppResumeOutboxConsumer},{OutboxBullMqRelay},{OutboxDispatcher},{PrismaOutboxRepository},{InMemoryDomainEventBus},{MetricsService}]=await Promise.all([
      import('@prisma/client'),import('../dist/shared/tenant/tenant-context.service.js'),import('../dist/shared/persistence/tenant.middleware.js'),
      import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js'),
      import('../dist/modules/support/application/close-whatsapp-conversation.use-case.js'),
      import('../dist/modules/whatsapp-channel/application/services/whatsapp-resume-outbox.consumer.js'),
      import('../dist/shared/messaging/infrastructure/outbox-bullmq-relay.service.js'),import('../dist/shared/messaging/outbox-dispatcher.service.js'),
      import('../dist/shared/messaging/infrastructure/prisma-outbox.repository.js'),import('../dist/shared/events/in-memory-domain-event-bus.js'),
      import('../dist/shared/observability/metrics.service.js'),
    ]);
    secondClient=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}});assert.notEqual(secondClient,f.raw);
    assert.deepEqual(await secondClient.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
    await f.raw.$executeRaw`CREATE TABLE synthetic_resume_effects(delivery_id TEXT PRIMARY KEY,effects INTEGER NOT NULL)`;
    // Both actors/cases are prepared before any resume is queued. Each close
    // below is the actual command, and each lease comes only from dispatch.
    const a=await f.make(),b=await f.make(),close=new CloseWhatsAppConversationUseCase(f.scoped,f.bindings);
    const closeCase=value=>f.as(value.actor,()=>close.execute(value.principal,value.ticket.id,{expectedEpoch:2}));
    const first=await closeCase(a),firstId='support_resume:'+first.bindingId+':'+first.epoch;
    const make=(name,raw,scoped,bindings,tenant)=>{
      const bus=new InMemoryDomainEventBus();
      const sender={async sendText(input){
        const scope=f.submission.currentWhatsAppSubmissionScope();assert.ok(scope&&Object.isFrozen(scope));
        assert.equal(input.correlationId,scope.messageId);assert.equal(input.deviceId,scope.deviceId);assert.equal(input.toNumber,scope.recipient);
        return f.submission.startWhatsAppRequest(scope,async()=>{
          await raw.$executeRaw`INSERT INTO synthetic_resume_effects(delivery_id,effects) VALUES(${input.correlationId},1)
            ON CONFLICT(delivery_id) DO UPDATE SET effects=synthetic_resume_effects.effects+1`;
          nodes.set(input.correlationId,name);if(input.correlationId===firstId)await release.promise;
          return{status:'sent',messageId:'synthetic-resume-'+input.correlationId};
        });
      }};
      const consumer=new WhatsAppResumeOutboxConsumer(scoped,bindings,tenant,sender,bus);consumer.onModuleInit();
      const dispatcher=new OutboxDispatcher(new PrismaOutboxRepository(raw),bus),relay=new OutboxBullMqRelay(dispatcher,new MetricsService());
      dispatchers.push(dispatcher);relays.push(relay);return{relay,consumer};
    };
    const secondTenant=new TenantContextService(),secondScoped=registerTenantMiddleware(secondClient,secondTenant),secondBindings=new PrismaWhatsAppHandoffRepository(secondScoped);
    const firstNode=make('A',f.raw,f.scoped,f.bindings,f.contexts),secondNode=make('B',secondClient,secondScoped,secondBindings,secondTenant);
    process.env.REDIS_URL=redis.url;
    const wait=async(work,label)=>{const end=Date.now()+15_000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};
    await firstNode.relay.onApplicationBootstrap();await wait(()=>nodes.get(firstId)==='A','first actual resumed request did not start');
    const second=await closeCase(b),secondId='support_resume:'+second.bindingId+':'+second.epoch;
    await secondNode.relay.onApplicationBootstrap();
    await wait(async()=>nodes.get(secondId)==='B'&&(await secondClient.whatsAppDelivery.findUniqueOrThrow({where:{id:secondId}})).state==='accepted',
      'second real relay did not complete while first actual transport result was held');
    const ids=[firstId,secondId],rows=await f.raw.whatsAppDelivery.findMany({where:{id:{in:ids}}});assert.equal(rows.length,2);
    const eventIds=rows.map(row=>row.response.outboxEventId),handlerId='whatsapp-human-resume-v1';
    assert.equal(await f.raw.outboxHandlerExecution.count({where:{eventId:rows.find(row=>row.id===firstId).response.outboxEventId,handlerId}}),0);
    for(const id of ids){const [effect]=await f.raw.$queryRaw`SELECT effects FROM synthetic_resume_effects WHERE delivery_id=${id}`;assert.equal(effect.effects,1);}
    release.resolve();
    await wait(async()=>(await f.raw.outboxMessage.findMany({where:{eventId:{in:eventIds}}})).every(row=>row.status==='delivered'),
      'canonical resumed events did not finish with both actual relays');
    for(const id of ids){
      const receipt=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id}}),event=await f.raw.outboxMessage.findUniqueOrThrow({where:{eventId:receipt.response.outboxEventId}});
      assert.equal(receipt.state,'accepted');assert.equal(receipt.response.submission.requestInvoked,true);assert.equal(event.attempts,1);
      assert.equal(await f.raw.outboxHandlerExecution.count({where:{eventId:event.eventId,handlerId}}),1);
      const [effect]=await f.raw.$queryRaw`SELECT effects FROM synthetic_resume_effects WHERE delivery_id=${id}`;assert.equal(effect.effects,1);
    }
    assert.equal(nodes.get(firstId),'A');assert.equal(nodes.get(secondId),'B');
    console.info('resume_relay_overlap',JSON.stringify({relays:2,prismaClients:2,intents:2,effects:[1,1],handlerMarkers:[1,1],sameOwnedPostgresAndRedis:true,noGlobalSingleJobClaim:true}));
  }catch(error){primary=error;}
  finally{
    release.resolve();const cleanup=[];
    for(const relay of [...relays].reverse())try{await relay.onModuleDestroy();}catch(error){cleanup.push(error);}
    for(const dispatcher of [...dispatchers].reverse())try{await dispatcher.onModuleDestroy();}catch(error){cleanup.push(error);}
    if(secondClient)try{await secondClient.$disconnect();}catch(error){cleanup.push(error);}
    if(redis)try{await redis.dispose();}catch(error){cleanup.push(error);}
    if(f)try{await f.close();}catch(error){cleanup.push(error);}
    delete process.env.REDIS_URL;
    if(cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],'resume_overlap_owned_cleanup_failed');
  }
  if(primary)throw primary;
});
