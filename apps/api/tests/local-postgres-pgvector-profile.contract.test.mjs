import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {connect} from 'node:net';
import {localPostgresProfile,assertCachedPgvectorImage,assertPgvectorContainer,localPostgresBridgeCommand,PGVECTOR_LOOPBACK_BASH,prepareOwnedPgvector} from './local-postgres-profiles.mjs';
import {createDisposablePostgres,openOwnedPostgresBridge} from './local-disposable-postgres.mjs';

const profile=localPostgresProfile('pgvector16');
const id='a'.repeat(64),runId='12345678-1234-4123-8123-123456789abc';
const info={Id:id,Name:'/aacp-write-db-'+runId,Config:{Labels:{'com.zyon.storefront-write-test':runId}},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,PortBindings:{}},Mounts:[]};

test('T66 PostgreSQL profile defaults retain Alpine UID70 and legacy nc argv',()=>{
  assert.deepEqual(localPostgresProfile(),{name:'alpine16',tag:'postgres:16-alpine',uid:70});
  assert.equal(localPostgresProfile('alpine16'),localPostgresProfile());
  assert.deepEqual(localPostgresBridgeCommand(),['nc','127.0.0.1','5432']);
  assert.equal(profile.uid,999);assert.ok(Object.isFrozen(profile));
});
test('T66 profile and factory refuse free image URL endpoint env or unknown options before Docker',async()=>{
  for(const name of ['postgres:latest','https://external.invalid/image','pgvector16 ',{},null])assert.throws(()=>localPostgresProfile(name));
  for(const options of [{profile:'external'}, {profile:'pgvector16',image:'external'}, {profile:'pgvector16',url:'postgresql://external'},
    {profile:'pgvector16',env:{DOCKER_HOST:'tcp://external'}}])await assert.rejects(createDisposablePostgres(options));
});
test('T66 cached pgvector image ID and repository digest are independent mandatory checks',()=>{
  const image={Id:profile.imageId,RepoDigests:[profile.repoDigest],Architecture:'amd64',Os:'linux'};
  assert.equal(assertCachedPgvectorImage(image),profile.imageId);
  for(const changed of [{...image,Id:'sha256:'+'0'.repeat(64)},{...image,RepoDigests:[]},
    {...image,RepoDigests:['unrelated@'+profile.imageId]},{...image,Architecture:'arm64'},{...image,Os:'windows'}])
    assert.throws(()=>assertCachedPgvectorImage(changed));
});
test('T66 Bash program is static loopback duplex with both cat children reaped on EOF or signal',()=>{
  assert.deepEqual(localPostgresBridgeCommand('pgvector16'),['/bin/bash','-c',PGVECTOR_LOOPBACK_BASH]);
  assert.match(PGVECTOR_LOOPBACK_BASH,/exec 3<>\/dev\/tcp\/127\.0\.0\.1\/5432/);
  assert.match(PGVECTOR_LOOPBACK_BASH,/exec 4<&0/);
  assert.match(PGVECTOR_LOOPBACK_BASH,/cat <&3 3<&- 4<&- &/);assert.match(PGVECTOR_LOOPBACK_BASH,/cat <&4 >&3 3<&- 4<&- &/);
  assert.match(PGVECTOR_LOOPBACK_BASH,/wait -n "\$reader" "\$writer"/);
  for(const pid of ['reader','writer']){
    assert.ok(PGVECTOR_LOOPBACK_BASH.includes('kill "$'+pid+'"'));
    assert.ok(PGVECTOR_LOOPBACK_BASH.includes('wait "$'+pid+'"'));
  }
  assert.match(PGVECTOR_LOOPBACK_BASH,/trap cleanup EXIT/);assert.match(PGVECTOR_LOOPBACK_BASH,/trap 'exit 143' TERM/);
  assert.doesNotMatch(PGVECTOR_LOOPBACK_BASH,/curl|wget|apt-get|apk add|eval/);
});
test('T66 pgvector container profile requires the pinned image and exact unprivileged tmpfs identity',()=>{
  const actual={Image:profile.imageId,Config:{User:'999:999'},HostConfig:{Tmpfs:{
    '/var/lib/postgresql/data':'rw,size=256m,uid=999,gid=999,mode=0700','/var/run/postgresql':'rw,size=16m,uid=999,gid=999'}}};
  assert.doesNotThrow(()=>assertPgvectorContainer(actual));
  for(const changed of [{...actual,Image:'sha256:'+'0'.repeat(64)},{...actual,Config:{User:'0:0'}},
    {...actual,HostConfig:{Tmpfs:{}}}])assert.throws(()=>assertPgvectorContainer(changed));
});

