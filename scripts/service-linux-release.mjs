import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {produceServiceActivationRelease,measureProofSourceInputs,parseActivationPlaywright} from '../apps/api/tests/service-activation-release-producer.mjs';
import {validateApiResume} from './service-linux-api-phase.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),api=resolve(root,'apps/api');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const revision=git(['rev-parse','HEAD']);assert.match(revision,/^[a-f0-9]{40}$/);
assert.equal(process.platform,'linux','release_linux_target_required');assert.equal(process.arch,'x64');
assert.equal(git(['status','--porcelain','--untracked-files=no']),'','release_clean_checkout_required');
const resumeApi=process.argv[3]==='--resume-api-ci';
assert.ok(process.argv.length===3||process.argv.length===4&&resumeApi,'release_public_auth_json_path_and_optional_real_api_resume_required');
const publicFile=resolve(root,process.argv[2]);assert.ok(!relative(root,publicFile).startsWith('..'));
const publicAuth=JSON.parse(readFileSync(publicFile,'utf8'));
const publicKeys=['VITE_API_BASE_URL','VITE_GOOGLE_CLIENT_ID','VITE_OAUTH_REDIRECT_URI','VITE_TURNSTILE_SITE_KEY',
  'VITE_GITHUB_CLIENT_ID','VITE_FACEBOOK_CLIENT_ID','VITE_FACEBOOK_GRAPH_API_VERSION','VITE_FACEBOOK_LOGIN_ENABLED',
  'VITE_MICROSOFT_CLIENT_ID','VITE_STOREFRONT_URL','VITE_WIDGET_V2_URL','NEXT_PUBLIC_API_WEBSOCKET_ORIGIN',
  'NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_TURNSTILE_SITE_KEY','NEXT_PUBLIC_WIDGET_BASE_URL','WIDGET_FRAME_ANCESTORS'];
assert.ok(Object.keys(publicAuth).every(key=>publicKeys.includes(key)),'release_only_public_config_allowed');
assert.ok(Object.values(publicAuth).every(value=>typeof value==='string'),'release_public_config_string_required');
const directory=resolve(root,'.cache/linux-service-release-'+revision);assert.equal(existsSync(directory),false,'release_fresh_output_required');mkdirSync(directory,{recursive:true});
const relativeOutput=relative(root,directory).replaceAll('\\','/');
const environment={...process.env,...publicAuth,NEXT_TELEMETRY_DISABLED:'1'};
for(const key of ['DATABASE_URL','REDIS_URL','OPENAI_API_KEY','STRIPE_SECRET_KEY','MERCADOPAGO_ACCESS_TOKEN','RAILWAY_TOKEN','GITHUB_TOKEN'])
  assert.ok(!process.env[key],'release_provider_and_remote_credentials_forbidden');

async function run(name,argv,cwd=root,extra={}){
  const out=resolve(directory,name+'.stdout.log'),err=resolve(directory,name+'.stderr.log');
  const pieces={stdout:[],stderr:[]};let bytes=0;
  const child=spawn(argv[0],argv.slice(1),{cwd,env:{...environment,...extra},shell:false,stdio:['ignore','pipe','pipe']});
  const complete=await new Promise((yes,no)=>{
    child.once('error',no);for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{
      bytes+=chunk.length;if(bytes>64_000_000){child.kill('SIGTERM');no(Error('release_output_limit'));return;}
      pieces[stream].push(chunk);process[stream].write(chunk);
    });child.once('close',(code,signal)=>yes({code,signal}));
  });
  for(const stream of ['stdout','stderr'])writeFileSync(stream==='stdout'?out:err,Buffer.concat(pieces[stream]),{flag:'wx'});
  const actual={argv,cwd:relative(root,cwd).replaceAll('\\','/'),exitCode:complete.code,signal:complete.signal,
    stdout:relative(root,out).replaceAll('\\','/'),stderr:relative(root,err).replaceAll('\\','/')};
  json(resolve(directory,name+'.invocation.json'),actual);assert.equal(complete.signal,null,'release_command_signal');assert.equal(complete.code,0,'release_command_failed:'+name);
  return actual;
}

