import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {createServiceTestRedis} from './service-test-redis.mjs';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {terminateOwnedNativeWorker} from './native-prisma-admission-guards.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';
import {awaitServiceStartup} from './service-test-startup.mjs';
import {createHmac,randomBytes} from 'node:crypto';
import {validateLocalWhatsAppOptions} from './service-whatsapp-provider-fixture.mjs';

export const serviceTestEnvironment=source=>constructionOnlyEnvironment(source);
export function assertServiceCaseSummary(value){
  assert.ok(Number.isSafeInteger(value.executed)&&value.executed>0,'service_nonzero_tests_required');
  assert.equal(value.failed,0,'service_failed_case');assert.equal(value.skipped,0,'service_skipped_case');
  return Object.freeze({...value});
}
export async function createServiceTestRuntime(options){
  assert.ok(options&&options.local===true&&Object.keys(options).every(k=>['local','graph','whatsapp'].includes(k))
    &&(options.graph===undefined||typeof options.graph==='boolean'),'service_local_options_required');
  const whatsapp=options.whatsapp===undefined?undefined:validateLocalWhatsAppOptions(options.whatsapp);
  const fixtureSecret=whatsapp?randomBytes(32).toString('hex'):undefined,localEvents=[];
  const fixtureArgument=whatsapp?JSON.stringify({...whatsapp,metaSecret:fixtureSecret}):undefined;
  assert.ok(fixtureArgument===undefined||fixtureArgument.length<=8192,'local_whatsapp_fixture_size_invalid');
  const build=assertServiceArtifacts(),apiRoot=fileURLToPath(new URL('../',import.meta.url));
  let db,redis,graph,worker,workerExited,closed=false,appEvidence,cleanup,lastStage='unspawned',cleanupDiagnostics=[];
  let readyResolve,readyReject,preflightResolve,preflightReject,closeResolve,closeReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const preflight=new Promise((resolve,reject)=>{preflightResolve=resolve;preflightReject=reject;});
  ready.catch(()=>{});preflight.catch(()=>{});
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
    if(errors.length)throw new AggregateError(errors,`service_runtime_cleanup_failed:${lastStage}:${errors.map(error=>String(error.message).slice(0,1800)).join('|')}:${JSON.stringify(cleanupDiagnostics)}`);
    cleanup={appClosed:true,remainingContainers:0,remainingBridgeSockets:0};
  }
  try{
    db=await createDisposablePostgres({transport:'loopback-exec'});redis=await createServiceTestRedis();
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    if(options.graph)graph=await createServiceTestNeo4j();
    worker=spawn(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,
      fileURLToPath(new URL('./service-test-runtime.worker.mjs',import.meta.url)),db.prismaUrl,db.runId,redis.url,redis.runId,...(fixtureArgument?[fixtureArgument]:[])],
      {cwd:apiRoot,env:serviceTestEnvironment(process.env),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    let outputBytes=0,stderr='',stageFailure='';lastStage='spawned';
    const limit=chunk=>{outputBytes+=chunk.length;if(outputBytes>2_000_000){readyReject(new Error('service_worker_output_limit'));worker.kill();}};
    let diagnosticBuffer='';
    worker.stdout.on('data',limit);worker.stderr.on('data',chunk=>{
      limit(chunk);if(stderr.length<20_000)stderr+=chunk.toString();
      diagnosticBuffer+=chunk.toString();const lines=diagnosticBuffer.split('\n');diagnosticBuffer=lines.pop().slice(-4000);
      for(const line of lines)if(line.startsWith('service_cleanup_resources:')){
        const value=JSON.parse(line.slice('service_cleanup_resources:'.length));
        assert.ok(['before_closed_ack','disconnected'].includes(value.stage)&&Array.isArray(value.resourceTypes)&&value.resourceTypes.every(type=>typeof type==='string'));
        cleanupDiagnostics.push(value);
        console.info('service_cleanup_resources',JSON.stringify(value));
      }
    });
    worker.on('error',error=>{preflightReject(error);readyReject(error);closeReject(error);});
    worker.on('message',message=>{
      if(message?.type==='local_whatsapp_event'){
        assert.ok(whatsapp&&message.event?.sequence===localEvents.length+1&&['sendText','sendMedia','voiceInterpret'].includes(message.event.kind),'local_whatsapp_event_invalid');
        assert.ok(localEvents.length<2000,'local_whatsapp_event_limit');localEvents.push(message.event);
      }
      else if(message?.type==='stage'){lastStage=message.stage;if(message.failure)stageFailure=message.failure;
        if(message.stage==='owned_markers_checked')preflightResolve();}
      else if(message?.type==='ready')readyResolve(message);
      else if(message?.type==='closed')closeResolve(message.evidence);
      else if(message?.type==='failure'){const error=new Error(message.code??'service_worker_failed');preflightReject(error);readyReject(error);closeReject(error);}
    });
    workerExited=new Promise(resolve=>worker.once('close',(code,signal)=>resolve({code,signal})));
    worker.on('exit',code=>{if(!appEvidence){const error=new Error(`service_worker_exit_before_ready:${code}:${stderr.slice(-4000)}`);
      preflightReject(error);readyReject(error);}if(code!==0)closeReject(new Error(`service_worker_exit:${code}`));});
    let info,timings;
    try{({info,timings}=await awaitServiceStartup(preflight,ready));}
    catch(error){if(['service_preflight_timeout','service_app_ready_timeout'].includes(error.message))throw new Error(`${error.message}:${lastStage}:${stageFailure}`);throw error;}
    const origin=new URL(info.apiOrigin);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');
    assert.ok(Number(origin.port)>1024);appEvidence=Object.freeze({...info.evidence,checkedBuild:build,startupTimings:timings});
    return Object.freeze({db,redis,graph,apiOrigin:info.apiOrigin,evidence:()=>whatsapp?Object.freeze({...appEvidence,localProviderEvents:localEvents.length}):appEvidence,cleanupEvidence:()=>cleanup,close,
      ...(whatsapp?{whatsapp:Object.freeze({events:()=>structuredClone(localEvents),signature:body=>{
        assert.equal(typeof body,'string');assert.ok(body.length<=1_000_000);return 'sha256='+createHmac('sha256',fixtureSecret).update(body).digest('hex');
      }})}:{})});
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'service_runtime_setup_cleanup_failed');}throw error;}
}
async function deadline(promise,milliseconds,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}finally{clearTimeout(timer);}}
