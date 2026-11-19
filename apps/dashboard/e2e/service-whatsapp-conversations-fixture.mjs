import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from '../../api/tests/whatsapp-operator-http-fixture.mjs';

/** One existing owned T2 fixture, real bearer/cookie auth, repositories and API.
 * Historical delivery projections below are synthetic, never Meta delivery proof. */
export async function prepareWhatsAppConversationFixtures(){
  const recipients={'staff-active':'5511999991000','staff-history':'5511999991001','products-inactive':'5511999991002','owner-accepted':'5511999991003'};
  const f=await createWhatsAppOperatorHttpFixture({provider:'META_CLOUD',operatorDelivery:true,
    whatsapp:{operatorOutcomesByRecipient:{
      [recipients['staff-active']]:{status:'unknown',messageId:''},
      [recipients['staff-history']]:{status:'queued',messageId:'synthetic-t61-history'},
      [recipients['products-inactive']]:{status:'queued',messageId:'synthetic-t61-products'},
      [recipients['owner-accepted']]:{status:'sent',messageId:'synthetic-t61-accepted'}}}});
  try{
    assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.runtime.db.runId}]);
    assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
    const scenarios=new Map(),fixtures=new Map();
    // Independent functional owner scenario retains the real tenant quota.
    assert.notEqual(f.foreignAuth.merchant_id,f.staffAuth.merchant_id,'synthetic_t61_independent_owner_tenant_required');
    const phoneIds=new Map([[f.ownerAuth.merchant_id,'90006101'],[f.productAuth.merchant_id,'90006102'],[f.foreignAuth.merchant_id,'90006103']]);
    for(const auth of [f.ownerAuth,f.productAuth,f.foreignAuth])await f.raw.whatsAppChannelConfig.update({where:{id:auth.merchant_id+'-config'},
      data:{credentials:{phoneNumberId:phoneIds.get(auth.merchant_id),wabaId:'90006199',accessToken:'synthetic-t61-local-token'}}});
    for(const [scenario,auth]of [['staff-active',f.staffAuth],['staff-history',f.staffAuth],['products-inactive',f.productAuth],['owner-accepted',f.foreignAuth]]){
      const value=await f.makeCase(auth,'browser-'+scenario),fixtureId=randomUUID();
      assert.equal(value.session.buyerPhone,recipients[scenario],'synthetic_t61_recipient_binding_required');
      const base=Date.now()-30*60*1000;
      if(scenario==='staff-history'){
        await f.raw.supportTicketMessage.createMany({data:Array.from({length:105},(_,index)=>({id:randomUUID(),ticketId:value.ticket.id,senderType:'buyer',
          content:'Histórico adicional #'+index,createdAt:new Date(base+index*1000)}))});
      }else{
        const statuses=['queued','accepted','delivered','read','failed','unknown'];
        await f.raw.supportTicketMessage.createMany({data:[{id:randomUUID(),ticketId:value.ticket.id,senderType:'buyer',content:'Preciso de ajuda para continuar.',createdAt:new Date(base-1000)},
          ...statuses.map((status,index)=>({id:randomUUID(),ticketId:value.ticket.id,senderType:'merchant',content:{queued:'Resposta aguardando envio',accepted:'Resposta aceita pelo canal',
            delivered:'Resposta entregue',read:'Resposta lida',failed:'Envio com falha',unknown:'Resposta sem confirmação'}[status],createdAt:new Date(base+index*1000),
            metadata:{kind:'whatsapp_outgoing',schemaVersion:1,clientMessageId:'history_'+randomUUID(),delivery:{status,revision:1}}}))]});
      }
      // The current 24-hour operator window comes from a real signed local
      // webhook processed by the existing human-mode worker, not a clock patch.
      const eventId='t61-inbound-'+randomUUID(),body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneIds.get(auth.merchant_id)},
        messages:[{id:eventId,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Olá, preciso de atendimento.'}}]}}]}]});
      const incoming=await fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body});
      assert.equal(incoming.status,200);await incoming.body?.cancel();
      const end=Date.now()+15_000;let processed=false;
      do{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId}});processed=row?.status==='processed';if(!processed)await pause(20);}while(!processed&&Date.now()<end);
      assert.ok(processed,'synthetic_t61_actual_inbound_required');
      if(scenario==='products-inactive'){
        // This is already the actual current operator's case. The negative UI
        // proves closing remains available when its channel then goes offline.
        const claim=await f.request('/support/whatsapp/conversations/'+value.ticket.id+'/claim',{expectedEpoch:1},auth);assert.equal(claim.status,201);
        await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{enabled:false,status:'DISCONNECTED'}});
      }
      const context=await f.request('/support/whatsapp/conversations/context',undefined,auth,'GET');assert.equal(context.status,200);
      assert.equal(context.body.merchant_id,auth.merchant_id);assert.equal(context.body.user_id,auth.user_id);
      const seed={fixtureId,scenario,ticketId:value.ticket.id,email:auth.email,password:auth.password};
      scenarios.set(scenario,seed);fixtures.set(fixtureId,{seed,value});
    }
    return{runtime:f.runtime,scenarios,fixtures,
      async close(){
        // No queries or alternate teardown: retain only identities already owned.
        let owned;
        try{owned={postgresRunId:f.runtime.db.runId,redisRunId:f.runtime.redis.runId,bridgeBefore:f.runtime.db.bridgeStatus()};}catch{}
        try{await f.close();}catch(error){
          try{if(owned&&[owned.postgresRunId,owned.redisRunId].every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)))
            console.error('t61_owned_cleanup_identity',JSON.stringify({...owned,bridgeAfter:f.runtime.db.bridgeStatus()}));}catch{}
          throw error;
        }
      },
      async snapshot(fixtureId){
        const entry=fixtures.get(fixtureId);assert.ok(entry,'synthetic_t61_owned_fixture_required');const stored=await f.snapshot(entry.value);
        const messages=stored.messages.map(row=>({id:row.id,senderType:row.senderType,content:row.content,clientMessageId:row.metadata?.clientMessageId??null,deliveryStatus:row.metadata?.delivery?.status??null}));
        const ids=new Set(messages.map(row=>'support_message:'+row.id));
        return{ticketStatus:stored.ticket.status,binding:{ticketId:stored.binding.ticketId,mode:stored.binding.mode,epoch:stored.binding.epoch,assignedOperatorId:stored.binding.assignedOperatorId},
          messages,checkoutCart:stored.checkout.cart,operatorSendAttempts:f.runtime.whatsapp.events().filter(event=>event.kind==='sendText'&&ids.has(event.input.correlationId)).length,
          providerCalls:f.runtime.evidence().providerCalls,authOverrides:f.runtime.evidence().authOverrides,repositoryOverrides:f.runtime.evidence().repositoryOverrides};
      }};
  }catch(error){try{await f.close();}catch(cleanup){throw new AggregateError([error,cleanup],'synthetic_t61_setup_cleanup_failed');}throw error;}
}

