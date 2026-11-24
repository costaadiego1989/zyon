import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
export const campaignFolder=fileURLToPath(new URL('../../../.specs/features/admin-prospecting-campaign-flow/',import.meta.url));
const root=fileURLToPath(new URL('../../../',import.meta.url));
const listener=fileURLToPath(new URL('../../../.specs/features/admin-company-prospecting/browser-runtime/listeners.json',import.meta.url));
const receipt=campaignFolder+'browser-runtime.json';
async function alive(origins){try{return (await fetch(origins.api+'/v1/platform/prospecting/config',{signal:AbortSignal.timeout(3000)})).status===401;}catch{return false;}}
async function available(port){await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
export async function ensureCampaignPreview(){
 mkdirSync(campaignFolder,{recursive:true});
 if(existsSync(receipt)){const prior=JSON.parse(readFileSync(receipt,'utf8'));if(prior.origins?.api==='http://127.0.0.1:3067'&&await alive(prior.origins))return prior;}
 for(const port of [3067,5227,5228,5229])await available(port);
 const env={NODE_ENV:'test',PROSPECTING_BROWSER_BASE_PORT:'3067',PROSPECTING_CAMPAIGN_FLOW_PREVIEW:'true'};
 for(const key of ['SystemRoot','SYSTEMROOT','PATH','Path','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ComSpec'])if(process.env[key])env[key]=process.env[key];
 const log=openSync(campaignFolder+'browser-runtime.log','a');
 const child=spawn(process.execPath,['--loader','./apps/api/tests/platform-support-loader.mjs','./apps/api/tests/prospecting-browser-runtime.ts','--preview'],{cwd:root,env,windowsHide:true,detached:true,stdio:['ignore',log,log]});
 closeSync(log);child.unref();
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  if(existsSync(listener)){
   const current=JSON.parse(readFileSync(listener,'utf8'));
   if(current.apiPid===child.pid&&current.origins.api==='http://127.0.0.1:3067'&&await alive(current.origins)){
    const value={...current,source:'actual local HTTP/PG with controlled providers',sourceRoot:root,controlMode:'vite-dev-explicit-loopback-api'};
    writeFileSync(receipt,JSON.stringify(value,null,2)+'\n');return value;
   }
  }
  if(child.exitCode!==null)throw Error('campaign_preview_start_failed: inspect owned browser-runtime.log');
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 throw Error('campaign_preview_start_timeout: inspect owned browser-runtime.log');
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await ensureCampaignPreview()));
