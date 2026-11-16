import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {connect} from 'node:net';
import {ALPINE_EOF_CAPABILITY,ALPINE_NC_EOF_PROGRAM,ALPINE_NC_EOF_PREFLIGHT,alpineEofCommand,alpineEofPreflightCommand,alpineEofSpawn,openOwnedAlpineEofBridge} from './local-postgres-alpine-eof.mjs';
import {localPostgresBridgeCommand} from './local-postgres-profiles.mjs';

const id='a'.repeat(64),runId='01234567-89ab-4cde-8fab-0123456789ab',image='sha256:'+'b'.repeat(64);
const info={Id:id,Name:'/aacp-write-db-'+runId,Image:image,
  Config:{User:'70:70',Labels:{'com.zyon.storefront-write-test':runId}},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,PortBindings:{}},Mounts:[]};
const options=()=>({capability:ALPINE_EOF_CAPABILITY,id,runId,context:'desktop-linux',
  endpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',env:{PATH:'fixture'},inspect:async()=>info,expectedImageId:image});

test('additive Alpine EOF command is static and the original default nc command is unchanged',()=>{
  assert.deepEqual(localPostgresBridgeCommand(),['nc','127.0.0.1','5432']);
  assert.deepEqual(alpineEofCommand(),['/bin/sh','-c',ALPINE_NC_EOF_PROGRAM]);
  assert.deepEqual(alpineEofPreflightCommand(),['/bin/sh','-c',ALPINE_NC_EOF_PREFLIGHT]);
  assert.ok(ALPINE_NC_EOF_PREFLIGHT.includes('[ "$status" -eq 127 ]'));
  assert.ok(ALPINE_NC_EOF_PREFLIGHT.includes('exec nc 127.0.0.1 5432 -e /bin/sh -c'));
  assert.ok(ALPINE_NC_EOF_PREFLIGHT.includes(ALPINE_EOF_CAPABILITY));
  assert.ok(ALPINE_NC_EOF_PROGRAM.includes('exec 8<&0 9>&1'));
  assert.ok(ALPINE_NC_EOF_PROGRAM.includes('exec nc 127.0.0.1 5432 -e /bin/sh -c'));
  assert.ok(ALPINE_NC_EOF_PROGRAM.includes('exec 7<&0'));
  assert.ok(ALPINE_NC_EOF_PROGRAM.includes('wait -n || status=$?'));
  for(const child of ['reader','writer']){
    assert.ok(ALPINE_NC_EOF_PROGRAM.includes('kill "$'+child+'"'));
    assert.ok(ALPINE_NC_EOF_PROGRAM.includes('wait "$'+child+'"'));
  }
});

test('explicit owned capability delegates to the base bridge and preserves its exact lifecycle',async()=>{
  const calls=[];
  const spawn=(command,args,config)=>{
    calls.push({command,args,config});const child=new EventEmitter();
    Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null});
    let closed=false;child.stdin.on('data',bytes=>child.stdout.write(bytes));
    child.kill=()=>{if(!closed){closed=true;child.signalCode='SIGTERM';queueMicrotask(()=>child.emit('close',null,'SIGTERM'));}return true;};
    return child;
  };
  const bridge=await openOwnedAlpineEofBridge(options(),spawn);let socket;
  try{
    socket=connect({host:bridge.host,port:bridge.port});await once(socket,'connect');
    const received=once(socket,'data');socket.write('synthetic-additive-capability');assert.equal((await received)[0].toString(),'synthetic-additive-capability');
    assert.equal(calls.length,1);assert.equal(calls[0].command,'docker');
    assert.deepEqual(calls[0].args,['--context','desktop-linux','exec','--interactive',id,...alpineEofCommand()]);
    assert.equal(calls[0].config.windowsHide,true);assert.equal(bridge.host,'127.0.0.1');
    const closed=once(socket,'close');socket.end();await closed;
  }finally{socket?.destroy();await bridge.close();}
  assert.deepEqual(bridge.status(),{listening:false,sockets:0,children:0});
});

test('capability refuses absent forged array and free command options before spawn',async()=>{
  let spawns=0;const forbidden=()=>{spawns++;throw Error('forbidden_spawn');};
  for(const value of [undefined,'default','pgvector16',{},['owned-alpine-nc-first-eof-v1']])
    await assert.rejects(openOwnedAlpineEofBridge({...options(),capability:value},forbidden),/alpine_eof_explicit_capability_required/);
  for(const key of ['profile','command','imageUrl','host','port','timeout','argv'])
    await assert.rejects(openOwnedAlpineEofBridge({...options(),[key]:'untrusted'},forbidden),/alpine_eof_unknown_option/);
  assert.equal(spawns,0);
});

test('command builder rejects all arguments and scope cannot alter the Docker command or argv',()=>{
  for(const value of ['127.0.0.2',5433,{},['nc'],undefined])assert.throws(()=>alpineEofCommand(value),/alpine_eof_command_has_no_arguments/);
  for(const value of ['127.0.0.2',5433,{},['nc'],undefined])assert.throws(()=>alpineEofPreflightCommand(value),/alpine_eof_preflight_has_no_arguments/);
  const execute=alpineEofSpawn('desktop-linux',id,()=>assert.fail('invalid command must never spawn'));
  const exact=['--context','desktop-linux','exec','--interactive',id,'nc','127.0.0.1','5432'];
  assert.throws(()=>execute('cmd',exact,{}),/alpine_eof_docker_only/);
  for(const value of [[...exact,'-w','1'],[...exact.slice(0,-1),'5433'],[...exact.slice(0,4),'c'.repeat(64),...exact.slice(5)]])
    assert.throws(()=>execute('docker',value,{}),/alpine_eof_exact_owned_argv_required/);
  assert.throws(()=>alpineEofSpawn('ssh://remote',id),assert.AssertionError);
});

test('captured image UID UUID and isolated context guards reject mismatches before spawn',async()=>{
  let spawns=0;const forbidden=()=>{spawns++;throw Error('forbidden_spawn');};
  for(const changed of [{Image:'sha256:'+'c'.repeat(64)},{Config:{...info.Config,User:'999:999'}},
    {Name:'/unowned'}, {Config:{...info.Config,Labels:{'com.zyon.storefront-write-test':'another-run'}}},
    {HostConfig:{...info.HostConfig,NetworkMode:'bridge'}},{HostConfig:{...info.HostConfig,ReadonlyRootfs:false}},
    {HostConfig:{...info.HostConfig,PortBindings:{'5432/tcp':[{HostPort:'5432'}]}}}])
    await assert.rejects(openOwnedAlpineEofBridge({...options(),inspect:async()=>({...info,...changed})},forbidden),assert.AssertionError);
  await assert.rejects(openOwnedAlpineEofBridge({...options(),endpoint:'tcp://127.0.0.1:2375'},forbidden),/local_docker_context_required/);
  assert.equal(spawns,0);
});
