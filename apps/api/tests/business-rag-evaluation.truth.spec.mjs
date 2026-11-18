import assert from 'node:assert/strict';
import test from 'node:test';
import {projectObservedLive} from './business-rag-evaluation.truth.mjs';

test('T72 live measurement retains operational truth without substituting the server clock',async t=>{
  const make=()=>({facts:{merchantId:'synthetic',priceInCents:7900},publicLabels:{serviceName:'Published'},
    availability:{asOf:'2030-01-01T12:00:00.000Z',policyVersion:3,status:'ready',slots:[{startsAt:'2030-01-02T10:30:00.000Z'}]}});
  const bounds={startedAt:Date.parse('2030-01-01T11:59:59Z'),finishedAt:Date.parse('2030-01-01T12:00:01Z')};
  await t.test('the comparison includes the full facts labels versions and slots',()=>{
    const input=make(),before=structuredClone(input),result=projectObservedLive(input,bounds);
    assert.deepEqual(result,{facts:input.facts,publicLabels:input.publicLabels,
      availability:{policyVersion:3,status:'ready',slots:[{startsAt:'2030-01-02T10:30:00.000Z'}]}});
    assert.deepEqual(input,before);result.facts.priceInCents=1;assert.equal(input.facts.priceInCents,7900);
  });
  await t.test('a stale future missing or invalid timestamp is an observation failure',()=>{
    for(const asOf of ['2029-12-31T12:00:00Z','2030-01-03T12:00:00Z',undefined,'invalid']){
      const input=make();input.availability.asOf=asOf;
      assert.throws(()=>projectObservedLive(input,bounds),/evaluation_live_clock/);
    }
  });
  await t.test('the timestamp bracket itself cannot be fabricated or reversed',()=>{
    for(const invalid of [{startedAt:NaN,finishedAt:bounds.finishedAt},
      {startedAt:bounds.finishedAt,finishedAt:bounds.startedAt},{}])
      assert.throws(()=>projectObservedLive(make(),invalid),/evaluation_clock_bracket/);
  });
  await t.test('a missing canonical result fails rather than becoming an empty successful tool',()=>{
    for(const input of [undefined,null,{},[],{facts:{},availability:null}])
      assert.throws(()=>projectObservedLive(input,bounds),/evaluation_live_result/);
  });
  await t.test('a tool price or slot change remains visible to the evaluator',()=>{
    const original=projectObservedLive(make(),bounds),price=make(),slot=make();
    price.facts.priceInCents=7300;slot.availability.slots.push({startsAt:'2030-01-02T10:00:00.000Z'});
    assert.notDeepEqual(projectObservedLive(price,bounds),original);
    assert.notDeepEqual(projectObservedLive(slot,bounds),original);
  });
});
