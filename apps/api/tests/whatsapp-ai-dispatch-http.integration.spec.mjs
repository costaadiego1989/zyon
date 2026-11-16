import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma,PrismaClient} from '@prisma/client';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

test('T51 signed HTTP and actual worker mutation boundaries',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHandoffFixture({provider:'META_CLOUD',whatsapp:true});
  try{
    const sent=()=>f.runtime.whatsapp.events().filter(event=>['sendText','sendMedia'].includes(event.kind));
    const post=async(value,id,text)=>{
      const body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:f.metaPhoneNumberId(value.actor)},messages:[{
        id,from:value.session.buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text},
      }]}}]}]});
      return fetch(f.runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':f.runtime.whatsapp.signature(body)},
        body,redirect:'error',signal:AbortSignal.timeout(15_000)});
    };
    const wait=async(predicate,label)=>{const deadline=Date.now()+15_000;do{const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);assert.fail(label);};
    const processed=id=>wait(async()=>{const row=await f.raw.whatsAppWebhookInbox.findFirst({where:{eventId:id}});
      if(row&&['dead','blocked'].includes(row.status))assert.fail('inbox terminal failure: '+row.lastError);
      return row?.status==='processed'?row:undefined;},'inbox not processed: '+id);

    for(const expired of [false,true])await t.test('a synthetically prepared old AI0 response cannot adopt a later AI2 epoch through signed HTTP replay; expired='+expired,async()=>{
      const eventId=expired?'t51-old-prepared-expired':'t51-old-prepared';
      const value=await f.thread(f.owner,'stale-prepared-'+expired);
      const binding=await f.as(value.actor,()=>f.repo.getOrCreate(value.scope));
      // This fixture seeds a later state; it does not claim to exercise T56's
      // future authenticated close command or a real provider/LLM response.
      await f.raw.whatsAppHandoffBinding.update({where:{id:binding.id},data:{mode:'ai',epoch:2}});
      if(expired)await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{lastActivityAt:new Date(0)}});
      const checkoutCount=await f.raw.checkoutSession.count({where:{merchantId:value.actor.merchantId}});
      const before=await f.raw.checkoutSession.findFirst({where:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}});
      const beforeState=(await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}})).conversationState;
      await f.runtime.db.sql(`CREATE FUNCTION seed_old_ai_turn() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE wa whatsapp_sessions%ROWTYPE; account_id TEXT;
        BEGIN IF NEW.event_id='${eventId}' THEN
          SELECT * INTO STRICT wa FROM whatsapp_sessions WHERE merchant_id=NEW.merchant_id AND device_id=NEW.device_id
            AND regexp_replace(buyer_phone,'[^0-9]','','g')=regexp_replace(NEW.payload->>'fromNumber','[^0-9]','','g');
          SELECT credentials->>'phoneNumberId' INTO account_id FROM whatsapp_channel_configs WHERE id=NEW.config_id;
          NEW.response_state=jsonb_build_object('phase','prepared','sessionId',wa.id,'previousRevision',wa.conversation_state->>'revision','sent','[]'::jsonb,
            'aiAuthority',jsonb_build_object('version',1,'merchantId',NEW.merchant_id,'configId',NEW.config_id,'whatsappSessionId',wa.id,'inboxId',NEW.id,
              'bindingId',NULL,'epoch',0,'deviceId',NEW.device_id,'buyerPhone','+'||wa.buyer_phone,'provider','META_CLOUD','accountId',account_id,
              'checkoutSessionId',wa.checkout_session_id,'conversationId',wa.conversation_state->>'conversationId','revision',wa.conversation_state->>'revision'),
            'state',jsonb_set(wa.conversation_state,'{revision}',to_jsonb(NEW.id)),
            'presentation',jsonb_build_object('messages',jsonb_build_array(jsonb_build_object('type','text','text',jsonb_build_object('body','Old prepared result must not be sent'))),
              'selections','{}'::jsonb,'numericSelections','[]'::jsonb,'page',0,'totalPages',1));
        END IF;RETURN NEW;END $$;
        CREATE TRIGGER seed_old_ai_turn BEFORE INSERT ON whatsapp_webhook_inbox FOR EACH ROW EXECUTE FUNCTION seed_old_ai_turn();`);
      try{
        assert.equal((await post(value,eventId,'Synthetic old input')).status,200);
        const inbox=await processed(eventId);
        assert.equal(inbox.responseState.purpose,'ai_suppressed');assert.equal(inbox.responseState.phase,'complete');
        assert.equal(inbox.responseState.aiAuthority.epoch,0);assert.equal(inbox.responseState.aiAuthority.bindingId,null);
        assert.deepEqual(sent(),[]);assert.equal(await f.raw.npsResponse.count(),0);
        assert.deepEqual(await f.raw.checkoutSession.findUnique({where:{id:before.id}}),before);
        assert.equal(await f.raw.checkoutSession.count({where:{merchantId:value.actor.merchantId}}),checkoutCount);
        assert.deepEqual((await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}})).conversationState,beforeState);
        assert.equal((await f.raw.whatsAppHandoffBinding.findUnique({where:{id:binding.id}})).epoch,2);
      }finally{await f.runtime.db.sql('DROP TRIGGER seed_old_ai_turn ON whatsapp_webhook_inbox; DROP FUNCTION seed_old_ai_turn();');}
    });

    await t.test('the real cart writer holds identity until commit and the waiting takeover suppresses subsequent automatic UI',async()=>{
      const value=await f.thread(f.products,'actual-cart');
      const state={...value.session.conversationState,stage:'store'};
      await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{conversationState:state,postSaleContext:Prisma.DbNull}});
      const checkoutBefore=await f.raw.checkoutSession.findFirst({where:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}});
      const ticket=await f.ticket(value,'actual-cart-takeover');
      const holderClient=new PrismaClient({datasources:{db:{url:f.runtime.db.prismaUrl}}});
      const observer=new PrismaClient({datasources:{db:{url:f.runtime.db.prismaUrl}}});
      const ready=deferred(),release=deferred();let holder,takeover;
      try{
        holder=holderClient.$transaction(async tx=>{
          await tx.$executeRawUnsafe('LOCK TABLE storefront_carts IN SHARE MODE');
          const[row]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;ready.resolve(row.pid);await release.promise;
        },{timeout:15_000});
        const holderPid=await Promise.race([ready.promise,holder.then(()=>{throw new Error('controlled_holder_closed_before_ready');})]);
        assert.equal((await post(value,'t51-actual-cart','Ver carrinho')).status,200);
        const writer=await wait(async()=>{
          const rows=await observer.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
            AND ${holderPid}=ANY(pg_blocking_pids(pid)) AND query ILIKE '%INSERT%storefront_carts%'`;
          return rows[0];
        },'signed worker did not reach the actual storefront cart INSERT');
        takeover=f.as(value.actor,()=>f.repo.begin(value.scope,ticket.id,0));
        await wait(async()=>{
          const rows=await observer.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
            AND ${writer.pid}=ANY(pg_blocking_pids(pid)) AND query ILIKE '%pg_advisory_xact_lock%'`;
          return rows[0];
        },'takeover did not wait for the actual cart writer identity lock');
        release.resolve();await holder;assert.equal((await takeover).state.mode,'waiting_human');
        const inbox=await processed('t51-actual-cart');
        assert.equal(inbox.responseState.purpose,'ai_suppressed');
        assert.equal(await f.raw.storefrontCart.count({where:{merchantId:value.actor.merchantId,sessionId:state.conversationId}}),1);
        assert.deepEqual(sent(),[]);assert.equal(await f.raw.aiUsageEvent.count(),0);
        assert.deepEqual(await f.raw.checkoutSession.findUnique({where:{id:checkoutBefore.id}}),checkoutBefore);
        assert.equal((await f.raw.whatsAppHandoffBinding.findFirst({where:{whatsappSessionId:value.session.id}})).ticketId,ticket.id);
      }finally{
        release.resolve();if(holder)await holder.catch(()=>{});if(takeover)await takeover.catch(()=>{});
        await holderClient.$disconnect();await observer.$disconnect();
      }
    });
    await t.test('a same-epoch partial presentation resumes its original expired context and reuses the durable own receipt on retry',async()=>{
      const value=await f.thread(f.owner,'matching-prepared');
      await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{lastActivityAt:new Date(0),postSaleContext:Prisma.DbNull}});
      const originalState=value.session.conversationState,checkouts=await f.raw.checkoutSession.count();
      const beforeCalls=sent().length;
      await f.runtime.db.sql(`CREATE FUNCTION seed_matching_ai_turn() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE wa whatsapp_sessions%ROWTYPE; account_id TEXT;
        BEGIN IF NEW.event_id='t51-matching-prepared' THEN
          SELECT * INTO STRICT wa FROM whatsapp_sessions WHERE merchant_id=NEW.merchant_id AND device_id=NEW.device_id
            AND regexp_replace(buyer_phone,'[^0-9]','','g')=regexp_replace(NEW.payload->>'fromNumber','[^0-9]','','g');
          SELECT credentials->>'phoneNumberId' INTO account_id FROM whatsapp_channel_configs WHERE id=NEW.config_id;
          NEW.response_state=jsonb_build_object('phase','prepared','sessionId',wa.id,'previousRevision',wa.conversation_state->>'revision',
            'sent',jsonb_build_array(jsonb_build_object('index',0,'messageId','synthetic-already-submitted')),
            'aiAuthority',jsonb_build_object('version',1,'merchantId',NEW.merchant_id,'configId',NEW.config_id,'whatsappSessionId',wa.id,'inboxId',NEW.id,
              'bindingId',NULL,'epoch',0,'deviceId',NEW.device_id,'buyerPhone','+'||wa.buyer_phone,'provider','META_CLOUD','accountId',account_id,
              'checkoutSessionId',wa.checkout_session_id,'conversationId',wa.conversation_state->>'conversationId','revision',wa.conversation_state->>'revision'),
            'state',jsonb_set(wa.conversation_state,'{revision}',to_jsonb(NEW.id)),
            'presentation',jsonb_build_object('messages',jsonb_build_array(
              jsonb_build_object('type','text','text',jsonb_build_object('body','Already submitted fixture part')),
              jsonb_build_object('type','text','text',jsonb_build_object('body','Remaining local prepared part'))),
              'selections','{}'::jsonb,'numericSelections','[]'::jsonb,'page',0,'totalPages',1));
        END IF;RETURN NEW;END $$;
        CREATE TRIGGER seed_matching_ai_turn BEFORE INSERT ON whatsapp_webhook_inbox FOR EACH ROW EXECUTE FUNCTION seed_matching_ai_turn();`);
      try{
        assert.equal((await post(value,'t51-matching-prepared','Synthetic prepared input')).status,200);
        const first=await processed('t51-matching-prepared');
        assert.equal(first.responseState.phase,'complete');assert.equal(first.responseState.sent.length,2);
        assert.equal(first.responseState.ownContextReceipt.to.revision,first.id);
        assert.deepEqual((await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}})).conversationState,{...originalState,revision:first.id});
        assert.equal(sent().length,beforeCalls+1);assert.equal(sent().at(-1).input.uiMessage.text.body,'Remaining local prepared part');
        assert.equal(await f.raw.checkoutSession.count(),checkouts);assert.equal(await f.raw.aiUsageEvent.count(),0);
        // Simulate the bounded crash gap after durable UI receipts, before the
        // inbox completion acknowledgement. This is not another buyer input.
        await f.raw.whatsAppWebhookInbox.update({where:{id:first.id},data:{status:'pending',processedAt:null,availableAt:new Date(0),leaseToken:null,leaseExpiresAt:null}});
        const resumed=await processed('t51-matching-prepared');
        assert.equal(resumed.attempts,first.attempts+1);assert.deepEqual(resumed.responseState.aiAuthority,first.responseState.aiAuthority);
        assert.deepEqual(resumed.responseState.ownContextReceipt,first.responseState.ownContextReceipt);assert.equal(sent().length,beforeCalls+1);
      }finally{await f.runtime.db.sql('DROP TRIGGER seed_matching_ai_turn ON whatsapp_webhook_inbox; DROP FUNCTION seed_matching_ai_turn();');}
    });

    for(const versioned of [false,true])await t.test('an unconfirmed notice retry never renews context or creates a binding; versioned='+versioned,async()=>{
      const eventId='t51-unconfirmed-'+versioned,value=await f.thread(f.owner,'unconfirmed-'+versioned);
      await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{lastActivityAt:new Date(0)}});
      const before=await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}}),checkouts=await f.raw.checkoutSession.count(),calls=sent().length;
      await f.runtime.db.sql(`CREATE FUNCTION seed_unconfirmed_turn() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE wa whatsapp_sessions%ROWTYPE; account_id TEXT;
        BEGIN IF NEW.event_id='${eventId}' THEN
          SELECT * INTO STRICT wa FROM whatsapp_sessions WHERE merchant_id=NEW.merchant_id AND device_id=NEW.device_id
            AND regexp_replace(buyer_phone,'[^0-9]','','g')=regexp_replace(NEW.payload->>'fromNumber','[^0-9]','','g');
          NEW.response_state=jsonb_build_object('purpose','human_handoff','handoff',jsonb_build_object('confirmed',false,'reply','Synthetic unknown old result'),
            'phase','prepared','sessionId',wa.id,'sessionApplied',true,'state',wa.conversation_state,'sent','[]'::jsonb,
            'presentation',jsonb_build_object('messages',jsonb_build_array(jsonb_build_object('type','text','text',jsonb_build_object('body','Must not repeat'))),
              'selections','{}'::jsonb,'numericSelections','[]'::jsonb,'page',0,'totalPages',1));
          IF ${versioned?'TRUE':'FALSE'} THEN
            SELECT credentials->>'phoneNumberId' INTO account_id FROM whatsapp_channel_configs WHERE id=NEW.config_id;
            NEW.response_state=NEW.response_state||jsonb_build_object('aiAuthority',jsonb_build_object('version',1,'merchantId',NEW.merchant_id,'configId',NEW.config_id,
              'whatsappSessionId',wa.id,'inboxId',NEW.id,'bindingId',NULL,'epoch',0,'deviceId',NEW.device_id,'buyerPhone','+'||wa.buyer_phone,
              'provider','META_CLOUD','accountId',account_id,'checkoutSessionId',wa.checkout_session_id,
              'conversationId',wa.conversation_state->>'conversationId','revision',wa.conversation_state->>'revision'));
          END IF;
        END IF;RETURN NEW;END $$;
        CREATE TRIGGER seed_unconfirmed_turn BEFORE INSERT ON whatsapp_webhook_inbox FOR EACH ROW EXECUTE FUNCTION seed_unconfirmed_turn();`);
      try{
        assert.equal((await post(value,eventId,'Quero falar com atendente')).status,200);
        // Preserve T50's already-approved consumption marker. A null receipt
        // acknowledges this input without claiming a new human ticket/send.
        const inbox=await processed(eventId);assert.equal(inbox.responseState.purpose,'human_received');assert.equal(inbox.responseState.phase,'complete');
        assert.deepEqual(inbox.responseState.receipt,{inboxId:inbox.id,sessionId:value.session.id,bindingId:null,ticketId:null,epoch:null});
        assert.equal(versioned?inbox.responseState.aiAuthority.epoch:inbox.responseState.aiAuthority,versioned?0:undefined);
        assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:value.session.id}}),0);
        assert.equal(await f.raw.supportTicket.count({where:{sessionId:value.session.id}}),0);assert.equal(sent().length,calls);
        assert.equal(await f.raw.checkoutSession.count(),checkouts);assert.deepEqual(await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}}),before);
      }finally{await f.runtime.db.sql('DROP TRIGGER seed_unconfirmed_turn ON whatsapp_webhook_inbox; DROP FUNCTION seed_unconfirmed_turn();');}
    });
    assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().authOverrides,false);
    assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close();}
});
