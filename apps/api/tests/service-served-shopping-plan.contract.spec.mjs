import assert from 'node:assert/strict';
import test from 'node:test';
import {validateServedModelScript,createServedModelScript} from './service-served-model-script.mjs';
const wire=()=>({schemaVersion:1,plan:{version:1,query:'fone',discountOnly:null,recovery:null,minPriceCents:null,maxPriceCents:10000,
  minRating:4,minPriceExclusive:null,maxPriceExclusive:null,minRatingExclusive:null,attributes:[],attributeAnyOf:null,
  sortBy:'price_asc',delivery:null,unsupportedCriteria:[]}});
const step=()=>({phase:'storefront.shopping-plan',response:wire()});

test('S2A exact existing shopping-plan phase carries only criteria through original ordered script',async()=>{
  const input=step(),events=[],script=createServedModelScript([input]);
  assert.deepEqual(await script.next('storefront.shopping-plan',event=>events.push(event)),input);
  assert.deepEqual(events,[{...input,scriptStep:1,held:false}]);script.close();
});
test('S2A misspelled or arbitrary phase and any tool call at the planner phase are refused',()=>{
  for(const phase of ['storefront.shopping_plan','shopping_plan','payment.confirm'])assert.throws(()=>validateServedModelScript([{...step(),phase}]));
  for(const field of ['toolCall','humanToolCall','serviceToolCall'])assert.throws(()=>validateServedModelScript([{phase:'storefront.shopping-plan',[field]:{}}]));
});
test('S2A planner wire refuses result payloads and extra identity or commercial override fields',()=>{
  const bad=[null,[],JSON.stringify(wire()),{...wire(),products:[{id:'forged',price:1}]},
    {...wire(),plan:{...wire().plan,merchantId:'foreign'}},{...wire(),plan:{...wire().plan,price:1}},
    {...wire(),plan:{...wire().plan,cartId:'forged'}},{...wire(),schemaVersion:2}];
  for(const response of bad)assert.throws(()=>validateServedModelScript([{phase:'storefront.shopping-plan',response}]));
});
test('S2A bounded full nullable plan is copied and cannot acquire caller mutations',()=>{
  const input=[step()],copy=validateServedModelScript(input);input[0].response.plan.maxPriceCents=1;
  assert.equal(copy[0].response.plan.maxPriceCents,10000);assert.deepEqual(Object.keys(copy[0].response.plan).sort(),Object.keys(wire().plan).sort());
  const missing=wire();delete missing.plan.minRating;assert.throws(()=>validateServedModelScript([{phase:'storefront.shopping-plan',response:missing}]));
});
test('S2A preserves original sixteen-step, six-thousand-step and sixty-five-hundred-total bounds',()=>{
  const small={phase:'storefront.intent',response:{}};
  assert.equal(validateServedModelScript(Array.from({length:16},()=>small)).length,16);
  assert.throws(()=>validateServedModelScript(Array.from({length:17},()=>small)),/local_model_script_size/);
  assert.throws(()=>validateServedModelScript([{phase:'storefront.intent',response:'x'.repeat(6000)}]),/local_model_script_step_bounded/);
  assert.throws(()=>validateServedModelScript([{phase:'storefront.intent',response:'x'.repeat(3400)},{phase:'storefront.intent',response:'x'.repeat(3400)}]),/local_model_script_total_bounded/);
});
test('S2A existing response phase/default script and phase-order refusal remain intact',async()=>{
  assert.equal(createServedModelScript(undefined),undefined);
  const prior={phase:'support.answer',response:'Unchanged default shape'};assert.deepEqual(validateServedModelScript([prior]),[prior]);
  const script=createServedModelScript([step()]);let captured=0;
  await assert.rejects(script.next('storefront.sales',()=>{captured++;}),/local_model_script_phase/);assert.equal(captured,0);script.close();
});