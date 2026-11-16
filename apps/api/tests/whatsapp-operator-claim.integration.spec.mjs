import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';

test('T52 authenticated WhatsApp operator claim owns exactly one canonical case',async t=>{
  const f=await createWhatsAppOperatorHttpFixture();
  try{
    const waiting=await f.makeCase(f.ownerAuth,'waiting');
    await t.test('unauthenticated or free ownership fields cannot mutate a waiting case',async()=>{
      const before=await f.snapshot(waiting);
      assert.equal((await f.request(f.path(waiting),{expectedEpoch:1})).status,401);
      for(const input of [{},{expectedEpoch:'1'},{expectedEpoch:1,operatorId:'forged'},
        {expectedEpoch:1,merchantId:f.ownerAuth.merchant_id},{expectedEpoch:1,source:'widget'}])
        assert.equal((await f.request(f.path(waiting),input,f.ownerAuth)).status,400);
      // The existing global tenant fence rejects a foreign tenant before this
      // command's strict DTO validation. Prove both rejection layers exactly.
      const foreignPayload=await f.request(f.path(waiting),{expectedEpoch:1,merchantId:f.foreignAuth.merchant_id},f.ownerAuth);
      assert.equal(foreignPayload.status,403);assert.match(JSON.stringify(foreignPayload.body),/tenant_mismatch_body/);
      assert.deepEqual(await f.snapshot(waiting),before);
    });
    await t.test('another tenant and a widget case are not claimable and do not mint bindings',async()=>{
      const before=await f.snapshot(waiting),count=await f.raw.whatsAppHandoffBinding.count();
      assert.equal((await f.request(f.path(waiting),{expectedEpoch:1},f.foreignAuth)).status,404);
      const widget=await f.makeCase(f.ownerAuth,'widget',{source:'widget'}),widgetBefore=await f.snapshot(widget);
      assert.equal((await f.request(f.path(widget),{expectedEpoch:1},f.ownerAuth)).status,404);
      assert.deepEqual(await f.snapshot(widget),widgetBefore);assert.equal(await f.raw.whatsAppHandoffBinding.count(),count);
      assert.deepEqual(await f.snapshot(waiting),before);
    });
    await t.test('two authenticated operators race to one binding ticket owner audit and durable outbox',async()=>{
      const before=await f.snapshot(waiting),operators=[f.ownerAuth,f.staffAuth];
      const results=await Promise.all(operators.map(auth=>f.request(f.path(waiting),{expectedEpoch:1},auth)));
      assert.deepEqual(results.map(result=>result.status).sort(),[201,409]);
      const winner=operators[results.findIndex(result=>result.status===201)],state=await f.snapshot(waiting);
      assert.equal(state.binding.mode,'human');assert.equal(state.binding.epoch,2);
      assert.equal(state.binding.assignedOperatorId,winner.user_id);assert.equal(state.ticket.status,'in_progress');
      assert.equal(state.ticket.assignedTo,winner.user_id);assert.equal(state.messages.length,before.messages.length+1);
      assert.deepEqual(state.messages.at(-1).metadata,{kind:'whatsapp_claim',schemaVersion:1,bindingId:state.binding.id,
        configId:waiting.scope.configId,whatsappSessionId:waiting.session.id,previousEpoch:1,epoch:2,operatorId:winner.user_id});
      assert.equal(state.events.filter(event=>event.payload.event==='claimed').length,1);
      assert.equal(state.events.length,before.events.length+2);assert.deepEqual(state.checkout,before.checkout);assert.deepEqual(state.session,before.session);
      waiting.winner=winner;
    });
    await t.test('same operator replay keeps epoch audit outbox and context unchanged; stale future still refuse',async()=>{
      const before=await f.snapshot(waiting);
      for(const expectedEpoch of [1,2]){
        const result=await f.request(f.path(waiting),{expectedEpoch},waiting.winner);assert.equal(result.status,201);
        assert.deepEqual(result.body,{bindingId:before.binding.id,...waiting.scope,ticketId:waiting.ticket.id,
          mode:'human',epoch:2,assignedOperatorId:waiting.winner.user_id,status:'in_progress',idempotent:true});
      }
      for(const expectedEpoch of [0,3,99])assert.equal((await f.request(f.path(waiting),{expectedEpoch},waiting.winner)).status,409);
      assert.deepEqual(await f.snapshot(waiting),before);
    });
    await t.test('product businesses use the same exact operator authority without touching their checkout',async()=>{
      const value=await f.makeCase(f.productAuth,'products'),before=await f.snapshot(value);
      const result=await f.request(f.path(value),{expectedEpoch:1},f.productAuth);assert.equal(result.status,201);
      const after=await f.snapshot(value);assert.equal(after.binding.mode,'human');assert.equal(after.binding.epoch,2);
      assert.equal(after.binding.assignedOperatorId,f.productAuth.user_id);assert.deepEqual(after.checkout,before.checkout);
      assert.deepEqual(after.session,before.session);
    });
    await t.test('closed merged or superseded cases cannot be revived',async()=>{
      for(const [patch,expectedStatus] of [[{status:'closed'},409],[{status:'resolved'},409],[{mergedIntoId:waiting.ticket.id},404]]){
        const value=await f.makeCase(f.ownerAuth,'unavailable-'+randomUUID());
        await f.raw.supportTicket.update({where:{id:value.ticket.id},data:patch});const before=await f.snapshot(value);
        const result=await f.request(f.path(value),{expectedEpoch:1},f.ownerAuth);assert.equal(result.status,expectedStatus);
        assert.deepEqual(await f.snapshot(value),before);
      }
    });
    await t.test('actual outbox failure rolls back binding ticket assignment audit message and first outbox',async()=>{
      const value=await f.makeCase(f.ownerAuth,'rollback'),before=await f.snapshot(value);
      await f.raw.$executeRawUnsafe("CREATE FUNCTION synthetic_reject_whatsapp_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='support.case.changed' AND NEW.payload->>'event'='claimed' THEN RAISE EXCEPTION 'synthetic_whatsapp_claim_rollback'; END IF; RETURN NEW; END $$");
      await f.raw.$executeRawUnsafe('CREATE TRIGGER synthetic_whatsapp_claim_rollback BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_whatsapp_claim()');
      try{assert.equal((await f.request(f.path(value),{expectedEpoch:1},f.ownerAuth)).status,500);assert.deepEqual(await f.snapshot(value),before);}
      finally{await f.raw.$executeRawUnsafe('DROP TRIGGER synthetic_whatsapp_claim_rollback ON outbox_messages');await f.raw.$executeRawUnsafe('DROP FUNCTION synthetic_reject_whatsapp_claim()');}
    });
    await t.test('valid scoped API key proves ordinary support access but cannot become a human operator',async()=>{
      const value=await f.makeCase(f.ownerAuth,'service-key'),before=await f.snapshot(value);
      const {ApiKeyService}=await import('../dist/modules/integrations/domain/api-key.service.js');
      const generated=new ApiKeyService().generate('test');
      await f.raw.merchantBillingSubscription.upsert({where:{merchantId:f.ownerAuth.merchant_id},
        create:{merchantId:f.ownerAuth.merchant_id,status:'active',planKey:'growth'},update:{status:'active',planKey:'growth',stripePriceId:null}});
      await f.raw.merchantApiKey.create({data:{id:randomUUID(),merchantId:f.ownerAuth.merchant_id,name:'Synthetic operator guard',
        keyHash:generated.keyHash,keyPrefix:generated.keyPrefix,scopes:['support:read','support:write'],environment:'test'}});
      const credential={access_token:generated.rawKey,merchant_id:f.ownerAuth.merchant_id};
      assert.equal((await f.request('/support/tickets',undefined,credential,'GET')).status,200);
      const rejected=await f.request(f.path(value),{expectedEpoch:1},credential);assert.equal(rejected.status,403);
      assert.match(JSON.stringify(rejected.body),/human_session_required/);assert.deepEqual(await f.snapshot(value),before);
    });
    await t.test('generic status update cannot bypass WhatsApp claim while existing widget behavior remains valid',async()=>{
      const value=await f.makeCase(f.ownerAuth,'generic-status'),before=await f.snapshot(value);
      const rejected=await f.request('/support/tickets/'+value.ticket.id,{status:'in_progress'},f.ownerAuth,'PATCH');
      assert.equal(rejected.status,409);assert.deepEqual(await f.snapshot(value),before);
      const widget=await f.makeCase(f.ownerAuth,'generic-widget',{source:'widget'}),widgetBefore=await f.snapshot(widget);
      assert.equal((await f.request('/support/tickets/'+widget.ticket.id,{status:'in_progress'},f.ownerAuth,'PATCH')).status,200);
      const after=await f.snapshot(widget);assert.equal(after.ticket.status,'in_progress');assert.equal(after.ticket.assignedTo,f.ownerAuth.user_id);
      assert.equal(after.binding,null);assert.equal(after.messages.length,1);assert.deepEqual(after.checkout,widgetBefore.checkout);assert.deepEqual(after.session,widgetBefore.session);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().repositoryOverrides,false);
    assert.equal(f.runtime.evidence().authOverrides,false);
  }finally{await f.close();}
});
