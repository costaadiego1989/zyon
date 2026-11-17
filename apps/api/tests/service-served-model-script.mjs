import assert from 'node:assert/strict';

// Private synthetic transport input, not a route or productive model API.
const phases=new Set(['business.answer-plan','support.answer','storefront.intent','storefront.sales','storefront.reply-review']);
export function validateServedModelScript(value){
  assert.ok(Array.isArray(value)&&value.length>0&&value.length<=16,'local_model_script_size');
  const steps=structuredClone(value);
  for(const step of steps){
    assert.ok(step&&typeof step==='object'&&!Array.isArray(step));
    assert.ok(Object.keys(step).every(key=>['phase','response','toolCall','hold'].includes(key)));
    assert.ok(phases.has(step.phase));assert.ok(step.hold===undefined||typeof step.hold==='boolean');
    assert.equal(Object.hasOwn(step,'response'),!Object.hasOwn(step,'toolCall'));
    if(Object.hasOwn(step,'toolCall'))assert.equal(step.phase,'storefront.sales');
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
