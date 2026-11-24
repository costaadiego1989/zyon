import assert from 'node:assert/strict';
import {validateProductReadToolCall} from './service-product-read-model-fixture.mjs';

// Private synthetic transport input, not a route or productive model API.
const phases=new Set(['business.answer-plan','support.answer','storefront.intent','storefront.sales','storefront.reply-review','storefront.shopping-plan']);
const serviceNames=new Set(['get_service_professionals','get_service_dates','get_service_slots','resolve_service_selection']);
export function validateServedModelScript(value){
  assert.ok(Array.isArray(value)&&value.length>0&&value.length<=16,'local_model_script_size');
  const steps=structuredClone(value);
  for(const step of steps){
    assert.ok(step&&typeof step==='object'&&!Array.isArray(step));
    assert.ok(Object.keys(step).every(key=>['phase','response','toolCall','humanToolCall','serviceToolCall','productReadToolCall','hold'].includes(key)));
    assert.ok(phases.has(step.phase));assert.ok(step.hold===undefined||typeof step.hold==='boolean');
    assert.equal(['response','toolCall','humanToolCall','serviceToolCall','productReadToolCall'].filter(key=>Object.hasOwn(step,key)).length,1);
    if(Object.hasOwn(step,'toolCall')||Object.hasOwn(step,'humanToolCall')||Object.hasOwn(step,'serviceToolCall')||Object.hasOwn(step,'productReadToolCall'))assert.equal(step.phase,'storefront.sales');
    if(Object.hasOwn(step,'productReadToolCall'))validateProductReadToolCall(step.productReadToolCall);
    if(step.phase==='storefront.shopping-plan'){
      // Private transport envelope only. The ORIGINAL productive planner Zod
      // schema still validates every field/constraint before the real read.
      const wire=step.response;
      assert.ok(wire&&typeof wire==='object'&&!Array.isArray(wire),'local_shopping_plan_wire');
      assert.deepEqual(Object.keys(wire).sort(),['plan','schemaVersion']);assert.equal(wire.schemaVersion,1);
      assert.ok(wire.plan&&typeof wire.plan==='object'&&!Array.isArray(wire.plan));
      assert.deepEqual(Object.keys(wire.plan).sort(),['version','query','discountOnly','recovery','minPriceCents','maxPriceCents','minRating',
        'minPriceExclusive','maxPriceExclusive','minRatingExclusive','attributes','attributeAnyOf','sortBy','delivery','unsupportedCriteria'].sort());
      assert.equal(wire.plan.version,1);
    }
    if(Object.hasOwn(step,'serviceToolCall')){
      const call=step.serviceToolCall;
      assert.ok(call&&typeof call==='object'&&!Array.isArray(call)&&Object.keys(call).every(key=>['name','args','narration'].includes(key)));
      assert.ok(serviceNames.has(call.name)&&call.args&&typeof call.args==='object'&&!Array.isArray(call.args));
      assert.ok(call.narration===undefined||typeof call.narration==='string'&&call.narration.length<=600);
    }
    if(Object.hasOwn(step,'humanToolCall')){
      const call=step.humanToolCall;
      assert.ok(call&&typeof call==='object'&&!Array.isArray(call));
      assert.deepEqual(Object.keys(call),['reason']);
      assert.ok(typeof call.reason==='string'&&call.reason.trim().length>0&&call.reason.length<=2000);
    }
    assert.ok(JSON.stringify(step).length<=6000,'local_model_script_step_bounded');
  }
  assert.ok(JSON.stringify(steps).length<=6500,'local_model_script_total_bounded');return steps;
}
export function createServedModelScript(value){
  if(value===undefined)return undefined;
  const steps=validateServedModelScript(value),waiting=new Map();let index=0,closed=false;
  return {
    async next(phase,capture){
      assert.equal(closed,false);const step=steps[index++];assert.ok(step,'local_model_script_exhausted');
      assert.equal(step.phase,phase,'local_model_script_phase');const sequence=index;
      let wait,timer;
      if(step.hold)wait=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{waiting.delete(sequence);reject(new Error('local_model_hold_unreleased'));},10_000);
        waiting.set(sequence,{resolve,reject,timer});
      });
      // Capture happens before the last model await; the real parent sees this
      // existing bounded IPC event, commits its SQL change, and releases it.
      try{
        capture({...structuredClone(step),scriptStep:sequence,held:step.hold===true});
        if(wait)await wait;
      }finally{if(timer)clearTimeout(timer);waiting.delete(sequence);}
      return structuredClone(step);
    },
    release(sequence){
      assert.ok(Number.isSafeInteger(sequence)&&sequence>0&&sequence<=steps.length);
      const pending=waiting.get(sequence);assert.ok(pending,'local_model_hold_not_waiting');pending.resolve();
    },
    close(){closed=true;for(const pending of waiting.values()){
      clearTimeout(pending.timer);pending.reject(new Error('local_model_fixture_closed'));
    }waiting.clear();},
  };
}
