import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const worker=fileURLToPath(new URL('./run-agentic-cypress-worker.mjs',import.meta.url));
const safeParent=fileURLToPath(new URL('../../../.audit/cypress-worker-contracts/',import.meta.url));
async function runWorker(source){
 await mkdir(safeParent,{recursive:true});const directory=await mkdtemp(path.join(safeParent,'case-'));
 try{
  const loader=path.join(directory,'loader.mjs'),bootstrap=path.join(directory,'bootstrap.mjs'),options=path.join(directory,'options.json'),result=path.join(directory,'result.json');
  await writeFile(loader,`export async function resolve(name,context,next){if(name==='cypress')return{url:${JSON.stringify('data:text/javascript,'+encodeURIComponent(source))},shortCircuit:true};return next(name,context);}`);
  await writeFile(bootstrap,`import{register}from'node:module';register(${JSON.stringify(pathToFileURL(loader).href)});`);
  await writeFile(options,JSON.stringify({record:false,headless:true}));
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  const outcome=await new Promise(resolve=>execFile(process.execPath,['--import',pathToFileURL(bootstrap).href,worker,options,result],{env:environment,timeout:4000,windowsHide:true},(error,stdout,stderr)=>resolve({code:error?.code??0,killed:error?.killed??false,stdout,stderr})));
  let saved=null;try{saved=JSON.parse(await readFile(result,'utf8'));}catch{}
  return{...outcome,saved};
 }finally{
  const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(safeParent)||!path.basename(resolved).startsWith('case-'))throw Error('unsafe_worker_fixture_cleanup');
  await rm(resolved,{recursive:true,force:true});
 }
}
const success={totalTests:1,totalPassed:1,totalFailed:0,totalSkipped:0,totalPending:0,runs:[{spec:{relative:'cypress/e2e/agentic/runtime.cy.ts'},tests:[{title:['worker contract','completed case'],state:'passed',displayError:null}],screenshots:[]}]};
test('worker exits after a complete passing result even when the Cypress library retains a handle',async()=>{
 const outcome=await runWorker(`setInterval(()=>{},1000);export async function run(){return ${JSON.stringify(success)}}`);
 assert.equal(outcome.killed,false,'completed worker must close without a process timeout');assert.equal(outcome.code,0);assert.equal(outcome.saved.totalTests,1);assert.equal(outcome.saved.totalPassed,1);assert.deepEqual(outcome.saved.runs[0].tests,[{title:['worker contract','completed case'],state:'passed',displayError:null}]);
});
test('worker preserves a failed Cypress launch and exits nonzero without lingering library handles',async()=>{
 const outcome=await runWorker(`setInterval(()=>{},1000);export async function run(){return{failures:1,message:'Could not find Cypress test run results'}}`);
 assert.equal(outcome.killed,false);assert.equal(outcome.code,1);assert.deepEqual(outcome.saved,{failures:1,message:'Could not find Cypress test run results'});assert.match(outcome.stderr,/cypress_failed/);
});
test('worker never treats a zero-test result as a passing run',async()=>{
 const outcome=await runWorker(`export async function run(){return{totalTests:0,totalPassed:0,totalFailed:0,runs:[]}}`);
 assert.equal(outcome.killed,false);assert.equal(outcome.code,1);assert.equal(outcome.saved.totalTests,0);assert.match(outcome.stderr,/cypress_no_test_ran/);
});
test('worker exits and preserves the startup error when Cypress throws with a live handle',async()=>{
 const outcome=await runWorker(`setInterval(()=>{},1000);export async function run(){throw Error('synthetic_startup_failure')}`);
 assert.equal(outcome.killed,false);assert.equal(outcome.code,1);assert.equal(outcome.saved,null);assert.match(outcome.stderr,/synthetic_startup_failure/);
});