const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atendimento WhatsApp local</title></head><body><div id="conversation-fixture"></div><script type="module" src="/e2e/fixtures/whatsapp-conversation.tsx"></script></body></html>`;
export function installWhatsAppConversationFixture(vite,prepared){
  vite.middlewares.use((request,response,next)=>{
    const url=new URL(request.url??'/','http://127.0.0.1:5187');
    const seed=/^\/__service\/conversations\/(staff-active|staff-history|products-inactive|owner-accepted)$/.exec(url.pathname);
    const snapshot=/^\/__service\/conversations\/([a-f0-9-]{36})\/snapshot$/.exec(url.pathname);
    if(url.pathname==='/__service/conversations'&&request.method==='GET'){
      void vite.transformIndexHtml(request.url,html).then(document=>{response.setHeader('content-type','text/html; charset=utf-8');response.end(document);})
        .catch(()=>{response.statusCode=500;response.end('synthetic_t61_page_failed');});return;
    }
    if(!((seed&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(seed){const value=prepared.scenarios.get(seed[1]);assert.ok(value);response.setHeader('content-type','application/json');response.end(JSON.stringify(value));return;}
      if(!prepared.fixtures.has(snapshot[1])){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const value=await prepared.snapshot(snapshot[1]);response.setHeader('content-type','application/json');response.end(JSON.stringify(value));
    })().catch(()=>{response.statusCode=500;response.end('synthetic_t61_fixture_failed');});
  });
}
