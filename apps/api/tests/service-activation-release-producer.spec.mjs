import assert from 'node:assert/strict';
import test from 'node:test';
import {parseActivationTap,parseActivationPlaywright,activationCriterionInventory} from './service-activation-release-producer.mjs';
const tap=(extra={})=>Object.entries({tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0,...extra}).map(([key,value])=>'# '+key+' '+value).join('\n')+'\n';
test('T94 actual-output producer parsers',async t=>{
  await t.test('reads actual TAP summary and never an asserted input pass count',()=>assert.deepEqual(parseActivationTap(tap()),{executed:2,passed:2,failed:0,skipped:0}));
  await t.test('rejects zero matches, skips, failure, duplicates, cancellation and missing TAP summaries',()=>{
    for(const value of [tap({tests:0,pass:0}),tap({skipped:1}),tap({fail:1}),tap({cancelled:1}),tap({pass:1}),tap()+'# tests 2\n','{"passed":2}',tap()+'not ok 3 - late failure\n',tap()+'    not ok 1 - nested failure\n'])assert.throws(()=>parseActivationTap(value));
  });
  await t.test('browser output needs actual non-retried passing results and zero skipped/flaky cases',()=>{
    const raw={stats:{expected:1,unexpected:0,skipped:0,flaky:0},suites:[{specs:[{tests:[{results:[{status:'passed'}]}]}]}]};
    assert.equal(parseActivationPlaywright(JSON.stringify(raw)).executed,1);
    const retried={...raw,suites:[
      {specs:[{tests:[{results:[{status:'passed'},{status:'passed'}]}]}]},
    ]};
    for(const changed of [{...raw,stats:{...raw.stats,skipped:1}},{...raw,suites:[]},retried])assert.throws(()=>parseActivationPlaywright(JSON.stringify(changed)));
  });
  await t.test('criterion identity comes from actual criterion/proof bindings and rejects duplicates or missing proof lines',()=>{
    const raw='**C1** - WHEN something THEN the system SHALL preserve it. (REG-04, AC 4)\nProof: `node actual.spec.mjs`\nTasks: T94\n';
    assert.equal(activationCriterionInventory(raw)[0].id,'C1');assert.throws(()=>activationCriterionInventory(raw+raw));assert.throws(()=>activationCriterionInventory(raw.replace('Proof:','Missing:')));
  });
});
