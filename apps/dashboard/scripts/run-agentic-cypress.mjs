import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,realpath,readdir,rm} from 'node:fs/promises';
import {createConnection,createServer as createTcpServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dashboard=fileURLToPath(new URL('../',import.meta.url)),workspace=path.resolve(dashboard,'../..');
let apiBase='http://127.0.0.1:3019',front='http://127.0.0.1:5179';
export async function isolatedPorts(isOpen=isPortOccupied){for(const pair of [[3019,5179],[3049,5249],[3050,5250]])if(!await isOpen(pair[0])&&!await isOpen(pair[1]))return{apiPort:pair[0],frontPort:pair[1]};throw Error('agentic_test_ports_unavailable');}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const execute=promisify(execFile);
export function parseArguments(args){
  const parsed={};for(let i=0;i<args.length;i++){
    const name=args[i];if(name==='--serve'&&!parsed.serve){parsed.serve=true;continue;}
    if(!['--case','--spec'].includes(name)||parsed[name.slice(2)]!==undefined||!args[i+1])throw Error('agentic_argument_invalid');parsed[name.slice(2)]=args[++i];
  }
  if(parsed.case&&!/^(?:ADAS-(54|55|56|57|58|66|70)|ACAP-27)$/.test(parsed.case)||parsed.spec&&(!/^cypress\/e2e\/agentic\/[a-z0-9-]+\.cy\.ts$/.test(parsed.spec))||parsed.serve&&(parsed.case||parsed.spec))throw Error('agentic_argument_invalid');return parsed;
}
export function assertSuccessfulRun(result){
  if(result.failures||result.totalFailed||result.totalSkipped||result.totalPending||result.runs?.some(run=>run.error))throw Error('cypress_failed');
  if(!result.totalTests)throw Error('cypress_no_test_ran');
  if(result.totalPassed!==result.totalTests||!result.runs?.some(run=>run.tests?.some(test=>test.state==='passed')))throw Error('cypress_failed');
}
export function selectedSpec(options){const cases={'ADAS-54':'runtime','ADAS-55':'funding-and-help','ADAS-56':'campaign','ADAS-57':'automation','ADAS-58':'report-and-recovery','ADAS-66':'runtime','ADAS-70':'report-and-recovery','ACAP-27':'campaign-approval'};return options.spec??(options.case?`cypress/e2e/agentic/${cases[options.case]}.cy.ts`:undefined);}
export function fixtureContext(spec){return spec==='cypress/e2e/agentic/cashback.cy.ts'?'cashback':'meta-ads';}
export async function runSpecSuite(specs,run){
  if(!specs.length||specs.some(spec=>!/^cypress\/e2e\/agentic\/[a-z0-9-]+\.cy\.ts$/.test(spec)))throw Error('agentic_suite_selection_invalid');
  for(const spec of specs){const code=await run(spec);if(code!==0)return Number.isInteger(code)&&code>0?code:1;}return 0;
}
export function isPortOccupied(port){return new Promise(resolve=>{const server=createTcpServer();server.once('error',()=>resolve(true));server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(()=>resolve(false)));});}
function open(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>{socket.destroy();resolve(false);});socket.once('timeout',()=>{socket.destroy();resolve(false);});});}
export function assertBrowserDatabaseContainer(value){
  if(value?.Name!=='/zyon-cashback-postgres-20261118'||!value.Config?.Env?.includes('POSTGRES_USER=cashback')||!value.Config.Env.includes('POSTGRES_DB=cashback'))throw Error('agentic_database_owner_mismatch');
  const bindings=value.HostConfig?.PortBindings?.['5432/tcp'];
  if(bindings?.length!==1||bindings[0].HostIp!=='127.0.0.1'||bindings[0].HostPort!=='15433')throw Error('agentic_database_port_mismatch');
}
async function database(){
  const container='zyon-cashback-postgres-20261118',name='cashback_agentic_browser_qa_20261119';
  let inspected;try{inspected=JSON.parse((await execute('docker',['inspect',container],{windowsHide:true})).stdout)[0];}catch{throw Error('agentic_owned_local_postgres_required');}
  assertBrowserDatabaseContainer(inspected);
  if(!inspected.State.Running)await execute('docker',['start',container],{windowsHide:true});
  let ready=false;for(let i=0;i<60;i++){if(await open(15433)){ready=true;break;}await wait(500);}if(!ready)throw Error('agentic_local_postgres_unavailable');
  const prefix=['exec',container,'psql','-U','cashback','-d','postgres','-v','ON_ERROR_STOP=1'];
  const exists=(await execute('docker',[...prefix,'-Atc',`SELECT 1 FROM pg_database WHERE datname='${name}'`],{windowsHide:true})).stdout.trim();
  if(exists!=='1')await execute('docker',[...prefix,'-c',`CREATE DATABASE ${name} OWNER cashback`],{windowsHide:true});
}
async function sourceSnapshot(){
  const revision=(await execute('git',['rev-parse','HEAD'],{cwd:workspace,windowsHide:true})).stdout.trim();
  const sourceFiles=(await execute('git',['ls-files','--cached','--others','--exclude-standard','--','apps/api/tests/agentic-assistant-browser*','apps/api/src/modules/cashback','apps/api/src/modules/merchant-assistant','apps/api/src/modules/meta-ads-agent','apps/dashboard/src/pages/cashback','apps/dashboard/src/pages/meta-ads-agent','apps/dashboard/src/components/merchant-assistant','apps/dashboard/e2e/agentic-assistant','apps/dashboard/cypress/e2e/agentic','apps/dashboard/cypress/support','apps/dashboard/scripts/run-agentic-cypress*','packages/shared-types/src','packages/conversation-engine/src'],{cwd:workspace,windowsHide:true})).stdout.trim().split('\n').filter(Boolean).sort();
  const sourceDigest=createHash('sha256'),productDigest=createHash('sha256');for(const file of sourceFiles){const bytes=await readFile(path.join(workspace,file));sourceDigest.update(file).update('\0').update(bytes).update('\0');if(file.includes('/src/'))productDigest.update(file).update('\0').update(bytes).update('\0');}
  return{revision,sourceFiles:sourceFiles.length,sourceDigest:sourceDigest.digest('hex'),productDigest:productDigest.digest('hex')};
}

