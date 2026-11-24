import assert from 'node:assert/strict';
import test from 'node:test';
import {activationCriterionInventory,activationProofCommands} from './service-activation-release-producer.mjs';
const line='**C64** - WHEN UI is demonstrated THEN the system SHALL retain both required browser proofs.\n';
test('T94 complete multiple-proof bindings',async t=>{
  await t.test('keeps both separate Proof lines used by the approved C64 criterion',()=>{
    const source=line+'Proof: `node first.spec.mjs`\nProof: `node second.spec.mjs`\nTasks: T93, T95.\n';
    const result=activationCriterionInventory(source);assert.equal(result.length,1);assert.equal(result[0].id,'C64');
    assert.deepEqual(activationProofCommands(result[0].proof),['node first.spec.mjs','node second.spec.mjs']);
  });
  await t.test('keeps every command when multiple Proof lines also contain compound commands',()=>{
    const source=line+'Proof: `node first.spec.mjs` and `node second.spec.mjs`\n\nBoundary: all commands are required.\n  Proof: `node third.spec.mjs`\nTasks: T93, T95.\n';
    assert.deepEqual(activationProofCommands(activationCriterionInventory(source)[0].proof),['node first.spec.mjs','node second.spec.mjs','node third.spec.mjs']);
  });
  await t.test('rejects the same command repeated across separate proof expressions',()=>{
    const source=line+'Proof: `node first.spec.mjs` and `node second.spec.mjs`\nProof: `node second.spec.mjs`\nTasks: T93, T95.\n';
    assert.throws(()=>activationCriterionInventory(source),/activation_duplicate_criterion_proof/);
  });
});
