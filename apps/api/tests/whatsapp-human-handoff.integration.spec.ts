import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {operatorDiagnosticError,observeProviderTrapFailure} from './whatsapp-operator-delivery-diagnostics.mjs';

// Real AppModule/auth/HMAC/SQL/outbox, with only the explicit local sender.
// This does not establish external Meta eligibility, delivery or buyer reading.
test('T56',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createWhatsAppOperatorHttpFixture({provider:'META_CLOUD',operatorDelivery:true,whatsapp:true});
  try{
    const wait=async(work:()=>Promise<any>,label:string)=>{
      const end=Date.now()+15_000;
      do{const result=await work();if(result)return result;await pause(20);}while(Date.now()<end);
      assert.fail(label);
    };
    const configs=new Map();let configIndex=0;
    for(const auth of [f.ownerAuth,f.productAuth,f.foreignAuth]){
      const credentials={phoneNumberId:'9000560'+(++configIndex),wabaId:'90005699',accessToken:'synthetic-resume-'+auth.merchant_id};
      configs.set(auth.merchant_id,await f.raw.whatsAppChannelConfig.update({where:{id:auth.merchant_id+'-config'},data:{credentials}}));
    }
    const close=async(value:any,body:any,auth:any=value.auth)=>{
      const correlationId=randomUUID(),response=await fetch(f.runtime.apiOrigin+'/support/tickets/'+value.ticket.id+'/whatsapp/close',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json','x-correlation-id':correlationId,
          ...(auth?{authorization:'Bearer '+auth.access_token}:{})},body:JSON.stringify(body)});
      const result={status:response.status,body:await response.json(),correlationId};
      if(auth&&(![401,403].includes(result.status)||/human_operator_required|whatsapp_claim_owned_by_another_operator/.test(JSON.stringify(result.body)))){
        const audit=await wait(()=>f.raw.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}}),'actual close audit did not settle');
        assert.equal(audit.actorId,auth.user_id);assert.equal(audit.metadata.statusCode,result.status);assert.equal(audit.outcome,result.status<400?'success':'failed');
      }
      return result;
    };
    const incoming=async(value:any)=>{
      const config=configs.get(value.actor.merchantId),eventId='synthetic-resume-inbound-'+randomUUID();
      const body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:config.credentials.phoneNumberId},messages:[{
        id:eventId,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Synthetic authenticated human conversation'}}]}}]}]});
      const response=await fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body});
      assert.equal(response.status,200);await response.body?.cancel();
      await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId}});return row?.status==='processed';},'real authenticated inbox not processed');
    };
    const make=async(auth:any,suffix:string,withInbound=true)=>{
      const value=await f.makeCase(auth,suffix);const claim=await f.request(f.path(value),{expectedEpoch:1},auth);
      assert.equal(claim.status,201);assert.equal(claim.body.epoch,2);if(withInbound)await incoming(value);return value;
    };
    const receipt=async(value:any)=>{
      const binding=await f.raw.whatsAppHandoffBinding.findFirstOrThrow({where:{merchantId:value.actor.merchantId,whatsappSessionId:value.session.id}});
      return f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:'support_resume:'+binding.id+':'+binding.epoch}});
    };
    const sent=(id:string)=>f.runtime.whatsapp.events().filter((event:any)=>event.kind==='sendText'&&event.input.correlationId===id);

    await t.test('real claimed close and concurrent replay produce one immutable robot notice and preserve the checkout',async()=>{
      const value=await make(f.ownerAuth,'close-once'),before=await f.snapshot(value);
      const responses=await Promise.all([close(value,{expectedEpoch:2}),close(value,{expectedEpoch:2})]);
      assert.ok(responses.every(result=>result.status===201));assert.deepEqual(responses.map(result=>result.body.idempotent).sort(),[false,true]);
      const row=await wait(async()=>{const current=await receipt(value);return current.response.delivery.status==='accepted'?current:undefined;},'resumed notice not accepted locally');
      const after=await f.snapshot(value);assert.equal(after.binding.mode,'ai');assert.equal(after.binding.epoch,3);assert.equal(after.binding.ticketId,value.ticket.id);
      assert.equal(after.ticket.status,'closed');assert.deepEqual(after.checkout,before.checkout);assert.deepEqual(after.session,before.session);
      const messages=after.messages.filter((message:any)=>message.metadata?.kind==='whatsapp_resume');assert.equal(messages.length,1);
      const message=messages[0];assert.match(message.content,/^🤖 \*Atendimento humano concluído\*\n\n/);
      assert.equal(row.response.contentHash,createHash('sha256').update(message.content).digest('hex'));assert.equal(row.response.purpose,'human_resume');
      assert.equal(row.response.submission.requestInvoked,true);assert.match(row.response.submission.credentialDigest,/^[a-f0-9]{64}$/);
      assert.equal(sent(row.id).length,1);assert.equal(sent(row.id)[0].input.text,message.content);
      const stable=await f.snapshot(value),replay=await close(value,{expectedEpoch:3});assert.equal(replay.status,201);assert.equal(replay.body.idempotent,true);
      assert.deepEqual(await f.snapshot(value),stable);assert.equal(sent(row.id).length,1);
      const resumed=await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'whatsapp.support.resume.requested'}});
      assert.equal(resumed.filter((event:any)=>event.payload.ticketId===value.ticket.id).length,1);
      assert.equal(after.events.filter((event:any)=>event.payload.event==='message'&&event.payload.messageId===message.id).length,1);
      assert.equal(after.events.filter((event:any)=>event.payload.event==='delivery'&&event.payload.messageId===message.id).length,1);
      assert.equal(after.events.filter((event:any)=>event.payload.messageId===message.id).length,2);
      assert.equal(after.events.filter((event:any)=>event.payload.event==='closed'&&event.payload.messageId===null).length,1);
      const history=await f.request('/support/tickets/'+value.ticket.id+'/messages',undefined,f.ownerAuth,'GET');assert.equal(history.status,200);
      const encoded=JSON.stringify({responses,history:history.body,replay:replay.body});
      for(const key of ['authority','submission','credentialDigest','providerAccountId','outboxLeaseToken','attemptToken'])assert.equal(encoded.includes('"'+key+'":'),false);
      for(const secret of [row.response.authority.accountId,row.response.submission.credentialDigest,row.response.submission.attemptToken,
        configs.get(value.actor.merchantId).credentials.accessToken])assert.equal(encoded.includes(secret),false);
    });
    await t.test('owner override, foreign tenant, stale epoch and body grants cannot close another claimed case',async()=>{
      const value=await make(f.staffAuth,'staff-claimed'),before=await f.snapshot(value);
      const profile=await f.request('/merchants/me',undefined,f.staffAuth,'GET');assert.equal(profile.status,403);
      assert.equal((await close(value,{expectedEpoch:2},f.ownerAuth)).status,403);
      assert.equal((await close(value,{expectedEpoch:2},f.foreignAuth)).status,404);
      assert.equal((await close(value,{expectedEpoch:2},null)).status,401);
      assert.equal((await close(value,{expectedEpoch:1},f.staffAuth)).status,409);
      assert.equal((await close(value,{expectedEpoch:2,accountId:'body-sender-grant'},f.staffAuth)).status,400);
      assert.deepEqual(await f.snapshot(value),before);
      const result=await close(value,{expectedEpoch:2},f.staffAuth);assert.equal(result.status,201);assert.equal(result.body.mode,'ai');
      assert.equal((await f.request('/merchants/me',undefined,f.staffAuth,'GET')).status,403);
    });
    await t.test('unavailable sender closes the case but never adopts a subsequently connected account',async()=>{
      const value=await make(f.productAuth,'unavailable',false),before=await f.snapshot(value);
      await f.raw.whatsAppChannelConfig.update({where:{id:configs.get(value.actor.merchantId).id},data:{credentials:{}}});
      const result=await close(value,{expectedEpoch:2});assert.equal(result.status,201);assert.equal(result.body.mode,'ai');assert.equal(result.body.resume.status,'failed');
      const row=await receipt(value);assert.equal(row.state,'failed');assert.equal(row.processingToken,'not_started');assert.equal(row.response.authority.accountId,null);
      assert.equal(row.response.authority.identityStatus,'unavailable');assert.equal(row.response.submission,undefined);assert.equal(sent(row.id).length,0);
      await f.raw.whatsAppChannelConfig.update({where:{id:configs.get(value.actor.merchantId).id},data:{credentials:configs.get(value.actor.merchantId).credentials}});
      await wait(async()=>{const event=await f.raw.outboxMessage.findUniqueOrThrow({where:{eventId:row.response.outboxEventId}});
        return event.status==='delivered';},'original unavailable intent did not finish without starting transport');
      const stable=await f.snapshot(value),replay=await close(value,{expectedEpoch:3});assert.equal(replay.status,201);assert.equal(replay.body.resume.status,'failed');
      assert.deepEqual(await f.snapshot(value),stable);assert.equal(sent(row.id).length,0);
      const after=await f.snapshot(value);assert.deepEqual(after.checkout,before.checkout);assert.deepEqual(after.session,before.session);
    });
    await t.test('generic status writes cannot bypass the canonical epoch close while ordinary support remains unchanged',async()=>{
      const value=await make(f.ownerAuth,'generic-bypass'),before=await f.snapshot(value);
      for(const status of ['closed','resolved','open'])assert.equal((await f.request('/support/tickets/'+value.ticket.id,{status},f.ownerAuth,'PATCH')).status,409);
      assert.deepEqual(await f.snapshot(value),before);
      const ordinary=await f.makeCase(f.productAuth,'ordinary-status',{source:'widget'});
      const result=await f.request('/support/tickets/'+ordinary.ticket.id,{status:'closed'},f.productAuth,'PATCH');assert.equal(result.status,200);
      assert.equal(result.body.status,'closed');assert.equal((await f.snapshot(ordinary)).binding,null);
    });
    await t.test('a valid scoped machine credential retains ordinary support access but cannot close as a human',async()=>{
      const value=await make(f.ownerAuth,'machine-close'),before=await f.snapshot(value);
      const {ApiKeyService}=await import('../dist/modules/integrations/domain/api-key.service.js');
      const generated=new ApiKeyService().generate('test');
      await f.raw.merchantBillingSubscription.upsert({where:{merchantId:f.ownerAuth.merchant_id},
        create:{merchantId:f.ownerAuth.merchant_id,status:'active',planKey:'growth'},update:{status:'active',planKey:'growth',stripePriceId:null}});
      await f.raw.merchantApiKey.create({data:{id:randomUUID(),merchantId:f.ownerAuth.merchant_id,name:'Synthetic resume human guard',
        keyHash:generated.keyHash,keyPrefix:generated.keyPrefix,scopes:['support:read','support:write'],environment:'test'}});
      const credential={access_token:generated.rawKey,merchant_id:f.ownerAuth.merchant_id};
      assert.equal((await f.request('/support/tickets',undefined,credential,'GET')).status,200);
      const rejected=await close(value,{expectedEpoch:2},credential);assert.equal(rejected.status,403);
      assert.match(JSON.stringify(rejected.body),/human_session_required/);assert.deepEqual(await f.snapshot(value),before);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
  }finally{try{console.info('t56_owned_resources',JSON.stringify({pid:process.pid,postgresRunId:f.runtime.db.runId,redisRunId:f.runtime.redis.runId}));}catch{}try{await f.close();}catch(error){try{observeProviderTrapFailure(error);console.info('t56_close_diagnostic',JSON.stringify({pid:process.pid,error:operatorDiagnosticError(error)}));}catch{}throw error;}}
});
