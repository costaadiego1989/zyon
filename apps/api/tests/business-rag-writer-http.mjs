import assert from 'node:assert/strict';
import {companyHttpFixture} from './service-company-http-fixture.mjs';

const states=new WeakMap();

/** Honor the real server quota without overriding limits or retrying mutations.
 * Every T65 companion shares the same per-runtime/token observation. */
export function businessRagWriterHttp(runtime){
  let state=states.get(runtime);
  if(!state){state={resumeAt:new Map()};states.set(runtime,state);}
  const raw=companyHttpFixture(runtime);
  const ready=async token=>{
    const delay=(state.resumeAt.get(token)??0)-Date.now();
    if(delay>0){assert.ok(delay<=60_100,'server_rate_limit_interval_bounded');await new Promise(resolve=>setTimeout(resolve,delay));}
  };
  const request=async(path,body,token,method='PUT',headers={})=>{
    await ready(token);
    const result=await raw.request(path,body,token,method,headers);
    const remaining=Number(result.headers.get('x-ratelimit-remaining')),reset=Number(result.headers.get('x-ratelimit-reset'));
    if(token&&Number.isFinite(remaining)&&remaining<=5&&Number.isFinite(reset)&&reset>0)
      state.resumeAt.set(token,reset*1000+50);
    return result;
  };
  return{...raw,request,ready};
}
