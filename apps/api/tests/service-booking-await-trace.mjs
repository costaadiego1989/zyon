import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';

const profile='native18-v1';
const methods=new Set(['native.respond','booking.select','booking.prepare','booking.review','checkout.start','holds.prepare','holds.state']);
const phases=new Set(['enter','resolve','reject','throw']);
const operations=new Set(['offer','professional','date','slot','continue','confirm','back','refine','other']);
const valid=(condition,code)=>assert.ok(condition,code);
export function validateOwnedBookingAwaitTrace(options){
  if(options.bookingAwaitTrace===undefined)return undefined;
  valid(options.bookingAwaitTrace===profile,'booking_await_trace_profile_invalid');
  valid(options.local===true&&!!options.whatsapp&&options.metaCapabilitiesFixture==='owned-empty-v1'
    &&options.recoveryTemplateMonitorFixture==='manual-only-v1'
    &&!options.graph&&!options.buyerBooking&&options.modelScript===undefined
    &&options.supportQueryModel===undefined&&options.storefrontQueryModel===undefined,'booking_await_trace_native18_required');
  return profile;
}
/** Observation only: no argument, result, error, identifier or caller text is emitted. */
export function observeOwnedBookingAwaits(selected,bindings,onEvent){
  if(selected===undefined)return undefined;
  valid(selected===profile&&Array.isArray(bindings)&&bindings.length>0&&bindings.length<=7&&typeof onEvent==='function','booking_await_trace_bindings_invalid');
  const parents=new AsyncLocalStorage(),prepared=[],seen=new Set();
  for(const binding of bindings){
    const {instance,prototype,method,label}=binding;
    valid(instance&&Object.getPrototypeOf(instance)===prototype&&typeof method==='string'&&methods.has(label)
      &&!seen.has(label)&&!Object.hasOwn(instance,method),'booking_await_trace_binding_invalid');
    const descriptor=Object.getOwnPropertyDescriptor(prototype,method);
    valid(descriptor&&typeof descriptor.value==='function'&&descriptor.configurable===true,'booking_await_trace_binding_invalid');
    prepared.push({instance,method,label,original:descriptor.value});seen.add(label);
  }
  let sequence=0,callSequence=0,observerFaults=0,restored=false;
  const emit=(entry,phase)=>{
    if(restored)return;
    try{onEvent(Object.freeze({sequence:++sequence,...entry,phase}));}catch{observerFaults++;}
  };
  try{
    for(const binding of prepared){
      const {instance,method,label,original}=binding;
      binding.wrapper=function(...args){
        const parentId=parents.getStore()??null,callId=++callSequence;
        const candidate=label==='native.respond'?args[0]?.action?.operation:undefined;
        const entry={callId,parentId,method:label,...(label==='native.respond'?{operation:operations.has(candidate)?candidate:'other'}:{})};
        emit(entry,'enter');
        let result;
        try{result=parents.run(callId,()=>Reflect.apply(original,this,args));}
        catch(error){emit(entry,'throw');throw error;}
        // Canonical methods return native Promises. Return the identical object; the
        // detached observer callbacks cannot replace its value/rejection or authority ALS.
        if(result instanceof Promise){
          try{Promise.prototype.then.call(result,()=>emit(entry,'resolve'),()=>emit(entry,'reject'));}
          catch{observerFaults++;}
        }else emit(entry,'resolve');
        return result;
      };
      Object.defineProperty(instance,method,{value:binding.wrapper,writable:true,configurable:true,enumerable:false});
    }
  }catch(error){for(const binding of prepared)if(Object.hasOwn(binding.instance,binding.method))delete binding.instance[binding.method];throw error;}
  return Object.freeze({
    evidence:()=>Object.freeze({profile,observedMethods:prepared.length,events:sequence,observerFaults,restored}),
    restore(){
      if(restored)return;
      let failed=false;
      for(const binding of prepared){
        const descriptor=Object.getOwnPropertyDescriptor(binding.instance,binding.method);
        if(!descriptor||descriptor.value!==binding.wrapper||descriptor.configurable!==true||descriptor.writable!==true||descriptor.enumerable!==false)failed=true;
        try{if(!Reflect.deleteProperty(binding.instance,binding.method))failed=true;}catch{failed=true;}
      }
      restored=true;
      valid(!failed,'booking_await_trace_restore_failed');
    }
  });
}
/** A diagnostic ring, independent of (and not enlarging) model-script budgets. */
export function createOwnedBookingAwaitCollector(){
  let lastSequence=0,droppedRecent=0,untrackedActive=0;
  const recent=[],active=new Map();
  const invalid=condition=>valid(condition,'booking_await_trace_event_invalid');
  return Object.freeze({
    accept(event){
      invalid(event&&typeof event==='object'&&!Array.isArray(event)
        &&Object.keys(event).every(key=>['sequence','callId','parentId','method','phase','operation'].includes(key))
        &&Number.isSafeInteger(event.sequence)&&event.sequence===lastSequence+1
        &&Number.isSafeInteger(event.callId)&&event.callId>0
        &&(event.parentId===null||Number.isSafeInteger(event.parentId)&&event.parentId>0&&event.parentId<event.callId)
        &&methods.has(event.method)&&phases.has(event.phase)
        &&(event.operation===undefined||event.method==='native.respond'&&operations.has(event.operation)));
      const safe=Object.freeze({...event});lastSequence=event.sequence;
      if(event.phase==='enter'){
        if(active.size<32)active.set(event.callId,safe);else untrackedActive++;
      }else active.delete(event.callId);
      recent.push(safe);if(recent.length>24){recent.shift();droppedRecent++;}
    },
    snapshot:()=>({lastSequence,active:[...active.values()].map(e=>({...e})),recent:recent.map(e=>({...e})),droppedRecent,untrackedActive})
  });
}
