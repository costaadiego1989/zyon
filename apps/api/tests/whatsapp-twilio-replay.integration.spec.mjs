import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac,createHash} from 'node:crypto';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T50 Twilio replay',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHandoffFixture({provider:'TWILIO',whatsapp:true});
  try{
    const token='synthetic-local-twilio-token',number='+5511988880001',value=await f.thread(f.owner,'twilio-replay');
    await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{whatsappNumber:number,credentials:{authToken:token}}});
    const url=f.runtime.apiOrigin+'/webhooks/whatsapp/twilio';
    const params={MessageSid:'SMsyntheticreplay001',From:'whatsapp:+'+value.session.buyerPhone,To:'whatsapp:'+number,WaId:value.session.buyerPhone,Body:'Quero falar com atendente'};
    const encoded=new URLSearchParams(params).toString();
    const post=(fields=params,valid=true)=>{
      const form=new URLSearchParams(fields).toString();
      const signed=url+Object.keys(fields).sort().map(key=>key+fields[key]).join('');
      const signature=createHmac('sha1',token).update(signed).digest('base64');
      return fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':valid?signature:'invalid'},body:form});
    };
    const wait=async(predicate,label)=>{const end=Date.now()+15_000;do{const row=await predicate();if(row)return row;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);assert.fail(label);};
    const snapshot=async()=>({checkout:await f.raw.checkoutSession.findFirst({where:{merchantId:f.owner.merchantId,sessionId:value.session.checkoutSessionId}}),
      tickets:await f.raw.supportTicket.findMany({where:{sessionId:value.session.id},orderBy:{id:'asc'}}),messages:await f.raw.supportTicketMessage.findMany({where:{ticket:{sessionId:value.session.id}},orderBy:{id:'asc'}}),
      events:await f.raw.outboxMessage.findMany({where:{merchantId:f.owner.merchantId,eventType:'support.case.changed'},orderBy:{eventId:'asc'}}),submissions:f.runtime.whatsapp.events().filter(event=>event.kind==='sendText')});
    const beforeCheckout=(await snapshot()).checkout;
    await t.test('a real local URL/HMAC validates and the first provider SID commits one exact conversation intake',async()=>{
      assert.equal((await post(params,false)).status,401);assert.equal(await f.raw.whatsAppWebhookInbox.count(),0);
      assert.equal((await post()).status,200);
      const inbox=await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:params.MessageSid}});if(row&&['dead','blocked'].includes(row.status))assert.fail(row.lastError);return row?.status==='processed'?row:undefined;},'Twilio initial input not processed');
      assert.equal(inbox.payload.provider,'TWILIO');assert.equal(inbox.payload.body,params.Body);assert.ok(Number.isSafeInteger(inbox.payload.timestamp));
      const saved=await snapshot();assert.equal(saved.tickets.length,1);assert.equal(saved.messages.length,1);assert.equal(saved.messages[0].content,params.Body);assert.equal(saved.events.length,2);assert.equal(saved.submissions.length,1);
      assert.equal(saved.messages[0].metadata.inboxId,inbox.id);assert.deepEqual(saved.checkout,beforeCheckout);
    });
    await t.test('a byte-equivalent signed replay after the witnessed ingest-clock barrier is idempotent while a changed body remains409',async()=>{
      const original=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:params.MessageSid}}),before=await snapshot();
      // The Node parent/child share the same host clock. This waits for an
      // observed condition against the persisted ingestion timestamp, not an
      // arbitrary sleep or a globally mocked Date/production clock.
      const observed=await wait(async()=>Date.now()>original.payload.timestamp?Date.now():undefined,'ingest clock did not advance');
      assert.ok(observed>original.payload.timestamp);assert.equal(new URLSearchParams(params).toString(),encoded);
      console.log(JSON.stringify({twilioReplayBarrier:{ingestMs:original.payload.timestamp,observedMs:observed,bodySha256:createHash('sha256').update(encoded).digest('hex')}}));
      const changed=await post({...params,Body:'Altered commercial input with the same SID'});assert.equal(changed.status,409);
      for(const patch of [{From:'whatsapp:+5511999990000'},{ProfileName:'A different sender alias'},
        {MediaUrl0:'https://example.invalid/other-audio.ogg',MediaContentType0:'audio/ogg'}])
        assert.equal((await post({...params,...patch})).status,409,JSON.stringify(patch));
      const replay=await post();assert.equal(replay.status,200,await replay.text());
      const after=await snapshot();assert.deepEqual(after.checkout,before.checkout);assert.deepEqual(after.tickets,before.tickets);assert.deepEqual(after.messages,before.messages);
      assert.deepEqual(after.events.map(row=>({eventId:row.eventId,payload:row.payload})),before.events.map(row=>({eventId:row.eventId,payload:row.payload})));assert.deepEqual(after.submissions,before.submissions);
      const persisted=await f.raw.whatsAppWebhookInbox.findUnique({where:{id:original.id}});assert.equal(persisted.payloadHash,original.payloadHash);assert.deepEqual(persisted.payload,original.payload);assert.equal(await f.raw.whatsAppWebhookInbox.count({where:{eventId:params.MessageSid}}),1);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.deepEqual(f.runtime.evidence().localProviderOverrides,['whatsapp-channel.WHATSAPP_SENDER_PORT']);
  }finally{await f.close();}
});
