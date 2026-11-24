import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {terminateOwnedNativeWorker} from './native-prisma-admission-guards.mjs';
import {buyerStorefrontInit,buyerStorefrontReady} from './service-buyer-storefront-contract.mjs';
const bounded=(promise,ms,code)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(code)),ms))]).finally(()=>clearTimeout(timer));};

/** Called only from the existing private issuer closure. No secret is returned
 * to the caller or included in errors, build evidence or child arguments. */
export async function createOwnedBuyerStorefront({runId,apiOrigin,credential}){
  const directory=fileURLToPath(new URL('../../storefront/',import.meta.url)),manifest=readFileSync(resolve(directory,'.next/required-server-files.json'));
  const artifact={buildId:readFileSync(resolve(directory,'.next/BUILD_ID'),'utf8').trim(),
    manifestSha256:createHash('sha256').update(manifest).digest('hex'),publicApiBaseUrl:'/api/v1'};
  assert.equal(JSON.parse(manifest).config.env.NEXT_PUBLIC_API_BASE_URL,'/api/v1','buyer_storefront_same_origin_bundle_required');
  const init=buyerStorefrontInit({type:'buyer_storefront_init',runId,apiOrigin,credential,artifact},runId);
  const child=spawn(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,
    fileURLToPath(new URL('./service-buyer-storefront.worker.mjs',import.meta.url))],
  {cwd:directory,env:constructionOnlyEnvironment(process.env),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let resolveReady,rejectReady,resolveClosed,rejectClosed,info,closed=false;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const acknowledged=new Promise((resolve,reject)=>{resolveClosed=resolve;rejectClosed=reject;});acknowledged.catch(()=>{});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{resolve({code,signal});
    if(!info)rejectReady(Error('buyer_storefront_child_exited'));}));
  // Drain without exposing headers, user data or the private IPC credential.
  let bytes=0;for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{
    bytes+=chunk.length;if(bytes>2_000_000){rejectReady(Error('buyer_storefront_output_limit'));child.kill();}
  });
  child.on('error',()=>{rejectReady(Error('buyer_storefront_child_failed'));rejectClosed(Error('buyer_storefront_child_failed'));});
  child.on('message',message=>{
    try{
      if(message?.type==='buyer_storefront_ready')resolveReady(buyerStorefrontReady(message,runId,artifact));
      else if(message?.type==='buyer_storefront_closed'){assert.deepEqual(message.evidence,{serverClosed:true,remainingSockets:0});resolveClosed(message.evidence);}
      else{assert.equal(message?.type,'buyer_storefront_failure');throw Error('buyer_storefront_child_failed');}
    }catch{rejectReady(Error('buyer_storefront_child_failed'));rejectClosed(Error('buyer_storefront_child_failed'));}
  });
  const close=async()=>{if(closed)return;closed=true;
    try{if(info&&child.exitCode===null&&child.connected){child.send({type:'close'});await bounded(acknowledged,25_000,'buyer_storefront_close_timeout');}
      const exit=await bounded(exited,5000,'buyer_storefront_natural_exit_required');assert.equal(exit.code,0);assert.equal(exit.signal,null);
    }finally{await terminateOwnedNativeWorker(child);}
  };
  try{child.send(init);info=await bounded(ready,45_000,'buyer_storefront_start_timeout');
    return Object.freeze({origin:info.origin,evidence:()=>structuredClone(info),close});
  }catch{await terminateOwnedNativeWorker(child);throw Error('buyer_storefront_start_failed');}
}
