import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {once} from 'node:events';
import {inspect} from 'node:util';
import {parseCurrentProcessEstablishedTcp,readOwnedWindowsTcpRows} from './windows-owned-tcp.mjs';
import {createConstructionRedisSocketProof} from './nest-construction-only.guards.mjs';

const own=process.pid,other=process.pid+1;
const line=(local='127.0.0.1:51001',remote='127.0.0.1:51002',pid=own,state='ESTABLISHED')=>`  TCP    ${local}    ${remote}    ${state}    ${pid}\r\n`;
const expected={LocalAddress:'127.0.0.1',LocalPort:51001,RemoteAddress:'127.0.0.1',RemotePort:51002,OwningProcess:own,State:'Established'};

test('T108 native TCP collection contract',async t=>{
  await t.test('numeric endpoints are scoped to the current process and established TCP only',()=>{
    const text='Active Connections\r\n Proto Local Foreign State PID\r\n'+line()+line('127.0.0.1:51003','127.0.0.1:51002',other)
      +line('127.0.0.1:51004','127.0.0.1:51002',own,'CLOSE_WAIT')+' UDP 127.0.0.1:52000 *:* '+own+'\r\n';
    assert.deepEqual(parseCurrentProcessEstablishedTcp(text),[expected]);
    assert.deepEqual(parseCurrentProcessEstablishedTcp(line('127.0.0.1:51001','127.0.0.1:51002',other)),[]);
  });
  await t.test('IPv6 bracket endpoints and scopes remain distinct from IPv4 loopback',()=>{
    assert.deepEqual(parseCurrentProcessEstablishedTcp(line('[::1]:51001','[::1]:51002')),
      [{...expected,LocalAddress:'::1',RemoteAddress:'::1'}]);
    assert.deepEqual(parseCurrentProcessEstablishedTcp(line('[::ffff:127.0.0.1]:51001','[fe80::1%12]:51002')),
      [{...expected,LocalAddress:'::ffff:127.0.0.1',RemoteAddress:'fe80::1%12'}]);
  });
  await t.test('duplicate established rows remain ambiguous for the existing unique-tuple guard',()=>{
    assert.deepEqual(parseCurrentProcessEstablishedTcp(line()+line()),[expected,expected]);
  });
  await t.test('malformed owned established endpoints, ports and oversized output fail closed',()=>{
    for(const value of [line('localhost:51001'),line('127.0.0.1:0'),line('127.0.0.1:65536'),line('[::1:51001'),
      line('[fe80::1%bad]:51001'),line('127.0.0.1:NaN'),line('127.0.0.1:51001','bad:51002'),
      ` TCP 127.0.0.1:51001 127.0.0.1:51002 EXTRA ESTABLISHED ${own}\n`,line()+' TCP 127.0.0.1:51001 127.0.0.1:51002 ESTABLISHED\n',
      line()+' TCP 127.0.0.1:51003 127.0.0.1:51004 ESTABLISHED not-a-pid\n','x'.repeat(1_000_001),'\0',null])
      assert.throws(()=>parseCurrentProcessEstablishedTcp(value),/construction_native_tcp_output_invalid/);
  });
  await t.test('collector uses fixed native command and bounded options or rejects its unsupported platform',async()=>{
    let calls=0;
    const runner=async(file,args,options)=>{
      calls++;assert.match(file,/^[A-Za-z]:[\\/].*[\\/]System32[\\/]netstat\.exe$/i);assert.deepEqual(args,['-ano']);
      assert.deepEqual(options,{windowsHide:true,shell:false,timeout:10_000,maxBuffer:1_000_000,encoding:'utf8'});
      return{stdout:line(),stderr:''};
    };
    if(process.platform==='win32'){
      assert.deepEqual(await readOwnedWindowsTcpRows(runner),[expected]);assert.equal(calls,1);
    }else{
      await assert.rejects(readOwnedWindowsTcpRows(runner),/construction_native_tcp_evidence_windows_only/);assert.equal(calls,0);
    }
  });
  await t.test('failed native command discards partial output and exposes only bounded diagnostic fields',async()=>{
    const runner=async()=>{throw Object.assign(Error('PRIVATE-RAW-CANARY'),{stdout:line(),stderr:'PRIVATE-RAW-CANARY',code:'ETIMEDOUT',killed:true,signal:'SIGTERM'});};
    if(process.platform==='win32'){
      await assert.rejects(readOwnedWindowsTcpRows(runner),error=>{
        assert.equal(error.message,'construction_native_tcp_probe_failed');assert.equal(error.code,'ETIMEDOUT');assert.equal(error.killed,true);assert.equal(error.signal,'SIGTERM');
        assert.equal(inspect(error).includes('PRIVATE-RAW-CANARY'),false);assert.equal(Object.hasOwn(error,'stdout'),false);assert.equal(Object.hasOwn(error,'stderr'),false);return true;
      });
    }else await assert.rejects(readOwnedWindowsTcpRows(runner),/construction_native_tcp_evidence_windows_only/);
  });
  await t.test('actual native snapshot corroborates the exact live socket when Node peer getters are blank',async()=>{
    if(process.platform!=='win32'){
      await assert.rejects(readOwnedWindowsTcpRows(),/construction_native_tcp_evidence_windows_only/);return;
    }
    const peers=new Set(),server=net.createServer(socket=>{peers.add(socket);socket.on('close',()=>peers.delete(socket));});
    const replacement=new net.Socket(),owner={};let socket;
    try{
      const listening=once(server,'listening');server.listen({host:'127.0.0.1',port:0});await listening;
      socket=net.createConnection({host:'127.0.0.1',port:server.address().port});await once(socket,'connect');
      const remotePort=socket.remotePort,localPort=socket.localPort;
      Object.defineProperty(socket,'remoteAddress',{configurable:true,value:undefined});Object.defineProperty(socket,'remotePort',{configurable:true,value:undefined});
      const rows=await readOwnedWindowsTcpRows();
      assert.deepEqual(rows.filter(row=>row.LocalAddress==='127.0.0.1'&&row.LocalPort===localPort),
        [{LocalAddress:'127.0.0.1',LocalPort:localPort,RemoteAddress:'127.0.0.1',RemotePort:remotePort,OwningProcess:own,State:'Established'}]);
      const proof=createConstructionRedisSocketProof(remotePort);
      assert.deepEqual(await proof.captureAll([{owner,socket}]),{nativeTcpCorroborations:1});proof.assertCaptured(owner,socket);
      assert.throws(()=>proof.assertCaptured(owner,replacement),/construction_redis_socket_identity_required/);
      const closed=new Promise(resolve=>socket.once('close',resolve));socket.destroy();await closed;proof.assertCaptured(owner,socket);
      await assert.rejects(proof.captureAll([{owner:{},socket}]),/construction_redis_live_socket_required/);
    }finally{
      socket?.destroy();replacement.destroy();for(const peer of peers)peer.destroy();if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