const catalog={extension:'0.8.7',columnType:'vector(384)',dimensions:384,sameSimilarity:1,otherSimilarity:0,
  indexDefinition:'CREATE INDEX knowledge_chunks_embedding_vec_idx ON public.knowledge_chunks USING hnsw (embedding_vec vector_cosine_ops)'};
const dbWith=(calls,changed={})=>({profile:'pgvector16',imageId:profile.imageId,repoDigest:profile.repoDigest,runId,network:'none',transport:'loopback-exec',
  sql:async sql=>{
    calls.push(sql);
    if(sql==='SELECT run_id FROM synthetic_native_marker')return runId;
    if(sql.startsWith('SELECT count(*) FROM _prisma_migrations'))return '1';
    if(sql.startsWith('BEGIN;'))return '';
    return JSON.stringify(catalog);
  },...changed});
test('T66 owned vector preparation checks marker ledger DDL and real-catalog contract in that order',async()=>{
  const calls=[];assert.equal((await prepareOwnedPgvector(dbWith(calls))).columnType,'vector(384)');
  assert.equal(calls.length,4);assert.equal(calls[0],'SELECT run_id FROM synthetic_native_marker');
  assert.match(calls[1],/_prisma_migrations/);assert.match(calls[2],/^BEGIN;/);
  assert.match(calls[2],/CREATE EXTENSION IF NOT EXISTS vector/);assert.match(calls[2],/embedding_vec vector\(384\)/);
  assert.doesNotMatch(calls[2],/DROP|EXCEPTION|RAISE NOTICE/);assert.match(calls[3],/<=>/);
});
test('T66 vector preparation refuses wrong owned profile marker ledger or dimension without a tolerated fallback',async()=>{
  for(const changed of [{profile:'alpine16'},{imageId:'unrelated'},{repoDigest:'unrelated'},{network:'bridge'},{transport:'external'}])
    await assert.rejects(prepareOwnedPgvector(dbWith([],changed)));
  await assert.rejects(prepareOwnedPgvector(dbWith([],{sql:async()=> 'foreign-marker'})));
  const noLedger=dbWith([]);
  await assert.rejects(prepareOwnedPgvector({...noLedger,sql:async sql=>sql.startsWith('SELECT count(*)')?'0':noLedger.sql(sql)}),/normal_migration_ledger_required/);
  for(const changed of [{extension:null},{columnType:'vector(1536)'},{dimensions:1536},{sameSimilarity:0},{otherSimilarity:1},{indexDefinition:null}]){
    const base=dbWith([]);await assert.rejects(prepareOwnedPgvector({...base,sql:async sql=>sql.startsWith('SELECT json_build_object')?JSON.stringify({...catalog,...changed}):base.sql(sql)}));
  }
  const base=dbWith([]);await assert.rejects(prepareOwnedPgvector({...base,sql:async sql=>sql.startsWith('BEGIN;')?Promise.reject(new Error('synthetic_vector_DDL_failure')):base.sql(sql)}),/synthetic_vector_DDL_failure/);
});

for(const selected of [undefined,'pgvector16'])test('T66 '+(selected??'default')+' owned bridge preserves local tracking and closes duplex child resources',async()=>{
  const calls=[];
  const spawn=(command,args,options)=>{
    calls.push({command,args,options});
    const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null});
    let closed=false;
    child.stdin.on('data',bytes=>child.stdout.write(bytes));
    child.kill=()=>{if(!closed){closed=true;child.signalCode='SIGTERM';queueMicrotask(()=>child.emit('close',null,'SIGTERM'));}return true;};
    return child;
  };
  const selectedInfo=selected===undefined?info:{...info,Image:profile.imageId,Config:{...info.Config,User:'999:999'},
    HostConfig:{...info.HostConfig,Tmpfs:{'/var/lib/postgresql/data':'rw,size=256m,uid=999,gid=999,mode=0700','/var/run/postgresql':'rw,size=16m,uid=999,gid=999'}}};
  const bridge=await openOwnedPostgresBridge({id,runId,context:'desktop-linux',endpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',env:{PATH:'fixture'},inspect:async()=>selectedInfo,profile:selected},spawn);
  let socket;
  try{
    socket=connect({host:bridge.host,port:bridge.port});await once(socket,'connect');
    const received=once(socket,'data');socket.write('synthetic-duplex');assert.equal((await received)[0].toString(),'synthetic-duplex');
    assert.equal(calls.length,1);assert.equal(calls[0].command,'docker');
    assert.deepEqual(calls[0].args,['--context','desktop-linux','exec','--interactive',id,...localPostgresBridgeCommand(selected)]);
    assert.equal(calls[0].options.windowsHide,true);assert.equal(bridge.host,'127.0.0.1');
    const ended=once(socket,'close');socket.end();await ended;
  }finally{socket?.destroy();await bridge.close();}
  assert.deepEqual(bridge.status(),{listening:false,sockets:0,children:0});await bridge.close();
});
