import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';
import {SERVICE_LOCAL_BOOT_MS,SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {operatorTerminalDiagnostic,operatorDiagnosticError,operatorCloseDiagnostic} from './whatsapp-operator-delivery-diagnostics.mjs';

const signedForm=(url,form,token)=>createHmac('sha1',token).update(url+Object.keys(form).sort().map(key=>key+form[key]).join('')).digest('base64');
const{io}=createRequire(new URL('../../dashboard/package.json',import.meta.url))('socket.io-client');
function assertNoPrivateAttempt(publicValue,attempt){
  assert.ok(attempt.providerAccountId);assert.ok(attempt.outboxLeaseToken);assert.ok(attempt.attemptToken);assert.ok(attempt.credentialDigest);
  const json=JSON.stringify(publicValue);
  for(const key of ['providerAccountId','submission','authority','outboxEventId','outboxLeaseToken','attemptToken','credentialDigest'])
    assert.equal(json.includes(JSON.stringify(key)+':'),false,key);
  for(const forbidden of [attempt.providerAccountId,attempt.sender,attempt.outboxLeaseToken,attempt.attemptToken,attempt.credentialDigest].filter(value=>typeof value==='string'&&value.length>0))
    assert.equal(json.includes(forbidden),false,forbidden);
}
const wait=async(work,label)=>{const end=Date.now()+15_000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};
async function awaitReceiptRelay(f){
  const started=Date.now(),end=started+SERVICE_LOCAL_BOOT_MS;
  const names=new Set(['Error','TypeError','AbortError','TimeoutError','DOMException','AssertionError','AggregateError']);
  const transportCodes=new Set(['ABORT_ERR','ETIMEDOUT','ECONNRESET','ECONNREFUSED','EPIPE',
    'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UND_ERR_ABORTED']);
  let last,phase='fetch',transientFailures=0,lastTransient;
  const classification=value=>({name:names.has(value?.name)?value.name:'OtherError',
    ...(transportCodes.has(value?.code)||[20,23].includes(value?.code)?{code:value.code}:{})});
  const diagnostic=(stage,error)=>{
    try{
      console.info('t55_receipt_transport_read_diagnostic',JSON.stringify({stage,phase,observedAt:new Date().toISOString(),
        elapsedMs:Date.now()-started,transientFailures,lastMetrics:last??null,error:operatorDiagnosticError(error),
        fetchError:classification(error),...(error?.cause?{directCause:classification(error.cause)}:{})}));
    }catch{}
  };
  const transient=error=>{
    try{return ['AbortError','TimeoutError'].includes(error?.name)
      ||transportCodes.has(error?.code)||['AbortError','TimeoutError'].includes(error?.cause?.name)
      ||transportCodes.has(error?.cause?.code);}catch{return false;}
  };
  const poll=async()=>{const remaining=end-Date.now();if(remaining>0)await pause(Math.min(200,remaining));};
  const observeTransient=error=>{transientFailures++;lastTransient=error;if(transientFailures<=3)diagnostic('transient_read',error);};
  try{
    do{
      const remaining=end-Date.now();if(remaining<=0)break;
      let response,body;
      phase='fetch';
      try{response=await fetch(f.runtime.apiOrigin+'/metrics',{redirect:'error',signal:AbortSignal.timeout(Math.min(1500,remaining)),
        headers:{authorization:'Bearer '+f.ownerAuth.access_token}});}
      catch(error){if(!transient(error))throw error;observeTransient(error);await poll();continue;}
      if(response.status!==200){
        try{await response.body?.cancel();}catch{}
        assert.equal(response.status,200,'receipt_transport_metrics_http_required');
      }
      phase='stream';
      try{body=await response.text();}
      catch(error){if(!transient(error))throw error;observeTransient(error);await poll();continue;}
      phase='validate';
      assert.ok(body.length<=1_000_000,'receipt_transport_metrics_bounded');
      const values={};
      for(const field of ['outbox_relay_ready','outbox_relay_last_dispatch_timestamp_seconds']){
        const match=body.match(new RegExp('^'+field+' ([0-9.eE+\\-]+)$','m'));
        assert.ok(match&&Number.isFinite(Number(match[1])),'receipt_transport_metric_required');values[field]=Number(match[1]);
      }
      assert.ok([0,1].includes(values.outbox_relay_ready),'receipt_transport_ready_metric_invalid');
      assert.ok(values.outbox_relay_last_dispatch_timestamp_seconds>=0,'receipt_transport_dispatch_metric_invalid');
      last=values;
      if(Date.now()<end&&values.outbox_relay_ready===1&&values.outbox_relay_last_dispatch_timestamp_seconds>0){
        if(transientFailures>3)diagnostic('transient_summary',lastTransient);
        try{console.info('t55_receipt_transport_ready',JSON.stringify({observedAt:new Date().toISOString(),elapsedMs:Date.now()-started,
          transientFailures,...values}));}catch{}
        return;
      }
      phase='poll';await poll();
    }while(Date.now()<end);
    if(transientFailures>3)diagnostic('transient_summary',lastTransient);
    try{console.info('t55_receipt_transport_not_ready',JSON.stringify({observedAt:new Date().toISOString(),elapsedMs:Date.now()-started,
      transientFailures,...last}));}catch{}
    assert.fail('receipt_transport_first_completed_dispatch_required');
  }catch(error){diagnostic('fatal_readiness_failure',error);throw error;}
}
async function fixture(provider){
  const f=await createWhatsAppOperatorHttpFixture({provider,operatorDelivery:true,whatsapp:{operatorStatusCallbacks:true,
    operatorOutcomes:[{status:'unknown',messageId:''},{status:'unknown',messageId:''},{status:'unknown',messageId:''}]}});
  try{
    await awaitReceiptRelay(f);
    const configs=new Map();let index=0;
    for(const auth of [f.ownerAuth,f.productAuth,f.foreignAuth]){
      const credentials=provider==='META_CLOUD'?{phoneNumberId:'9000400'+(++index),wabaId:'90004999',accessToken:'synthetic-private-token-'+auth.merchant_id}
        :{accountSid:'AC'+randomUUID().replaceAll('-',''),authToken:'synthetic-private-token-'+auth.merchant_id,senderId:'whatsapp:+551199988000'+(++index)};
      configs.set(auth.merchant_id,await f.raw.whatsAppChannelConfig.update({where:{id:auth.merchant_id+'-config'},data:{credentials,
        ...(provider==='TWILIO'?{whatsappNumber:credentials.senderId.slice('whatsapp:'.length)}:{})}}));
    }
    const post=async(path,body,headers)=>{const response=await fetch(f.runtime.apiOrigin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers,body});
      const text=await response.text();return{status:response.status,text};};
    const metaPost=async(config,status,signatureOverride)=>{
      const body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:config.credentials.phoneNumberId},statuses:[status]}}]}]});
      return post('/webhooks/whatsapp/meta',body,{'content-type':'application/json','x-hub-signature-256':signatureOverride??f.runtime.whatsapp.signature(body)});
    };
    const make=async(auth,suffix)=>{
      const value=await f.makeCase(auth,suffix),config=configs.get(auth.merchant_id);assert.equal((await f.request(f.path(value),{expectedEpoch:1},auth)).status,201);
      const eventId=provider==='META_CLOUD'?'synthetic-receipt-inbound-'+randomUUID():'SM'+randomUUID().replaceAll('-','');
      let incoming;
      if(provider==='META_CLOUD'){
        const body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:config.credentials.phoneNumberId},messages:[{
          id:eventId,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Synthetic authenticated receipt context'}}]}}]}]});
        incoming=await post('/webhooks/whatsapp/meta',body,{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)});
      }else{
        const form={AccountSid:config.credentials.accountSid,MessageSid:eventId,From:'whatsapp:+'+value.session.buyerPhone,To:config.credentials.senderId,
          WaId:value.session.buyerPhone,Body:'Synthetic authenticated receipt context'},path='/v1/webhooks/whatsapp/twilio';
        incoming=await post(path,new URLSearchParams(form).toString(),{'content-type':'application/x-www-form-urlencoded',
          'x-twilio-signature':signedForm(f.runtime.apiOrigin+path,form,config.credentials.authToken)});
      }
      assert.equal(incoming.status,200);
      await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId}});return row?.status==='processed'?row:undefined;},'authenticated receipt context not processed');
      const result=await f.request('/support/tickets/'+value.ticket.id+'/messages',{content:'Synthetic original receipt message '+suffix,clientMessageId:randomUUID()},auth);
      assert.equal(result.status,201);const message=result.body,deliveryId='support_message:'+message.id;
      const row=await wait(async()=>{const saved=await f.raw.supportTicketMessage.findUniqueOrThrow({where:{id:message.id}});return saved.metadata.delivery.status!=='queued'?saved:undefined;},'original receipt attempt not settled').catch(async error=>{console.info('t55_receipt_submission_capture',JSON.stringify({matchingLocalSendText:f.runtime.whatsapp.events().filter(event=>event.kind==='sendText'&&event.input?.correlationId===deliveryId).length}));await operatorTerminalDiagnostic(f,message.id);throw error;});
      assert.deepEqual(row.metadata.delivery,{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
      return{...value,message,deliveryId,config};
    };
    const snapshot=async value=>({message:await f.raw.supportTicketMessage.findUniqueOrThrow({where:{id:value.message.id}}),
      delivery:await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.deliveryId}}),events:(await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'support.case.changed'},orderBy:{eventId:'asc'}}))
        .filter(event=>event.payload.messageId===value.message.id).map(({eventId,eventType,payload})=>({eventId,eventType,payload}))});
    const preserved=async value=>{const s=await f.snapshot(value);return{session:s.session,binding:s.binding,ticket:s.ticket,checkout:s.checkout};};
    const twilioPath=value=>'/v1/webhooks/whatsapp/twilio/status?configId='+encodeURIComponent(value.config.id)+'&correlationId='+encodeURIComponent(value.deliveryId);
    const twilioPost=async(value,form,options={})=>{const path=options.path??twilioPath(value),signatureUrl=options.signatureUrl??f.runtime.apiOrigin+path;
      return post(path,new URLSearchParams(form).toString(),{'content-type':'application/x-www-form-urlencoded',
        'x-twilio-signature':options.signature??signedForm(signatureUrl,form,value.config.credentials.authToken)});};
    return{...f,configs,post,metaPost,make,snapshot,preserved,twilioPath,twilioPost};
  }catch(error){await f.close().catch(error=>{try{operatorCloseDiagnostic(error);}catch{}throw error;});throw error;}
}