export async function main(args=process.argv.slice(2)){
  const options=parseArguments(args);
  if(!Object.keys(options).length){
    const specs=(await readdir(path.join(dashboard,'cypress/e2e/agentic'))).filter(file=>/^[a-z0-9-]+\.cy\.ts$/.test(file)).sort().map(file=>'cypress/e2e/agentic/'+file);
    const code=await runSpecSuite(specs,spec=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--spec',spec],{cwd:workspace,env:process.env,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('close',resolve);}));if(code!==0)process.exitCode=code;return;
  }
  const spec=selectedSpec(options);
  if(options.spec){const file=await realpath(path.join(dashboard,options.spec)),root=await realpath(path.join(dashboard,'cypress/e2e/agentic'));if(!file.startsWith(root+path.sep))throw Error('agentic_argument_invalid');}
  const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','COMSPEC','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','HOMEDRIVE','HOMEPATH']);
  for(const name of Object.keys(process.env))if(!allowed.has(name.toUpperCase()))delete process.env[name];
  process.env.NODE_ENV='test';process.env.CYPRESS_VERIFY_TIMEOUT='120000';
  // Bound only this isolated runner's children on shared development machines.
  process.env.NODE_OPTIONS='--max-old-space-size=768';
  process.env.ELECTRON_EXTRA_LAUNCH_ARGS='--js-flags=--max-old-space-size=768';
  await database();const ports=await isolatedPorts();apiBase='http://127.0.0.1:'+ports.apiPort;front='http://127.0.0.1:'+ports.frontPort;
  const sourceBefore=await sourceSnapshot();
  const nonce=randomBytes(32).toString('hex'),artifact=path.join(workspace,'.specs/features/agentic-dashboard-assistant/cypress-results',new Date().toISOString().replaceAll(':','-'));
  await mkdir(artifact,{recursive:true});
  await writeFile(path.join(artifact,'source-start.json'),JSON.stringify({...sourceBefore,selection:options.case??options.spec??'all',controlledTransport:true},null,2));
  const loader='data:text/javascript,'+encodeURIComponent("import {register} from 'node:module';import {pathToFileURL} from 'node:url';register('./tests/ready-prod-loader.mjs',pathToFileURL('./'));");
  const child=spawn(process.execPath,['--import',loader,'./tests/agentic-assistant-browser-runtime.ts'],{cwd:path.join(workspace,'apps/api'),env:{...process.env,AGENTIC_TEST_NONCE:nonce,AGENTIC_TEST_PORT:String(ports.apiPort),AGENTIC_TEST_FRONTEND_URL:front,AGENTIC_TEST_CONTEXT:fixtureContext(spec)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-100000);});child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-100000);});const exited=new Promise(resolve=>child.once('exit',resolve));let vite;
  const headers={'x-agentic-test-nonce':nonce,'content-type':'application/json'};
  try{
    let ready=false;for(let i=0;i<360;i++){try{ready=(await fetch(apiBase+'/__test/health')).ok;}catch{}if(ready||child.exitCode!==null)break;await wait(250);}if(!ready)throw Error('agentic_api_start_failed: '+logs.slice(-6000));
    if(!(await fetch(apiBase+'/__test/facts',{headers})).ok)throw Error('agentic_api_owner_mismatch');
    const {createServer}=await import('vite');vite=await createServer({configFile:path.join(dashboard,'e2e/agentic-assistant/vite.config.ts'),cacheDir:path.join(artifact,'vite-cache'),server:{host:'127.0.0.1',port:ports.frontPort,strictPort:true},define:{__AGENTIC_API__:JSON.stringify(apiBase),__AGENTIC_NONCE__:JSON.stringify(nonce)}});await vite.listen();await vite.warmupRequest('/entry.tsx');
    process.stdout.write(`Local API and dashboard ready: ${front}\n`);
    if(options.serve){await Promise.race([exited,new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);})]);return;}
    process.stdout.write('Starting Cypress in isolated Edge\n');
    const optionsPath=path.join(artifact,'options.json'),resultPath=path.join(artifact,'results.json');
    await writeFile(optionsPath,JSON.stringify({project:dashboard,configFile:'cypress.agentic.config.ts',browser:'edge',headless:true,record:false,testingType:'e2e',...(spec?{spec}:{}),env:{agenticNonce:nonce},config:{baseUrl:front,expose:{agenticCase:options.case??'',agenticApi:apiBase},screenshotsFolder:path.join(artifact,'screenshots'),downloadsFolder:path.join(artifact,'downloads')}}));
    const worker=spawn(process.execPath,[path.join(dashboard,'scripts/run-agentic-cypress-worker.mjs'),optionsPath,resultPath],{cwd:dashboard,env:{...process.env},windowsHide:true,detached:process.platform==='win32',stdio:['ignore','pipe','pipe']});
    worker.stdout.pipe(process.stdout);worker.stderr.pipe(process.stderr);
    const code=await new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',resolve);});await rm(optionsPath);
    let result;try{result=JSON.parse(await readFile(resultPath,'utf8'));}catch{throw Error(`cypress_no_test_ran: worker exited ${code} without results`);}
    assertSuccessfulRun(result);if(code!==0)throw Error('cypress_failed');
    const sourceAfter=await sourceSnapshot();if(JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter))throw Error('agentic_source_changed_during_run');
    await writeFile(path.join(artifact,'source.json'),JSON.stringify({...sourceBefore,selection:options.case??options.spec??'all',controlledTransport:true,passed:result.totalPassed,total:result.totalTests},null,2));process.stdout.write(`Cypress: ${result.totalPassed}/${result.totalTests} passed. Evidence: ${artifact}\n`);
  }finally{
    await writeFile(path.join(artifact,'api.log'),logs);
    await vite?.close();try{await fetch(apiBase+'/__test/shutdown',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(10000)});}catch{}
    if(await Promise.race([exited,wait(15000).then(()=>false)])===false){if(process.platform==='win32')await execute('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});else child.kill('SIGTERM');}
    await writeFile(path.join(artifact,'api.log'),logs);
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}}
