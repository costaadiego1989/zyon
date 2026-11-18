import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {createOperatorDeliveryDbFixture} from './whatsapp-operator-delivery-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('T58 ticket, binding and history share a real concurrent SQL snapshot',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createOperatorDeliveryDbFixture();let readRaw;
  try{
    const [{ReadWhatsAppConversationsUseCase},{CloseWhatsAppConversationUseCase},{TenantContextService},{registerTenantMiddleware}]=await Promise.all([
      import('../dist/modules/support/application/read-whatsapp-conversations.use-case.js'),
      import('../dist/modules/support/application/close-whatsapp-conversation.use-case.js'),
      import('../dist/shared/tenant/tenant-context.service.js'),import('../dist/shared/persistence/tenant.middleware.js'),
    ]);
    readRaw=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}});
    const contexts=new TenantContextService();let gate;
    // Real installed Prisma query-extension ABI. Await query(args) first;
    // preserve identical args/result and pause only after actual ticket SQL.
    const observe=async({args,query})=>{
      const supplied=structuredClone(args),result=await query(args);assert.deepEqual(args,supplied);
      if(gate?.armed){gate.armed=false;gate.reached.resolve();await gate.release.promise;}
      return result;
    };
    const observed=readRaw.$extends({query:{supportTicket:{findFirst:observe,findMany:observe}}});
    const reader=new ReadWhatsAppConversationsUseCase(registerTenantMiddleware(observed,contexts));
    const close=new CloseWhatsAppConversationUseCase(f.scoped,f.bindings);
    for(const selection of ['list','detail'])await t.test(selection+' stays old while canonical close commits, then becomes new',async()=>{
      const value=await f.make();gate={armed:true,reached:deferred(),release:deferred()};
      const read=()=>contexts.run(value.actor,()=>selection==='list'?reader.list(value.principal,{}) :reader.detail(value.principal,value.ticket.id,{}));
      const pending=read();void pending.catch(()=>{});
      try{
        await Promise.race([gate.reached.promise,pending.then(()=>{throw new Error('snapshot_finished_before_real_ticket_query');})]);
        await f.as(value.actor,()=>close.execute(value.principal,value.ticket.id,{expectedEpoch:2}));
        const stored=await f.preserved(value);assert.equal(stored.ticket.status,'closed');assert.equal(stored.binding.mode,'ai');assert.equal(stored.binding.epoch,3);
        gate.release.resolve();const old=await pending;
        const oldTicket=selection==='list'?old.data.find(row=>row.id===value.ticket.id):old.ticket;
        const oldBinding=selection==='list'?oldTicket.binding:old.binding;
        assert.equal(oldTicket.status,'in_progress');assert.equal(oldBinding.mode,'human');assert.equal(oldBinding.epoch,2);
        if(selection==='detail')assert.equal(old.messages.filter(message=>message.senderType==='system').length,1);
        const current=await read(),newTicket=selection==='list'?current.data.find(row=>row.id===value.ticket.id):current.ticket;
        const newBinding=selection==='list'?newTicket.binding:current.binding;
        assert.equal(newTicket.status,'closed');assert.equal(newBinding.mode,'ai');assert.equal(newBinding.epoch,3);
        if(selection==='detail')assert.equal(current.messages.filter(message=>message.senderType==='system').length,2);
      }finally{gate.release.resolve();await pending;gate=undefined;}
    });
  }finally{if(readRaw)await readRaw.$disconnect();await f.close();}
});
