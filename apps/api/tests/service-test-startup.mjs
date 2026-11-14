import {performance} from 'node:perf_hooks';

// These are local test budgets. Production connection, quota and application
// timeouts remain untouched. Integrity must settle once before boot is timed.
export const SERVICE_LOCAL_PREFLIGHT_MS=150_000;
export const SERVICE_LOCAL_BOOT_MS=110_000;
export const SERVICE_LOCAL_TEST_MS=600_000;

export async function awaitServiceStartup(preflight,ready){
  ready.catch(()=>{});
  const started=performance.now();
  await deadline(preflight,SERVICE_LOCAL_PREFLIGHT_MS,'service_preflight_timeout');
  const verified=performance.now();
  const info=await deadline(ready,SERVICE_LOCAL_BOOT_MS,'service_app_ready_timeout');
  return{info,timings:{preflightMs:Math.round(verified-started),bootMs:Math.round(performance.now()-verified)}};
}
async function deadline(work,milliseconds,code){
  let timer;
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
