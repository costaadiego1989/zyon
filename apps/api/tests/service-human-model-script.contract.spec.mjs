import assert from 'node:assert/strict';
import test from 'node:test';
import {validateServedModelScript} from './service-served-model-script.mjs';

// Drafted against the explicit local transport delta in ROOT71-REBASE.md.
// Current Root71 ABI has no humanToolCall and is not represented as ready.
test('T57 declared local human tool transport is bounded and never supplies authority',async t=>{
  await t.test('accepts only the one declared ordinary tool with a reason',()=>{
    const steps=[{phase:'storefront.sales',humanToolCall:{reason:'Synthetic selected ordinary tool'}}];
    assert.deepEqual(validateServedModelScript(steps),steps);
  });
  await t.test('rejects body identity/epoch fields and an unannounced tool selector',()=>{
    for(const patch of [{merchantId:'foreign'},{sessionId:'foreign'},{epoch:10},{accountId:'fake'},{tool:'create_case'}])
      assert.throws(()=>validateServedModelScript([{phase:'storefront.sales',humanToolCall:{reason:'Synthetic',...patch}}]));
  });
  await t.test('rejects mixed branches, wrong phases and overbound inputs',()=>{
    for(const steps of [[{phase:'support.answer',humanToolCall:{reason:'Synthetic'}}],
      [{phase:'storefront.sales',humanToolCall:{reason:'Synthetic'},response:'simulated success'}],
      [{phase:'storefront.sales',humanToolCall:{reason:''}}],Array.from({length:17},()=>({phase:'storefront.sales',response:'Synthetic'}))])
      assert.throws(()=>validateServedModelScript(steps));
  });
});
