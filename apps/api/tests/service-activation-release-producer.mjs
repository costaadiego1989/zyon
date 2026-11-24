import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';

const api=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(api,'../..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const sort=(a,b)=>a<b?-1:a>b?1:0;
const same=(actual,expected)=>actual.length===expected.length&&new Set(actual).size===actual.length&&[...actual].sort(sort).every((value,index)=>value===[...expected].sort(sort)[index]);
function owned(root,path){const file=resolve(root,path),rel=relative(root,file);assert.ok(rel&&!rel.startsWith('..')&&!resolve(rel).startsWith('..'),'activation_evidence_path');assert.ok(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink(),'activation_evidence_file');return file;}
function json(root,path){const file=owned(root,path),stat=lstatSync(file);assert.ok(stat.size<=16_000_000,'activation_evidence_bound');return JSON.parse(readFileSync(file,'utf8'));}
export function parseActivationTap(raw){
  assert.equal(typeof raw,'string');const value={};
  for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
    const matches=[...raw.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];assert.equal(matches.length,1,'activation_tap_summary_required');value[key]=Number(matches[0][1]);
  }
  assert.ok(value.tests>0&&value.tests===value.pass,'activation_all_cases_required');
  for(const key of ['fail','cancelled','skipped','todo'])assert.equal(value[key],0,'activation_no_failed_or_skipped_cases');
  assert.doesNotMatch(raw,/^\s*not ok\b/m,'activation_tap_failure');return{executed:value.tests,passed:value.pass,failed:0,skipped:0};
}
export function parseActivationPlaywright(raw){
  const report=JSON.parse(raw),results=[];
  function visit(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[]){assert.ok(Array.isArray(test.results)&&test.results.length===1,'activation_browser_no_retry');results.push(test.results[0]);}visit(suite.suites);}}
  visit(report.suites);assert.ok(results.length>0,'activation_browser_nonzero');assert.ok(results.every(value=>value.status==='passed'),'activation_browser_all_pass');
  assert.equal(report.stats?.unexpected,0);assert.equal(report.stats?.skipped,0);assert.equal(report.stats?.flaky,0);assert.equal(report.stats?.expected,results.length);
  return{executed:results.length,passed:results.length,failed:0,skipped:0};
}
export function activationProofCommands(value){
  assert.equal(typeof value,'string');const expression=value.trim();assert.ok(expression,'activation_criterion_proof_empty');
  if(!expression.includes('`'))return[expression];
  const commands=[...expression.matchAll(/`([^`]+)`/g)];
  assert.ok(commands.length>0,'activation_criterion_proof_quotes');
  const structure=expression.replace(/`([^`]+)`/g,'COMMAND');
  assert.match(structure,/^COMMAND(?:[ \t]+and[ \t]+COMMAND)*$/,'activation_criterion_proof_expression');
  return commands.map(command=>{assert.ok(command[1].trim(),'activation_criterion_proof_empty');return command[1];});
}
export function activationCriterionInventory(raw){
  assert.equal(typeof raw,'string');
  const section=/^## Checks[ \t]*\r?$/m.exec(raw);
  let scope=section?raw.slice(section.index+section[0].length):raw;
  const next=/^## /m.exec(scope);if(section&&next)scope=scope.slice(0,next.index);
  const headers=[...scope.matchAll(/^\*\*C(\d+)\*\* - ([^\r\n]+)\r?$/gm)];
  const criteria=headers.map((value,index)=>{
    const body=scope.slice(value.index+value[0].length,headers[index+1]?.index??scope.length);
    const proofs=[...body.matchAll(/^[ \t]*Proof: ([^\r\n]+)\r?$/gm)];
    const tasks=[...body.matchAll(/^[ \t]*Tasks: ([^\r\n]+)\r?$/gm)];
    assert.ok(proofs.length>0,'activation_criterion_proof_required');
    assert.equal(tasks.length,1,'activation_unique_criterion_tasks_required');
    const commands=proofs.flatMap(proof=>activationProofCommands(proof[1]));
    assert.equal(new Set(commands).size,commands.length,'activation_duplicate_criterion_proof');
    return{id:'C'+value[1],statement:value[2],proof:commands.length===1?commands[0]:commands.map(command=>'`'+command+'`').join(' and '),tasks:tasks[0][1]};
  });
  assert.ok(criteria.length>0,'activation_criterion_inventory_required');assert.equal(new Set(criteria.map(value=>value.id)).size,criteria.length);
  assert.equal((scope.match(/^\*\*C\d+\*\* - /gm)??[]).length,criteria.length,'activation_incomplete_criterion_inventory');return criteria;
}
function directoryDigest(root){
  const entries=[];function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false,'activation_frontend_symlink');
    if(entry.isDirectory()){if(entry.name!=='cache')walk(resolve(path,entry.name));}else if(entry.isFile())entries.push({path:relative(root,resolve(path,entry.name)).split(sep).join('/'),sha256:sha(readFileSync(resolve(path,entry.name)))});}}
  walk(root);assert.ok(entries.length>0,'activation_frontend_artifact_empty');entries.sort((a,b)=>sort(a.path,b.path));return sha(JSON.stringify(entries));
}
/** Producer-owned measurements. Receipts must bind the selected whole files
 * AND the complete local test/fixture/loader inputs, not only their names. */
