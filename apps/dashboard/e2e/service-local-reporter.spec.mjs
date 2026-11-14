import assert from 'node:assert/strict';
import test from 'node:test';
import ServiceLocalReporter from './service-local-reporter.mjs';

test('T3 rejects empty skipped and failed browser counts',()=>{
  for(const statuses of [[],['skipped'],['failed'],['passed','skipped']]){
    const reporter=new ServiceLocalReporter();
    reporter.onBegin({}, {allTests:()=>statuses.map(status=>({results:[{status}]}))});
    assert.deepEqual(reporter.onEnd({status:'passed'}),{status:'failed'});
  }
  const reporter=new ServiceLocalReporter();
  reporter.onBegin({}, {allTests:()=>[{results:[{status:'passed'}]}]});
  assert.equal(reporter.onEnd({status:'passed'}),undefined);
});
