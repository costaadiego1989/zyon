// Synthetic metadata contracts only. No app, HTTP, database, provider or feature proof is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseOfficialCliCounts,officialCapturePlan,verifyOfficialProofRawCapture} from './service-official-proof-raw-audit.mjs';
const node='pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test ./tests/synthetic.spec.mjs';
const vitest='pnpm --dir apps/dashboard exec vitest run src/synthetic.spec.ts --pool=forks --maxWorkers=1 --minWorkers=1 --no-file-parallelism';
const browser='pnpm --dir apps/dashboard exec playwright test --config playwright.synthetic.config.ts';
const tap=(values={})=>{const x={tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0,...values};return 'TAP version 13\nok 1 - synthetic metadata A\nok 2 - synthetic metadata B\n'+Object.entries(x).map(([k,v])=>'# '+k+' '+v).join('\n')+'\n';};
test('metadata parsers retain positive native/Vitest/browser observed counts',()=>{
  assert.equal(parseOfficialCliCounts(node,tap(),'').executed,2);
  assert.equal(parseOfficialCliCounts(vitest,'Test Files 1 passed (1)\nTests 2 passed (2)\n','').executed,2);
  assert.equal(parseOfficialCliCounts(browser,'Running 2 tests using 1 worker\n2 passed (1s)\n','').executed,2);
});
test('native zero, skip, cancelled, todo, failure and unknown summaries all refuse',()=>{
  for(const value of [{tests:0,pass:0},{pass:1,skipped:1},{pass:1,cancelled:1},{pass:1,todo:1},{pass:1,fail:1}])
    assert.throws(()=>parseOfficialCliCounts(node,tap(value),''));
  assert.throws(()=>parseOfficialCliCounts(node,'no counters',''));
  assert.throws(()=>parseOfficialCliCounts(node,tap()+'ok 3 - case # SKIP hidden\n',''));
});
test('Vitest zero, skip, incomplete totals/files and unsupported JUnit skip all refuse',()=>{
  for(const raw of ['Test Files 1 passed (1)\nTests 0 passed (0)\n','Test Files 1 passed (1)\nTests 1 passed | 1 skipped (2)\n',
    'Test Files 1 passed (1)\nTests 1 passed (2)\n','Test Files 1 passed (2)\nTests 2 passed (2)\n',
    '<testsuite><testcase><skipped/></testcase></testsuite>','opaque report'])
    assert.throws(()=>parseOfficialCliCounts(vitest,raw,''));
});
test('browser zero, incomplete, skipped, flaky and unannounced output all refuse',()=>{
  for(const raw of ['Running 0 tests using 1 worker\n0 passed\n','Running 3 tests using 1 worker\n2 passed\n',
    'Running 2 tests using 1 worker\n1 passed\n1 skipped\n','Running 2 tests using 1 worker\n2 passed\n1 flaky\n',
    '2 passed\n','unknown output'])assert.throws(()=>parseOfficialCliCounts(browser,raw,''));
});
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const tick=String.fromCharCode(96),builds=Array.from({length:9},(_,i)=>'node scripts/build-'+i+'.mjs');
  const tasks='**Build**: '+tick+builds.join('; ')+tick+'\n## Checks\n'+Array.from({length:84},(_,i)=>
    '**C'+(i+1)+'** - synthetic metadata only\nProof: '+tick+node+tick+'\nTasks: T'+(i+1)+'\n').join('\n')+'\n## Handoff\n';
  const plan=officialCapturePlan(tasks),files=new Map(),root=process.cwd(),sourceFiles={};
  for(const name of ['check_proofs.py','validate_verification.py','runners.py','lean_config.py','service-official-proof-capture.py',
    'service-official-proof-raw-audit.mjs','service-acceptance-report.mjs','service-activation-release-producer.mjs','tasks.md','mutation.json'])
    sourceFiles[root+'/'+name]='f'.repeat(64);
  const manifest={version:1,workspaceRoot:root,officialExitCode:0,headBefore:'a'.repeat(40),headAfter:'a'.repeat(40),
    sourceBefore:{...sourceFiles},sourceAfter:{...sourceFiles},captureErrors:[],plan,entries:[]};
  plan.forEach((p,i)=>{const row={...p,phase:p.kind==='proof'?'official-positive-proof':'official-build',ordinal:i+1,cwd:root,returnCode:0};for(const stream of ['stdout','stderr']){
    const bytes=Buffer.from(stream==='stderr'?'':p.kind==='build'?'actual build output':tap()),path='logs/'+String(i+1).padStart(4,'0')+'.'+stream+'.txt';
    files.set(path,bytes);row[stream]={path,bytes:bytes.length,sha256:hash(bytes)};
  }manifest.entries.push(row);});
  return{manifest,read:path=>files.get(path),current:{root,sourceRevision:'a'.repeat(40),sourceFiles,tasks}};
}
test('same-capture audit separates the nine builds from observed test executions',()=>{
  const value=fixture(),result=verifyOfficialProofRawCapture(value);
  assert.equal(result.proofCommands,84);assert.equal(result.caseExecutions,168);assert.equal(result.buildCommands,9);
  assert.ok(result.buildRows.every(row=>row.counts===undefined));assert.equal(result.featureComplete,false);
});
test('capture refuses nonzero exit, missing log/entry, argv drift, code drift and unknown count',()=>{
  for(const change of [
    x=>{x.manifest.entries[0].returnCode=1;},x=>{x.manifest.entries.pop();},x=>{x.manifest.entries[0].command+=' --altered';},
    x=>{x.manifest.sourceAfter.extra='a';},x=>{x.manifest.entries[0].stdout.sha256='0'.repeat(64);},
    x=>{x.manifest.officialExitCode=1;},x=>{x.manifest.headAfter='b'.repeat(40);}]){const x=fixture();change(x);assert.throws(()=>verifyOfficialProofRawCapture(x));}
});

