import assert from 'node:assert/strict';
import test from 'node:test';
import {validateServedModelScript,createServedModelScript} from './service-served-model-script.mjs';

test('local served model control accepts only the explicit bounded transport phases and one result shape',()=>{
  const valid={phase:'support.answer',response:'Synthetic reply'};
  assert.deepEqual(validateServedModelScript([valid]),[valid]);
  for(const bad of [[],Array(17).fill(valid),[{...valid,merchantId:'foreign'}],
    [{...valid,phase:'charge_customer'}],[{...valid,toolCall:{variantId:'anything'}}],
    [{phase:'business.answer-plan',toolCall:{productId:'anything'}}],
    [{...valid,response:'x'.repeat(6501)}]])assert.throws(()=>validateServedModelScript(bad));
  const original=[valid],script=validateServedModelScript(original);original[0].response='changed';
  assert.equal(script[0].response,'Synthetic reply');
});

test('held local transport captures before the last await and resumes only its declared step',async()=>{
  const expected={phase:'support.answer',response:'Original reply',hold:true};
  const script=createServedModelScript([expected]);let captured,settled=false;
  const pending=script.next('support.answer',event=>{captured=event;}).then(value=>{settled=true;return value;});
  assert.deepEqual(captured,{...expected,scriptStep:1,held:true});
  await Promise.resolve();assert.equal(settled,false);assert.throws(()=>script.release(2));
  script.release(1);assert.deepEqual(await pending,expected);assert.equal(settled,true);
  assert.throws(()=>script.release(1));script.close();
});

test('unknown phase, exhausted script and cleanup cannot create an unobserved model result',async()=>{
  const wrong=createServedModelScript([{phase:'support.answer',response:'Synthetic'}]);let captures=0;
  await assert.rejects(wrong.next('storefront.sales',()=>{captures++;}));assert.equal(captures,0);wrong.close();
  const held=createServedModelScript([{phase:'support.answer',response:'Never returned',hold:true}]);
  const pending=held.next('support.answer',()=>{captures++;});held.close();
  await assert.rejects(pending,/local_model_fixture_closed/);assert.equal(captures,1);
  await assert.rejects(held.next('support.answer',()=>{captures++;}));assert.equal(captures,1);
  const once=createServedModelScript([{phase:'support.answer',response:'One result'}]);
  assert.equal((await once.next('support.answer',()=>{})).response,'One result');
  await assert.rejects(once.next('support.answer',()=>{}),/local_model_script_exhausted/);once.close();
});