test('T55 authenticated Meta operator receipts through the canonical application',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await fixture('META_CLOUD');
  try{
    assert.equal(f.runtime.evidence().localOperatorStatusCallbacks,true);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
    const value=await f.make(f.ownerAuth,'meta-original'),id='synthetic-meta-original-receipt';
    const status=(state='read',extra={})=>({id,status:state,biz_opaque_callback_data:value.deliveryId,recipient_id:value.session.buyerPhone,...extra});
    await t.test('a real signed original receipt reconciles unknown directly to read without changing checkout or human context',async()=>{
      const preserved=await f.preserved(value);assert.equal((await f.metaPost(value.config,status())).status,200);
      assert.deepEqual((await f.snapshot(value)).message.metadata.delivery,{status:'read',revision:2,providerMessageId:id});assert.deepEqual(await f.preserved(value),preserved);
    });
    await t.test('duplicates and delivered accepted or failed arriving after read perform no message private or realtime event writes',async()=>{
      const before=await f.snapshot(value);
      for(const state of ['read','delivered','sent','failed']){assert.equal((await f.metaPost(value.config,status(state))).status,200);assert.deepEqual(await f.snapshot(value),before);}
    });
    await t.test('wrong HMAC config recipient or known provider ID cannot adopt an unresolved original command',async()=>{
      const pending=await f.make(f.productAuth,'meta-invalid'),before=await f.snapshot(pending);
      const body={id:'synthetic-meta-pending-receipt',status:'read',biz_opaque_callback_data:pending.deliveryId,recipient_id:pending.session.buyerPhone};
      assert.equal((await f.metaPost(pending.config,body,'sha256='+'0'.repeat(64))).status,401);
      assert.equal((await f.metaPost(f.configs.get(f.foreignAuth.merchant_id),body)).status,200);
      assert.equal((await f.metaPost(pending.config,{...body,recipient_id:'5511000000000'})).status,200);assert.deepEqual(await f.snapshot(pending),before);
      assert.equal((await f.metaPost(pending.config,body)).status,200);const settled=await f.snapshot(pending);
      assert.equal((await f.metaPost(pending.config,{...body,id:'conflicting-meta-provider-id'})).status,200);assert.deepEqual(await f.snapshot(pending),settled);
    });
    await t.test('a known provider ID without an opaque selector or phone can identify only the exact authenticated original account',async()=>{
      const before=await f.snapshot(value);assert.equal((await f.metaPost(value.config,{id,status:'delivered'})).status,200);assert.deepEqual(await f.snapshot(value),before);
      assert.equal((await f.metaPost(f.configs.get(f.foreignAuth.merchant_id),{id,status:'read'})).status,200);assert.deepEqual(await f.snapshot(value),before);
    });
    await t.test('receipt HTTP history live Socket.IO command replay and delivery issues serialize only the public projection',async()=>{
      const target=await f.make(f.ownerAuth,'meta-private-receipt');
      const socket=io(f.runtime.apiOrigin+'/support',{auth:{accessToken:f.ownerAuth.access_token},transports:['websocket'],reconnection:false,forceNew:true,timeout:5000});
      try{
        await new Promise((resolve,reject)=>{let timer;const fail=error=>{clearTimeout(timer);reject(error);};timer=setTimeout(()=>fail(new Error('receipt_socket_authentication_timeout')),5000);
          socket.once('connect_error',fail);socket.once('error',fail);socket.once('authenticated',()=>{clearTimeout(timer);socket.off('connect_error',fail);socket.off('error',fail);resolve();});});
        const joined=await new Promise((resolve,reject)=>socket.timeout(5000).emit('join_ticket',{ticketId:target.ticket.id},(error,result)=>error?reject(error):resolve(result)));assert.equal(typeof joined.joined,'string');
        const observed=[];socket.on('new_message',message=>observed.push(message));
        assert.equal((await f.metaPost(target.config,{id:'synthetic-meta-public-receipt',status:'read',biz_opaque_callback_data:target.deliveryId,recipient_id:target.session.buyerPhone})).status,200);
        const live=await wait(()=>observed.find(row=>row.id===target.message.id&&row.metadata?.delivery?.status==='read'),'read public gateway projection missing');
        const path='/support/tickets/'+target.ticket.id+'/messages',history=await f.request(path,undefined,f.ownerAuth,'GET');assert.equal(history.status,200);
        assert.deepEqual(history.body.data.find(row=>row.id===target.message.id).metadata.delivery,live.metadata.delivery);
        const replay=await f.request(path,{content:target.message.content,clientMessageId:target.message.metadata.clientMessageId},f.ownerAuth);assert.equal(replay.status,201);
        assert.deepEqual(replay.body.metadata.delivery,{status:'read',revision:2,providerMessageId:'synthetic-meta-public-receipt'});
        const issues=await f.request('/merchants/me/whatsapp/delivery-issues',undefined,f.ownerAuth,'GET');assert.equal(issues.status,200);
        const privateRow=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:target.deliveryId}});
        assertNoPrivateAttempt({http:history.body,realtime:observed,replay:replay.body,issues:issues.body},privateRow.response.submission);
      }finally{socket.disconnect();}
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close().catch(error=>{try{operatorCloseDiagnostic(error);}catch{}throw error;});}
});

