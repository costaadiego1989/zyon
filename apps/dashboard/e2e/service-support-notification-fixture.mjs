import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createWhatsAppOperatorHttpFixture} from '../../api/tests/whatsapp-operator-http-fixture.mjs';

const phones=index=>({accepted:'+551199990'+String(index).padStart(4,'0'),unknown:'+551198990'+String(index).padStart(4,'0'),unavailable:'+551197990'+String(index).padStart(4,'0')});
const scenarios=new Set(['owner-services','owner-products','admin','staff']);
const MAX_FIXTURES=10;

/** Actual AppModule/auth/SQL/outbox/socket. Only the existing final provider
 * transport is local; no private case DTO or delivery outcome is prewritten. */
export async function prepareSupportNotificationFixtures(){
  const outcomes={};
  for(let index=1;index<=MAX_FIXTURES;index++){
    const value=phones(index);
    outcomes[value.accepted.slice(1)]={status:'sent',messageId:'synthetic-t101-accepted-'+index};
    outcomes[value.unknown.slice(1)]={status:'unknown',messageId:''};
  }
  const f=await createWhatsAppOperatorHttpFixture({provider:'META_CLOUD',operatorDelivery:true,whatsapp:{operatorOutcomesByRecipient:outcomes}});
  try{
    assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.runtime.db.runId}]);
    assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
    const {persistWhatsAppSupportIntake}=await import('../../api/dist/modules/support/application/whatsapp-support-intake.js');
    const {staffAlertId,STAFF_ALERT_REQUESTED}=await import('../../api/dist/modules/support/domain/support-case-alert.js');
    const {PrismaRecoveryTemplateLifecycleRepository}=await import('../../api/dist/modules/whatsapp-templates/infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js');
    const {WHATSAPP_TEMPLATE_TYPES}=await import('../../api/dist/modules/whatsapp-templates/domain/catalog/template-types.js');
    const entries=new Map(),initializer=new PrismaRecoveryTemplateLifecycleRepository(f.raw);
    const wait=async(work,label)=>{const end=Date.now()+15_000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};
    const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
    const seedWindow=async(entry,phone)=>{
      const eventId=randomUUID(),body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:entry.phoneNumberId},
        messages:[{id:eventId,from:phone.slice(1),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Falar com atendente'}}]}}]}]});
      const response=await fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},body});
      assert.equal(response.status,200);await response.body?.cancel();
      await wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId}});assert.ok(!row||!['dead','blocked'].includes(row.status));return row?.status==='processed';},'synthetic_t101_authenticated_staff_window_required');
    };
    const publicState=async merchantId=>{
      const rows=await f.raw.$queryRaw`SELECT jsonb_build_object(
        'merchant',(SELECT store_settings FROM merchants WHERE id=${merchantId}),
        'faq',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM support_settings s WHERE merchant_id=${merchantId}),
        'work',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]'::jsonb) FROM public_source_work w WHERE merchant_id=${merchantId}),
        'chunks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM knowledge_chunks c WHERE merchant_id=${merchantId}),
        'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',event_id,'type',event_type,'payload',payload) ORDER BY event_id),'[]'::jsonb)
          FROM outbox_messages WHERE merchant_id=${merchantId} AND event_type IN ('support.faq_updated','public.source.changed'))) AS state`;
      return rows[0].state;
    };
    // Owned processing leases are the same explicit producer precondition used
    // by native100. They never grant a staff window: that uses signed HTTP above.
    const intakeInput=async(value,origin='text')=>{
      const id=randomUUID(),leaseToken=randomUUID(),payload={merchantId:value.actor.merchantId,deviceId:value.session.deviceId,
        provider:'META_CLOUD',fromNumber:value.session.buyerPhone,timestamp:Date.now(),body:'Pedido sintético de atendimento humano T101',ignored:false};
      await f.raw.whatsAppWebhookInbox.create({data:{id,dedupKey:id,eventId:id,kind:'message',merchantId:value.actor.merchantId,configId:value.scope.configId,
        deviceId:value.session.deviceId,streamKey:createHash('sha256').update(id).digest('hex'),payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        status:'processing',leaseToken,leaseExpiresAt:new Date(Date.now()+60_000)}});
      return{scope:value.scope,inboxId:id,leaseToken,message:payload.body,origin};
    };
    const intake=(value,args)=>f.as(value.actor,()=>persistWhatsAppSupportIntake(f.repo,args));
    const terminal=id=>wait(async()=>{const row=await f.raw.whatsAppDelivery.findUnique({where:{id}});return row&&!['queued','preparing','started'].includes(row.state)?row:undefined;},'synthetic_t101_actual_alert_terminal_required');
    const owned=id=>{const entry=entries.get(id);assert.ok(entry,'synthetic_t101_owned_fixture_required');return entry;};
    return{runtime:f.runtime,
      async close(){await f.close();},
      async seed(scenario){
        assert.ok(scenarios.has(scenario),'synthetic_t101_scenario_required');
        const index=entries.size+1;assert.ok(index<=MAX_FIXTURES,'synthetic_t101_bounded_fixture_required');
        const mode=scenario==='owner-products'?'products':'services',role=scenario==='admin'?'ADMIN':scenario==='staff'?'STAFF':'OWNER';
        const email='t101-'+randomUUID()+'@operator.example.test',password='SyntheticPassword123!';
        const registered=await f.request('/auth/register',{merchant_name:'Synthetic T101',email,password,business_mode:mode});assert.equal(registered.status,201);
        const auth={...registered.body,email,password},merchantId=auth.merchant_id,phoneNumberId='900101'+String(index).padStart(4,'0');
        for(const type of WHATSAPP_TEMPLATE_TYPES)await initializer.ensure(merchantId,type);
        const where={merchantId,type:{in:[...WHATSAPP_TEMPLATE_TYPES]},channel:'whatsapp'};
        await f.raw.postSaleMessageTemplate.updateMany({where,data:{isActive:false,metaNextCheckAt:null}});
        const templates=await f.raw.postSaleMessageTemplate.findMany({where,select:{isActive:true,metaNextCheckAt:true,metaClaimToken:true}});
        assert.equal(templates.length,WHATSAPP_TEMPLATE_TYPES.length);
        assert.ok(templates.every(row=>row.isActive===false&&row.metaNextCheckAt===null&&row.metaClaimToken===null),'synthetic_t101_template_claim_must_finish_before_connection');
        await f.raw.whatsAppChannelConfig.create({data:{id:merchantId+'-config',merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',
          deviceId:'META_CLOUD:'+merchantId+'-config',credentials:{phoneNumberId,wabaId:'9001010000',accessToken:'synthetic-t101-local-token'}}});
        const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
        await f.runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${literal('support-alert-'+randomUUID())},store_settings='{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${literal(merchantId)};
          INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${literal(merchantId)},${literal(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
          INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${literal(merchantId)},'active','starter',now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key='starter',current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
          INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${literal(merchantId)},'[]'::jsonb,1,${literal(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
        await f.raw.supportSetting.create({data:{merchantId,faqItems:[{id:'synthetic-t101-faq',question:'Pergunta pública salva',answer:'Resposta pública preservada'}]}});
        await f.raw.$executeRaw`INSERT INTO knowledge_chunks(id,merchant_id,source_type,source_id,content,embedding,updated_at)
          VALUES (${randomUUID()},${merchantId},'company',${merchantId},'Introdução pública sintética preservada','[]',clock_timestamp())`;
        const actor={merchantId,userId:auth.user_id,role:'owner'},entry={actor,auth,phoneNumberId,phones:phones(index),cases:[],fixtureId:randomUUID()};
        // Establish authentic windows while no fallback is configured; these
        // precondition cases cannot create a retroactive send after a UI save.
        await seedWindow(entry,entry.phones.accepted);await seedWindow(entry,entry.phones.unknown);
        if(role==='STAFF'){
          const saved=await f.request('/support/notification-settings',{fallbackPhone:entry.phones.accepted},auth,'PUT');assert.equal(saved.status,200);
        }
        if(role!=='OWNER'){
          await f.raw.merchantUser.update({where:{id:auth.user_id},data:{role:role.toLowerCase()}});
          await f.raw.merchantTeamMember.updateMany({where:{userId:auth.user_id},data:{role}});
          const login=await f.request('/auth/login',{email,password});assert.equal(login.status,201);Object.assign(auth,login.body);actor.role=role.toLowerCase();
        }
        entries.set(entry.fixtureId,entry);
        return{fixtureId:entry.fixtureId,email,password,mode,role,phones:entry.phones};
      },
      async newCase(id,outcome){
        const entry=owned(id);assert.ok(['accepted','unknown','unavailable'].includes(outcome),'synthetic_t101_outcome_required');
        const setting=await f.raw.supportNotificationSetting.findUniqueOrThrow({where:{merchantId:entry.actor.merchantId}});
        assert.equal(setting.fallbackWhatsapp,entry.phones[outcome],'synthetic_t101_actual_ui_saved_recipient_required');
        const value=await f.thread(entry.actor,'t101-'+randomUUID()),args=await intakeInput(value),result=await intake(value,args);
        const alertId=staffAlertId(entry.actor.merchantId,result.ticketId,1),row=await terminal(alertId);assert.equal(row.state,outcome);
        entry.cases.push({value,args,ticketId:result.ticketId,alertId});return{ticketId:result.ticketId};
      },
      async replay(id){
        const entry=owned(id),current=entry.cases.at(-1);assert.ok(current,'synthetic_t101_case_required');
        await intake(current.value,current.args);await intake(current.value,await intakeInput(current.value,'voice'));await terminal(current.alertId);
        return{ticketId:current.ticketId};
      },
      async snapshot(id){
        const entry=owned(id),ids=entry.cases.map(value=>value.alertId),captures=f.runtime.whatsapp.events().filter(event=>event.kind==='sendText'&&ids.includes(event.input.correlationId));
        return{setting:await f.raw.supportNotificationSetting.findUnique({where:{merchantId:entry.actor.merchantId},select:{fallbackWhatsapp:true,version:true}}),
          publicState:await publicState(entry.actor.merchantId),staffSendAttempts:captures.length,
          alertEvents:await f.raw.outboxMessage.count({where:{merchantId:entry.actor.merchantId,eventType:STAFF_ALERT_REQUESTED,correlationId:{in:ids}}}),
          providerCalls:f.runtime.evidence().providerCalls,authOverrides:f.runtime.evidence().authOverrides,repositoryOverrides:f.runtime.evidence().repositoryOverrides};
      }};
  }catch(error){try{await f.close();}catch(cleanup){throw new AggregateError([error,cleanup],'synthetic_t101_setup_cleanup_failed');}throw error;}
}

export function installSupportNotificationFixture(vite,prepared){
  vite.middlewares.use((request,response,next)=>{
    const path=(request.url??'').split('?')[0],seed=path.match(/^\/__service\/support-notifications\/seed\/(owner-services|owner-products|admin|staff)$/),
      action=path.match(/^\/__service\/support-notifications\/([a-f0-9-]{36})\/(snapshot|case|replay)$/);
    if(!seed&&!action){next();return;}
    void(async()=>{
      response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
      if(seed){assert.equal(request.method,'POST');response.end(JSON.stringify(await prepared.seed(seed[1])));return;}
      const [,id,kind]=action;
      if(kind==='snapshot'){assert.equal(request.method,'GET');response.end(JSON.stringify(await prepared.snapshot(id)));return;}
      assert.equal(request.method,'POST');
      if(kind==='replay'){response.end(JSON.stringify(await prepared.replay(id)));return;}
      let body='';for await(const chunk of request){body+=chunk;assert.ok(Buffer.byteLength(body)<=4096,'synthetic_t101_bounded_body_required');}
      const input=JSON.parse(body);assert.ok(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===1&&typeof input.outcome==='string');
      response.end(JSON.stringify(await prepared.newCase(id,input.outcome)));
    })().catch(()=>{response.statusCode=500;response.end(JSON.stringify({error:'synthetic_t101_fixture_failed'}));});
  });
}
