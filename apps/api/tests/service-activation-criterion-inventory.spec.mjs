import assert from 'node:assert/strict';
import test from 'node:test';
import * as producer from './service-activation-release-producer.mjs';
const {activationCriterionInventory}=producer;

const entry=(id,proof='node actual.spec.mjs',indent='')=>`**C${id}** - WHEN a buyer chooses THEN the system SHALL preserve the approved result.\n${indent}Proof: \`${proof}\`\nTasks: T45, T93.\n`;
test('T94 complete criterion inventory',async t=>{
  await t.test('accepts the indented proof formatting already used by the approved checks',()=>{
    const result=activationCriterionInventory(entry(74,'node actual.spec.mjs','  '));
    assert.deepEqual(result,[{id:'C74',statement:'WHEN a buyer chooses THEN the system SHALL preserve the approved result.',proof:'node actual.spec.mjs',tasks:'T45, T93.'}]);
  });
  await t.test('retains every binding when source notes separate proof from task attribution',()=>{
    const raw=entry(1).replace('\nTasks:','\n\nEvidence boundary: local only.\n\nTasks:')+'\n'+entry(2);
    const result=activationCriterionInventory(raw);assert.equal(result.length,2);assert.deepEqual(result.map(value=>value.id),['C1','C2']);
    assert.deepEqual(result.map(value=>value.proof),['node actual.spec.mjs','node actual.spec.mjs']);
  });
  await t.test('cannot borrow a missing proof or task line from the following criterion',()=>{
    for(const raw of [entry(1).replace('Proof:','Missing:')+entry(2),entry(1).replace('Tasks:','Missing:')+entry(2)])assert.throws(()=>activationCriterionInventory(raw));
  });
  await t.test('rejects duplicate proof or task bindings rather than selecting a convenient one',()=>{
    for(const extra of ['Proof: `node actual.spec.mjs`\n','Tasks: T94.\n'])assert.throws(()=>activationCriterionInventory(entry(1)+extra));
  });
  await t.test('takes criteria only from the checks section and preserves complete multi-runner commands',()=>{
    const command='node one.spec.mjs && node two.spec.mjs';
    const raw='# Plan\n\n## Checks\n\n'+entry(1,command)+'\n## Handoff\n\n'+entry(99);
    assert.deepEqual(activationCriterionInventory(raw),[{id:'C1',statement:'WHEN a buyer chooses THEN the system SHALL preserve the approved result.',proof:command,tasks:'T45, T93.'}]);
  });
  await t.test('preserves both separately quoted commands in the current C82 binding',()=>{
    const expression='`node first.spec.mjs` and `node second.spec.mjs`';
    const result=activationCriterionInventory(entry(82).replace('`node actual.spec.mjs`',expression));
    assert.equal(result[0].proof,expression);
    assert.deepEqual(producer.activationProofCommands(result[0].proof),['node first.spec.mjs','node second.spec.mjs']);
  });
  await t.test('rejects ambiguous partial quoting without dropping any required runner',()=>{
    for(const expression of ['`node first.spec.mjs` ignored `node second.spec.mjs`','`node first.spec.mjs` and','`node first.spec.mjs` and ``'])
      assert.throws(()=>activationCriterionInventory(entry(82).replace('`node actual.spec.mjs`',expression)));
    assert.deepEqual(producer.activationProofCommands('node first.spec.mjs && node second.spec.mjs'),['node first.spec.mjs && node second.spec.mjs']);
  });
});
