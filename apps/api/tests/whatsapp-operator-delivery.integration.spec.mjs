import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {operatorTerminalDiagnostic,operatorCloseDiagnostic} from './whatsapp-operator-delivery-diagnostics.mjs';
const requireDashboard=createRequire(new URL('../../dashboard/package.json',import.meta.url));
const{io}=requireDashboard('socket.io-client');

// Real AppModule/HTTP/HMAC/auth/SQL/dispatcher/Gateway. The only transport
// override is the named local sender port, explicitly recorded by the worker.
// Captured acceptance is not a provider delivery/read receipt.
test('T54 local operator delivery through the real application',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const outcomes=[{status:'sent',messageId:'synthetic-owner-accepted'},{status:'failed',messageId:''},
    {status:'unknown',messageId:''},{status:'queued',messageId:'synthetic-product-accepted'}];
  const f=await createWhatsAppOperatorHttpFixture({provider:'META_CLOUD',operatorDelivery:true,whatsapp:{operatorOutcomes:outcomes}}),clients=[];
  try{
    const phoneIds=new Map([[f.ownerAuth.merchant_id,'90002001'],[f.productAuth.merchant_id,'90002002']]);
    for(const auth of [f.ownerAuth,f.productAuth])await f.raw.whatsAppChannelConfig.update({where:{id:auth.merchant_id+'-config'},data:{
      credentials:{phoneNumberId:phoneIds.get(auth.merchant_id),wabaId:'90002999',accessToken:'synthetic-private-token-'+auth.merchant_id}}});
    const wait=async(work,label)=>{const end=Date.now()+15_000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};
    const submissions=()=>f.runtime.whatsapp.events().filter(event=>event.kind==='sendText'&&event.input.correlationId?.startsWith('support_message:'));
    const path=value=>'/support/tickets/'+value.ticket.id+'/messages';
    const claimed=async(auth,suffix,expired=false)=>{
      const value=await f.makeCase(auth,suffix);assert.equal((await f.request(f.path(value),{expectedEpoch:1},auth)).status,201);
      const eventId='synthetic-operator-'+randomUUID(),body=JSON.stringify({entry:[{changes:[{field:'messages',value:{
        metadata:{phone_number_id:phoneIds.get(auth.merchant_id)},messages:[{id:eventId,from:value.session.buyerPhone,
          timestamp:String(Math.floor(Date.now()/1000)-(expired?25*60*60:0)),type:'text',text:{body:'Synthetic authenticated support context'}}]}}]}]});
      const response=await fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body});
      assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true});
      await wait(async()=>{const inbox=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId}});
        if(inbox&&['dead','blocked'].includes(inbox.status))assert.fail('authenticated operator context failed '+inbox.lastError);
        return inbox?.status==='processed'?inbox:undefined;},'authenticated incoming context not processed');
      return value;
    };
    const queue=async(value,content='Synthetic operator reply')=>{
      const result=await f.request(path(value),{content,clientMessageId:randomUUID(),toNumber:'+5511000000000',provider:'TWILIO',deviceId:'forged'},value.auth);
      assert.equal(result.status,201);assert.deepEqual(result.body.metadata.delivery,{status:'queued',revision:0,providerMessageId:null});return result.body;
    };
    const terminal=async message=>{try{return await wait(async()=>{const row=await f.raw.supportTicketMessage.findUniqueOrThrow({where:{id:message.id}});
      return row.metadata?.delivery?.status!=='queued'?row:undefined;},'operator delivery did not reach a terminal submission result');
    }catch(error){try{await operatorTerminalDiagnostic(f,message.id);}catch{}throw error;}};
    const preserved=async value=>{const snapshot=await f.snapshot(value);return{checkout:snapshot.checkout,session:snapshot.session,binding:snapshot.binding,ticket:snapshot.ticket};};
    const afterEnqueue=(before,message)=>({...before,ticket:{...before.ticket,updatedAt:new Date(message.createdAt)}});
    await t.test('runtime declares only the local sender and keeps canonical guards and dispatcher',async()=>{
      assert.deepEqual(f.runtime.evidence().localProviderOverrides,['whatsapp-channel.WHATSAPP_SENDER_PORT']);
      assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().authOverrides,false);
      assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().providerCalls,0);
      assert.deepEqual(await f.raw.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgname='synthetic_defer_operator_transport'`,[]);
    });
    let first,firstMessage;
    await t.test('authenticated operator text reaches only its original thread and becomes accepted',async()=>{
      first=await claimed(f.ownerAuth,'delivery-owner');const before=await preserved(first);
      firstMessage=await queue(first,'*Synthetic original operator*\nMessage for this exact conversation.');
      const row=await terminal(firstMessage);assert.deepEqual(row.metadata.delivery,{status:'accepted',revision:1,providerMessageId:'synthetic-owner-accepted'});
      const captured=submissions();assert.equal(captured.length,1);assert.deepEqual(captured[0].input,{provider:'META_CLOUD',deviceId:first.session.deviceId,
        toNumber:'+'+first.session.buyerPhone,text:firstMessage.content,correlationId:'support_message:'+firstMessage.id});
      assert.deepEqual(captured[0].result,outcomes[0]);assert.deepEqual(await preserved(first),afterEnqueue(before,firstMessage));
      const outbox=await wait(()=>f.raw.outboxMessage.findFirst({where:{eventType:'whatsapp.support.message.requested',causationId:firstMessage.id,status:'delivered'}}),'transport outbox dispatch not acknowledged');
      assert.equal(outbox.attempts,1);assert.equal(outbox.producer,'support');
    });
    await t.test('duplicate HTTP command returns the same accepted message without another submission',async()=>{
      const before=await f.raw.supportTicketMessage.findUniqueOrThrow({where:{id:firstMessage.id}}),count=submissions().length;
      const result=await f.request(path(first),{content:firstMessage.content,clientMessageId:firstMessage.metadata.clientMessageId},f.ownerAuth);
      assert.equal(result.status,201);assert.equal(result.body.id,firstMessage.id);assert.deepEqual(result.body.metadata.delivery,before.metadata.delivery);
      assert.equal(await f.raw.whatsAppDelivery.count({where:{id:'support_message:'+firstMessage.id}}),1);assert.equal(submissions().length,count);
      assert.equal(await f.raw.outboxMessage.count({where:{eventType:'whatsapp.support.message.requested',causationId:firstMessage.id}}),1);
    });
    for(const [suffix,status,errorCode]of [['rejected','failed','provider_rejected'],['timeout','unknown','submission_unknown']])
      await t.test('local '+suffix+' retains one command and a truthful '+status+' result',async()=>{
        const value=await claimed(f.ownerAuth,suffix),before=await preserved(value),message=await queue(value),row=await terminal(message);
        assert.deepEqual(row.metadata.delivery,{status,revision:1,providerMessageId:null,errorCode});
        const delivery=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:'support_message:'+message.id}});
        assert.equal(delivery.state,status);assert.deepEqual(delivery.response.delivery,row.metadata.delivery);assert.deepEqual(await preserved(value),afterEnqueue(before,message));
        const count=submissions().length;const replay=await f.request(path(value),{content:message.content,clientMessageId:message.metadata.clientMessageId},value.auth);
        assert.equal(replay.status,201);assert.equal(replay.body.id,message.id);assert.deepEqual(replay.body.metadata.delivery,row.metadata.delivery);assert.equal(submissions().length,count);
      });
    await t.test('product-company post-sale support retains the completed checkout and uses the same delivery path',async()=>{
      const value=await claimed(f.productAuth,'product-support');await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{status:'completed'}});
      const before=await preserved(value),message=await queue(value),row=await terminal(message);
      assert.deepEqual(row.metadata.delivery,{status:'accepted',revision:1,providerMessageId:'synthetic-product-accepted'});
      assert.deepEqual(await preserved(value),afterEnqueue(before,message));assert.equal(before.session.status,'completed');
    });
    await t.test('offline and expired-window commands preserve context and never call the sender',async()=>{
      for(const expired of [false,true]){
        const value=await claimed(f.ownerAuth,'unavailable-'+expired,expired),before=await preserved(value),count=submissions().length;
        if(!expired)await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{enabled:false}});
        try{
          const message=await queue(value),row=await terminal(message);
          assert.deepEqual(row.metadata.delivery,{status:'failed',revision:1,providerMessageId:null,errorCode:expired?'service_window_unavailable':'channel_offline'});
          assert.equal(submissions().length,count);assert.deepEqual(await preserved(value),afterEnqueue(before,message));
        }finally{if(!expired)await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{enabled:true}});}
      }
    });
    await t.test('public HTTP history and real Gateway events expose no private dispatch credentials',async()=>{
      const socket=io(f.runtime.apiOrigin+'/support',{auth:{accessToken:f.ownerAuth.access_token},transports:['websocket'],reconnection:false,forceNew:true,timeout:5000});clients.push(socket);
      await new Promise((resolve,reject)=>{let timer;const fail=error=>{clearTimeout(timer);reject(error);};
        timer=setTimeout(()=>fail(new Error('operator_delivery_socket_authentication_timeout')),5000);
        socket.once('connect_error',fail);socket.once('error',fail);socket.once('authenticated',()=>{clearTimeout(timer);socket.off('error',fail);socket.off('connect_error',fail);resolve();});});
      const joined=await new Promise((resolve,reject)=>socket.timeout(5000).emit('join_ticket',{ticketId:first.ticket.id},(error,result)=>error?reject(error):resolve(result)));
      assert.equal(typeof joined.joined,'string');const observed=[];socket.on('new_message',message=>observed.push(message));
      const message=await queue(first,'Synthetic public projection');await terminal(message);
      const live=await wait(async()=>observed.find(row=>row.id===message.id&&row.metadata?.delivery?.status==='accepted'),'accepted public gateway projection missing');
      const history=await f.request(path(first),undefined,f.ownerAuth,'GET');assert.equal(history.status,200);
      assert.deepEqual(history.body.data.find(row=>row.id===message.id).metadata.delivery,live.metadata.delivery);
      const row=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:'support_message:'+message.id}}),privateAttempt=row.response.submission;
      assert.ok(privateAttempt.outboxLeaseToken);assert.ok(privateAttempt.attemptToken);assert.ok(privateAttempt.credentialDigest);
      const publicJson=JSON.stringify({http:history.body,realtime:observed});
      for(const forbidden of ['deliveryLeaseToken','outboxLeaseToken','attemptToken','credentialDigest','outboxEventId','authority',
        privateAttempt.outboxLeaseToken,privateAttempt.attemptToken,privateAttempt.credentialDigest,'synthetic-private-token-'])assert.equal(publicJson.includes(forbidden),false,forbidden);
      assert.equal(await f.raw.supportTicketMessage.count({where:{id:message.id}}),1);
      assert.equal(observed.filter(row=>row.id===message.id&&row.metadata?.delivery?.status==='accepted').every(row=>row.metadata.delivery.revision===1),true);
    });
    assert.equal(submissions().length,5);assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{for(const client of clients)client.disconnect();try{await f.close();}catch(error){try{operatorCloseDiagnostic(error);}catch{}throw error;}}
});
