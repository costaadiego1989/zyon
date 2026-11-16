import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma,PrismaClient} from '@prisma/client';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('T51 routing transaction ownership',{timeout:SERVICE_LOCAL_TEST_MS},async()=>{
  const f=await createAgendaDbFixture();
  const observer=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}});
  const holderClient=new PrismaClient({datasources:{db:{url:f.db.prismaUrl}}});
  const releaseRow=deferred(),releaseCheckout=deferred(),ready=deferred();
  let holder,routePending;
  try{
    const {PrismaWhatsAppSessionRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-session.repository.js');
    const {PrismaWhatsAppHandoffRepository}=await import('../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js');
    const {RouteToSessionUseCase}=await import('../dist/modules/whatsapp-channel/application/use-cases/route-to-session.use-case.js');
    const configId='routing-owned-config',deviceId='TWILIO:'+configId,buyerPhone='5511999999999';
    await f.raw.whatsAppChannelConfig.create({data:{id:configId,merchantId:f.owner.merchantId,provider:'TWILIO',enabled:true,status:'ACTIVE'}});
    await f.raw.buyerIdentity.create({data:{merchantId:f.owner.merchantId,identityKey:'phone:'+buyerPhone,globalUserId:'routing-owned-buyer'}});
    const checkout=await f.raw.checkoutSession.create({data:{merchantId:f.owner.merchantId,sessionId:'routing-original-checkout',globalUserId:'routing-owned-buyer',conversationId:'routing-original-conversation',cart:{items:[],total:0,currency:'BRL'},customer:{fullName:'Synthetic buyer'},createdAt:new Date(),updatedAt:new Date()}});
    const wa=await f.raw.whatsAppSession.create({data:{merchantId:f.owner.merchantId,deviceId,buyerPhone,checkoutSessionId:checkout.sessionId,status:'active',lastActivityAt:new Date(Date.now()-26*60*60*1000)}});
    const scope={merchantId:f.owner.merchantId,configId,whatsappSessionId:wa.id},bindings=new PrismaWhatsAppHandoffRepository(f.scoped);
    const binding=await f.as(f.owner,()=>bindings.getOrCreate(scope));
    const ticket=await f.raw.supportTicket.create({data:{id:'routing-owned-ticket',merchantId:f.owner.merchantId,sessionId:wa.id,source:'whatsapp',status:'open',buyerMessage:'Synthetic request',createdAt:new Date()}});
    const before=await f.raw.checkoutSession.count({where:{merchantId:f.owner.merchantId}});
    holder=holderClient.$transaction(async tx=>{
      // SHARE permits the buyer's SELECT but blocks the real INSERT's
      // RowExclusiveLock. CheckoutSession has no merchant FK in this schema.
      await tx.$executeRawUnsafe('LOCK TABLE checkout_sessions IN SHARE MODE');
      await tx.$executeRawUnsafe('SAVEPOINT controlled_wa_hold');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM whatsapp_sessions WHERE id=${wa.id} FOR UPDATE`);
      const[connection]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid,clock_timestamp() AS started`;
      ready.resolve(connection);
      await releaseRow.promise;
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT controlled_wa_hold');
      await releaseCheckout.promise;
    },{timeout:15_000}); // Only the fixture lock holder; productive defaults stay5s.
    const connection=await Promise.race([ready.promise,holder.then(()=>{throw new Error('fixture_holder_closed_early');})]);
    const wait=async(predicate,label)=>{const end=Date.now()+10_000;do{const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<end);assert.fail(label);};
    const blockedQuery=async pattern=>{
      const rows=await observer.$queryRaw(Prisma.sql`SELECT pid,clock_timestamp() AS observed FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'
          AND ${connection.pid}=ANY(pg_blocking_pids(pid)) AND query ILIKE ${pattern}`);
      return rows[0];
    };
    const sessions=new PrismaWhatsAppSessionRepository(f.scoped),route=new RouteToSessionUseCase(sessions,f.scoped);
    routePending=f.as(f.owner,()=>route.execute({merchantId:f.owner.merchantId,deviceId,fromNumber:buyerPhone})).then(value=>({ok:true,value}),error=>({ok:false,code:error.code,message:error.message}));
    const rowWait=await wait(()=>blockedQuery('%UPDATE%whatsapp_sessions%'),'route did not reach the real WA expiry write');
    // Spend part of the unchanged outer5s budget behind a controlled row lock,
    // giving the independently started inner5s transaction a visible tail.
    await wait(async()=>{const[value]=await observer.$queryRaw(Prisma.sql`SELECT clock_timestamp() >= ${rowWait.observed}::timestamptz + interval '2 seconds' AS ready`);return value.ready;},'controlled SQL-clock barrier not reached');
    releaseRow.resolve();
    const checkoutWait=await wait(()=>blockedQuery('%INSERT%checkout_sessions%'),'nested checkout did not reach the real checkout table lock');
    const takeover=f.as(f.owner,()=>bindings.begin(scope,ticket.id,binding.epoch));
    if(checkoutWait.pid===rowWait.pid){
      // After enlistment, an in-flight SQL statement retains the transaction's
      // identity lock until it can roll back. Prove that exact ownership, spend
      // the unchanged productive5s budget, then release only the fixture lock.
      await wait(async()=>{
        const rows=await observer.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND ${rowWait.pid}=ANY(pg_blocking_pids(pid)) AND query ILIKE '%pg_advisory_xact_lock%'`;
        return rows[0];
      },'takeover did not wait on the enlisted routing transaction');
      await wait(async()=>{const[value]=await observer.$queryRaw(Prisma.sql`SELECT clock_timestamp() >= ${rowWait.observed}::timestamptz + interval '5 seconds' AS ready`);return value.ready;},'original productive transaction deadline was not crossed');
      releaseCheckout.resolve();await holder;
    }
    const result=await takeover;
    assert.equal(result.state.mode,'waiting_human');
    assert.equal(result.state.epoch,1);
    releaseCheckout.resolve();await holder;
    const routed=await routePending;
    await wait(async()=>{
      const rows=await observer.$queryRaw(Prisma.sql`SELECT state,xact_start FROM pg_stat_activity WHERE pid=${checkoutWait.pid}`);
      return rows.length===0||rows[0].xact_start===null;
    },'checkout transaction did not settle after the table lock was released');
    const after=await f.raw.checkoutSession.count({where:{merchantId:f.owner.merchantId}});
    console.log(JSON.stringify({routingTransactionOwnership:{rowWaitPid:rowWait.pid,checkoutWaitPid:checkoutWait.pid,routeOk:routed.ok,routeCode:routed.code??null,checkoutBefore:before,checkoutAfter:after,productiveTransactionTimeoutUnchanged:5000}}));
    assert.equal(after,before,'a timed-out outer route cannot leave a detached checkout committed after takeover');
    assert.equal((await f.raw.whatsAppSession.findUnique({where:{id:wa.id}})).checkoutSessionId,checkout.sessionId);
    assert.equal((await f.raw.whatsAppHandoffBinding.findUnique({where:{id:binding.id}})).mode,'waiting_human');
  }finally{
    releaseRow.resolve();releaseCheckout.resolve();
    if(holder)await holder.catch(()=>{});
    if(routePending)await routePending;
    await holderClient.$disconnect();await observer.$disconnect();await f.close();
  }
});
