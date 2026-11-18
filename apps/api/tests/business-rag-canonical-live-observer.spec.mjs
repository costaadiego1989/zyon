import assert from 'node:assert/strict';
import test from 'node:test';
import {observeCanonicalLiveReader} from './business-rag-canonical-live-observer.mjs';

// Prepared safety contracts for the later explicit owned-runtime observer.
// No test or application imports have been executed for this packet.
test('T72 evaluation instrumentation preserves canonical authority',async t=>{
  await t.test('original receiver, arguments and result identity survive observation',async()=>{
    const choice={productId:'service',professionalId:'professional'},scope={merchantId:'own',holdOwnerId:'PRIVATE_OWNER'};
    const result={facts:{priceInCents:7300},availability:{slots:[]}},events=[];
    class Reader{async read(c,s){assert.equal(this,reader);assert.equal(c,choice);assert.equal(s,scope);return result;}}
    const reader=new Reader(),observer=observeCanonicalLiveReader(reader,Reader.prototype.read,event=>events.push(event));
    assert.equal(await reader.read(choice,scope),result);
    assert.deepEqual(events,[{choice,merchantId:'own',result}]);
    assert.notEqual(events[0].choice,choice);assert.notEqual(events[0].result,result);
    events[0].result.facts.priceInCents=0;assert.equal(result.facts.priceInCents,7300);
    assert.equal(JSON.stringify(events).includes('PRIVATE_OWNER'),false);
    assert.deepEqual(observer.evidence(),{observedReads:1,observerFaults:0});observer.restore();
  });
  await t.test('the original failure is propagated without a fictitious successful read',async()=>{
    const error=new Error('canonical_unavailable'),events=[];
    class Reader{async read(){throw error;}}
    const reader=new Reader(),observer=observeCanonicalLiveReader(reader,Reader.prototype.read,event=>events.push(event));
    await assert.rejects(reader.read({},{}),value=>value===error);
    assert.deepEqual(events,[]);assert.deepEqual(observer.evidence(),{observedReads:0,observerFaults:0});observer.restore();
  });
  await t.test('an observer failure cannot replace the canonical result',async()=>{
    const result={facts:{priceInCents:7300}};
    class Reader{async read(){return result;}}
    const reader=new Reader(),observer=observeCanonicalLiveReader(reader,Reader.prototype.read,()=>{throw Error('observer_failed');});
    assert.equal(await reader.read({},{}),result);assert.deepEqual(observer.evidence(),{observedReads:0,observerFaults:1});observer.restore();
  });
  await t.test('a copying failure cannot suppress the real read',async()=>{
    let reads=0;const result={facts:{priceInCents:7300}};
    class Reader{async read(){reads++;return result;}}
    const reader=new Reader(),observer=observeCanonicalLiveReader(reader,Reader.prototype.read,()=>assert.fail('uncopyable input must not produce an observation'));
    assert.equal(await reader.read({unexpected:()=>0},{}),result);assert.equal(reads,1);
    assert.deepEqual(observer.evidence(),{observedReads:0,observerFaults:1});observer.restore();
  });
  await t.test('restoration removes only the owned wrapper and is idempotent',async()=>{
    let reads=0;
    class Reader{async read(){return ++reads;}}
    const reader=new Reader(),events=[],observer=observeCanonicalLiveReader(reader,Reader.prototype.read,event=>events.push(event));
    assert.equal(await reader.read({},{}),1);observer.restore();observer.restore();
    assert.equal(Object.hasOwn(reader,'read'),false);assert.equal(await reader.read({},{}),2);assert.equal(events.length,1);
  });
  await t.test('a substituted reader or existing own method cannot be presented as the real class',()=>{
    class Reader{async read(){return 1;}}
    class Substitute{async read(){return 1;}}
    assert.throws(()=>observeCanonicalLiveReader(new Substitute(),Reader.prototype.read,()=>{}),/actual_reader_prototype_required/);
    const reader=new Reader();reader.read=async()=>2;
    assert.throws(()=>observeCanonicalLiveReader(reader,Reader.prototype.read,()=>{}),/unmodified_reader_required/);
  });
  await t.test('bounded observation overflow is recorded as a fault while every real read still runs',async()=>{
    let reads=0;
    class Reader{async read(){return ++reads;}}
    const reader=new Reader(),events=[],observer=observeCanonicalLiveReader(reader,Reader.prototype.read,event=>events.push(event));
    for(let index=1;index<=21;index++)assert.equal(await reader.read({},{}),index);
    assert.equal(reads,21);assert.equal(events.length,20);assert.deepEqual(observer.evidence(),{observedReads:20,observerFaults:1});observer.restore();
  });
});
