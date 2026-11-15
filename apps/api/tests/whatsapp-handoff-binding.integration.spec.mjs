import assert from 'node:assert/strict';
import test from 'node:test';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T48',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHandoffFixture();
  try{
    const first=await f.thread(f.owner,'first'),products=await f.thread(f.products,'products');
    const firstTicket=await f.ticket(first,'first'),productTicket=await f.ticket(products,'first');
    let firstBinding;
    await t.test('canonical AppModule serves health and both business modes persist exact bindings',async()=>{
      const health=await fetch(f.runtime.apiOrigin+'/health',{redirect:'error',signal:AbortSignal.timeout(10_000)});
      assert.equal(health.status,200);assert.ok((await health.json()).status);
      const ready=await fetch(f.runtime.apiOrigin+'/ready',{redirect:'error',signal:AbortSignal.timeout(10_000)});
      assert.equal(ready.status,200);assert.equal((await ready.json()).status,'ready');
      assert.equal(f.runtime.evidence().canonicalAppModule,true);assert.equal(f.runtime.evidence().repositoryOverrides,false);
      firstBinding=await f.as(f.owner,()=>f.repo.getOrCreate(first.scope));
      assert.deepEqual(firstBinding,{...first.scope,id:firstBinding.id,mode:'ai',epoch:0,ticketId:null,assignedOperatorId:null});
      const productBinding=await f.as(f.products,()=>f.repo.getOrCreate(products.scope));
      assert.equal(productBinding.mode,'ai');assert.equal(productBinding.epoch,0);
      assert.equal((await f.raw.whatsAppHandoffBinding.findUnique({where:{id:firstBinding.id}})).conversationId,first.session.conversationState.conversationId);
    });
    await t.test('duplicate concurrent intake has one epoch and one ticket; reopening the repository preserves it',async()=>{
      const results=await f.as(f.owner,()=>Promise.all([f.repo.begin(first.scope,firstTicket.id,0),f.repo.begin(first.scope,firstTicket.id,0)]));
      assert.equal(results.filter(value=>value.changed).length,1);assert.equal(results.filter(value=>!value.changed).length,1);
      const restarted=new f.PrismaWhatsAppHandoffRepository(f.scoped);
      const state=await f.as(f.owner,()=>restarted.get(first.scope));
      assert.deepEqual(state,{...firstBinding,mode:'waiting_human',epoch:1,ticketId:firstTicket.id});
      assert.equal((await f.raw.whatsAppSession.findUnique({where:{id:first.session.id}})).status,'active');
      assert.equal(await f.raw.whatsAppHandoffBinding.count({where:{whatsappSessionId:first.session.id}}),1);
      await f.as(f.products,()=>f.repo.begin(products.scope,productTicket.id,0));
    });
    await t.test('foreign configuration, tenant, session and widget/other-thread tickets cannot alter or partially create a binding',async()=>{
      const other=await f.thread(f.owner,'other-thread'),otherTicket=await f.ticket(other,'other');
      const widget=await f.ticket(other,'widget',{source:'widget'});
      const before=await f.raw.whatsAppHandoffBinding.findMany({orderBy:{id:'asc'}});
      for(const scope of [{...first.scope,configId:products.scope.configId},{...first.scope,whatsappSessionId:products.session.id},{...first.scope,merchantId:products.actor.merchantId}]){
        await assert.rejects(f.as(f.owner,()=>f.repo.getOrCreate(scope)),/whatsapp_handoff/);
      }
      for(const wrongTicket of [firstTicket,productTicket,widget])await assert.rejects(f.as(f.owner,()=>f.repo.begin(other.scope,wrongTicket.id,0)),/whatsapp_handoff_ticket_not_found/);
      assert.deepEqual(await f.raw.whatsAppHandoffBinding.findMany({orderBy:{id:'asc'}}),before);
      assert.equal(await f.as(f.products,()=>f.repo.get(first.scope)),null);
      assert.equal((await f.as(f.owner,()=>f.repo.begin(other.scope,otherTicket.id,0))).state.ticketId,otherTicket.id);
    });
    await t.test('stale CAS and a later transactional failure preserve binding and commerce',async()=>{
      const value=await f.thread(f.owner,'rollback'),ticket=await f.ticket(value,'rollback');
      const state=await f.as(f.owner,()=>f.repo.getOrCreate(value.scope));
      const checkout=await f.raw.checkoutSession.findFirst({where:{merchantId:f.owner.merchantId,sessionId:value.session.checkoutSessionId}});
      await assert.rejects(f.as(f.owner,()=>f.repo.begin(value.scope,ticket.id,99)),/handoff_epoch_conflict/);
      await assert.rejects(f.as(f.owner,()=>f.repo.withLocked(value.scope,async(tx,current)=>{
        await f.repo.beginWithin(tx,value.scope,current,ticket.id,0);
        throw new Error('synthetic_outbox_write_failed');
      })),/synthetic_outbox_write_failed/);
      assert.deepEqual(await f.as(f.owner,()=>f.repo.get(value.scope)),state);
      assert.deepEqual(await f.raw.checkoutSession.findFirst({where:{merchantId:f.owner.merchantId,sessionId:value.session.checkoutSessionId}}),checkout);
    });
    await t.test('next inbound after 24h or expired lifecycle retains human checkout and all context',async()=>{
      for(const value of [first,products]){
        const checkoutCount=await f.raw.checkoutSession.count({where:{merchantId:value.actor.merchantId}});
        await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{status:'expired',lastActivityAt:new Date(Date.now()-25*3600_000)}});
        const result=await f.as(value.actor,()=>f.route.execute(value.routeInput));
        assert.equal(result.isNew,false);assert.equal(result.whatsappSession.id,value.session.id);assert.equal(result.checkoutSessionId,value.session.checkoutSessionId);
        assert.equal(result.whatsappSession.status,'active');assert.deepEqual(result.whatsappSession.currentOptions,['Existing option']);
        assert.equal(result.whatsappSession.currentPage,2);assert.deepEqual(result.whatsappSession.conversationState,value.session.conversationState);
        assert.deepEqual(result.whatsappSession.postSaleContext,value.session.postSaleContext);
        assert.equal(await f.raw.checkoutSession.count({where:{merchantId:value.actor.merchantId}}),checkoutCount);
        assert.equal((await f.as(value.actor,()=>f.repo.get(value.scope))).epoch,1);
      }
    });
    await t.test('a controlled takeover holding the routing lock wins before renewal without an orphan checkout',async()=>{
      const value=await f.thread(f.owner,'race'),ticket=await f.ticket(value,'race');
      await f.as(f.owner,()=>f.repo.getOrCreate(value.scope));
      await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{lastActivityAt:new Date(Date.now()-25*3600_000)}});
      const count=await f.raw.checkoutSession.count({where:{merchantId:f.owner.merchantId}});
      let heldResolve,release;const held=new Promise(resolve=>heldResolve=resolve),released=new Promise(resolve=>release=resolve);
      const taking=f.as(f.owner,()=>f.scoped.$transaction(async tx=>{
        const current=await f.repo.loadLocked(tx,value.scope);await f.repo.beginWithin(tx,value.scope,current,ticket.id,0);
        heldResolve();await released;
      }));taking.catch(()=>{});
      await held;
      const routing=f.as(f.owner,()=>f.route.execute(value.routeInput));routing.catch(()=>{});
      try{
        const deadline=Date.now()+2500;let waiting=false;
        do{const rows=await f.raw.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`;waiting=rows.length>0;}while(!waiting&&Date.now()<deadline);
        assert.equal(waiting,true,'real routing must wait for the handoff advisory lock');
      }finally{release();}
      await taking;const result=await routing;
      assert.equal(result.isNew,false);assert.equal(result.checkoutSessionId,value.session.checkoutSessionId);
      assert.deepEqual(result.whatsappSession.conversationState,value.session.conversationState);
      assert.equal(await f.raw.checkoutSession.count({where:{merchantId:f.owner.merchantId}}),count);
      assert.equal((await f.as(f.owner,()=>f.repo.get(value.scope))).mode,'waiting_human');
    });
    await t.test('ordinary AI expiry still creates the expected new checkout and invalidates the old epoch',async()=>{
      const value=await f.thread(f.products,'ai-expiry');await f.as(f.products,()=>f.repo.getOrCreate(value.scope));
      const original=await f.raw.checkoutSession.findFirst({where:{merchantId:f.products.merchantId,sessionId:value.session.checkoutSessionId}});
      const count=await f.raw.checkoutSession.count({where:{merchantId:f.products.merchantId}});
      await f.raw.whatsAppSession.update({where:{id:value.session.id},data:{lastActivityAt:new Date(Date.now()-25*3600_000)}});
      const result=await f.as(f.products,()=>f.route.execute(value.routeInput));
      assert.equal(result.isNew,true);assert.notEqual(result.checkoutSessionId,value.session.checkoutSessionId);assert.equal(result.whatsappSession.id,value.session.id);
      assert.equal(await f.raw.checkoutSession.count({where:{merchantId:f.products.merchantId}}),count+1);
      assert.deepEqual(await f.raw.checkoutSession.findUnique({where:{id:original.id}}),original);
      const binding=await f.as(f.products,()=>f.repo.get(value.scope));assert.equal(binding.mode,'ai');assert.equal(binding.epoch,1);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close();}
});
