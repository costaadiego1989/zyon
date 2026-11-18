import assert from 'node:assert/strict';

/** Local evaluation instrumentation only. It calls the registered method with
 * the original receiver/arguments and returns the exact result or exception.
 * Public synthetic results are copied for measurement; scope secrets are not. */
export function observeCanonicalLiveReader(reader,prototypeMethod,onObservation){
  assert.equal(typeof prototypeMethod,'function');assert.equal(typeof onObservation,'function');
  assert.equal(Object.getPrototypeOf(reader).read,prototypeMethod,'actual_reader_prototype_required');
  assert.equal(Object.hasOwn(reader,'read'),false,'unmodified_reader_required');
  const original=reader.read;let observed=0,faults=0,restored=false;
  const wrapper=async function(choice,scope){
    let input;
    try{input={choice:structuredClone(choice),merchantId:scope?.merchantId};}catch{faults++;}
    const result=await Reflect.apply(original,this,[choice,scope]);
    try{
      if(input){
        if(observed>=20)throw Error('evaluation_observation_limit');
        const snapshot={...input,result:structuredClone(result)};
        onObservation(snapshot);observed++;
      }
    }catch{faults++;}
    return result;
  };
  Object.defineProperty(reader,'read',{value:wrapper,writable:true,configurable:true});
  return Object.freeze({
    evidence:()=>Object.freeze({observedReads:observed,observerFaults:faults}),
    restore(){
      if(restored)return;
      assert.equal(reader.read,wrapper,'evaluation_reader_changed_before_restore');
      delete reader.read;assert.equal(reader.read,original);restored=true;
    },
  });
}
