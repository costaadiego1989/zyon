import assert from 'node:assert/strict';
import test from 'node:test';
import * as pg from './local-disposable-postgres.mjs';

const id='a'.repeat(64),runId='12345678-1234-1234-1234-123456789abc';
const info=pidsLimit=>({Id:id,Name:`/aacp-write-db-${runId}`,Config:{Labels:{'com.zyon.storefront-write-test':runId}},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,PortBindings:{},...(pidsLimit===undefined?{}:{PidsLimit:pidsLimit})},Mounts:[]});

test('test-only PostgreSQL PID capacity keeps the existing default128',()=>{
  assert.equal(typeof pg.localPostgresPidsLimit,'function');
  assert.equal(pg.localPostgresPidsLimit(),128);
  assert.equal(pg.localPostgresPidsLimit(undefined),128);
  assert.equal(pg.localPostgresPidsLimit(128),128);
});
test('the explicit stress-test option admits bounded256',()=>{
  assert.equal(typeof pg.localPostgresPidsLimit,'function');
  assert.equal(pg.localPostgresPidsLimit(256),256);
});
test('unknown capacities are rejected before transport selection or Docker',async()=>{
  for(const value of [null,false,true,0,-1,127,129,255,257,512,Infinity,NaN,'128','256',{},[]]){
    if(typeof pg.localPostgresPidsLimit==='function')assert.throws(()=>pg.localPostgresPidsLimit(value),/unsupported_disposable_postgres_pids_limit/);
    await assert.rejects(pg.createDisposablePostgres({pidsLimit:value,transport:'external'}),/unsupported_disposable_postgres_pids_limit/);
  }
});
test('creation and lifetime inspection admit only the requested real bounded capacity',()=>{
  for(const requested of [128,256])assert.doesNotThrow(()=>pg.assertIsolatedPostgresContainer(info(requested),id,runId,requested));
});
test('requested capacity cannot hide a changed or missing actual Docker limit',()=>{
  for(const requested of [128,256]){
    for(const actual of [undefined,null,0,-1,127,129,255,257,512,'128','256',requested===128?256:128])
      assert.throws(()=>pg.assertIsolatedPostgresContainer(info(actual),id,runId,requested),/owned_postgres_pids_limit_mismatch/);
    assert.throws(()=>pg.assertIsolatedPostgresContainer(info(512),id,runId,512),/unsupported_disposable_postgres_pids_limit/);
  }
});
test('existing three-argument ownership and isolation guards retain their contract',()=>{
  const original=info(undefined);
  assert.doesNotThrow(()=>pg.assertIsolatedPostgresContainer(original,id,runId));
  for(const changed of [{...original,Id:'b'.repeat(64)},{...original,Name:'/foreign'},
    {...original,HostConfig:{...original.HostConfig,NetworkMode:'bridge'}},
    {...original,Mounts:[{Type:'bind'}]}])assert.throws(()=>pg.assertIsolatedPostgresContainer(changed,id,runId));
});
