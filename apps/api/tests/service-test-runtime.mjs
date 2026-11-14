import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {createServiceTestRedis} from './service-test-redis.mjs';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {terminateOwnedNativeWorker} from './native-prisma-admission-guards.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {installCheckoutSessionVersionTrigger} from './checkout-session-version-trigger.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';

export const serviceTestEnvironment=source=>constructionOnlyEnvironment(source);
export function assertServiceCaseSummary(value){
  assert.ok(Number.isSafeInteger(value.executed)&&value.executed>0,'service_nonzero_tests_required');
  assert.equal(value.failed,0,'service_failed_case');assert.equal(value.skipped,0,'service_skipped_case');
  return Object.freeze({...value});
}
export async function createServiceTestRuntime(options){
  assert.ok(options&&options.local===true&&Object.keys(options).every(k=>['local','graph'].includes(k))
    &&(options.graph===undefined||typeof options.graph==='boolean'),'service_local_options_required');
  const build=assertServiceArtifacts(),apiRoot=fileURLToPath(new URL('../',import.meta.url));
  let db,redis,graph,worker,workerExited,closed=false,appEvidence,cleanup;
  let readyResolve,readyReject,closeResolve,closeReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const appClosed=new Promise((resolve,reject)=>{closeResolve=resolve;closeReject=reject;});
  // A setup failure may occur before the close acknowledgement is awaited.
  appClosed.catch(()=>{});
  async function close(){
    if(closed)return;closed=true;const errors=[];
    try{if(worker&&appEvidence){
      if(worker.exitCode===null&&worker.connected)worker.send({type:'close'});
      const final=await deadline(appClosed,35_000,'service_close_ack_timeout');assert.equal(final.appClosed,true);assert.equal(final.providerCalls,0);
      const exit=await deadline(workerExited,5000,'service_worker_natural_exit_required');assert.equal(exit.code,0);assert.equal(exit.signal,null);
    }}
    catch(e){errors.push(e);}
    try{await terminateOwnedNativeWorker(worker);}catch(e){errors.push(e);}
    for(const owned of [graph,redis,db])if(owned){try{await owned.dispose();if(owned.bridgeStatus)assert.deepEqual(owned.bridgeStatus(),{listening:false,sockets:0,children:0});}catch(e){errors.push(e);}}
    if(errors.length)throw new AggregateError(errors,'service_runtime_cleanup_failed');
    cleanup={appClosed:true,remainingContainers:0,remainingBridgeSockets:0};
  }
  try{
    db=await createDisposablePostgres({transport:'loopback-exec'});redis=await createServiceTestRedis();
    const require=createRequire(new URL('../package.json',import.meta.url)),pkgPath=require.resolve('prisma/package.json');
    const cli=resolve(dirname(pkgPath),JSON.parse(require('node:fs').readFileSync(pkgPath,'utf8')).bin.prisma);
    const diff=await promisify(execFile)(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,
      cli,'migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],
      {cwd:apiRoot,env:{...serviceTestEnvironment(process.env),DATABASE_URL:db.prismaUrl},windowsHide:true,timeout:60_000,maxBuffer:8_000_000});
    assert.ok(diff.stdout.includes('CREATE TABLE')&&diff.stdout.includes('"merchants"'),'service_full_schema_required');
    await db.sql(diff.stdout);await installCheckoutSessionVersionTrigger(db);
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    if(options.graph)graph=await createServiceTestNeo4j();
    worker=spawn(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,
      fileURLToPath(new URL('./service-test-runtime.worker.mjs',import.meta.url)),db.prismaUrl,db.runId,redis.url,redis.runId],
      {cwd:apiRoot,env:serviceTestEnvironment(process.env),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    let outputBytes=0,stderr='';
    const limit=chunk=>{outputBytes+=chunk.length;if(outputBytes>2_000_000){readyReject(new Error('service_worker_output_limit'));worker.kill();}};
    worker.stdout.on('data',limit);worker.stderr.on('data',chunk=>{limit(chunk);if(stderr.length<20_000)stderr+=chunk.toString();});
    worker.on('error',error=>{readyReject(error);closeReject(error);});
    worker.on('message',message=>{
      if(message?.type==='ready')readyResolve(message);
      else if(message?.type==='closed')closeResolve(message.evidence);
      else if(message?.type==='failure'){const error=new Error(message.code??'service_worker_failed');readyReject(error);closeReject(error);}
    });
    workerExited=new Promise(resolve=>worker.once('close',(code,signal)=>resolve({code,signal})));
    worker.on('exit',code=>{if(!appEvidence)readyReject(new Error(`service_worker_exit_before_ready:${code}:${stderr.slice(-4000)}`));if(code!==0)closeReject(new Error(`service_worker_exit:${code}`));});
    const info=await deadline(ready,110_000,'service_app_ready_timeout');
    const origin=new URL(info.apiOrigin);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');
    assert.ok(Number(origin.port)>1024);appEvidence=Object.freeze({...info.evidence,checkedBuild:build});
    return Object.freeze({db,redis,graph,apiOrigin:info.apiOrigin,evidence:()=>appEvidence,cleanupEvidence:()=>cleanup,close});
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'service_runtime_setup_cleanup_failed');}throw error;}
}
async function deadline(promise,milliseconds,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}finally{clearTimeout(timer);}}
