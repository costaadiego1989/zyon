import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

// Matrix51/8: actual SQL COMMIT failure after the physical local callback.
// No AppModule/auth/repository override. This direct composition uses the real
// fence/repository/transaction, DeliveryService and Meta adapter. Only the
// adapter fetch is scoped/local; the repository wrapper injects deferred SQL
// failure after its unchanged canonical readLocked/admission callback.
test('T51 started request plus deferred SQL COMMIT failure remains unknown without a blind retry',
  {timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  const unhandled=[];const onUnhandled=reason=>unhandled.push(reason);
  process.on('unhandledRejection',onUnhandled);
  try{
    const {WhatsAppAiDispatchFence}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-ai-dispatch-fence.js');
    const {PrismaWhatsAppHandoffRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js');
    const {WhatsAppTurnContext}=await import('../dist/modules/whatsapp-channel/domain/services/whatsapp-turn-context.js');
    const {currentWhatsAppExecution}=await import('../dist/shared/whatsapp/whatsapp-automation-context.js');
    const {WhatsAppDeliveryService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-delivery.service.js');
    const {MetaCloudSenderAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.js');
    const bindings=new PrismaWhatsAppHandoffRepository(f.scoped),turns=new WhatsAppTurnContext();
    const fence=new WhatsAppAiDispatchFence(f.scoped,bindings,turns);
    const id=randomUUID(),leaseToken=randomUUID(),configId='commit-config',deviceId='META_CLOUD:'+configId;
    const state={version:1,conversationId:'conversation-'+id,stage:'store',history:[],revision:'',page:0,previousViews:[]};
    await f.raw.whatsAppChannelConfig.create({data:{id:configId,merchantId:f.owner.merchantId,deviceId,provider:'META_CLOUD',
      enabled:true,status:'ACTIVE',credentials:{phoneNumberId:'100001',wabaId:'100002',accessToken:'synthetic-local-only'}}});
    const session=await f.raw.whatsAppSession.create({data:{merchantId:f.owner.merchantId,deviceId,buyerPhone:'5511999991001',status:'active',conversationState:state}});
    const payload={merchantId:f.owner.merchantId,deviceId,fromNumber:session.buyerPhone,body:'Synthetic request',messageType:'text',timestamp:Date.now(),provider:'META_CLOUD'};
    const row=await f.raw.whatsAppWebhookInbox.create({data:{id,dedupKey:id,eventId:id,kind:'message',merchantId:f.owner.merchantId,
      configId,deviceId,streamKey:session.buyerPhone,payload,payloadHash:id,status:'processing',leaseToken,
      leaseExpiresAt:new Date(Date.now()+120_000),attempts:1}});
    const claim={...row,payload,responseState:undefined},scope={merchantId:f.owner.merchantId,configId,whatsappSessionId:session.id};
    let authority;
    await f.as(f.owner,()=>turns.run({scope,inboxId:id,leaseToken,conversationId:state.conversationId,message:payload.body,origin:'text'},
      ()=>fence.run(claim,async()=>{authority=currentWhatsAppExecution().authority;})));
    const response={merchantId:f.owner.merchantId,deviceId,provider:'META_CLOUD',toNumber:session.buyerPhone,
      text:'Synthetic commit probe',aiAuthority:authority};
    await f.raw.whatsAppDelivery.create({data:{id,merchantId:f.owner.merchantId,configId,deviceId,state:'ready',processingToken:leaseToken,response}});
    const inboxBefore=await f.raw.whatsAppWebhookInbox.findUniqueOrThrow({where:{id}});
    const sessionBefore=await f.raw.whatsAppSession.findUniqueOrThrow({where:{id:session.id}});
    const ticketCount=await f.raw.supportTicket.count(),messageCount=await f.raw.supportTicketMessage.count();
    await f.raw.$executeRaw`CREATE TABLE synthetic_request_commit_probe(id TEXT PRIMARY KEY)`;
    await f.raw.$executeRawUnsafe("CREATE FUNCTION synthetic_request_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_request_commit_rollback'; END $$");
    await f.raw.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER synthetic_request_commit_rollback AFTER INSERT ON synthetic_request_commit_probe DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_request_commit_failure()');
    let physicalRequests=0,injections=0,insertReturned=false,commitFailureObserved=false,generationCalls=0,forwards=0;
    const envelopes=[];
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      physicalRequests++;envelopes.push({url:String(url),body:JSON.parse(options.body)});
      throw new Error('synthetic_immediate_provider_rejection');
    });
    const originalReadLock=bindings.withReadLock.bind(bindings);
    t.mock.method(bindings,'withReadLock',async(scope,work)=>{
      try{
        return await originalReadLock(scope,async(tx,locked)=>{
          const result=await work(tx,locked);
          // The outer async sender admission commits before physical start.
          // Fault only the final adapter transaction, after its fetch callback.
          if(physicalRequests===1&&injections===0&&result&&typeof result==='object'&&Object.hasOwn(result,'submission')){
            injections++;assert.equal(physicalRequests,1);
            await tx.$executeRaw`INSERT INTO synthetic_request_commit_probe(id) VALUES (${id})`;
            insertReturned=true;
          }
          return result;
        });
      }catch(error){
        if(injections===1&&insertReturned){
          assert.match(String(error)+' '+JSON.stringify(error?.meta??{}),/synthetic_request_commit_rollback/);
          commitFailureObserved=true;
        }
        throw error;
      }
    });
    const sender=new MetaCloudSenderAdapter({findById:id=>f.scoped.whatsAppChannelConfig.findUnique({where:{id}})});
    const delivery=new WhatsAppDeliveryService(f.scoped,sender,fence);
    const ownsLease=async()=>{
      const rows=await f.raw.$queryRaw`SELECT id FROM whatsapp_webhook_inbox WHERE id=${id}
        AND status='processing' AND lease_token=${leaseToken} AND lease_expires_at>clock_timestamp()`;
      return rows.length===1;
    };
    const execute=()=>f.as(f.owner,()=>delivery.process(claim,async()=>{generationCalls++;},ownsLease,async()=>{forwards++;}));
    await assert.rejects(execute(),/whatsapp_delivery_requires_reconciliation/);
    assert.equal(physicalRequests,1);assert.equal(injections,1);assert.equal(insertReturned,true);assert.equal(commitFailureObserved,true);
    assert.match(envelopes[0].url,/\/100001\/messages$/);assert.equal(envelopes[0].body.to,session.buyerPhone);
    assert.deepEqual(envelopes[0].body.text,{body:'Synthetic commit probe'});
    assert.deepEqual(await f.raw.$queryRaw`SELECT id FROM synthetic_request_commit_probe`,[]);
    const unknown=await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id}});
    assert.equal(unknown.state,'submission_unknown');assert.equal(unknown.providerMessageId,null);assert.equal(unknown.processingToken,leaseToken);
    assert.deepEqual(unknown.response,response);assert.equal(Object.hasOwn(unknown.response,'receipt'),false);
    await assert.rejects(execute(),/whatsapp_delivery_requires_reconciliation/);
    assert.equal(physicalRequests,1);assert.equal(injections,1);assert.equal(generationCalls,0);assert.equal(forwards,0);
    assert.deepEqual(await f.raw.whatsAppDelivery.findUniqueOrThrow({where:{id}}),unknown);
    assert.deepEqual(await f.raw.whatsAppWebhookInbox.findUniqueOrThrow({where:{id}}),inboxBefore);
    assert.deepEqual(await f.raw.whatsAppSession.findUniqueOrThrow({where:{id:session.id}}),sessionBefore);
    assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:session.id}}),0);
    assert.equal(await f.raw.supportTicket.count(),ticketCount);assert.equal(await f.raw.supportTicketMessage.count(),messageCount);
    await new Promise(setImmediate);assert.deepEqual(unhandled,[]);
    console.log(JSON.stringify({requestCommitProbe:{physicalLocalRequests:physicalRequests,deferredSqlInsertReturned:insertReturned,
      commitFailureObserved,rolledBackRows:0,durableState:unknown.state,retryRequests:0,forwards:0,unhandledRejections:0,
      actualProviderCalls:0,appModuleOverrides:false}}));
  }finally{process.off('unhandledRejection',onUnhandled);await f.close();console.log(JSON.stringify({requestCommitCleanup:{errors:0,bridge:f.db.bridgeStatus()}}));}
});
