import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {assertNativePrismaUrl,inspectNativePrismaClient,terminateOwnedNativeWorker} from './native-prisma-admission-guards.mjs';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';

assert.deepEqual(process.argv.slice(2),['--local-disposable','--prisma-loopback-exec']);
const api=fileURLToPath(new URL('../',import.meta.url));
const checked=assertServiceArtifacts(),clientEvidence=inspectNativePrismaClient(api);
const LEGACY_PID_LIMIT=256;
let db,client,child,failure,ownedIdentity;
const cleanupErrors=[];
try{
  db=await createDisposablePostgres({transport:'loopback-exec',profile:'pgvector16',pidsLimit:LEGACY_PID_LIMIT});
  const source=assertNativePrismaUrl(db.prismaUrl);
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  await bootstrapServiceSchema(db);
  const owned=await db.inspectOwned();
  assert.equal(owned.exists,true);assert.equal(owned.runId,db.runId);assert.equal(owned.networkMode,'none');
  ownedIdentity=Object.freeze({id:owned.id,runId:owned.runId});
  assert.equal(await db.sql('SELECT run_id FROM synthetic_native_marker'),db.runId);
  // The bootstrap's own CLI clients have exited. Never terminate a connection
  // to obtain a clone: refusal preserves the normal owned-container cleanup.
  assert.equal(await db.sql("SELECT count(*) FROM pg_stat_activity WHERE datname='storefront_synthetic' AND pid<>pg_backend_pid()"),'0');
  await db.sql('CREATE DATABASE ready_prod_test TEMPLATE storefront_synthetic;');
  const target=new URL(source);target.pathname='/ready_prod_test';
  // This adapter authorizes only the fixed clone of this exact owned tuple.
  // The strict primary helper and legacy test database guards stay unchanged.
  for(const key of ['protocol','username','password','hostname','port','search','hash'])assert.equal(target[key],source[key]);
  assert.equal(target.pathname,'/ready_prod_test');
  assert.equal(target.searchParams.get('application_name'),'aacp_write_native_'+db.runId);
  const {PrismaClient}=createRequire(import.meta.url)(clientEvidence.clientEntry);
  client=new PrismaClient({datasources:{db:{url:target.href}}});
  assert.deepEqual(await client.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`,
    [{database:'ready_prod_test',run_id:db.runId}]);
  await client.$disconnect();client=undefined;
  assert.deepEqual(assertServiceArtifacts(),checked);
  let tail='';
  child=spawn(process.execPath,['--import','./tests/test-network-guard.mjs','--loader','./tests/ready-prod-loader.mjs',
    '--test','--test-concurrency=1','./src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.integration.spec.ts'],
    {cwd:api,windowsHide:true,env:{...constructionOnlyEnvironment(process.env),
      READY_PROD_TEST_PRISMA_CLIENT:clientEvidence.clientEntry,READY_PROD_TEST_DATABASE_URL:target.href},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',bytes=>{tail=(tail+bytes.toString()).slice(-30000);process.stdout.write(bytes);});
  child.stderr.on('data',bytes=>{process.stderr.write(bytes);});
  const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  assert.deepEqual(ended,{code:0,signal:null});
  const counters=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>{
    const values=[...tail.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];return[key,values.length?Number(values.at(-1)[1]):null];
  }));
  assert.deepEqual(counters,{tests:9,pass:9,fail:0,cancelled:0,skipped:0,todo:0});
  assert.deepEqual(assertServiceArtifacts(),checked);
  assert.equal((await db.inspectOwned()).runId,db.runId);
  console.info(JSON.stringify({legacyInbox:counters,ownedMarkerChecked:true,currentDatabaseChecked:true,nativeClientVerified:true}));
}catch(error){failure=error;}
finally{
  try{
    assert.ok(db&&ownedIdentity,'legacy_owned_diagnostic_identity_required');
    const current=await db.inspectOwned(),bridge=db.bridgeStatus();
    assert.equal(current.exists,true);assert.equal(current.id,ownedIdentity.id);
    assert.equal(current.runId,ownedIdentity.runId);assert.equal(current.runId,db.runId);
    if(bridge.sockets===0&&bridge.children===0){
      const counters=JSON.parse(await db.sql("SELECT json_build_object('pidsCurrent',pg_read_file('/sys/fs/cgroup/pids.current',0,1024,true),'pidsMax',pg_read_file('/sys/fs/cgroup/pids.max',0,1024,true),'pidsPeak',pg_read_file('/sys/fs/cgroup/pids.peak',0,1024,true),'pidsEvents',pg_read_file('/sys/fs/cgroup/pids.events',0,1024,true))::text;"));
      assert.deepEqual(Object.keys(counters).sort(),['pidsCurrent','pidsEvents','pidsMax','pidsPeak']);
      for(const key of ['pidsCurrent','pidsMax','pidsPeak'])assert.ok(counters[key]===null||typeof counters[key]==='string'&&/^(?:[0-9]+|max)\s*$/.test(counters[key]));
      assert.ok(counters.pidsEvents===null||typeof counters.pidsEvents==='string'&&counters.pidsEvents.length<=1024&&/^[a-z_0-9\s]*$/.test(counters.pidsEvents));
      console.info('t57_legacy_cgroup_diagnostic',JSON.stringify({ownedIdentityVerified:true,requestedPidsLimit:LEGACY_PID_LIMIT,bridge,counters}));
      assert.equal(counters.pidsMax?.trim(),String(LEGACY_PID_LIMIT),'legacy_requested_pids_limit_not_effective');
      assert.ok(counters.pidsPeak!==null&&Number(counters.pidsPeak)<LEGACY_PID_LIMIT,'legacy_pid_capacity_peak_required');
      assert.match(counters.pidsEvents??'',/^max 0\s*$/,'legacy_pid_capacity_refusal_observed');
    }else{
      console.info('t57_legacy_cgroup_diagnostic',JSON.stringify({ownedIdentityVerified:true,bridge,skipped:'bridge_not_idle'}));
      assert.fail('legacy_bridge_idle_required_for_capacity_proof');
    }
  }catch(diagnosticError){
    const code=diagnosticError&&typeof diagnosticError==='object'&&typeof diagnosticError.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(diagnosticError.code)?diagnosticError.code:null;
    console.info('t57_legacy_cgroup_diagnostic',JSON.stringify({diagnosticFault:true,name:diagnosticError instanceof Error?diagnosticError.name:'Unknown',code}));
    if(!failure)failure=diagnosticError;
  }
  if(client)try{await client.$disconnect();}catch(error){cleanupErrors.push(error);}
  try{await terminateOwnedNativeWorker(child);}catch(error){cleanupErrors.push(error);}
  if(db)try{
    await db.dispose();assert.equal((await db.inspectOwned()).exists,false);
    assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});
  }catch(error){cleanupErrors.push(error);}
  console.info(JSON.stringify({cleanupErrors:cleanupErrors.length,disposableDatabaseRemoved:!!db&&cleanupErrors.length===0,
    bridgeClosed:!!db&&cleanupErrors.length===0}));
}
if(failure&&cleanupErrors.length)throw new AggregateError([failure,...cleanupErrors],'legacy_inbox_owned_cleanup_failed');
if(failure)throw failure;
if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'legacy_inbox_owned_cleanup_failed');
