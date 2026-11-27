import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {Redis} from 'ioredis';
import {assertOwnedJourneyRedisPing} from './journey-redis-ping-guard.mjs';

// Actual ioredis protocol/connection state against a test-owned RESP endpoint.
// No AppModule, database, provider or existing test expectation is involved.
const resp=value=>Array.isArray(value)?'*'+value.length+'\r\n'+value.map(resp).join(''):
  typeof value==='number'?':'+value+'\r\n':'$'+Buffer.byteLength(value)+'\r\n'+value+'\r\n';
async function fixture(options={}){
  const peers=new Set(),commands=[];let pendingAck,observeSubscribe,onPing;
  const subscriptionSeen=new Promise(resolve=>{observeSubscribe=resolve;});
  const server=net.createServer(socket=>{
    peers.add(socket);socket.once('close',()=>peers.delete(socket));let pending='',subscribed=false;
    socket.on('data',chunk=>{
      pending+=chunk.toString();
      while(pending){
        const header=/^\*(\d+)\r\n/.exec(pending);if(!header)return;let offset=header[0].length;const args=[];
        for(let n=0;n<Number(header[1]);n++){
          const bulk=/^\$(\d+)\r\n/.exec(pending.slice(offset));if(!bulk)return;offset+=bulk[0].length;
          const length=Number(bulk[1]);if(pending.length<offset+length+2)return;args.push(pending.slice(offset,offset+length));offset+=length+2;
        }
        pending=pending.slice(offset);const name=args[0].toLowerCase();commands.push(name);
        if(name==='subscribe'){
          pendingAck=()=>{subscribed=true;socket.write(resp(['subscribe',args[1],1]));pendingAck=undefined;};observeSubscribe();
          if(!options.deferSubscriptionAck)pendingAck();
        }else if(name==='ping'){
          onPing?.();const reply=Object.hasOwn(options,'reply')?options.reply:subscribed?['pong','']:null;
          socket.write(reply===null?'+PONG\r\n':resp(reply));
        }else if(name==='quit')socket.end('+OK\r\n');
        else socket.write('+OK\r\n');
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const client=new Redis({host:'127.0.0.1',port:server.address().port,lazyConnect:true,enableReadyCheck:false,
    disableClientInfo:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
  client.on('error',()=>{});
  await client.connect();
  return{client,commands,subscriptionSeen,ack(){assert.equal(typeof pendingAck,'function');pendingAck();},setOnPing(value){onPing=value;},
    async close(){client.disconnect();for(const peer of peers)peer.destroy();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
test('ordinary Redis still requires the exact PONG and sends one real PING',{timeout:7000},async()=>{
  const f=await fixture();try{assert.equal(await assertOwnedJourneyRedisPing(f.client),'normal');assert.equal(f.commands.filter(x=>x==='ping').length,1);}finally{await f.close();}
});
test('a pubsub tuple cannot replace PONG on an ordinary Redis connection',{timeout:7000},async()=>{
  const f=await fixture({reply:['pong','']});try{await assert.rejects(assertOwnedJourneyRedisPing(f.client));assert.equal(f.commands.filter(x=>x==='ping').length,1);}finally{await f.close();}
});
test('an actual acknowledged subscriber accepts only the exact pubsub PING tuple',{timeout:7000},async()=>{
  const f=await fixture();try{await f.client.subscribe('proof:owned');assert.equal(f.client.mode,'subscriber');assert.equal(await assertOwnedJourneyRedisPing(f.client),'subscriber');assert.equal(f.commands.filter(x=>x==='ping').length,1);}finally{await f.close();}
});
test('subscriber PING rejects wrong body, case, shape, length and ordinary text',{timeout:7000},async()=>{
  for(const reply of [['pong','unexpected'],['PONG',''],['pong'],['pong','','extra'],'PONG']){
    const f=await fixture({reply});try{await f.client.subscribe('proof:owned');await assert.rejects(assertOwnedJourneyRedisPing(f.client),/journey_exact_redis_subscriber_pong_required/);assert.equal(f.commands.filter(x=>x==='ping').length,1);}finally{await f.close();}
  }
});
test('pending real SUBSCRIBE ACK completes before freezing the mode and issuing PING',{timeout:7000},async()=>{
  const f=await fixture({deferSubscriptionAck:true});try{
    const subscribed=f.client.subscribe('proof:pending');await f.subscriptionSeen;assert.equal(f.client.mode,'normal');
    const guarded=assertOwnedJourneyRedisPing(f.client);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.commands.filter(x=>x==='ping').length,0);f.ack();await subscribed;
    assert.equal(await guarded,'subscriber');assert.equal(f.commands.filter(x=>x==='ping').length,1);
  }finally{await f.close();}
});
test('an injected mode getter is refused without being invoked or sending PING',{timeout:7000},async()=>{
  const f=await fixture();let getterCalls=0;try{
    Object.defineProperty(f.client,'mode',{configurable:true,get(){getterCalls++;return 'subscriber';}});
    await assert.rejects(assertOwnedJourneyRedisPing(f.client),/journey_redis_mode_shadow_forbidden/);
    assert.equal(getterCalls,0);assert.equal(f.commands.filter(x=>x==='ping').length,0);
  }finally{delete f.client.mode;await f.close();}
});
test('an injected subscription getter cannot grant the subscriber proof',{timeout:7000},async()=>{
  const f=await fixture();let getterCalls=0;try{
    await f.client.subscribe('proof:owned');Object.defineProperty(f.client.condition.subscriber,'channels',{configurable:true,get(){getterCalls++;throw Error('untrusted getter');}});
    await assert.rejects(assertOwnedJourneyRedisPing(f.client),/journey_subscription_method_shadow_forbidden/);
    assert.equal(getterCalls,0);assert.equal(f.commands.filter(x=>x==='ping').length,0);
  }finally{await f.close();}
});
test('mode transitions during PING are rejected after the startup ACK barrier',{timeout:7000},async()=>{
  const f=await fixture();try{
    await f.client.subscribe('proof:owned');f.setOnPing(()=>{f.client.condition.subscriber=false;});
    await assert.rejects(assertOwnedJourneyRedisPing(f.client),/journey_redis_mode_changed_during_ping/);
    assert.equal(f.commands.filter(x=>x==='ping').length,1);
  }finally{await f.close();}
});
test('an injected connection condition getter is refused before the SDK mode getter can invoke it',{timeout:7000},async()=>{
  const f=await fixture(),original=Object.getOwnPropertyDescriptor(f.client,'condition');let getterCalls=0;
  try{
    Object.defineProperty(f.client,'condition',{configurable:true,get(){getterCalls++;throw Error('untrusted condition getter');}});
    await assert.rejects(assertOwnedJourneyRedisPing(f.client),/journey_redis_condition_data_descriptor_required/);
    assert.equal(getterCalls,0);assert.equal(f.commands.filter(x=>x==='ping').length,0);
  }finally{Object.defineProperty(f.client,'condition',original);await f.close();}
});
test('an injected condition subscriber getter is refused before the SDK mode getter can invoke it',{timeout:7000},async()=>{
  const f=await fixture(),condition=f.client.condition,original=Object.getOwnPropertyDescriptor(condition,'subscriber');let getterCalls=0;
  try{
    Object.defineProperty(condition,'subscriber',{configurable:true,get(){getterCalls++;throw Error('untrusted subscriber getter');}});
    await assert.rejects(assertOwnedJourneyRedisPing(f.client),/journey_redis_subscriber_data_descriptor_required/);
    assert.equal(getterCalls,0);assert.equal(f.commands.filter(x=>x==='ping').length,0);
  }finally{Object.defineProperty(condition,'subscriber',original);await f.close();}
});
