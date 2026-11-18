// SOURCE ONLY: never imported/run. Existing owned DB fixture and compiled
// current candidate are mandatory prerequisites; this is not HTTP/provider proof.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T56 atomic active-case close and unique resumed command',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createOperatorDeliveryDbFixture();
  try{
    const {CloseWhatsAppConversationUseCase}=await import('../dist/modules/support/application/close-whatsapp-conversation.use-case.js');
    const {WHATSAPP_RESUME_REQUESTED,WHATSAPP_RESUME_TEXT}=await import('../dist/modules/whatsapp-channel/domain/services/whatsapp-resume-command.js');
    const close=new CloseWhatsAppConversationUseCase(f.scoped,f.bindings);
    const execute=(value,input={expectedEpoch:2})=>f.as(value.actor,()=>close.execute(value.principal,value.ticket.id,input));
    const snapshot=async value=>({
      ...(await f.preserved(value)),operator:await f.read(value),
      resume:await f.raw.whatsAppDelivery.findMany({where:{merchantId:value.actor.merchantId,id:{startsWith:'support_resume:'}},orderBy:{id:'asc'}}),
      messages:await f.raw.supportTicketMessage.findMany({where:{ticketId:value.ticket.id},orderBy:{id:'asc'}}),
      events:await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId},orderBy:{eventId:'asc'}}),
    });

    await t.test('double close atomically increments one epoch and preserves checkout/cart/session and55private command',async()=>{
      const value=await f.make();
      let acceptedRequests=0;
      const originalProviderMessageId='synthetic-original-operator-'+randomUUID();
      const consumer=f.consumer(f.submissionSender(async()=>{acceptedRequests++;return{status:'sent',messageId:originalProviderMessageId};}));
      await consumer.handle(value.event);
      assert.equal(acceptedRequests,1,'original55command actually crosses the guarded local request-start boundary');
      const {WhatsAppSupportDeliveryService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-support-delivery.service.js');
      const receipts=new WhatsAppSupportDeliveryService(f.scoped,f.contexts);
      assert.equal(await receipts.reconcileMeta(value.config,value.config.credentials.phoneNumberId,{id:originalProviderMessageId,status:'read',biz_opaque_callback_data:value.deliveryId,recipient_id:value.session.buyerPhone}),true);
      const originalOperator=await f.read(value);
      assert.deepEqual(originalOperator.message.metadata.delivery,{status:'read',revision:2,providerMessageId:originalProviderMessageId});
      assert.equal(originalOperator.delivery.response.submission.requestInvoked,true);
      assert.match(originalOperator.delivery.response.submission.credentialDigest,/^[0-9a-f]{64}$/);
      assert.equal(originalOperator.delivery.response.submission.outboxEventId,value.event.eventId);
      assert.equal(originalOperator.delivery.response.submission.outboxLeaseToken,value.claim.leaseToken);
      const cart={items:[{productId:'synthetic-physical-offer',variantId:'synthetic-variant',quantity:2,unitPriceInCents:2500}],totalInCents:5000,currency:'BRL'};
      await f.raw.checkoutSession.update({where:{merchantId_sessionId:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}},data:{cart}});
      const before=await snapshot(value),results=await Promise.all([execute(value),execute(value)]),after=await snapshot(value);
      assert.deepEqual(results.map(row=>row.idempotent).sort(),[false,true]);
      assert.equal(after.binding.mode,'ai');assert.equal(after.binding.epoch,3);assert.equal(after.binding.ticketId,value.ticket.id);assert.equal(after.binding.assignedOperatorId,null);
      assert.equal(after.ticket.status,'closed');assert.equal(after.resume.length,1);assert.equal(after.resume[0].response.purpose,'human_resume');
      assert.equal(after.messages.filter(row=>row.metadata?.kind==='whatsapp_resume').length,1);
      assert.equal(after.events.filter(row=>row.eventType===WHATSAPP_RESUME_REQUESTED).length,1);
      const resumeMessage=after.messages.find(row=>row.metadata?.kind==='whatsapp_resume');
      assert.equal(resumeMessage.content,WHATSAPP_RESUME_TEXT);assert.match(resumeMessage.content,/^🤖 /);
      assert.equal(after.resume[0].response.contentHash,createHash('sha256').update(resumeMessage.content).digest('hex'));
      assert.equal(after.events.filter(row=>row.eventType==='support.case.changed'&&row.payload.messageId===resumeMessage.id).length,1,'one persisted message produces one new_message projection');
      assert.equal(after.events.filter(row=>row.eventType==='support.case.changed'&&row.payload.event==='closed'&&row.payload.messageId===null).length,1,'close status event does not re-emit the message');
      assert.deepEqual(after.operator,before.operator,'55message/private receipt authority is untouched');
      assert.deepEqual(after.operator,originalOperator,'rich55accepted request and actualread receipt metadata survives close');
      assert.deepEqual(after.checkout,before.checkout);assert.deepEqual(after.session,before.session);
      assert.equal(JSON.stringify(results).includes('credentialDigest'),false);assert.equal(JSON.stringify(results).includes('leaseToken'),false);
      const stable=await snapshot(value);await execute(value,{expectedEpoch:3});assert.deepEqual(await snapshot(value),stable,'replay creates no delivery/message/event');
    });

    await t.test('missing sender identity still closes once with an immutable unavailable no-start notice',async()=>{
      const value=await f.make();
      await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:{}}});
      const before=await snapshot(value),result=await execute(value),after=await snapshot(value);
      assert.equal(result.mode,'ai');assert.equal(result.epoch,3);assert.equal(result.status,'closed');assert.equal(result.resume.status,'failed');
      assert.equal(after.binding.mode,'ai');assert.equal(after.binding.ticketId,value.ticket.id);assert.equal(after.ticket.status,'closed');
      const rows=after.resume.filter(row=>row.response.ticketId===value.ticket.id);assert.equal(rows.length,1);
      const saved=rows[0];assert.equal(saved.state,'failed');assert.equal(saved.processingToken,'not_started');
      assert.equal(saved.response.purpose,'human_resume');assert.equal(saved.response.authority.identityStatus,'unavailable');
      assert.equal(saved.response.authority.accountId,null);assert.equal(saved.response.submission,undefined);
      assert.deepEqual(saved.response.delivery,{status:'failed',revision:0,providerMessageId:null,errorCode:'channel_identity_unavailable'});
      const message=after.messages.find(row=>row.id===saved.response.messageId);assert.equal(message.content,WHATSAPP_RESUME_TEXT);
      assert.equal(saved.response.contentHash,createHash('sha256').update(message.content).digest('hex'));
      assert.deepEqual(after.operator,before.operator);assert.deepEqual(after.session,before.session);assert.deepEqual(after.checkout,before.checkout);
      await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:value.config.credentials}});
      const stable=await snapshot(value),replay=await execute(value,{expectedEpoch:3});
      assert.equal(replay.idempotent,true);assert.equal(replay.resume.status,'failed');
      assert.deepEqual(await snapshot(value),stable,'a newly connected account cannot upgrade the old unavailable intent');
      assert.equal((await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:saved.id}})).response.authority.accountId,null);
    });

    await t.test('a real outbox rejection rolls back binding ticket message and private delivery',async()=>{
      const value=await f.make(),before=await snapshot(value);
      assert.deepEqual(await f.raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:f.db.runId}]);
      await f.db.sql("CREATE FUNCTION synthetic_reject_resume() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='whatsapp.support.resume.requested' THEN RAISE EXCEPTION 'synthetic_resume_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_reject_resume BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_resume();");
      try{await assert.rejects(execute(value),/synthetic_resume_rollback/);assert.deepEqual(await snapshot(value),before);}
      finally{await f.db.sql('DROP TRIGGER synthetic_reject_resume ON outbox_messages; DROP FUNCTION synthetic_reject_resume();');}
    });

    await t.test('another operator stale epoch or foreign principal cannot close and cannot mutate preserved money state',async()=>{
      const value=await f.make(),before=await snapshot(value);
      await assert.rejects(execute(value,{expectedEpoch:1}),/epoch_conflict/);
      for(const principal of [{...value.principal,userId:'another-operator'},{...value.principal,tenantId:'foreign-tenant'},{...value.principal,kind:'m2m'}])
        await assert.rejects(f.as(value.actor,()=>close.execute(principal,value.ticket.id,{expectedEpoch:2})));
      assert.deepEqual(await snapshot(value),before);
    });

    await t.test('a new case makes the old close ineligible without resuming or replacing its binding',async()=>{
      const value=await f.make();await execute(value);
      const next=await f.raw.supportTicket.create({data:{id:randomUUID(),merchantId:value.actor.merchantId,sessionId:value.session.id,source:'whatsapp',status:'open',buyerMessage:'New actual synthetic handoff',createdAt:new Date()}});
      await f.as(value.actor,()=>f.bindings.begin(value.scope,next.id,3));
      const before=await snapshot(value);await assert.rejects(execute(value),/ticket_not_found|case_not_found/);assert.deepEqual(await snapshot(value),before);
      assert.equal(before.binding.mode,'waiting_human');assert.equal(before.binding.ticketId,next.id);assert.equal(before.binding.epoch,4);
    });

    await t.test('missing or cross-purpose durable proof never mints a replacement notice on replay',async()=>{
      const value=await f.make();await execute(value);const [row]=await f.raw.whatsAppDelivery.findMany({where:{merchantId:value.actor.merchantId,id:{startsWith:'support_resume:'}}});
      await f.raw.whatsAppDelivery.update({where:{id:row.id},data:{response:{...row.response,purpose:'support_message'}}});
      const before=await snapshot(value);await assert.rejects(execute(value),/original_command_required/);assert.deepEqual(await snapshot(value),before);
    });

    await t.test('replay rejects missing historical identity and inconsistent stored/read projections without current credential substitution',async()=>{
      const value=await f.make();await execute(value);
      const [row]=await f.raw.whatsAppDelivery.findMany({where:{merchantId:value.actor.merchantId,id:{startsWith:'support_resume:'}}});
      const original=structuredClone(row.response);
      for(const field of ['deviceId','provider','recipient','accountId']){
        const response=structuredClone(original);delete response.authority[field];
        await f.raw.whatsAppDelivery.update({where:{id:row.id},data:{response}});
        const before=await snapshot(value);await assert.rejects(execute(value),/original_command_required/);assert.deepEqual(await snapshot(value),before);
      }
      for(const delivery of [{status:'read',revision:1,providerMessageId:null},{status:'queued',revision:0,providerMessageId:'forged'}, {status:'queued',revision:1,providerMessageId:null}]){
        await f.raw.whatsAppDelivery.update({where:{id:row.id},data:{response:{...original,delivery}}});
        const before=await snapshot(value);await assert.rejects(execute(value),/original_command_required/);assert.deepEqual(await snapshot(value),before);
      }
      await f.raw.whatsAppDelivery.update({where:{id:row.id},data:{response:original}});
      await f.raw.whatsAppChannelConfig.update({where:{id:value.scope.configId},data:{credentials:{...value.config.credentials,phoneNumberId:'rotated-account',accessToken:'synthetic-rotated-secret'}}});
      const before=await snapshot(value);assert.equal((await execute(value)).idempotent,true);assert.deepEqual(await snapshot(value),before,'a historical response retains its original account, not rotated current credentials');
    });
  }finally{await f.close();}
});
