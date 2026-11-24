import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {validateCapturedProductPaymentControl} from './product-captured-payment-fixture.mjs';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));

/** Parent closure only. Secret Asaas header is never returned to tests, browser,
 * ready/evidence/stdout, a URL or file. All HTTP targets are the owned API. */
export function createCapturedProductPaymentChannel({enabled=false,runId,send,apiOrigin,fetchOwned=globalThis.fetch}){
  if(!enabled)return undefined;
  assert.ok(/^[a-f0-9-]{36}$/.test(runId)&&typeof send==='function'&&typeof apiOrigin==='function');
  let closed=false;const pending=new Map(),requests=new Set();
  const alive=()=>assert.ok(!closed,'captured_product_payment_channel_closed');
  const request=(operation,input)=>{
    alive();assert.ok(pending.size<8,'captured_product_payment_control_bound');
    const requestId=randomBytes(16).toString('hex');
    const message=validateCapturedProductPaymentControl({type:'local_product_payment_request',runId,requestId,operation,input},runId);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('captured_product_payment_control_timeout'));},15000);
      pending.set(requestId,{resolve,reject,timer,operation});
      try{assert.notEqual(send(message),false);}catch{clearTimeout(timer);pending.delete(requestId);reject(Error('captured_product_payment_worker_unavailable'));}
    });
  };
  const facade=Object.freeze({
    async bind(ownerToken){const value=await request('bind',{ownerToken});
      assert.ok(keys(value,['merchantId','syntheticSandboxConnection'])&&typeof value.merchantId==='string'&&value.syntheticSandboxConnection===true);
      return structuredClone(value);
    },
    async notify(intentId,variant='matching'){
      const envelope=await request('notification',{intentId,variant});alive();
      assert.ok(keys(envelope,['path','headers','body'])&&envelope.path==='/webhooks/asaas'
        &&keys(envelope.headers,['content-type','asaas-access-token'])&&envelope.headers['content-type']==='application/json'
        &&typeof envelope.headers['asaas-access-token']==='string'&&envelope.headers['asaas-access-token'].length<=128
        &&record(envelope.body)&&envelope.body.event==='PAYMENT_RECEIVED','captured_product_payment_envelope_invalid');
      const origin=new URL(apiOrigin());assert.ok(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'
        &&Number(origin.port)>1024&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,
        'captured_product_payment_owned_http_required');
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);requests.add(abort);
      try{
        const response=await fetchOwned(origin.origin+envelope.path,{method:'POST',redirect:'error',signal:abort.signal,
          headers:envelope.headers,body:JSON.stringify(envelope.body)});
        const body=await response.json();alive();const encoded=JSON.stringify(body);
        assert.ok(encoded.length<=20000&&!encoded.includes(envelope.headers['asaas-access-token']),'captured_product_payment_response_invalid');
        return{status:response.status,body};
      }finally{clearTimeout(timer);requests.delete(abort);}
    },
  });
  return Object.freeze({public:facade,
    accept(message){
      assert.ok(keys(message,['type','runId','requestId','result','error'])&&message.type==='local_product_payment_result'
        &&message.runId===runId&&/^[a-f0-9]{32}$/.test(message.requestId??''),'captured_product_payment_reply_invalid');
      if(closed)return false;
      const item=pending.get(message.requestId);assert.ok(item,'captured_product_payment_reply_unknown');
      clearTimeout(item.timer);pending.delete(message.requestId);
      message.error?item.reject(Error('captured_product_payment_control_failed')):item.resolve(message.result);return true;
    },
    close(){if(closed)return;closed=true;for(const controller of requests)controller.abort();requests.clear();
      for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('captured_product_payment_channel_closed'));}pending.clear();},
  });
}