// Resume only real early CI receipts on this exact container/Node/source/output.
if(resumeApi)await validateApiResume({workspaceRoot:root,expectedHead:revision});
else{
// This is the original normal checked build, not Dockerfile's direct tsc.
await run('api-capture',['node','tests/service-test-artifacts.mjs','--capture-inputs'],api);
await run('api-build',['pnpm','--dir','apps/api','build'],root,{DATABASE_URL:'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public',
  PROSPECTING_DIRECTORY_DATABASE_URL:'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=company_directory'});
await run('cashback-seed-build',['node','apps/api/prisma/seeds/cashback-validation-build.mjs']);
await run('api-record',['node','tests/service-test-artifacts.mjs','--record-build-exit0'],api);
await run('api-types',['pnpm','--filter','@zyon/api','typecheck']);
}
await run('native-service-selection-regression',['node','--import','./tests/test-network-guard.mjs','--loader','./tests/ready-prod-loader.mjs',
  '--test','--test-concurrency=1','./tests/service-selection-channel.integration.spec.ts'],api);
// These are the original Dockerfile's real local-model inferences. Populate
// public model weights before the original proof network guard is loaded.
await run('local-embedding-inference',['node','--input-type=module','-e',
  "const {LocalEmbeddingService}=await import('./dist/modules/knowledge-base/infrastructure/services/local-embedding.service.js'); const vector=await new LocalEmbeddingService().generate('Verificacao da base de conhecimento da loja'); if(!vector||vector.length!==384)process.exit(1); console.log('LOCAL EMBEDDING INFERENCE OK: 384 dimensions');"],api);
await run('graph-embedding-inference',['node','--input-type=module','-e',
  "const {GraphLocalEmbeddingService}=await import('./dist/modules/graph-rag/infrastructure/graph-local-embedding.service.js'); const service=new GraphLocalEmbeddingService(); const vector=await service.generate('Cuidado com a barreira da pele'); if(!vector||vector.length!==384)process.exit(1); console.log('GRAPH EMBEDDING INFERENCE OK:',service.modelId);"],api);
await run('widget-typecheck',['pnpm','--dir','apps/widget_v2','typecheck']);
await run('widget-build',['pnpm','--dir','apps/widget_v2','build']);
await run('widget-standalone-build',['pnpm','--dir','apps/widget_v2','build:app','--outDir','dist-app']);
await run('widget-frame-config',['node','scripts/configure-nginx-frames.mjs'],resolve(root,'apps/widget_v2'));
await run('dashboard-typecheck',['pnpm','--dir','apps/dashboard','typecheck']);
await run('dashboard-build',['pnpm','--dir','apps/dashboard','build']);
await run('storefront-typecheck',['pnpm','--dir','apps/storefront','typecheck']);
await run('storefront-build',['pnpm','--dir','apps/storefront','build'],root,{AACP_STANDALONE:'false'});
assert.equal(existsSync(resolve(root,'apps/storefront/.next/standalone')),false,'release_nonstandalone_next_required');
await run('release-source-contracts',['node','--import','./tests/test-network-guard.mjs','--test','--test-concurrency=1',
  './tests/native-prisma-release-platform.spec.mjs','./tests/service-served-artifact-observation.contract.spec.mjs',
  './tests/linux-owned-tcp.contract.spec.mjs','./tests/linux-owned-tcp.live.spec.mjs','./tests/service-release-stage-context.spec.mjs','./tests/journey-redis-ping-guard.contract.mjs','./tests/service-marketing-opening-fetch-fixture.contract.mjs','./tests/journey-cleanup-diagnostic.contract.mjs','./tests/whatsapp-operator-delivery-diagnostics.contract.spec.mjs','./tests/service-marketing-model-unavailable-fixture.contract.mjs','./tests/storefront-journey-owned-clients.generations.contract.mjs','./tests/journey-redis-terminal-lag.contract.mjs'],api);
await run('native-service-read-telemetry-regression',['node','--import','./tests/test-network-guard.mjs','--loader','./tests/ready-prod-loader.mjs',
  '--test','--test-concurrency=1','./src/modules/whatsapp-channel/infrastructure/adapters/checkout-whatsapp-service-read-telemetry.spec.ts'],api);
