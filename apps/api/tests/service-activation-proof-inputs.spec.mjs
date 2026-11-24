import assert from 'node:assert/strict';
import test from 'node:test';
import {assertActivationProofSourceInputs} from './service-activation-release-producer.mjs';

const current=()=>({inputSha256:'a'.repeat(64),files:[
  {path:'apps/api/tests/business-rag-evaluation.spec.mjs',sha256:'b'.repeat(64)},
  {path:'apps/api/tests/business-rag-canonical-live-observer.spec.mjs',sha256:'c'.repeat(64)},
]});
const receipt=measured=>({proofSourceInputSha256:measured.inputSha256,proofInputFiles:structuredClone(measured.files)});
test('T94 actual proof source binding',async t=>{
  await t.test('accepts exact runner-recorded file bytes and common harness inventory',()=>{
    const measured=current();assert.doesNotThrow(()=>assertActivationProofSourceInputs(receipt(measured),measured));
  });
  await t.test('same selected filename and passing raw output cannot hide changed test bytes',()=>{
    const measured=current(),reported=receipt(measured);reported.proofInputFiles[0].sha256='d'.repeat(64);
    assert.throws(()=>assertActivationProofSourceInputs(reported,measured),/activation_proof_file_changed/);
  });
  await t.test('rejects shortened, duplicated or substituted file inventories',()=>{
    const measured=current(),reported=receipt(measured);
    for(const files of [[],reported.proofInputFiles.slice(1),[reported.proofInputFiles[0],reported.proofInputFiles[0]],
      [reported.proofInputFiles[0],{...reported.proofInputFiles[1],path:'apps/api/tests/other.spec.mjs'}]])
      assert.throws(()=>assertActivationProofSourceInputs({...reported,proofInputFiles:files},measured));
  });
  await t.test('changed loader, network guard or fixture tree invalidates an otherwise matching receipt',()=>{
    const measured=current();assert.throws(()=>assertActivationProofSourceInputs({...receipt(measured),proofSourceInputSha256:'e'.repeat(64)},measured),/activation_proof_source_changed/);
    assert.throws(()=>assertActivationProofSourceInputs({proofInputFiles:measured.files},measured));
  });
});
