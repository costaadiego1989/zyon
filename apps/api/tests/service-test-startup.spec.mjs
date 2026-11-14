import assert from 'node:assert/strict';
import test from 'node:test';
import {awaitServiceStartup,SERVICE_LOCAL_PREFLIGHT_MS,SERVICE_LOCAL_BOOT_MS} from './service-test-startup.mjs';

const turn=()=>new Promise(setImmediate);
test('startup rejects an incomplete integrity preflight at its finite limit',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=new Promise(()=>{}),result=awaitServiceStartup(pending,pending);
  const rejection=assert.rejects(result,/service_preflight_timeout/);
  t.mock.timers.tick(SERVICE_LOCAL_PREFLIGHT_MS);
  await rejection;
});
test('startup keeps the boot limit after verified markers despite repeated signals',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let verified;const preflight=new Promise(resolve=>{verified=resolve;});
  let settled=false;
  const result=awaitServiceStartup(preflight,new Promise(()=>{}));
  result.finally(()=>{settled=true;}).catch(()=>{});
  t.mock.timers.tick(SERVICE_LOCAL_PREFLIGHT_MS-1);await turn();assert.equal(settled,false);
  verified();await turn();
  t.mock.timers.tick(SERVICE_LOCAL_BOOT_MS-1);await turn();assert.equal(settled,false);
  verified();await turn(); // A settled promise cannot extend the boot clock.
  const rejection=assert.rejects(result,/service_app_ready_timeout/);
  t.mock.timers.tick(1);await rejection;
});
test('startup does not accept readiness before integrity and markers are verified',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let verified;const preflight=new Promise(resolve=>{verified=resolve;});
  let settled=false;const ready={apiOrigin:'http://127.0.0.1:5187'};
  const result=awaitServiceStartup(preflight,Promise.resolve(ready));
  result.then(()=>{settled=true;});await turn();assert.equal(settled,false);
  verified();assert.equal((await result).info,ready);
});