test('T55 authenticated Twilio operator callbacks through the canonical application',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await fixture('TWILIO');
  try{
    const value=await f.make(f.ownerAuth,'twilio-original'),id='SM'+randomUUID().replaceAll('-','');
    const form={AccountSid:value.config.credentials.accountSid,MessageSid:id,MessageStatus:'read',ChannelPrefix:'whatsapp',
      To:'whatsapp:+'+value.session.buyerPhone,From:value.config.credentials.senderId,FutureSignedField:'synthetic+value'};
    await t.test('a signed full form settles only the original unknown message as read and preserves the checkout',async()=>{
      const before=await f.preserved(value);assert.equal((await f.twilioPost(value,form)).status,200);
      assert.deepEqual((await f.snapshot(value)).message.metadata.delivery,{status:'read',revision:2,providerMessageId:id});assert.deepEqual(await f.preserved(value),before);
    });
    await t.test('read survives duplicate delivered accepted and failed callbacks without any message private or event change',async()=>{
      const before=await f.snapshot(value);
      for(const MessageStatus of ['read','delivered','sent','failed']){assert.equal((await f.twilioPost(value,{...form,MessageStatus})).status,200);assert.deepEqual(await f.snapshot(value),before);}
    });
    await t.test('signature validation binds every unknown form field and the exact original encoded query bytes',async()=>{
      const before=await f.snapshot(value),path=f.twilioPath(value),lower=path.replace('%3A','%3a');assert.notEqual(lower,path);
      assert.equal((await f.twilioPost(value,form,{path:lower,signatureUrl:f.runtime.apiOrigin+path})).status,401);
      assert.equal((await f.twilioPost(value,form,{path:lower})).status,200);
      const signature=signedForm(f.runtime.apiOrigin+path,form,value.config.credentials.authToken);
      assert.equal((await f.twilioPost(value,{...form,FutureSignedField:'tampered-value'},{signature})).status,401);assert.deepEqual(await f.snapshot(value),before);
    });
    await t.test('a valid signature cannot adopt a wrong account sender recipient provider ID or array-coerced form',async()=>{
      const pending=await f.make(f.productAuth,'twilio-invalid'),before=await f.snapshot(pending);
      const original={AccountSid:pending.config.credentials.accountSid,MessageSid:'SM'+randomUUID().replaceAll('-',''),MessageStatus:'read',ChannelPrefix:'whatsapp',
        To:'whatsapp:+'+pending.session.buyerPhone,From:pending.config.credentials.senderId};
      assert.equal((await f.twilioPost(pending,{...original,AccountSid:'AC'+'4'.repeat(32)})).status,401);
      for(const patch of [{From:'whatsapp:+5511000000000'},{To:'whatsapp:+5511000000000'}])assert.equal((await f.twilioPost(pending,{...original,...patch})).status,200);
      assert.deepEqual(await f.snapshot(pending),before);
      const path=f.twilioPath(pending),body=new URLSearchParams(original);body.append('MessageSid',original.MessageSid);
      const malformed=await f.post(path,body.toString(),{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':'synthetic-invalid'});assert.equal(malformed.status,400);
      assert.equal((await f.twilioPost(pending,original)).status,200);const settled=await f.snapshot(pending);
      assert.equal((await f.twilioPost(pending,{...original,MessageSid:'SM'+'5'.repeat(32)})).status,200);assert.deepEqual(await f.snapshot(pending),settled);
    });
    await t.test('the persisted original Twilio sender account and attempt remain private in history replay and delivery issue responses',async()=>{
      const path='/support/tickets/'+value.ticket.id+'/messages',history=await f.request(path,undefined,f.ownerAuth,'GET');assert.equal(history.status,200);
      const replay=await f.request(path,{content:value.message.content,clientMessageId:value.message.metadata.clientMessageId},f.ownerAuth);assert.equal(replay.status,201);
      const issues=await f.request('/merchants/me/whatsapp/delivery-issues',undefined,f.ownerAuth,'GET');assert.equal(issues.status,200);
      const row=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.deliveryId}});assert.equal(row.response.submission.sender,value.config.whatsappNumber);
      assertNoPrivateAttempt({history:history.body,replay:replay.body,issues:issues.body},row.response.submission);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close().catch(error=>{try{operatorCloseDiagnostic(error);}catch{}throw error;});}
});
