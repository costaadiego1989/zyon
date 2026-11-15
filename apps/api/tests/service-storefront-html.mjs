import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {serviceTestEnvironment} from './service-test-runtime.mjs';
import {terminateOwnedNativeWorker} from './native-prisma-admission-guards.mjs';

function bounded(promise,ms,code){let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(code)),ms))]).finally(()=>clearTimeout(timer));}
/** Actual previously built Next application; no page/controller replacement. */
export async function createOwnedStorefrontHtml(runtime){
  const apiRoot=fileURLToPath(new URL('../',import.meta.url)),directory=resolve(apiRoot,'../storefront');
  const env={...serviceTestEnvironment(process.env),AACP_API_URL:runtime.apiOrigin,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'};
  const child=spawn(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,fileURLToPath(new URL('./service-storefront-html.worker.mjs',import.meta.url)),directory,runtime.apiOrigin],
    {cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let tail='',resolveReady,rejectReady,resolveClose,rejectClose,closed=false,info;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const acknowledged=new Promise((resolve,reject)=>{resolveClose=resolve;rejectClose=reject;});acknowledged.catch(()=>{});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>tail=(tail+String(bytes)).slice(-4000));
  child.on('error',error=>{rejectReady(error);rejectClose(error);});
  child.on('message',message=>{
    if(message.type==='ready')resolveReady(message);
    if(message.type==='closed')resolveClose(message.evidence);
    if(message.type==='failure'){const error=new Error('service_storefront_html_failure:'+String(message.code).slice(0,1200));rejectReady(error);rejectClose(error);}
  });
  child.on('exit',code=>{if(!info)rejectReady(new Error('service_storefront_html_exit:'+code+':'+tail));});
  const close=async()=>{
    if(closed)return;closed=true;
    try{
      if(info&&child.exitCode===null&&child.connected){child.send({type:'close'});assert.deepEqual(await bounded(acknowledged,25_000,'service_storefront_html_close_ack'),{serverClosed:true,remainingSockets:0});}
      const result=await bounded(exited,5000,'service_storefront_html_natural_exit_required');assert.equal(result.code,0);assert.equal(result.signal,null);
    }finally{await terminateOwnedNativeWorker(child);}
  };
  try{
    info=await bounded(ready,45_000,'service_storefront_html_startup_timeout');
    const origin=new URL(info.origin);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');assert.ok(Number(origin.port)>1024);assert.equal(info.evidence.actualNextApplication,true);
    return{origin:origin.origin,evidence:()=>info.evidence,close};
  }catch(error){await terminateOwnedNativeWorker(child);throw error;}
}