export function assertActivationProofSourceInputs(receipt,current){
  assert.equal(receipt.proofSourceInputSha256,current.inputSha256,'activation_proof_source_changed');
  const files=receipt.proofInputFiles;assert.ok(Array.isArray(files),'activation_proof_files_required');
  assert.ok(files.every(value=>value&&Object.keys(value).sort().join(',')==='path,sha256'
    &&typeof value.path==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)),'activation_proof_file_shape');
  assert.ok(same(files.map(value=>value.path),current.files.map(value=>value.path)),'activation_proof_file_inventory');
  for(const expected of current.files)assert.equal(files.find(value=>value.path===expected.path)?.sha256,expected.sha256,'activation_proof_file_changed');
}
export function measureProofSourceInputs(required){
  return measureActivationProofSourceInputs(repo,required);
}
/** Filesystem helper for owned-temp source-binding tests. Productive callers
 * remain on the fixed-repo facade; no root argument enters descriptor/route/ABI. */
export function measureActivationProofSourceInputs(root,required){
  const roots=['apps/api/tests','apps/dashboard/e2e','apps/dashboard/e2e-product-catalog','apps/api/src/modules/storefront','apps/api/src/modules/whatsapp-channel/infrastructure/adapters','apps/storefront/src','apps/dashboard/src/lib'];
  const config='apps/dashboard/playwright.service-local.config.ts';
  const additionalConfigs=['apps/storefront/vitest.config.mjs',
    'apps/storefront/package.json',
    'apps/storefront/tsconfig.json',
    'apps/dashboard/playwright.service-overview-local.config.ts',
    'apps/dashboard/playwright.service-policy-local.config.ts',
    'apps/dashboard/playwright.service-appointments-board.config.ts',
    'apps/dashboard/playwright.product-cart-journey.storefront.config.ts',
    'apps/dashboard/playwright.product-cart-journey.whatsapp.config.ts',
    'apps/dashboard/playwright.product-catalog-read.storefront.config.ts',
    'apps/dashboard/playwright.product-catalog-read.whatsapp.config.ts',
    'apps/dashboard/playwright.product-contact-delivery.storefront.config.ts',
    'apps/dashboard/playwright.product-contact-delivery.whatsapp.config.ts',
    'apps/dashboard/playwright.product-discovery-read.storefront.config.ts',
    'apps/dashboard/playwright.product-discovery-read.whatsapp.config.ts',
    'apps/dashboard/playwright.product-payment.storefront.config.ts',
    'apps/dashboard/playwright.product-payment.whatsapp.config.ts',
    'apps/dashboard/playwright.product-payment-duplex.storefront.config.ts',
    'apps/dashboard/playwright.product-payment-duplex.whatsapp.config.ts',
    'apps/dashboard/playwright.product-search-read.storefront.config.ts',
    'apps/dashboard/playwright.product-search-read.whatsapp.config.ts',
    'apps/dashboard/playwright.service-buyer-storefront.config.ts',
    'apps/dashboard/playwright.service-buyer-whatsapp.config.ts',
    'apps/dashboard/playwright.service-availability-local.config.ts'];
  return{inputSha256:sha(JSON.stringify({trees:roots.map(path=>({path,sha256:directoryDigest(resolve(root,path))})),
    config:{path:config,sha256:sha(readFileSync(resolve(root,config)))},
    additionalConfigs:additionalConfigs.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))}))})),
    files:required.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))}))};
}
function selectedFiles(receipt,required){
  assert.ok(Array.isArray(receipt.argv)&&receipt.argv.every(value=>typeof value==='string'),'activation_actual_argv_required');
  assert.ok(!receipt.argv.some(value=>/--(?:test-name-pattern|test-skip-pattern|grep|grep-invert|shard|list)/.test(value)),'activation_whole_files_required');
  const cwd=resolve(repo,receipt.cwd);assert.ok(!relative(repo,cwd).startsWith('..'),'activation_actual_cwd_required');
  const files=receipt.argv.filter(value=>/\.(?:spec|integration)\.(?:mjs|ts|tsx)$/.test(value)).map(value=>relative(repo,resolve(cwd,value)).split(sep).join('/'));
  assert.ok(same(files,required),'activation_actual_selection_mismatch');
  assert.ok(receipt.argv.includes('--test')||receipt.argv.includes('playwright'),'activation_actual_runner_required');
  if(receipt.argv.includes('--test'))assert.ok(receipt.argv.some((value,index)=>value==='--import'&&receipt.argv[index+1]
    &&relative(repo,resolve(cwd,receipt.argv[index+1])).split(sep).join('/')==='apps/api/tests/test-network-guard.mjs'
    ||value.startsWith('--import=')&&relative(repo,resolve(cwd,value.slice(9))).split(sep).join('/')==='apps/api/tests/test-network-guard.mjs'),'activation_original_network_guard_required');
}
function attachmentPaths(report){const paths=[];function walk(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[])for(const result of test.results??[])
  for(const attachment of result.attachments??[])if(typeof attachment.path==='string')paths.push(attachment.path);walk(suite.suites);}}walk(report.suites);return paths;}
