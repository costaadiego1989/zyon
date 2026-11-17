import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {Redis} from 'ioredis';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {createServiceTestRedis} from './service-test-redis.mjs';
import {assertSyntheticRedisIdentity} from './local-disposable-redis.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

// Two actual relay/Worker/dispatcher/repository instances and two Prisma clients
// share one owned PG and Redis. No dispatcher/publisher is called by the test.
// The synthetic SQL handler is deliberately not idempotent: a second invocation
// increments its counter, so SQL effects and durable handler fences must agree.
test('two real startup relays overlap on the same PG and Redis and apply each event exactly once',
  {timeout:SERVICE_LOCAL_TEST_MS},async()=>{
  assert.equal(process.env.REDIS_URL,undefined,'isolated sanitized native environment required');
  let f,redis,secondClient,primary;
  const relays=[],dispatchers=[],releaseFirst=deferred(),handlerErrors=[];
  const entered=new Map(),invocations=new Map();
  try{
    f=await createAgendaDbFixture();redis=await createServiceTestRedis();
    const marker=new Redis(redis.url,{lazyConnect:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
    try{
      await marker.connect();assertSyntheticRedisIdentity(redis.url,redis.runId,await marker.get('aacp:synthetic:run'));
    }finally{
      if(marker.status!=='end')await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('relay_marker_client_close_required')),5000);
        marker.once('end',()=>{clearTimeout(timer);resolve();});marker.disconnect();
      });
    }
    assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
    const [{PrismaClient},{OutboxBullMqRelay},{OutboxDispatcher},{PrismaOutboxRepository},
      {InMemoryDomainEventBus},{MetricsService},{appendOutboxInTransaction}]=await Promise.all([
      import('@prisma/client'),
      import('../dist/shared/messaging/infrastructure/outbox-bullmq-relay.service.js'),
      import('../dist/shared/messaging/outbox-dispatcher.service.js'),
      import('../dist/shared/messaging/infrastructure/prisma-outbox.repository.js'),
      import('../dist/shared/events/in-memory-domain-event-bus.js'),
      import('../dist/shared/observability/metrics.service.js'),
      import('../dist/shared/messaging/infrastructure/append-outbox-in-transaction.js'),
    ]);
    secondClient=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}});
    assert.ok(secondClient!==f.raw,'independent Prisma clients required');
    assert.deepEqual(await secondClient.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
    await f.raw.$executeRaw`CREATE TABLE synthetic_relay_effects(event_id TEXT PRIMARY KEY,effects INTEGER NOT NULL)`;
    process.env.REDIS_URL=redis.url; // Only this isolated child; verified owned URL, no control flag.
    const firstId=randomUUID(),secondId=randomUUID(),ids=[firstId,secondId];
    const eventType='synthetic.relay.startup.overlap',handlerId='synthetic.relay.startup.overlap.v1';
    const wait=async(work,label)=>{
      const end=Date.now()+15_000;
      do{if(handlerErrors.length)throw handlerErrors[0];const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);
      assert.fail(label);
    };
    const append=id=>f.raw.$transaction(tx=>appendOutboxInTransaction(tx,{event_id:id,event_type:eventType,schema_version:1,
      merchant_id:f.owner.merchantId,occurred_at:new Date().toISOString(),correlation_id:id,causation_id:id,
      producer:'synthetic-relay-native',payload:{kind:'owned_sql_effect'}}));
    const metric=async(metrics,name)=>{const value=await metrics.registry.getSingleMetric(name).get();
      assert.equal(value.values.length,1);return value.values[0].value;};
    const make=(name,client)=>{
      const bus=new InMemoryDomainEventBus(),repository=new PrismaOutboxRepository(client);
      bus.subscribe(eventType,async event=>{
        try{
          assert.ok(ids.includes(event.eventId),'only the original synthetic events may reach this handler');
          assert.equal(event.merchantId,f.owner.merchantId);
          const row=await client.outboxMessage.findUniqueOrThrow({where:{eventId:event.eventId}});
          const [clock]=await client.$queryRaw`SELECT clock_timestamp() AS now`;
          assert.equal(row.status,'processing');
          assert.ok(typeof event.deliveryLeaseToken==='string'&&row.leaseToken===event.deliveryLeaseToken,'canonical claim identity required');
          assert.ok(row.leaseExpiresAt instanceof Date&&row.leaseExpiresAt>clock.now,'live SQL lease required before effect');
          assert.equal(Object.getOwnPropertyDescriptor(event,'deliveryLeaseToken').enumerable,false);
          invocations.set(event.eventId,(invocations.get(event.eventId)??0)+1);
          await client.$executeRaw`INSERT INTO synthetic_relay_effects(event_id,effects) VALUES(${event.eventId},1)
            ON CONFLICT(event_id) DO UPDATE SET effects=synthetic_relay_effects.effects+1`;
          entered.set(event.eventId,name);
          if(event.eventId===firstId)await releaseFirst.promise;
        }catch(error){handlerErrors.push(error);throw error;}
      },handlerId);
      const dispatcher=new OutboxDispatcher(repository,bus),metrics=new MetricsService();
      const relay=new OutboxBullMqRelay(dispatcher,metrics);dispatchers.push(dispatcher);relays.push(relay);
      return{relay,dispatcher,metrics};
    };
    const first=make('A',f.raw),second=make('B',secondClient);
    assert.equal(await metric(first.metrics,'outbox_relay_ready'),0);
    assert.equal(await metric(second.metrics,'outbox_relay_ready'),0);
    const firstStartupAt=Date.now();
    await append(firstId);await first.relay.onApplicationBootstrap();
    await wait(()=>entered.get(firstId)==='A','first real startup job did not invoke its leased handler within15s');
    assert.equal(await metric(first.metrics,'outbox_relay_ready'),0,'held first round must not advertise completed readiness');
    assert.equal(first.dispatcher.getLastCompletedRoundAt(),0);
    // A is still in its first handler. B must deliver a different event while
    // the original event remains leased, proving actual overlapping instances.
    const secondStartupAt=Date.now();
    await append(secondId);await second.relay.onApplicationBootstrap();
    await wait(async()=>entered.get(secondId)==='B'&&(await secondClient.outboxMessage.findUniqueOrThrow({where:{eventId:secondId}})).status==='delivered',
      'second real relay did not deliver while the first handler was held');
    await wait(async()=>await metric(second.metrics,'outbox_relay_ready')===1,'second actual completed round readiness missing');
    const [clock]=await f.raw.$queryRaw`SELECT clock_timestamp() AS now`;
    const held=await f.raw.outboxMessage.findUniqueOrThrow({where:{eventId:firstId}});
    assert.equal(held.status,'processing');assert.equal(held.attempts,1);
    assert.ok(held.leaseExpiresAt instanceof Date&&held.leaseExpiresAt>clock.now,'first lease must remain live during overlap');
    assert.equal(await f.raw.outboxHandlerExecution.count({where:{eventId:firstId,handlerId}}),0);
    assert.equal(await secondClient.outboxHandlerExecution.count({where:{eventId:secondId,handlerId}}),1);
    for(const id of ids){const [effect]=await f.raw.$queryRaw`SELECT effects FROM synthetic_relay_effects WHERE event_id=${id}`;
      assert.equal(effect.effects,1);assert.equal(invocations.get(id),1);}
    releaseFirst.resolve();
    await wait(async()=>(await f.raw.outboxMessage.findMany({where:{eventId:{in:ids}}})).every(row=>row.status==='delivered'),
      'both original events must settle without another effect');
    await wait(async()=>await metric(first.metrics,'outbox_relay_ready')===1,'first actual completed round readiness missing');
    const finalEffects=[],finalMarkers=[];
    for(const id of ids){
      const row=await f.raw.outboxMessage.findUniqueOrThrow({where:{eventId:id}});
      assert.equal(row.attempts,1);assert.equal(row.leaseToken,null);assert.equal(row.leaseExpiresAt,null);
      const markers=await f.raw.outboxHandlerExecution.count({where:{eventId:id,handlerId}});
      assert.equal(markers,1);finalMarkers.push(markers);
      const [effect]=await f.raw.$queryRaw`SELECT effects FROM synthetic_relay_effects WHERE event_id=${id}`;
      assert.equal(effect.effects,1);assert.equal(invocations.get(id),1);finalEffects.push(effect.effects);
    }
    assert.equal(entered.get(firstId),'A');assert.equal(entered.get(secondId),'B');assert.equal(handlerErrors.length,0);
    try{console.info('outbox_relay_startup_overlap',JSON.stringify({relays:relays.length,prismaClients:2,events:ids.length,
      effects:finalEffects,handlerMarkers:finalMarkers,firstStartupAt:new Date(firstStartupAt).toISOString(),
      secondStartupAt:new Date(secondStartupAt).toISOString(),sameOwnedPostgresAndRedis:true,noGlobalSingleJobClaim:true}));}catch{}
  }catch(error){primary=error;}
  finally{
    releaseFirst.resolve();const cleanup=[];
    for(const relay of [...relays].reverse())try{await relay.onModuleDestroy();}catch(error){cleanup.push(error);}
    for(const dispatcher of [...dispatchers].reverse())try{await dispatcher.onModuleDestroy();}catch(error){cleanup.push(error);}
    if(secondClient)try{await secondClient.$disconnect();}catch(error){cleanup.push(error);}
    if(f)try{await f.raw.$disconnect();}catch(error){cleanup.push(error);}
    if(redis)try{await redis.dispose();}catch(error){cleanup.push(error);}
    if(f)try{await f.db.dispose();assert.deepEqual(f.db.bridgeStatus(),{listening:false,sockets:0,children:0});}catch(error){cleanup.push(error);}
    delete process.env.REDIS_URL;
    if(cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],'relay_overlap_owned_cleanup_failed');
  }
  if(primary)throw primary;
});
