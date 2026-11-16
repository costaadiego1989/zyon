import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';
const requireDashboard=createRequire(new URL('../../dashboard/package.json',import.meta.url));
const {io}=requireDashboard('socket.io-client');

// AppModule, authentication, tenant middleware, HTTP, real Socket.IO and SQL.
// No outbound sender/AI/auth/repository override. This task queues, not sends.
test('T53 exact authenticated operator message queues atomically without trusting DTO delivery or sender flags',async t=>{
 const f=await createWhatsAppOperatorHttpFixture(),clients=[];
 try{
  for(const [auth,index]of [[f.ownerAuth,1],[f.productAuth,2]]){
   const accountSid='AC'+createHash('sha256').update(auth.merchant_id).digest('hex').slice(0,32),number='+551199988000'+index;
   await f.raw.whatsAppChannelConfig.update({where:{id:auth.merchant_id+'-config'},data:{whatsappNumber:number,
    credentials:{accountSid,authToken:'synthetic-local-only',senderId:'whatsapp:'+number}}});
  }
  const path=value=>'/support/tickets/'+value.ticket.id+'/messages';
  const snapshot=async value=>({...await f.snapshot(value),
   transportEvents:(await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'whatsapp.support.message.requested'},orderBy:{eventId:'asc'}}))
    .filter(row=>row.payload.ticketId===value.ticket.id).map(({eventId,eventType,payload})=>({eventId,eventType,payload})),
   deliveries:await f.raw.whatsAppDelivery.findMany({where:{merchantId:value.actor.merchantId,response:{path:['ticketId'],equals:value.ticket.id}},orderBy:{id:'asc'}})});
  const claimed=async(auth,suffix)=>{const value=await f.makeCase(auth,suffix);assert.equal((await f.request(f.path(value),{expectedEpoch:1},auth)).status,201);return value;};
  const value=await claimed(f.ownerAuth,'message'),unclaimed=await f.makeCase(f.ownerAuth,'unclaimed');
  let savedMessage,command;
  await t.test('missing credentials invalid content client IDs and unclaimed cases cannot queue',async()=>{
   const before=await snapshot(value),waitingBefore=await snapshot(unclaimed);
   assert.equal((await f.request(path(value),{content:'Synthetic',clientMessageId:randomUUID()})).status,401);
   for(const input of [null,{}, {content:' '},{content:'x'.repeat(4001),clientMessageId:randomUUID()},
    {content:'Synthetic'},{content:'Synthetic',clientMessageId:12345678},{content:'Synthetic',clientMessageId:'short'}])
    assert.equal((await f.request(path(value),input,f.ownerAuth)).status,400);
   assert.equal((await f.request(path(unclaimed),{content:'Synthetic',clientMessageId:randomUUID()},f.ownerAuth)).status,409);
   assert.deepEqual(await snapshot(value),before);assert.deepEqual(await snapshot(unclaimed),waitingBefore);
  });
  await t.test('only the exact active human tenant and claimed operator can send',async()=>{
   const before=await snapshot(value),input={content:'Synthetic',clientMessageId:randomUUID()};
   assert.equal((await f.request(path(value),input,f.foreignAuth)).status,404);
   const other=await f.request(path(value),input,f.staffAuth);assert.equal(other.status,403);
   assert.match(JSON.stringify(other.body),/whatsapp_claim_owned_by_another_operator/);assert.deepEqual(await snapshot(value),before);
  });
  await t.test('a real scoped API key cannot impersonate an operator even with free principal fields',async()=>{
   const {ApiKeyService}=await import('../dist/modules/integrations/domain/api-key.service.js'),generated=new ApiKeyService().generate('test'),keyId=randomUUID();
   await f.raw.merchantBillingSubscription.upsert({where:{merchantId:f.ownerAuth.merchant_id},create:{merchantId:f.ownerAuth.merchant_id,status:'active',planKey:'growth'},update:{status:'active',planKey:'growth',stripePriceId:null}});
   await f.raw.merchantApiKey.create({data:{id:keyId,merchantId:f.ownerAuth.merchant_id,name:'Synthetic message guard',keyHash:generated.keyHash,keyPrefix:generated.keyPrefix,scopes:['support:read','support:write'],environment:'test'}});
   const key={access_token:generated.rawKey,merchant_id:f.ownerAuth.merchant_id,credential_id:keyId};
   assert.equal((await f.request('/support/tickets',undefined,key,'GET')).status,200);const before=await snapshot(value);
   const result=await f.request(path(value),{content:'Synthetic',clientMessageId:randomUUID(),operatorId:f.ownerAuth.user_id,principal:{kind:'human',userId:f.ownerAuth.user_id}},key);
   assert.equal(result.status,403);assert.match(JSON.stringify(result.body),/human_operator_required/);assert.deepEqual(await snapshot(value),before);
  });
  await t.test('queue freezes the real actor scope text and original thread; queued never means read',async()=>{
   const before=await snapshot(value),clientMessageId=randomUUID();
   command={content:'  *Ol?!*\nSua solicita??o est? comigo.  ',clientMessageId,operatorId:'forged',senderType:'system',source:'widget',epoch:999,
    configId:f.foreignAuth.merchant_id+'-config',toNumber:'+5511000000000',metadata:{kind:'text',delivery:{status:'read',revision:999,providerMessageId:'forged'}}};
   const result=await f.request(path(value),command,f.ownerAuth);assert.equal(result.status,201);savedMessage=result.body;
   const after=await snapshot(value),meta=savedMessage.metadata;assert.equal(savedMessage.senderType,'merchant');assert.equal(savedMessage.content,command.content.trim());
   assert.deepEqual(meta,{kind:'whatsapp_outgoing',schemaVersion:1,bindingId:before.binding.id,configId:value.scope.configId,
    whatsappSessionId:value.session.id,epoch:2,operatorId:f.ownerAuth.user_id,clientMessageId,delivery:{status:'queued',revision:0,providerMessageId:null}});
   assert.equal(after.messages.length,before.messages.length+1);assert.equal(after.events.length,before.events.length+1);
   assert.equal(after.transportEvents.length,1);assert.deepEqual(after.transportEvents[0].payload,{messageId:savedMessage.id,ticketId:value.ticket.id,bindingId:before.binding.id,epoch:2});
   assert.equal(after.deliveries.length,1);const delivery=after.deliveries[0];assert.equal(delivery.id,'support_message:'+savedMessage.id);
   assert.equal(delivery.state,'queued');assert.equal(delivery.providerMessageId,null);assert.equal(delivery.processingToken,'not_started');
   assert.equal(delivery.response.contentHash,createHash('sha256').update(command.content.trim()).digest('hex'));
   assert.equal(delivery.response.authority.recipient,'+'+value.session.buyerPhone);assert.equal(delivery.response.authority.operatorId,f.ownerAuth.user_id);
   assert.equal(delivery.response.authority.epoch,2);assert.equal(delivery.response.authority.deviceId,value.session.deviceId);
   assert.equal(delivery.response.authority.configId,value.scope.configId);assert.equal(delivery.response.authority.whatsappSessionId,value.session.id);
   assert.equal(delivery.response.authority.bindingId,before.binding.id);assert.deepEqual(delivery.response.delivery,meta.delivery);
   assert.equal(JSON.stringify(savedMessage).includes('accountId'),false);assert.equal(JSON.stringify(savedMessage).includes('authToken'),false);
   assert.deepEqual(after.checkout,before.checkout);assert.deepEqual(after.session,before.session);assert.deepEqual(after.binding,before.binding);
   const history=await f.request(path(value),undefined,f.ownerAuth,'GET');assert.equal(history.status,200);
   assert.deepEqual(history.body.data.find(message=>message.id===savedMessage.id),savedMessage);
  });
  await t.test('equivalent replay returns the same persisted state; conflicting reuse never changes the original',async()=>{
   const before=await snapshot(value),result=await f.request(path(value),command,f.ownerAuth);assert.equal(result.status,201);assert.deepEqual(result.body,savedMessage);
   const conflict=await f.request(path(value),{content:'Different content',clientMessageId:command.clientMessageId},f.ownerAuth);assert.equal(conflict.status,409);
   assert.deepEqual(await snapshot(value),before);
  });
  await t.test('the legacy inbox receipt machine cannot acknowledge the new operator namespace',async()=>{
   const id='support_message:'+savedMessage.id;
   await f.raw.whatsAppDelivery.update({where:{id},data:{state:'sending'}});
   try{
    const before=await snapshot(value),{WhatsAppDeliveryService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-delivery.service.js');
    const legacy=new WhatsAppDeliveryService(f.scoped,{sendText:async()=>{throw new Error('legacy_namespace_probe_must_not_send');}});
    await f.as(value.actor,()=>legacy.reconcileMeta(value.actor.merchantId,value.scope.configId,{id:'synthetic-unrelated-provider',status:'read',biz_opaque_callback_data:id}));
    assert.deepEqual(await snapshot(value),before);
   }finally{await f.raw.whatsAppDelivery.update({where:{id},data:{state:'queued'}});}
  });
  await t.test('closed and alias-to-WhatsApp cases cannot enqueue or adopt a different ticket',async()=>{
   const closed=await claimed(f.ownerAuth,'closed');await f.raw.supportTicket.update({where:{id:closed.ticket.id},data:{status:'closed'}});
   const closedBefore=await snapshot(closed);assert.equal((await f.request(path(closed),{content:'Synthetic',clientMessageId:randomUUID()},f.ownerAuth)).status,409);
   assert.deepEqual(await snapshot(closed),closedBefore);
   const alias=await f.makeCase(f.ownerAuth,'alias',{source:'widget',mergedIntoId:value.ticket.id}),before=await snapshot(value),aliasBefore=await snapshot(alias);
   assert.equal((await f.request(path(alias),{content:'Synthetic',clientMessageId:randomUUID()},f.ownerAuth)).status,409);
   assert.deepEqual(await snapshot(value),before);assert.deepEqual(await snapshot(alias),aliasBefore);
  });
  await t.test('the final transport-outbox SQL failure rolls back message realtime event and delivery together',async()=>{
   const failure=await claimed(f.ownerAuth,'rollback'),before=await snapshot(failure);
   await f.raw.$executeRaw`CREATE SEQUENCE synthetic_operator_outbox_hits`;
   await f.raw.$executeRawUnsafe("CREATE FUNCTION synthetic_reject_operator_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='whatsapp.support.message.requested' THEN PERFORM nextval('synthetic_operator_outbox_hits'); RAISE EXCEPTION 'synthetic_operator_outbox_rollback'; END IF; RETURN NEW; END $$");
   await f.raw.$executeRawUnsafe('CREATE TRIGGER synthetic_operator_outbox_rollback BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_operator_outbox()');
   try{
    assert.equal((await f.request(path(failure),{content:'Synthetic rollback',clientMessageId:randomUUID()},f.ownerAuth)).status,500);
    assert.deepEqual(await f.raw.$queryRaw`SELECT last_value::int AS value,is_called FROM synthetic_operator_outbox_hits`,[{value:1,is_called:true}]);
    assert.deepEqual(await snapshot(failure),before);
   }finally{await f.raw.$executeRawUnsafe('DROP TRIGGER synthetic_operator_outbox_rollback ON outbox_messages');await f.raw.$executeRawUnsafe('DROP FUNCTION synthetic_reject_operator_outbox()');await f.raw.$executeRawUnsafe('DROP SEQUENCE synthetic_operator_outbox_hits');}
  });
  await t.test('a product merchant queues identically and legacy widget send and alias behavior remain valid',async()=>{
   const product=await claimed(f.productAuth,'product'),before=await snapshot(product),input={content:'Synthetic product support',clientMessageId:randomUUID()};
   const queued=await f.request(path(product),input,f.productAuth);assert.equal(queued.status,201);assert.equal(queued.body.metadata.delivery.status,'queued');
   const after=await snapshot(product);assert.deepEqual(after.checkout,before.checkout);assert.deepEqual(after.session,before.session);
   const widget=await f.makeCase(f.ownerAuth,'widget',{source:'widget'}),widgetInput={content:'Legacy widget reply',clientMessageId:randomUUID()};
   const widgetResult=await f.request(path(widget),widgetInput,f.ownerAuth);assert.equal(widgetResult.status,201);assert.equal(widgetResult.body.metadata,null);
   const widgetAfter=await snapshot(widget);assert.equal(widgetAfter.binding,null);assert.equal(widgetAfter.deliveries.length,0);assert.equal(widgetAfter.transportEvents.length,0);
   const alias=await f.makeCase(f.ownerAuth,'widget-alias',{source:'widget',mergedIntoId:widget.ticket.id});
   const aliasResult=await f.request(path(alias),{content:'Another widget reply',clientMessageId:randomUUID()},f.ownerAuth);assert.equal(aliasResult.status,201);assert.equal(aliasResult.body.ticketId,widget.ticket.id);
  });
  await t.test('cross-store transfer refuses a WhatsApp case before any tenant write',async()=>{
   await f.raw.marketplaceConnection.create({data:{buyerMerchantId:f.ownerAuth.merchant_id,sellerMerchantId:f.foreignAuth.merchant_id,status:'active'}});
   const before=await snapshot(value),result=await f.request('/support/tickets/'+value.ticket.id+'/transfer',{targetMerchantId:f.foreignAuth.merchant_id},f.ownerAuth);
   assert.equal(result.status,403);assert.match(JSON.stringify(result.body),/whatsapp_ticket_transfer_not_available/);assert.deepEqual(await snapshot(value),before);
  });
  await t.test('an explicitly authorized staff operator can send only after claiming its own exact case',async()=>{
   const staffCase=await claimed(f.staffAuth,'staff-message'),before=await snapshot(staffCase),clientMessageId=randomUUID();
   assert.equal(before.binding.assignedOperatorId,f.staffAuth.user_id);assert.equal(before.ticket.assignedTo,f.staffAuth.user_id);
   const result=await f.request(path(staffCase),{content:'Synthetic staff reply',clientMessageId,operatorId:f.ownerAuth.user_id},f.staffAuth);
   assert.equal(result.status,201);assert.equal(result.body.metadata.operatorId,f.staffAuth.user_id);assert.equal(result.body.metadata.epoch,2);
   assert.deepEqual(result.body.metadata.delivery,{status:'queued',revision:0,providerMessageId:null});
   const after=await snapshot(staffCase);assert.equal(after.messages.length,before.messages.length+1);assert.equal(after.transportEvents.length,1);assert.equal(after.deliveries.length,1);
   assert.deepEqual(after.binding,before.binding);assert.deepEqual(after.session,before.session);assert.deepEqual(after.checkout,before.checkout);
  });
  await t.test('real authenticated Socket.IO sends retain operator authority and reject another operator',async()=>{
   const connect=auth=>new Promise((resolve,reject)=>{
    const client=io(f.runtime.apiOrigin+'/support',{auth:{accessToken:auth.access_token},transports:['websocket'],reconnection:false,forceNew:true,timeout:5000});clients.push(client);
    let timer;const fail=error=>{clearTimeout(timer);client.disconnect();reject(error);};
    timer=setTimeout(()=>fail(new Error('operator_socket_authentication_timeout')),5000);
    client.once('connect_error',fail);client.once('error',fail);client.once('disconnect',reason=>fail(new Error('operator_socket_disconnected_before_authentication:'+reason)));
    client.once('authenticated',()=>{clearTimeout(timer);client.off('connect_error',fail);client.off('error',fail);client.removeAllListeners('disconnect');resolve(client);});
   });
   const owner=await connect(f.ownerAuth),staff=await connect(f.staffAuth);
   const emit=(client,body)=>new Promise((resolve,reject)=>client.timeout(5000).emit('send_message',body,(error,result)=>error?reject(error):resolve(result)));
   const before=await snapshot(value),clientMessageId=randomUUID();
   const sent=await emit(owner,{ticketId:value.ticket.id,content:'Actual socket operator',clientMessageId,senderType:'system',operatorId:'forged'});
   assert.equal(sent.success,true);assert.equal(sent.message.senderType,'merchant');assert.equal(sent.message.metadata.operatorId,f.ownerAuth.user_id);
   assert.equal(sent.message.metadata.clientMessageId,clientMessageId);assert.deepEqual(sent.message.metadata.delivery,{status:'queued',revision:0,providerMessageId:null});
   const after=await snapshot(value);assert.equal(after.messages.length,before.messages.length+1);assert.equal(after.deliveries.length,before.deliveries.length+1);
   const rejected=await emit(staff,{ticketId:value.ticket.id,content:'Forbidden other operator',clientMessageId:randomUUID(),operatorId:f.ownerAuth.user_id});
   assert.deepEqual(rejected,{success:false,error:'send_failed'});assert.deepEqual(await snapshot(value),after);
  });
  assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);
 }finally{for(const client of clients)client.disconnect();await f.close();}
});
