import assert from 'node:assert/strict';
import test from 'node:test';
import {AsyncLocalStorage} from 'node:async_hooks';
import {validateOwnedBookingAwaitTrace,observeOwnedBookingAwaits,createOwnedBookingAwaitCollector} from './service-booking-await-trace.mjs';

const options={local:true,whatsapp:true,metaCapabilitiesFixture:'owned-empty-v1',recoveryTemplateMonitorFixture:'manual-only-v1',bookingAwaitTrace:'native18-v1'};
const binding=(instance,method,label)=>({instance,prototype:Object.getPrototypeOf(instance),method,label});

test('Await trace is an explicit native18-only private selector and omission has no action',()=>{
  assert.equal(validateOwnedBookingAwaitTrace({}),undefined);
  assert.equal(validateOwnedBookingAwaitTrace(options),'native18-v1');
  for(const patch of[{bookingAwaitTrace:true},{bookingAwaitTrace:'any'},{whatsapp:undefined},{local:false},
    {modelScript:[]},{buyerBooking:true},{graph:true},{metaCapabilitiesFixture:undefined},{recoveryTemplateMonitorFixture:undefined}])
    assert.throws(()=>validateOwnedBookingAwaitTrace({...options,...patch}),/booking_await_trace_/);
  const value={keep:true};assert.equal(observeOwnedBookingAwaits(undefined,[],()=>{}),undefined);assert.deepEqual(value,{keep:true});
});

test('Synchronous observation preserves original receiver, argument and result references and identical thrown errors',()=>{
  const input={secret:'never-record'},result={private:'not-recorded'},error=Error('never-record-error');
  class Unit{select(arg){assert.equal(this,unit);assert.equal(arg,input);return result;} prepare(arg){assert.equal(arg,input);throw error;}}
  const unit=new Unit(),events=[],observer=observeOwnedBookingAwaits('native18-v1',[binding(unit,'select','booking.select'),binding(unit,'prepare','booking.prepare')],e=>events.push(e));
  try{
    assert.equal(unit.select(input),result);assert.throws(()=>unit.prepare(input),e=>e===error);
    assert.deepEqual(events.map(e=>e.phase),['enter','resolve','enter','throw']);
    const serialized=JSON.stringify(events);assert.equal(serialized.includes('never-record'),false);assert.equal(serialized.includes('not-recorded'),false);
  }finally{observer.restore();}
  assert.equal(Object.hasOwn(unit,'select'),false);assert.equal(Object.hasOwn(unit,'prepare'),false);
});

test('Real promises, rejection identities and existing ALS context survive nested suspended awaits',async()=>{
  const authority=new AsyncLocalStorage(),store={immutableAuthority:true},collector=createOwnedBookingAwaitCollector();
  let release;const gate=new Promise(resolve=>{release=resolve;}),answer={canonical:true},failure=Error('private-error');
  class Inner{select(){assert.equal(authority.getStore(),store);return gate;} state(){return Promise.reject(failure);}}
  const inner=new Inner();let originalPromise;
  class Outer{respond(input){assert.equal(authority.getStore(),store);originalPromise=(async()=>{await inner.select(input);assert.equal(authority.getStore(),store);return answer;})();return originalPromise;}}
  const outer=new Outer(),observer=observeOwnedBookingAwaits('native18-v1',[binding(outer,'respond','native.respond'),binding(inner,'select','booking.select'),binding(inner,'state','holds.state')],e=>collector.accept(e));
  try{
    await authority.run(store,async()=>{
      const promise=outer.respond({action:{operation:'continue'},secret:'no-record'});assert.equal(promise,originalPromise);
      const active=collector.snapshot().active;assert.deepEqual(active.map(e=>e.method),['native.respond','booking.select']);
      assert.equal(active[1].parentId,active[0].callId);assert.equal(active[0].operation,'continue');
      release();assert.equal(await promise,answer);await Promise.resolve();
      const rejected=inner.state();await assert.rejects(rejected,e=>e===failure);
    });
    assert.deepEqual(collector.snapshot().active,[]);
    assert.equal(JSON.stringify(collector.snapshot()).includes('no-record'),false);
  }finally{observer.restore();}
});

test('Observer callback failure never changes an original value, promise or exception',async()=>{
  const answer={},error=Error('original'),promise=Promise.resolve(answer);
  class Unit{select(){return answer;} prepare(){return promise;} state(){throw error;}}
  const unit=new Unit(),observer=observeOwnedBookingAwaits('native18-v1',[binding(unit,'select','booking.select'),binding(unit,'prepare','booking.prepare'),binding(unit,'state','holds.state')],()=>{throw Error('observer-only');});
  try{assert.equal(unit.select(),answer);assert.equal(unit.prepare(),promise);assert.equal(await promise,answer);assert.throws(()=>unit.state(),e=>e===error);await Promise.resolve();assert.ok(observer.evidence().observerFaults>0);}
  finally{observer.restore();}
});

test('Collector records only allowlisted bounded metadata and refuses gaps or private fields',()=>{
  const collector=createOwnedBookingAwaitCollector();let n=0;
  for(let callId=1;callId<=40;callId++){collector.accept({sequence:++n,callId,parentId:null,method:'booking.prepare',phase:'enter'});collector.accept({sequence:++n,callId,parentId:null,method:'booking.prepare',phase:'resolve'});}
  const value=collector.snapshot();assert.equal(value.recent.length,24);assert.equal(value.droppedRecent,56);assert.deepEqual(value.active,[]);
  const next={sequence:n+1,callId:41,parentId:null,method:'booking.prepare',phase:'enter'};
  for(const invalid of[{...next,sequence:n+2},{...next,method:'caller:any'},{...next,phase:'success-paid'},{...next,payload:'private'},{...next,operation:'buyer-secret'}])
    assert.throws(()=>collector.accept(invalid),/booking_await_trace_event_invalid/);
  assert.equal(collector.snapshot().lastSequence,n);
});

test('Restoration checks exact descriptors and restores every observed method even after a changed wrapper',()=>{
  class Unit{select(){}prepare(){}}
  const unit=new Unit(),first=Unit.prototype.select,second=Unit.prototype.prepare;
  const observer=observeOwnedBookingAwaits('native18-v1',[binding(unit,'select','booking.select'),binding(unit,'prepare','booking.prepare')],()=>{});
  unit.select=()=>{};
  assert.throws(()=>observer.restore(),/booking_await_trace_restore_failed/);
  assert.equal(unit.select,first);assert.equal(unit.prepare,second);assert.equal(Object.hasOwn(unit,'select'),false);assert.equal(Object.hasOwn(unit,'prepare'),false);
  observer.restore();assert.equal(observer.evidence().restored,true);
});
