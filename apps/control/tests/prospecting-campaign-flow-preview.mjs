import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join,relative} from 'node:path';
export const campaignFolder=fileURLToPath(new URL('../../../.specs/features/admin-prospecting-campaign-flow/',import.meta.url));
const root=fileURLToPath(new URL('../../../',import.meta.url));
const listener=fileURLToPath(new URL('../../../.specs/features/admin-company-prospecting/browser-runtime/listeners.json',import.meta.url));
const receipt=campaignFolder+'browser-runtime.json';
async function alive(origins){try{return (await fetch(origins.api+'/v1/platform/prospecting/config',{signal:AbortSignal.timeout(3000)})).status===401;}catch{return false;}}
async function available(port){await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
function sourceFingerprint(){
 const files=[];
 function walk(folder){for(const entry of readdirSync(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.ts')&&!entry.name.endsWith('.spec.ts'))files.push(file);}}
 for(const folder of ['apps/api/src/modules/platform-prospecting','apps/api/src/modules/platform-control','packages/shared-types/src'])walk(join(root,folder));
 for(const file of ['apps/api/src/modules/payment/public-platform-sales-offers.ts','apps/api/tests/prospecting-browser-services.ts','apps/api/tests/prospecting-browser-runtime.ts','apps/api/tests/prospecting-browser-data.ts','apps/api/tests/prospecting-browser-accounts.ts','apps/api/tests/prospecting-fixture.ts'])files.push(join(root,file));
 const hash=createHash('sha256');for(const file of files.sort())hash.update(relative(root,file)).update('\0').update(readFileSync(file));return hash.digest('hex');
}
async function validateOwnedDataset(value){
 if(resolve(value.sourceRoot??'')!==resolve(root)||!Number.isSafeInteger(value.apiPid)||!/^prospecting_test_[a-f0-9]{32}$/.test(value.database)||typeof value.owner!=='string')throw Error('campaign_preview_ownership_invalid');
 const cfg=JSON.parse(readFileSync(join(root,'.specs/features/admin-company-prospecting/environment.local.json'),'utf8')),url=new URL(cfg.databaseUrl);
 if(url.hostname!=='127.0.0.1'||url.port!=='15438')throw Error('campaign_preview_database_not_owned_loopback');url.pathname='/'+value.database;url.search='';
 const {Pool}=createRequire(new URL('../../api/package.json',import.meta.url))('pg'),pool=new Pool({connectionString:url.href,max:1});
 try{if((await pool.query('SELECT owner FROM browser_runtime_owner')).rows[0]?.owner!==value.owner)throw Error('campaign_preview_database_owner_mismatch');if((await pool.query("SELECT count(*)::int AS count FROM company_directory.company_establishments WHERE snapshot_id='search-old' AND uf='SP' AND main_cnae='4781400'")).rows[0].count!==25)throw Error('campaign_preview_dataset_mismatch');}finally{await pool.end();}
}
export async function ensureCampaignPreview(){
 mkdirSync(campaignFolder,{recursive:true});
 const fingerprint=sourceFingerprint();
 if(existsSync(receipt)){
  const prior=JSON.parse(readFileSync(receipt,'utf8'));
  if(prior.origins?.api==='http://127.0.0.1:3067'&&await alive(prior.origins)){
   await validateOwnedDataset(prior);if(prior.sourceFingerprint===fingerprint)return prior;
   // Only the process tied to this root, database owner and loopback origin receives its stop file.
   writeFileSync(join(root,'.specs/features/admin-company-prospecting/browser-runtime/stop-'+prior.apiPid),'owned source refresh');
   const deadline=Date.now()+15000;while(await alive(prior.origins)){if(Date.now()>deadline)throw Error('campaign_preview_owned_stop_timeout');await new Promise(resolve=>setTimeout(resolve,200));}
  }
 }
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
    const value={...current,source:'actual local HTTP/PG with controlled providers',sourceRoot:root,sourceFingerprint:fingerprint,controlMode:'vite-dev-explicit-loopback-api'};
    await validateOwnedDataset(value);
    writeFileSync(receipt,JSON.stringify(value,null,2)+'\n');return value;
   }
  }
  if(child.exitCode!==null)throw Error('campaign_preview_start_failed: inspect owned browser-runtime.log');
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 throw Error('campaign_preview_start_timeout: inspect owned browser-runtime.log');
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await ensureCampaignPreview()));
