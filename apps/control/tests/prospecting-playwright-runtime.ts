import {spawn} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
export default async function setup(){
 const cwd=fileURLToPath(new URL("../../../",import.meta.url));
 const folder=fileURLToPath(new URL("../../../.specs/features/admin-company-prospecting/browser-runtime/",import.meta.url));
 const child=spawn(process.execPath,["--loader","./apps/api/tests/platform-support-loader.mjs","./apps/api/tests/prospecting-browser-runtime.ts","--disposable"],{cwd,windowsHide:true,stdio:"inherit"});
 const exit=new Promise<void>((resolve,reject)=>{child.once("exit",()=>resolve());child.once("error",reject);});
 const deadline=Date.now()+120000;
 async function stop(){
  if(child.exitCode!==null||child.signalCode!==null)return;
  writeFileSync(folder+"/stop-"+child.pid,"");
  const timeout=setTimeout(()=>child.kill(),30000);
  try{await exit;}finally{clearTimeout(timeout);}
 }
 try{
  while(Date.now()<deadline){
   if(child.exitCode!==null||child.signalCode!==null)throw Error("prospecting_browser_start_failed");
   if(existsSync(folder+"/listeners.json")){
    const current=JSON.parse(readFileSync(folder+"/listeners.json","utf8"));
    if(current.apiPid===child.pid&&current.mode==="disposable")return stop;
   }
   await delay(250);
  }
  throw Error("prospecting_browser_start_timeout");
 }catch(e){await stop();throw e;}
}