await run('release-migration-byte-contract',['node','--test','scripts/service-release-migration-bytes.spec.mjs','scripts/service-release-support-migration-bytes.spec.mjs']);
await run('validation-boundary-contracts',['node','--test','apps/dashboard/e2e/service-storefront-library-resolution.contract.mjs','scripts/service-validation-system-git-trust.contract.mjs']);
await run('storefront-library-resolution-qualification',['node','scripts/qualify-service-storefront-library-resolution.mjs',root,resolve(directory,'storefront-library-resolution.receipt.json')]);
const protocol=await import('../apps/api/dist/shared/bookings/service-release-manifest.js');
const artifact=await import('../apps/api/dist/shared/bookings/service-release-artifact.js');
const current=artifact.measureServiceReleaseRuntime(api,revision);
const receipts=[];let browserRaw;
for(const required of protocol.SERVICE_RELEASE_CHECKS){
  const proofInputsBefore=measureProofSourceInputs(required.files);
  let invocation,rawPath;
  if(required.origin==='served_browser'){
    browserRaw=resolve(directory,'buyer-coexistence.browser.json');
    invocation=await run(required.id,['pnpm','--dir','apps/dashboard','exec','playwright','test','--config','playwright.service-local.config.ts',
      ...required.files.map(path=>relative(resolve(root,'apps/dashboard'),resolve(root,path)))],root,{SERVICE_COMPANY_PROOF_REPORT:browserRaw});rawPath=browserRaw;
  }else{
    invocation=await run(required.id,['node','--import','./tests/test-network-guard.mjs','--loader','./tests/ready-prod-loader.mjs','--test','--test-concurrency=1',
      ...required.files.map(path=>'./'+relative(api,resolve(root,path)).replaceAll('\\','/'))],api);rawPath=resolve(root,invocation.stdout);
  }
  const raw=readFileSync(rawPath),inputs=measureProofSourceInputs(required.files);
  assert.deepEqual(inputs,proofInputsBefore,'release_proof_source_changed_during_execution');
  const receipt={version:1,completed:true,exitCode:0,signal:null,fixtureOnly:false,sourceRevision:revision,
    releaseSourceInputSha256:current.sourceInputSha256,releasePayloadSha256:current.apiPayloadSha256,
    rawOutputSha256:sha(raw),proofSourceInputSha256:inputs.inputSha256,proofInputFiles:inputs.files,
    argv:invocation.argv[0]==='pnpm'?invocation.argv.slice(4):invocation.argv,cwd:required.origin==='served_browser'?'apps/dashboard':invocation.cwd,
    originalInvocation:{argv:invocation.argv,cwd:invocation.cwd}};
  // The receipt contains the actual executable argv; pnpm's fixed prefix only
  // moves the real browser cwd, not its file selection or options.
  const receiptPath=resolve(directory,required.id+'.receipt.json');json(receiptPath,receipt);
  receipts.push({id:required.id,raw:relative(root,rawPath).replaceAll('\\','/'),receipt:relative(root,receiptPath).replaceAll('\\','/')});
  assert.deepEqual(artifact.measureServiceReleaseRuntime(api,revision),current,'release_payload_changed_during_proofs');
}
const browserBytes=readFileSync(browserRaw),browserReport=JSON.parse(browserBytes);parseActivationPlaywright(browserBytes.toString('utf8'));
const standaloneRaw=resolve(directory,'standalone-widget.browser.json');
await run('standalone-widget-browser',['pnpm','--dir','apps/dashboard','exec','playwright','test','--config','playwright.service-release-artifacts.config.ts',
  'e2e/service-standalone-widget-release.spec.ts'],root,{SERVICE_RELEASE_STANDALONE_REPORT:standaloneRaw});