/** T95-facing producer: reads actual raw runner outputs/receipts and the current
 * payload. It does not accept asserted pass counters, ready/writer flags or
 * a synthetic release-precondition manifest as input evidence. */
export async function produceServiceActivationRelease(input){
  assert.equal(input?.version,1);assert.ok(Object.keys(input).every(key=>['version','reportRoot','proofs','ragReport','frontendReceipts','seal'].includes(key)),'activation_input_fields');
  assertServiceArtifacts();
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim();assert.match(sourceRevision,/^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),'','activation_clean_source_required');
  const protocol=await import('../dist/shared/bookings/service-release-manifest.js'),artifact=await import('../dist/shared/bookings/service-release-artifact.js');
  const runtime=artifact.measureServiceReleaseRuntime(api,sourceRevision),reportRoot=resolve(repo,input.reportRoot);assert.ok(!relative(repo,reportRoot).startsWith('..'),'activation_evidence_root');
  assert.ok(Array.isArray(input.proofs)&&same(input.proofs.map(value=>value.id),protocol.SERVICE_RELEASE_CHECKS.map(value=>value.id)),'activation_fixed_proofs_required');
  const proofs=protocol.SERVICE_RELEASE_CHECKS.map(required=>{
    const item=input.proofs.find(value=>value.id===required.id);assert.deepEqual(Object.keys(item).sort(),['id','raw','receipt'].sort());
    const receipt=json(reportRoot,item.receipt),raw=readFileSync(owned(reportRoot,item.raw),'utf8');
    assert.equal(receipt.version,1);assert.equal(receipt.completed,true);assert.equal(receipt.exitCode,0);assert.notEqual(receipt.fixtureOnly,true);
    assert.equal(receipt.sourceRevision,sourceRevision);assert.equal(receipt.releaseSourceInputSha256,runtime.sourceInputSha256);assert.equal(receipt.releasePayloadSha256,runtime.apiPayloadSha256);
    assert.equal(receipt.rawOutputSha256,sha(raw));selectedFiles(receipt,required.files);
    assertActivationProofSourceInputs(receipt,measureProofSourceInputs(required.files));
    const counts=required.origin==='served_browser'?parseActivationPlaywright(raw):parseActivationTap(raw);
    return{id:required.id,files:[...required.files],sourceRevision,apiPayloadSha256:runtime.apiPayloadSha256,rawEvidenceSha256:sha(raw),...counts,exitCode:0,origin:required.origin};
  });
  const rag=json(reportRoot,input.ragReport),datasetSha256=sha(readFileSync(resolve(api,'tests/business-rag-evaluation-corpus.mjs'))),contractSha256=sha(readFileSync(resolve(api,'tests/business-rag-evaluation.mjs')));
  assert.equal(rag.revision,sourceRevision);assert.equal(rag.mode,'owned_runtime');assert.equal(rag.datasetHash,datasetSha256);assert.equal(rag.contractHash,contractSha256);
  assert.equal(rag.gate?.completeExecution,true);assert.equal(rag.gate?.passed,true);assert.equal(rag.failedCritical,0);assert.deepEqual(rag.invalidObservations,[]);assert.deepEqual(rag.reviewItems,[]);
  const cases=rag.results.filter(value=>value.critical);assert.ok(same(cases.map(value=>value.id),protocol.SERVICE_RELEASE_CRITICAL_CASE_IDS));assert.ok(cases.every(value=>value.passed===true&&value.reasons.length===0));
  assert.equal(rag.executed,rag.total);assert.equal(rag.passed,rag.total);assert.equal(rag.providerAccuracyProven,false,'activation_must_preserve_local_provider_limit');
  const frontendRoots={storefront:'apps/storefront/.next',widget:'apps/widget_v2/dist',dashboard:'apps/dashboard/dist'};
  const browserInput=input.proofs.find(value=>value.id==='buyer-coexistence'),browserRaw=readFileSync(owned(reportRoot,browserInput.raw),'utf8'),browserAttachments=attachmentPaths(JSON.parse(browserRaw));
  assert.ok(Array.isArray(input.frontendReceipts)&&same(input.frontendReceipts.map(value=>value.id),Object.keys(frontendRoots)));
  const frontendArtifacts=input.frontendReceipts.map(item=>{
    assert.deepEqual(Object.keys(item).sort(),['id','receipt'].sort());const receipt=json(reportRoot,item.receipt),artifactSha256=directoryDigest(resolve(repo,frontendRoots[item.id]));
    assert.equal(receipt.sourceRevision,sourceRevision);assert.equal(receipt.artifactSha256,artifactSha256);assert.equal(receipt.releasePayloadSha256,runtime.apiPayloadSha256);
    assert.equal(receipt.origin,'served_browser');assert.notEqual(receipt.fixtureOnly,true);assert.equal(receipt.browserRawOutputSha256,sha(browserRaw));
    const observationFile=owned(reportRoot,receipt.observationPath),observation=json(reportRoot,receipt.observationPath);
    assert.ok(browserAttachments.some(path=>resolve(path)===observationFile||resolve(reportRoot,path)===observationFile),'activation_served_observation_attachment_required');
    assert.equal(receipt.observationSha256,sha(readFileSync(observationFile)));assert.equal(observation.kind,'served_artifact_observation');
    assert.equal(observation.frontendId,item.id);assert.equal(observation.sourceRevision,sourceRevision);assert.equal(observation.artifactSha256,artifactSha256);
    assert.equal(observation.releasePayloadSha256,runtime.apiPayloadSha256);assert.equal(observation.transport,'owned_http');assert.equal(observation.responseStatus,200);
    const origin=new URL(observation.observedOrigin);assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');assert.ok(Number(origin.port)>1024);
    assert.match(observation.responseSha256,/^[a-f0-9]{64}$/);assert.notEqual(observation.fixtureOnly,true);
    // This is an attested observation from the real T93 fixture, checked
    // alongside its actual browser output above; byte presence alone is not served proof.
    return{id:item.id,sourceRevision,artifactSha256};
  });
  const inventory=activationCriterionInventory(readFileSync(resolve(repo,'.specs/features/whatsapp-service-booking-business-rag/tasks.md'),'utf8'));
  const manifest={schemaVersion:1,feature:'whatsapp-service-booking-business-rag',contractVersion:1,...runtime,criterionInventorySha256:sha(JSON.stringify(inventory)),frontendArtifacts,proofs,
    ragEvaluation:{sourceRevision,datasetSha256,contractSha256,rawEvidenceSha256:sha(readFileSync(owned(reportRoot,input.ragReport))),businesses:['clinic','salon','consulting'],
      criticalCaseIds:cases.map(value=>value.id),passedCriticalCaseIds:cases.filter(value=>value.passed).map(value=>value.id),executed:rag.executed,invalidObservations:0,failedCritical:0,mode:'owned_runtime'}};
  assert.equal(protocol.verifyServiceReleaseManifest(manifest,runtime).kind,'verified');
  assert.deepEqual(artifact.measureServiceReleaseRuntime(api,sourceRevision),runtime,'activation_payload_changed_during_generation');
  if(input.seal===true){const output=resolve(api,artifact.SERVICE_RELEASE_ASSET);assert.equal(existsSync(output),false,'activation_asset_already_exists');mkdirSync(dirname(output),{recursive:true});
    writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});assert.deepEqual(artifact.measureServiceReleaseRuntime(api,sourceRevision),runtime,'activation_seal_changed_payload');}
  else assert.ok(input.seal===undefined||input.seal===false);
  return{manifest,manifestSha256:sha(JSON.stringify(manifest,null,2)+'\n'),sealed:input.seal===true,target:{platform:process.platform,arch:process.arch,node:process.version},
    scope:'same_payload_local_evidence_not_external_provider_acceptance',fullT95Acceptance:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'activation_producer_input_file_required');
  const result=await produceServiceActivationRelease(json(repo,process.argv[2]));console.log(JSON.stringify({sealed:result.sealed,manifestSha256:result.manifestSha256,target:result.target,scope:result.scope,fullT95Acceptance:false}));}
