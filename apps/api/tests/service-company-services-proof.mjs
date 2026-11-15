import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serviceTestEnvironment} from './service-test-runtime.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';

const args=process.argv.slice(2),browserOnly=args.length===1&&args[0]==='--browser-only',reuse=args.length===2&&args[0]==='--reuse-browser';
assert.ok(args.length===0||browserOnly||reuse,'one_local_company_services_proof_required');
const root=fileURLToPath(new URL('../../../',import.meta.url)),api=resolve(root,'apps/api'),feature=resolve(root,'.specs/features/whatsapp-service-booking-business-rag');
const capturedAt=new Date().toISOString(),startedAt=Date.now(),proofRoot=resolve(feature,'captures/company-services-proof'),directory=resolve(proofRoot,capturedAt.replaceAll(':','-'));
mkdirSync(directory,{recursive:true});
assert.ok(process.env.LOCALAPPDATA,'cached_pnpm_required');
const cache=resolve(process.env.LOCALAPPDATA,'pnpm/.tools/pnpm/9.15.0/node_modules'),launcher=resolve(cache,'pnpm/bin/pnpm.cjs');
assert.equal(JSON.parse(readFileSync(resolve(cache,'pnpm/package.json'),'utf8')).version,'9.15.0');
const base=serviceTestEnvironment(process.env);
const env={...Object.fromEntries(Object.entries(base).filter(([name])=>name.toLowerCase()!=='path')),LOCALAPPDATA:process.env.LOCALAPPDATA,
 PATH:resolve(cache,'.bin')+';'+process.env.PATH,NODE_OPTIONS:'--import '+new URL('./test-network-guard.mjs',import.meta.url).href,
 SERVICE_COMPANY_PROOF_REPORT:resolve(directory,'browser.json')};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uiFiles=['apps/dashboard/e2e/service-company-service-names.spec.ts','apps/dashboard/e2e/service-company-services-fixture.mjs','apps/dashboard/playwright.service-local.config.ts','apps/dashboard/e2e/service-local-setup.mjs'];
function addFrontendInputs(directory){
 if(!existsSync(directory))return;
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  assert.equal(entry.isSymbolicLink(),false,'mutable_front_input_symlink_forbidden');
  const path=resolve(directory,entry.name);
  if(entry.isDirectory())addFrontendInputs(path);else uiFiles.push(relative(root,path).replaceAll('\\','/'));
 }
}
addFrontendInputs(resolve(root,'apps/dashboard/src'));addFrontendInputs(resolve(root,'apps/dashboard/public'));
for(const entry of readdirSync(resolve(root,'apps/dashboard'),{withFileTypes:true}))
 if(entry.isFile()&&/\.(?:[cm]?js|[cm]?ts|json|html)$/.test(entry.name))uiFiles.push('apps/dashboard/'+entry.name);
