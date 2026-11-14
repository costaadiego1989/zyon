import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServiceTestRuntime, serviceTestEnvironment, assertServiceCaseSummary } from './service-test-runtime.mjs';
import { assertOwnedServiceNeo4j } from './service-test-neo4j.mjs';
import { assertOwnedServiceRedis } from './service-test-redis.mjs';
import { SERVICE_LOCAL_TEST_MS } from './service-test-startup.mjs';

test('T2', { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  await t.test('ambient endpoints and secrets never enter the worker', () => {
    const env = serviceTestEnvironment({ PATH: 'synthetic-path', DATABASE_URL: 'postgresql://external',
      REDIS_URL: 'redis://external', NEO4J_URI: 'bolt://external', OPENAI_API_KEY: 'private-canary',
      STRIPE_SECRET_KEY: 'private-canary', NODE_OPTIONS: '--import external', DOTENV_CONFIG_PATH: 'external' });
    assert.equal(env.PATH, 'synthetic-path');
    assert.equal(env.NODE_ENV, 'test');
    for (const key of ['DATABASE_URL','REDIS_URL','NEO4J_URI','OPENAI_API_KEY','STRIPE_SECRET_KEY','NODE_OPTIONS','DOTENV_CONFIG_PATH'])
      assert.equal(Object.hasOwn(env,key), false, key);
  });
  await t.test('caller cannot choose a database, provider or executable', async () => {
    for (const input of [{}, { local: false }, { local:true, databaseUrl:'postgresql://external' },
      { local:true, redisUrl:'redis://127.0.0.1:6379' }, { local:true, graphUri:'bolt://external' },
      { local:true, worker:'external.mjs' }, { local:true, env:{ OPENAI_API_KEY:'canary' } }])
      await assert.rejects(createServiceTestRuntime(input), /service_local_options_required/);
  });
  await t.test('ownership proof cannot authorize another container or a host volume', () => {
    const runId=randomUUID(), id='a'.repeat(64);
    const info={Id:id,Name:`/zyon-service-graph-${runId}`,Config:{Labels:{'com.zyon.service-test':runId}},
      HostConfig:{PortBindings:{'7687/tcp':[{HostIp:'127.0.0.1',HostPort:'45001'}]}},Mounts:[]};
    assert.doesNotThrow(()=>assertOwnedServiceNeo4j(info,id,runId));
    for (const changed of [{...info,Id:'b'.repeat(64)}, {...info,Name:'/foreign'},
      {...info,Config:{Labels:{'com.zyon.service-test':'foreign'}}},
      {...info,Mounts:[{Type:'bind',Source:'C:/private'}]},
      {...info,HostConfig:{PortBindings:{'7687/tcp':[{HostIp:'0.0.0.0',HostPort:'45001'}]}}}])
      assert.throws(()=>assertOwnedServiceNeo4j(changed,id,runId));
  });
  await t.test('zero cases, skipped cases and failures cannot become green evidence', () => {
    for(const data of [{executed:0,failed:0,skipped:0},{executed:1,failed:1,skipped:0},{executed:1,failed:0,skipped:1}])
      assert.throws(()=>assertServiceCaseSummary(data));
    assert.deepEqual(assertServiceCaseSummary({executed:2,failed:0,skipped:0}),{executed:2,failed:0,skipped:0});
  });
  await t.test('published Redis cannot bind externally or mount host data', () => {
    const runId=randomUUID(),id='c'.repeat(64),info={Id:id,Name:`/zyon-service-redis-${runId}`,
      Config:{Labels:{'com.zyon.service-redis-test':runId}},
      HostConfig:{ReadonlyRootfs:true,PortBindings:{'6379/tcp':[{HostIp:'127.0.0.1',HostPort:''}]}},Mounts:[{Type:'tmpfs'}]};
    assert.doesNotThrow(()=>assertOwnedServiceRedis(info,id,runId));
    for(const changed of [{...info,Id:'d'.repeat(64)},{...info,Name:'/foreign'},
      {...info,Mounts:[{Type:'bind',Source:'C:/private'}]}, {...info,Mounts:[{Type:'volume'}]},
      {...info,HostConfig:{...info.HostConfig,PortBindings:{'6379/tcp':[{HostIp:'0.0.0.0',HostPort:''}]}}}])
      assert.throws(()=>assertOwnedServiceRedis(changed,id,runId));
  });
  await t.test('real owned SQL, Redis, Neo4j and canonical AppModule are exercised then removed', async () => {
    const runtime=await createServiceTestRuntime({local:true,graph:true});
    try {
      assert.equal(await runtime.db.sql('SELECT run_id FROM synthetic_native_marker'),runtime.db.runId);
      assert.ok(Number(await runtime.db.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"))>100);
      const {Redis}=await import('ioredis');
      const redis=new Redis(runtime.redis.url,{lazyConnect:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
      try {await redis.connect(); assert.equal(await redis.get('aacp:synthetic:run'),runtime.redis.runId);}
      finally {redis.disconnect();}
      assert.deepEqual(await runtime.graph.query('MATCH (n:ServiceTestMarker) RETURN n.runId AS runId'),[{runId:runtime.graph.runId}]);
      const health=await fetch(runtime.apiOrigin+'/health',{redirect:'error',signal:AbortSignal.timeout(10_000)});
      assert.equal(health.status,200); assert.ok((await health.json()).status);
      const ready=await fetch(runtime.apiOrigin+'/ready',{redirect:'error',signal:AbortSignal.timeout(10_000)});
      assert.equal(ready.status,200); assert.equal((await ready.json()).status,'ready');
      const evidence=runtime.evidence();
      assert.equal(evidence.canonicalAppModule,true); assert.equal(evidence.repositoryOverrides,false);
      assert.equal(evidence.authOverrides,false); assert.equal(evidence.providerCalls,0);
    } finally {await runtime.close();}
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
  });
});
