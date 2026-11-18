import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
test('T56 resumed notice original request-start and uncertain outcomes',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createOperatorDeliveryDbFixture();
  try{
    const [{CloseWhatsAppConversationUseCase},{WhatsAppResumeOutboxConsumer},{PrismaOutboxRepository},{WHATSAPP_RESUME_TEXT}]=await Promise.all([
      import('../dist/modules/support/application/close-whatsapp-conversation.use-case.js'),
      import('../dist/modules/whatsapp-channel/application/services/whatsapp-resume-outbox.consumer.js'),
      import('../dist/shared/messaging/infrastructure/prisma-outbox.repository.js'),
      import('../dist/modules/whatsapp-channel/domain/services/whatsapp-resume-command.js'),
    ]);
    const close=new CloseWhatsAppConversationUseCase(f.scoped,f.bindings),outbox=new PrismaOutboxRepository(f.raw);
    const consumer=sender=>new WhatsAppResumeOutboxConsumer(f.scoped,f.bindings,f.contexts,sender,f.events);
    const make=async options=>{
      const value=await f.make(options);await f.as(value.actor,()=>close.execute(value.principal,value.ticket.id,{expectedEpoch:2}));
      const claims=await outbox.claimBatch(50),claim=claims.find(row=>row.envelope.event_type==='whatsapp.support.resume.requested'&&row.envelope.payload.ticketId===value.ticket.id);
      assert.ok(claim,'actual owned resume outbox claim required');const e=claim.envelope;
      const event={eventId:e.event_id,eventType:e.event_type,merchantId:e.merchant_id,correlationId:e.correlation_id,causationId:e.causation_id,schemaVersion:e.schema_version,payload:e.payload};
      Object.defineProperty(event,'deliveryLeaseToken',{value:claim.leaseToken,enumerable:false,writable:false,configurable:false});
      return{...value,resumeEvent:event,resumeId:e.correlation_id};
    };
    const read=async value=>({receipt:await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id:value.resumeId}}),
      message:await f.raw.supportTicketMessage.findUniqueOrThrow({where:{id:value.resumeEvent.payload.messageId}})});
    const handle=(c,value)=>f.as(value.actor,()=>c.handle(value.resumeEvent));
    const wait=async(work,label)=>{const end=Date.now()+5000;do{const value=await work();if(value)return value;await pause(20);}while(Date.now()<end);assert.fail(label);};

    await t.test('one canonical resumed request persists its original attempt and duplicate dispatch never sends again',async()=>{
      const value=await make(),before=await f.preserved(value);let sends=0,captured;
      const c=consumer(f.submissionSender(async(input,scope)=>{sends++;captured={input,scope};return{status:'sent',messageId:'synthetic-resume-original'};}));
      await Promise.all([handle(c,value),handle(c,value)]);const result=await read(value);
      assert.equal(sends,1);assert.equal(captured.input.text,WHATSAPP_RESUME_TEXT);assert.equal(captured.input.correlationId,value.resumeId);
      assert.equal(captured.scope.messageId,value.resumeId);assert.equal(result.receipt.response.purpose,'human_resume');
      assert.equal(result.receipt.response.contentHash,createHash('sha256').update(result.message.content).digest('hex'));
      assert.deepEqual(result.message.metadata.delivery,{status:'accepted',revision:1,providerMessageId:'synthetic-resume-original'});
      assert.equal(result.receipt.response.submission.requestInvoked,true);assert.equal(result.receipt.response.submission.outboxLeaseToken,value.resumeEvent.deliveryLeaseToken);
      assert.match(result.receipt.response.submission.credentialDigest,/^[a-f0-9]{64}$/);assert.deepEqual(await f.preserved(value),before);
      const stable=await read(value);await handle(c,value);assert.equal(sends,1);assert.deepEqual(await read(value),stable);
    });

    for(const change of ['handoff','credentials'])await t.test('final start rejects '+change+' changed during actual transport preparation',async()=>{
      const value=await make(),prepared=deferred(),release=deferred();let sends=0;
      const sender={async sendText(input){const scope=f.submission.currentWhatsAppSubmissionScope();assert.ok(scope&&Object.isFrozen(scope));
        prepared.resolve();await release.promise;return f.submission.startWhatsAppRequest(scope,async()=>{sends++;return{status:'sent',messageId:'must-not-send'};});}};
      const pending=handle(consumer(sender),value);
      try{
        await prepared.promise;
        if(change==='handoff'){
          const next=await f.raw.supportTicket.create({data:{id:randomUUID(),merchantId:value.actor.merchantId,sessionId:value.session.id,
            source:'whatsapp',status:'open',buyerMessage:'Synthetic new human handoff',createdAt:new Date()}});
          await f.as(value.actor,()=>f.bindings.begin(value.scope,next.id,3));
        }else await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:{...value.config.credentials,accessToken:'synthetic-rotated-token'}}});
      }finally{release.resolve();}
      await pending;const result=await read(value);assert.equal(sends,0);assert.equal(result.message.metadata.delivery.status,'failed');
      assert.equal(result.receipt.response.submission.requestInvoked,false);
      assert.equal(result.message.metadata.delivery.errorCode,change==='handoff'?'conversation_changed':'channel_context_changed');
      if(change==='handoff'){const current=await f.preserved(value);assert.equal(current.binding.mode,'waiting_human');assert.equal(current.binding.epoch,4);}
      await handle(consumer(f.submissionSender(async()=>{sends++;return{status:'sent',messageId:'forbidden-retry'};})),value);assert.equal(sends,0);
    });

    await t.test('unknown started submission remains unknown and is never resent on dispatch retry',async()=>{
      const value=await make();let sends=0;
      const c=consumer(f.submissionSender(async()=>{sends++;return{status:'unknown',messageId:''};}));
      await handle(c,value);const before=await read(value);assert.equal(sends,1);
      assert.deepEqual(before.message.metadata.delivery,{status:'unknown',revision:1,providerMessageId:null,errorCode:'submission_unknown'});
      assert.equal(before.receipt.response.submission.requestInvoked,true);await handle(c,value);assert.equal(sends,1);assert.deepEqual(await read(value),before);
    });

    await t.test('real deferred COMMIT rejection after local SDK start persists unknown without a replacement request',async()=>{
      const value=await make();let sends=0;
      await f.db.sql(`CREATE FUNCTION synthetic_resume_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id=${sql(value.resumeId)} AND NEW.state='started' THEN RAISE EXCEPTION 'synthetic_resume_commit_unknown'; END IF; RETURN NEW; END $$;
        CREATE CONSTRAINT TRIGGER synthetic_resume_commit_failure AFTER UPDATE ON whatsapp_deliveries DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION synthetic_resume_commit_failure();`);
      try{
        const c=consumer(f.submissionSender(async()=>{sends++;return{status:'sent',messageId:'synthetic-started-before-commit'};}));
        await handle(c,value);const saved=await read(value);assert.equal(sends,1);assert.equal(saved.message.metadata.delivery.status,'unknown');
        assert.equal(saved.receipt.response.submission.requestInvoked,true);assert.equal(saved.receipt.response.submission.commitUnknown,true);
        await handle(c,value);assert.equal(sends,1);assert.deepEqual(await read(value),saved);
      }finally{await f.db.sql('DROP TRIGGER synthetic_resume_commit_failure ON whatsapp_deliveries; DROP FUNCTION synthetic_resume_commit_failure();');}
    });

    await t.test('unavailable original identity cannot acquire send authority after a new connection',async()=>{
      const value=await make({provider:'BUBBLEWHATS'});let sends=0;
      await f.raw.whatsAppChannelConfig.update({where:{id:value.config.id},data:{credentials:{phoneNumberId:'new-account',accessToken:'new-token'}}});
      const before=await read(value);await handle(consumer(f.submissionSender(async()=>{sends++;return{status:'sent',messageId:'forbidden-migration'};})),value);
      assert.equal(sends,0);assert.deepEqual(await read(value),before);assert.equal(before.receipt.response.authority.accountId,null);
      assert.equal(before.receipt.response.authority.identityStatus,'unavailable');assert.equal(before.receipt.processingToken,'not_started');
    });

    await t.test('SQL clock after a real member-row wait rejects the now-expired lease before starting the SDK',async()=>{
      const value=await make(),prepared=deferred(),release=deferred(),locked=deferred(),unlock=deferred();let sends=0,blockerPid;
      const c=consumer({async sendText(){const scope=f.submission.currentWhatsAppSubmissionScope();assert.ok(scope);prepared.resolve();await release.promise;
        return f.submission.startWhatsAppRequest(scope,async()=>{sends++;return{status:'sent',messageId:'forbidden-expired-lease'};});}});
      const pending=handle(c,value);let blocker;
      try{
        await prepared.promise;
        blocker=f.raw.$transaction(async tx=>{
          const [pid]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;blockerPid=pid.pid;
          await tx.$queryRaw`SELECT id FROM merchant_users WHERE id=${value.principal.userId} AND merchant_id=${value.actor.merchantId} FOR UPDATE`;
          locked.resolve();await unlock.promise;
        },{timeout:15_000});
        await locked.promise;release.resolve();
        await wait(async()=>Number(await f.db.sql(`SELECT count(*) FROM pg_stat_activity WHERE ${Number(blockerPid)}=ANY(pg_blocking_pids(pid));`))>0,'actual resumed request did not physically wait');
        assert.equal(await f.db.sql(`SELECT (lease_expires_at>clock_timestamp())::text FROM outbox_messages WHERE event_id=${sql(value.resumeEvent.eventId)};`),'true',
          'the original lease was still live when the request entered its real row wait');
        await f.db.sql(`UPDATE outbox_messages SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE event_id=${sql(value.resumeEvent.eventId)};`);
        assert.equal(await f.db.sql(`SELECT (lease_expires_at<=clock_timestamp())::text FROM outbox_messages WHERE event_id=${sql(value.resumeEvent.eventId)};`),'true');
        assert.equal(sends,0);
      }finally{release.resolve();unlock.resolve();if(blocker)await blocker;}
      await pending;const saved=await read(value);assert.equal(sends,0);assert.equal(saved.message.metadata.delivery.status,'failed');
      assert.equal(saved.message.metadata.delivery.errorCode,'dispatch_lease_lost');assert.equal(saved.receipt.response.submission.requestInvoked,false);
    });
  }finally{await f.close();}
});
