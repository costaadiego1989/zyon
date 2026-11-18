import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T58 actual served scoped conversation queue and minimal context',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createWhatsAppOperatorHttpFixture({provider:'META_CLOUD',operatorDelivery:true,whatsapp:true});
  try{
    const base='/support/whatsapp/conversations',get=(path,auth=f.ownerAuth)=>f.request(base+path,undefined,auth,'GET');
    const one=await f.makeCase(f.ownerAuth,'queue-one'),two=await f.makeCase(f.ownerAuth,'queue-two'),foreign=await f.makeCase(f.foreignAuth,'foreign');
    const ordinary=await f.makeCase(f.ownerAuth,'ordinary',{source:'widget'});
    await t.test('owner/admin/staff context is separate and private merchant profile remains forbidden to staff',async()=>{
      for(const auth of [f.ownerAuth,f.staffAuth,f.productAuth]){
        const actual=await get('/context',auth);assert.equal(actual.status,200);
        assert.deepEqual(actual.body,{merchant_id:auth.merchant_id,user_id:auth.user_id,role:auth===f.staffAuth?'STAFF':'OWNER'});
      }
      assert.equal((await f.request('/merchants/me',undefined,f.staffAuth,'GET')).status,403);
      assert.equal((await get('/context',null)).status,401);
      assert.equal((await get('/context?merchant_id='+f.foreignAuth.merchant_id)).status,403);
      assert.equal((await get('/context?role=OWNER',f.staffAuth)).status,400);
    });
    await t.test('list fixes current tenant and WhatsApp source while excluding ordinary support',async()=>{
      const result=await get('');assert.equal(result.status,200);
      assert.deepEqual(result.body.data.map(row=>row.id).sort(),[one.ticket.id,two.ticket.id].sort());
      assert.equal(result.body.data.some(row=>row.id===foreign.ticket.id||row.id===ordinary.ticket.id),false);
      assert.equal((await get('?merchantId='+f.foreignAuth.merchant_id)).status,403);
      assert.equal((await get('?source=widget')).status,400);
      assert.equal((await get('/'+foreign.ticket.id)).status,404);assert.equal((await get('/'+ordinary.ticket.id)).status,404);
      assert.equal((await f.request('/support/tickets/'+ordinary.ticket.id+'/messages',undefined,f.ownerAuth,'GET')).status,200);
    });
    await t.test('same-time cursor ordering is deterministic and malformed cursors fail closed',async()=>{
      const timestamp=new Date();await f.raw.supportTicket.updateMany({where:{id:{in:[one.ticket.id,two.ticket.id]}},data:{updatedAt:timestamp}});
      const first=await get('?limit=1');assert.equal(first.status,200);assert.equal(first.body.data.length,1);assert.equal(first.body.has_more,true);
      const next=await get('?limit=1&cursor='+encodeURIComponent(first.body.next_cursor));assert.equal(next.status,200);assert.equal(next.body.data.length,1);
      assert.notEqual(first.body.data[0].id,next.body.data[0].id);assert.equal(next.body.has_more,false);
      for(const query of ['limit=0','limit=201','cursor=invalid','cursor=','status=unknown'])assert.equal((await get('?'+query)).status,400);
    });
    await t.test('detail serializes only the public message projection, never rich private receipt metadata',async()=>{
      const privateCanary='PRIVATE_T58_'+randomUUID();
      await f.raw.supportTicketMessage.create({data:{id:randomUUID(),ticketId:one.ticket.id,senderType:'merchant',content:'Synthetic privacy projection',
        metadata:{kind:'whatsapp_outgoing',schemaVersion:1,clientMessageId:'private_projection_123',
          authority:{accountId:privateCanary},providerAccountId:privateCanary,sender:privateCanary,submission:{attemptToken:privateCanary},
          delivery:{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'}}}});
      const actual=await get('/'+one.ticket.id);assert.equal(actual.status,200);
      const row=actual.body.messages.find(message=>message.content==='Synthetic privacy projection');assert.deepEqual(row.delivery,{status:'unknown',revision:1});
      const encoded=JSON.stringify(actual.body);assert.equal(encoded.includes(privateCanary),false);
      for(const key of ['authority','submission','providerAccountId','sender','credentialDigest','credentials','storeSettings','leaseToken'])
        assert.equal(encoded.includes('"'+key+'":'),false,key);
      assert.deepEqual(Object.keys(actual.body.channel).sort(),['enabled','id','provider','status']);
    });
    await t.test('new command routes retain canonical claimed-operator and expected-epoch authority',async()=>{
      const claimed=await f.request(base+'/'+two.ticket.id+'/claim',{expectedEpoch:1},f.ownerAuth);assert.equal(claimed.status,201);assert.equal(claimed.body.epoch,2);
      const before=await f.snapshot(two);
      assert.equal((await f.request(base+'/'+two.ticket.id+'/close',{expectedEpoch:2},f.staffAuth)).status,403);
      assert.equal((await f.request(base+'/'+two.ticket.id+'/close',{expectedEpoch:1},f.ownerAuth)).status,409);
      assert.equal((await f.request(base+'/'+foreign.ticket.id+'/claim',{expectedEpoch:1},f.ownerAuth)).status,404);
      assert.deepEqual(await f.snapshot(two),before);
      const closed=await f.request(base+'/'+two.ticket.id+'/close',{expectedEpoch:2},f.ownerAuth);assert.equal(closed.status,201);assert.equal(closed.body.mode,'ai');
      const replay=await f.request(base+'/'+two.ticket.id+'/close',{expectedEpoch:3},f.ownerAuth);assert.equal(replay.status,201);assert.equal(replay.body.idempotent,true);
    });
    await t.test('served message alias uses one canonical client intent and the real current inbound window',async()=>{
      const value=await f.makeCase(f.ownerAuth,'served-message'),phoneNumberId='90005801';
      await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{credentials:{phoneNumberId,wabaId:'90005899',accessToken:'synthetic-t58-token'}}});
      assert.equal((await f.request(base+'/'+value.ticket.id+'/claim',{expectedEpoch:1},f.ownerAuth)).status,201);
      const wait=async(work,label)=>{const end=Date.now()+15_000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};
      const inboundId='synthetic-t58-inbound-'+randomUUID(),body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneNumberId},
        messages:[{id:inboundId,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Synthetic current human input'}}]}}]}]});
      const incoming=await fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body});assert.equal(incoming.status,200);await incoming.body?.cancel();
      await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:inboundId}});return row?.status==='processed';},'actual T58 inbound did not settle');
      const content='Synthetic canonical T58 reply',clientMessageId='native_t58_'+randomUUID(),first=await f.request(base+'/'+value.ticket.id+'/messages',{content,clientMessageId},f.ownerAuth);
      assert.equal(first.status,201);assert.equal(first.body.clientMessageId,clientMessageId);assert.equal(first.body.content,content);
      const sends=()=>f.runtime.whatsapp.events().filter(event=>event.kind==='sendText'&&event.input.correlationId==='support_message:'+first.body.id);
      await wait(()=>Promise.resolve(sends().length===1),'original T58 request did not reach local transport');
      const again=await f.request(base+'/'+value.ticket.id+'/messages',{content,clientMessageId},f.ownerAuth);
      assert.equal(again.status,201);assert.equal(again.body.id,first.body.id);assert.equal(again.body.content,content);assert.equal(sends().length,1);
      const encoded=JSON.stringify({first:first.body,replay:again.body});for(const key of ['authority','submission','providerAccountId','sender','credentialDigest','outboxLeaseToken'])
        assert.equal(encoded.includes('"'+key+'":'),false,key);
      const binding=await f.raw.whatsAppHandoffBinding.findFirstOrThrow({where:{ticketId:value.ticket.id}});assert.equal(binding.mode,'human');assert.equal(binding.epoch,2);
    });
    await t.test('a valid support machine credential has no human queue/context/command grant',async()=>{
      const {ApiKeyService}=await import('../dist/modules/integrations/domain/api-key.service.js'),key=new ApiKeyService().generate('test');
      await f.raw.merchantBillingSubscription.upsert({where:{merchantId:f.ownerAuth.merchant_id},create:{merchantId:f.ownerAuth.merchant_id,status:'active',planKey:'growth'},update:{status:'active',planKey:'growth',stripePriceId:null}});
      await f.raw.merchantApiKey.create({data:{id:randomUUID(),merchantId:f.ownerAuth.merchant_id,name:'Synthetic T58 support key',keyHash:key.keyHash,keyPrefix:key.keyPrefix,scopes:['support:read','support:write'],environment:'test'}});
      const credential={access_token:key.rawKey,merchant_id:f.ownerAuth.merchant_id};
      assert.equal((await f.request('/support/tickets',undefined,credential,'GET')).status,200);
      assert.equal((await get('/context',credential)).status,403);assert.equal((await get('',credential)).status,403);
      assert.equal((await f.request(base+'/'+one.ticket.id+'/claim',{expectedEpoch:1},credential)).status,403);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
  }finally{await f.close();}
});