const standaloneBytes=readFileSync(standaloneRaw),standaloneReport=JSON.parse(standaloneBytes);parseActivationPlaywright(standaloneBytes.toString('utf8'));
const standaloneAttachments=[];function collectStandalone(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])for(const item of spec.tests??[])for(const result of item.results??[])
  for(const attachment of result.attachments??[])if(attachment.name==='served-widget-app-artifact'&&attachment.path)standaloneAttachments.push(attachment.path);collectStandalone(suite.suites);}}
collectStandalone(standaloneReport.suites);assert.equal(standaloneAttachments.length,1,'release_standalone_real_observation_required');
const standaloneObservation=readFileSync(standaloneAttachments[0]);
writeFileSync(resolve(directory,'standalone-widget-observation.json'),standaloneObservation,{flag:'wx'});
const standaloneFacts=JSON.parse(standaloneObservation);assert.equal(standaloneFacts.frontendId,'widget-app');
assert.equal(standaloneFacts.sourceRevision,revision);assert.equal(standaloneFacts.releasePayloadSha256,current.apiPayloadSha256);assert.equal(standaloneFacts.responseStatus,200);
const observations=[];
function visit(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[])for(const result of test.results??[])
  for(const attachment of result.attachments??[]){if(attachment.name?.startsWith('served-')&&attachment.path)observations.push(attachment.path);}visit(suite.suites);}}
visit(browserReport.suites);
const frontendReceipts=[];
for(const id of ['storefront','widget','dashboard']){
  const candidates=observations.map(path=>({path,value:JSON.parse(readFileSync(path,'utf8'))})).filter(row=>row.value.frontendId===id);
  assert.equal(candidates.length,1,'release_exactly_one_served_observation_required:'+id);const item=candidates[0];
  assert.equal(item.value.sourceRevision,revision);assert.equal(item.value.releasePayloadSha256,current.apiPayloadSha256);
  const receiptPath=resolve(directory,'frontend-'+id+'.receipt.json');
  json(receiptPath,{sourceRevision:revision,artifactSha256:item.value.artifactSha256,releasePayloadSha256:current.apiPayloadSha256,
    origin:'served_browser',fixtureOnly:false,browserRawOutputSha256:sha(browserBytes),
    observationPath:relative(root,item.path).replaceAll('\\','/'),observationSha256:sha(readFileSync(item.path))});
  frontendReceipts.push({id,receipt:relative(root,receiptPath).replaceAll('\\','/')});
}
// T10/T3 have five existing tracked screenshot outputs. Preserve their new
// evidence before restoring ONLY those exact generated outputs to clean HEAD.
const captures=['task10-signup-products','task10-signup-services','task3-dashboard-login','task3-whatsapp-fixture-mobile','task3-whatsapp-fixture'];
for(const name of captures){
  const path='.specs/features/whatsapp-service-booking-business-rag/captures/'+name+'.running.png';
  if(!git(['ls-files','--',path]))continue;
  const target=resolve(root,path),archive=resolve(directory,'original-browser-captures',name+'.running.png');mkdirSync(dirname(archive),{recursive:true});copyFileSync(target,archive);
  const head=execFileSync('git',['show',revision+':'+path],{cwd:root});writeFileSync(target,head);
}
assert.equal(git(['status','--porcelain','--untracked-files=no']),'','release_source_changed_during_proofs');
const descriptor={version:1,reportRoot:'.',proofs:receipts,ragReport:'.cache/t72-owned-evaluation-report.json',frontendReceipts,seal:true};
json(resolve(directory,'activation-descriptor.json'),descriptor);
const sealed=await produceServiceActivationRelease(descriptor);assert.equal(sealed.sealed,true);
json(resolve(directory,'sealed-release.json'),{revision,manifestSha256:sealed.manifestSha256,target:sealed.target,
  sourceInputSha256:current.sourceInputSha256,apiPayloadSha256:current.apiPayloadSha256,evidenceRoot:relativeOutput,
  targetEnvironment:process.env.SERVICE_RELEASE_TARGET,standaloneBrowserRawSha256:sha(standaloneBytes),standaloneObservationSha256:sha(standaloneObservation),
  fullT95Acceptance:false,providerAccepted:false});
console.log('SEALED_SAME_LINUX_PAYLOAD '+revision+' '+sealed.manifestSha256);