uiFiles.splice(0,uiFiles.length,...new Set(uiFiles));uiFiles.sort();
const nativeFiles=['apps/api/tests/service-company-service-names.integration.spec.mjs','apps/api/tests/service-storefront-html.mjs','apps/api/tests/service-storefront-html.worker.mjs'];
const sources=files=>files.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))}));
const uiInput=sources(uiFiles),nativeInput=sources(nativeFiles),artifact=assertServiceArtifacts(),toolSha256=sha(readFileSync(fileURLToPath(import.meta.url)));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const workingTree=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const metadata={criterion:'ONB-06',capturedAt,revision,workingTreeDirty:Boolean(workingTree),workingTreePaths:workingTree.split('\n').filter(Boolean),environment:'owned-local-only',toolSha256,uiSources:uiInput,checkedApiArtifact:artifact};
async function run(label,command,cwd){
 let stdout='',stderr='';
 const child=spawn(process.execPath,command,{env,cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',bytes=>{stdout+=String(bytes);process.stdout.write(bytes);});child.stderr.on('data',bytes=>{stderr+=String(bytes);process.stderr.write(bytes);});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
 writeFileSync(resolve(directory,label+'.log'),stdout+stderr);
 if(code!==0){
  writeFileSync(resolve(directory,label+'-failed.json'),JSON.stringify({code,capturedAt,revision},null,2));
  const browserArtifacts=resolve(feature,'captures/browser-artifacts');
  if(label==='browser'&&existsSync(browserArtifacts))cpSync(browserArtifacts,resolve(directory,'failure-artifacts'),{recursive:true});
 }
 assert.equal(code,0,label+'_exit_required');return stdout;
}
function validateBrowser(report){
 const tests=[];
 function collect(suite){for(const spec of suite.specs??[])for(const test of spec.tests??[])tests.push({title:spec.title,...test});for(const child of suite.suites??[])collect(child);}
 for(const suite of report.suites)collect(suite);
 assert.equal(tests.length,1,'one_T97_browser_required');assert.equal(tests[0].title,'T97');assert.equal(tests[0].expectedStatus,'passed');assert.equal(tests[0].results.length,1);assert.equal(tests[0].results[0].status,'passed');assert.equal(tests[0].results[0].retry,0);
 assert.equal(report.stats.expected,1);for(const name of ['unexpected','flaky','skipped'])assert.equal(report.stats[name],0);assert.deepEqual(report.errors,[]);
 return{executed:1,passed:1,skipped:0,retries:0,actualLocalApi:true};
}
function screens(fresh){
 return ['company-services.running.png','company-services-mobile.running.png','company-services-products.running.png'].map(name=>{
  const path=resolve(feature,'artifacts',name),bytes=readFileSync(path);assert.ok(bytes.length>1000,'actual_company_screenshot_required');
  if(fresh)assert.ok(statSync(path).mtimeMs>=startedAt-2000,'fresh_company_screenshot_required');
  return{path,bytes:bytes.length,sha256:sha(bytes)};
 });
}
let browser;
if(reuse){
 const receiptPath=resolve(args[1]);assert.ok(receiptPath.toLowerCase().startsWith(proofRoot.toLowerCase()+sep),'owned_browser_receipt_required');
 const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));assert.equal(receipt.kind,'completed-local-T97-browser');assert.equal(receipt.exitCode,0);assert.equal(receipt.toolSha256,toolSha256);
 assert.deepEqual(receipt.uiSources,uiInput,'browser_ui_revision_changed');assert.deepEqual(receipt.checkedApiArtifact,artifact,'browser_api_revision_changed');
 const reportBytes=readFileSync(receipt.reportFile);assert.equal(sha(reportBytes),receipt.reportSha256);const summary=validateBrowser(JSON.parse(reportBytes));assert.deepEqual(receipt.screenshots,screens(false));
 browser={...summary,execution:'verified-prior-local-gate',originalCapturedAt:receipt.capturedAt,receiptPath,receiptSha256:sha(readFileSync(receiptPath)),screenshots:receipt.screenshots};
}else{
 await run('browser',[launcher,'--dir','apps/dashboard','exec','playwright','test','--config','playwright.service-local.config.ts','e2e/service-company-service-names.spec.ts','--grep','T97$'],root);
 const reportFile=resolve(directory,'browser.json'),reportBytes=readFileSync(reportFile),summary=validateBrowser(JSON.parse(reportBytes));
 assert.deepEqual(sources(uiFiles),uiInput,'company_browser_source_changed');assert.deepEqual(assertServiceArtifacts(),artifact);
 const receipt={...metadata,kind:'completed-local-T97-browser',exitCode:0,...summary,reportFile,reportSha256:sha(reportBytes),screenshots:screens(true)};
 const receiptPath=resolve(directory,'browser-receipt.json');writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
 browser={...summary,execution:'fresh-local-gate',receiptPath,screenshots:receipt.screenshots};
}
if(browserOnly){
 console.log(JSON.stringify({criterion:'ONB-06',browserOnly:true,browserPassed:true,directory,browserReceipt:browser.receiptPath}));
}else{
 const native=await run('native',['--import','./tests/test-network-guard.mjs','--loader','./tests/ready-prod-loader.mjs','--test','--test-concurrency=1','--test-name-pattern','^T96$','./tests/service-company-service-names.integration.spec.mjs'],api);
 const count=name=>{const values=[...native.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))];assert.equal(values.length,1,'native_summary_required_'+name);return Number(values[0][1]);};
 assert.ok(count('tests')>=17,'all_company_native_cases_required');assert.equal(count('pass'),count('tests'));for(const name of ['fail','cancelled','skipped','todo'])assert.equal(count(name),0);
 assert.deepEqual(sources(uiFiles),uiInput,'company_proof_front_source_changed');assert.deepEqual(sources(nativeFiles),nativeInput,'company_proof_native_changed');assert.deepEqual(assertServiceArtifacts(),artifact);
 const evidence={...metadata,nativeSources:nativeInput,native:{executed:count('tests'),passed:count('pass'),skipped:0,actualAppModule:true,actualSql:true,actualCanonicalRagReader:true,actualNextHtml:true},browser,remoteProviders:0,productionAcceptance:false};
 writeFileSync(resolve(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({criterion:'ONB-06',passed:true,directory}));
}
