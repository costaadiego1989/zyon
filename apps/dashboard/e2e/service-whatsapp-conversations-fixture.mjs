import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from '../../api/tests/whatsapp-operator-http-fixture.mjs';

/** One existing owned T2 fixture, real bearer/cookie auth, repositories and API.
 * Historical delivery projections below are synthetic, never Meta delivery proof. */
export async function prepareWhatsAppConversationFixtures(options={}){
  assert.ok(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(key=>key==='appMount')
    &&(options.appMount===undefined||options.appMount===true),'synthetic_t62_local_app_options_required');
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
    await keepLocalTemplatesInactive(f,[f.ownerAuth.merchant_id,f.productAuth.merchant_id,f.foreignAuth.merchant_id]);
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
    const appScenarios=options.appMount===true?await prepareConversationAppAccess(f,scenarios,fixtures):undefined;
    return{runtime:f.runtime,scenarios,fixtures,appScenarios,
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

/** Canonical per-merchant template settings isolate this foreground fixture.
 * Keep the real monitor and provider trap; no Meta approval is simulated. */
async function keepLocalTemplatesInactive(f,merchantIds){
  const ids=[...new Set(merchantIds)];
  assert.ok(ids.length>0&&ids.every(id=>typeof id==='string'&&id.trim()),'synthetic_template_owned_scope_required');
  const {PrismaRecoveryTemplateLifecycleRepository}=await import('../../api/dist/modules/whatsapp-templates/infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js');
  const {WHATSAPP_TEMPLATE_TYPES}=await import('../../api/dist/modules/whatsapp-templates/domain/catalog/template-types.js');
  const {connectedMetaCloudCredentials}=await import('../../api/dist/modules/whatsapp-channel/domain/services/connected-meta-cloud-credentials.js');
  for(const merchantId of ids){
    const config=await f.raw.whatsAppChannelConfig.findFirst({where:{merchantId}});
    assert.equal(connectedMetaCloudCredentials(config,merchantId),null,'synthetic_template_precondition_before_connected_meta_required');
  }
  const initializer=new PrismaRecoveryTemplateLifecycleRepository(f.raw);
  for(const merchantId of ids)for(const type of WHATSAPP_TEMPLATE_TYPES)await initializer.ensure(merchantId,type);
  const where={merchantId:{in:ids},type:{in:[...WHATSAPP_TEMPLATE_TYPES]},channel:'whatsapp'};
  await f.raw.postSaleMessageTemplate.updateMany({where,data:{isActive:false,metaNextCheckAt:null}});
  const rows=await f.raw.postSaleMessageTemplate.findMany({where,select:{merchantId:true,type:true,isActive:true,metaNextCheckAt:true,metaClaimToken:true}});
  assert.equal(rows.length,ids.length*WHATSAPP_TEMPLATE_TYPES.length,'synthetic_all_whatsapp_template_types_required');
  for(const merchantId of ids){
    assert.deepEqual(rows.filter(row=>row.merchantId===merchantId).map(row=>row.type).sort(),[...WHATSAPP_TEMPLATE_TYPES].sort());
  }
  for(const row of rows){
    assert.equal(row.isActive,false);assert.equal(row.metaNextCheckAt,null);
    // A claimed row may already be in processRows. Fail closed before publishing
    // credentials; do not clear a claim, alter revision or guess provider outcome.
    assert.equal(row.metaClaimToken,null,'synthetic_template_claim_must_finish_before_connection');
  }
  console.log('local_template_fixture_precondition',JSON.stringify({
    merchantScopeHashes:ids.map(id=>createHash('sha256').update(id).digest('hex').slice(0,16)).sort(),
    whatsappTemplateCount:rows.length,activeTemplates:0,dueTemplates:0,heldClaims:0,
  }));
}

/** Optional real-main preconditions; no alternate auth/repository/provider. */
async function prepareConversationAppAccess(f,scenarios,fixtures){
  const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
  const email='t62-admin-'+randomUUID()+'@operator.example.test',password='SyntheticPassword123!';
  const registered=await f.request('/auth/register',{merchant_name:'Synthetic T62 Admin',email,password,business_mode:'services'});
  assert.equal(registered.status,201,'synthetic_t62_admin_registration_required');
  const admin={...registered.body,email,password};
  await f.raw.merchantUser.update({where:{id:admin.user_id},data:{role:'admin'}});
  await f.raw.merchantTeamMember.updateMany({where:{userId:admin.user_id},data:{role:'ADMIN'}});
  const loggedIn=await f.request('/auth/login',{email,password});assert.equal(loggedIn.status,201);Object.assign(admin,loggedIn.body);
  await keepLocalTemplatesInactive(f,[admin.merchant_id]);
  await f.raw.whatsAppChannelConfig.create({data:{id:admin.merchant_id+'-config',merchantId:admin.merchant_id,provider:'META_CLOUD',enabled:true,status:'ACTIVE',
    credentials:{phoneNumberId:'90006204',wabaId:'90006199',accessToken:'synthetic-t62-admin-local-token'}}});
  for(const auth of [f.ownerAuth,f.productAuth,f.foreignAuth,admin]){
    const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
    await f.runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${literal('conversation-app-'+randomUUID())},store_settings='{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${literal(auth.merchant_id)};
      INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${literal(auth.merchant_id)},${literal(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
      INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${literal(auth.merchant_id)},'active','starter',now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key='starter',current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
      INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${literal(auth.merchant_id)},'[]'::jsonb,1,${literal(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
    const checkout=await f.request('/checkout-settings',undefined,auth,'GET');assert.equal(checkout.status,200,'synthetic_t62_actual_checkout_defaults_required');
  }
  const app=new Map();
  for(const [name,scenario,auth,role,mode]of [['staff','staff-active',f.staffAuth,'STAFF','services'],['services-owner','owner-accepted',f.foreignAuth,'OWNER','services'],['products-owner','products-inactive',f.productAuth,'OWNER','products']]){
    const original=scenarios.get(scenario);assert.ok(original);
    const context=await f.request('/support/whatsapp/conversations/context',undefined,auth,'GET');assert.equal(context.status,200);
    assert.deepEqual(context.body,{merchant_id:auth.merchant_id,user_id:auth.user_id,role});
    app.set(name,{...original,merchantId:auth.merchant_id,role,mode});
  }
  const own=await f.makeCase(admin,'browser-admin-readonly'),fixtureId=randomUUID();
  // The requested ticket is deliberately foreign; snapshot ownership stays on
  // this Admin's separate real canonical case and is never used as authority.
  const seed={fixtureId,scenario:'admin',ticketId:scenarios.get('staff-active').ticketId,email,password,merchantId:admin.merchant_id,role:'ADMIN',mode:'services'};
  fixtures.set(fixtureId,{seed,value:own});app.set('admin',seed);
  const context=await f.request('/support/whatsapp/conversations/context',undefined,admin,'GET');assert.equal(context.status,200);
  assert.deepEqual(context.body,{merchant_id:admin.merchant_id,user_id:admin.user_id,role:'ADMIN'});
  const profile=await f.request('/merchants/me',undefined,admin,'GET');assert.equal(profile.status,200);
  assert.equal((profile.body.data??profile.body).businessMode,'services');assert.equal(String((profile.body.data??profile.body).role).toUpperCase(),'ADMIN');
  return app;
}

const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atendimento WhatsApp local</title></head><body><div id="conversation-fixture"></div><script type="module" src="/e2e/fixtures/whatsapp-conversation.tsx"></script></body></html>`;
export function installWhatsAppConversationFixture(vite,prepared){
  vite.middlewares.use((request,response,next)=>{
    const url=new URL(request.url??'/','http://127.0.0.1:5187');
    const seed=/^\/__service\/conversations\/(staff-active|staff-history|products-inactive|owner-accepted)$/.exec(url.pathname);
    const snapshot=/^\/__service\/conversations\/([a-f0-9-]{36})\/snapshot$/.exec(url.pathname);
    const app=/^\/__service\/conversation-app\/(staff|services-owner|products-owner|admin)$/.exec(url.pathname);
    if(app&&request.method==='POST'&&prepared.appScenarios){
      const value=prepared.appScenarios.get(app[1]);assert.ok(value);response.setHeader('content-type','application/json');response.end(JSON.stringify(value));return;
    }
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
