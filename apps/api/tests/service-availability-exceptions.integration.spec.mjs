import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T22',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const {SaveAvailabilityExceptionUseCase,saveAvailabilityException}=await import('../dist/modules/catalog/application/save-availability-exception.use-case.js');
    const {lockServiceProfessional}=await import('../dist/shared/bookings/service-professional-lock.js');
    const {lockCatalogMerchant}=await import('../dist/shared/persistence/catalog-stock-ledger.js');
    const observeLockWait=async(holderPid,table)=>{
      assert.ok(Number.isInteger(holderPid));assert.ok(['merchants','service_professionals'].includes(table));
      const deadline=Date.now()+2000;let waiting=false;
      do{waiting=Number(await f.db.sql("SELECT count(*) FROM pg_stat_activity WHERE "+holderPid+"=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND position('"+table+"' in query)>0 AND position('FOR UPDATE' in upper(query))>0;"))>0;}while(!waiting&&Date.now()<deadline);
      assert.equal(waiting,true,'PostgreSQL must observe the canonical '+table+' row lock wait behind the exact holder');
    };
    const events=[],command=new SaveAvailabilityExceptionUseCase(f.scoped,{publish:async event=>events.push(event)});
    const input=(kind,start,end)=>({kind,startsAt:'2030-01-02T'+start+':00Z',endsAt:'2030-01-02T'+end+':00Z',timeZone:'America/Sao_Paulo',reason:'Private synthetic reason'});
    const foreignException=await f.raw.availabilityException.create({data:{id:'foreign-exception',merchantId:f.foreign.merchantId,professionalId:f.foreignProfessional.id,kind:'block',startsAt:new Date('2030-01-02T13:00:00Z'),endsAt:new Date('2030-01-02T14:00:00Z'),timeZone:'UTC',actorId:f.foreign.userId,reason:'Private foreign canary'}});
    let version=1;
    await t.test('one-off block and adjacent times use the same resource without rewriting history',async()=>{
      const one=await f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,input('one_off','10:00','11:00')));version=one.version;
      assert.equal(one.exception.kind,'one_off');assert.equal(one.exception.actorId,f.owner.userId);assert.equal(one.exception.reason,'Private synthetic reason');
      const block=await f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,input('block','10:30','11:00')));version=block.version;assert.equal(block.exception.kind,'block');
      const before=await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id}});
      await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,input('one_off','10:45','11:15'))),/block_conflict/);assert.deepEqual(await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id}}),before);
      const appointment=await f.raw.serviceAppointment.create({data:f.appointmentData(f.professional.id,'2030-01-02T11:00:00Z','2030-01-02T11:30:00Z')});
      for(const kind of ['block','one_off'])await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,input(kind,'11:15','11:45'))),/appointment_conflict/);
      const adjacent=await f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,input('one_off','11:30','12:00')));version=adjacent.version;assert.equal(adjacent.exception.startsAt.toISOString(),appointment.endsAt.toISOString());
      assert.deepEqual(await f.raw.serviceAppointment.findUnique({where:{id:appointment.id}}),appointment);assert.ok(events.every(event=>Object.keys(event.payload).sort().join(',')==='professionalId,version'));
    });
    await t.test('minute admission rejects new precise times while withdrawal retains the exact historical interval',async()=>{
      const before=await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id}}),eventCount=events.length;
      for(const kind of ['one_off','block'])for(const suffix of ['01Z','00.001Z'])await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{kind,startsAt:'2030-01-02T13:00:'+suffix,endsAt:'2030-01-02T14:00:'+suffix,timeZone:'UTC'})),/availability_minute_precision_required/);
      await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{kind:'one_off',startsAt:'2030-01-02T13:00:30.123Z',endsAt:'2030-01-02T14:00:30.123Z',timeZone:'UTC',isActive:false})),/availability_minute_precision_required/);
      assert.deepEqual(await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id}}),before);assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:f.professional.id}})).version,version);assert.equal(events.length,eventCount);
      const legacy=await f.raw.availabilityException.create({data:{merchantId:f.owner.merchantId,professionalId:f.professional.id,kind:'one_off',startsAt:new Date('2030-01-02T14:00:30.123Z'),endsAt:new Date('2030-01-02T14:30:30.123Z'),timeZone:'UTC',actorId:f.owner.userId,reason:'Private historical reason'}});
      const result=await f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{id:legacy.id,kind:legacy.kind,startsAt:legacy.startsAt.toISOString(),endsAt:legacy.endsAt.toISOString(),timeZone:legacy.timeZone,reason:legacy.reason,isActive:false}));version=result.version;
      assert.equal(result.exception.id,legacy.id);assert.equal(result.exception.startsAt.toISOString(),legacy.startsAt.toISOString());assert.equal(result.exception.endsAt.toISOString(),legacy.endsAt.toISOString());assert.equal(result.exception.isActive,false);assert.equal(result.exception.reason,legacy.reason);assert.deepEqual(Object.keys(events.at(-1).payload).sort(),['professionalId','version']);
    });
    await t.test('withdrawal after an actual profile timezone edit retains every historical interval field and appointment snapshot',async()=>{
      const {PrismaServiceProfessionalRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-service-professional.repository.js');
      const repository=new PrismaServiceProfessionalRepository(f.scoped);
      const professional=await f.raw.serviceProfessional.create({data:{merchantId:f.owner.merchantId,publicName:'Historical zone professional',timeZone:'UTC'}});
      await f.raw.professionalService.create({data:{merchantId:f.owner.merchantId,professionalId:professional.id,productId:f.selection.productId}});
      const historical=await f.raw.availabilityException.create({data:{merchantId:f.owner.merchantId,professionalId:professional.id,kind:'block',startsAt:new Date('2030-01-02T17:00:30.123Z'),endsAt:new Date('2030-01-02T17:30:30.123Z'),timeZone:'UTC',actorId:f.owner.userId,reason:'Historical private timezone canary'}});
      const appointment=await f.raw.serviceAppointment.create({data:f.appointmentData(professional.id,'2030-01-02T18:00:30.123Z','2030-01-02T18:30:30.123Z')});
      const edited=await f.as(f.owner,()=>repository.update(f.owner,professional.id,professional.version,{timeZone:'America/Sao_Paulo',isActive:false}));assert.equal(edited.timeZone,'America/Sao_Paulo');
      const withdrawn=await f.as(f.owner,()=>command.execute(f.owner,professional.id,edited.version,{id:historical.id,kind:'one_off',startsAt:'2030-01-02T19:00:30.123Z',endsAt:'2030-01-02T19:30:30.123Z',timeZone:historical.timeZone,reason:'Replacement must not overwrite history',isActive:false}));
      const {updatedAt:actualUpdatedAt,...actual}=withdrawn.exception,{updatedAt:historicalUpdatedAt,...expected}=historical;
      assert.deepEqual(actual,{...expected,isActive:false,version:historical.version+1,actorId:f.owner.userId});assert.equal(withdrawn.version,edited.version+1);
      assert.deepEqual(await f.raw.serviceAppointment.findUnique({where:{id:appointment.id}}),appointment);
      assert.deepEqual(await f.raw.availabilityException.findUnique({where:{id:historical.id}}),withdrawn.exception);
      const reactivated=await f.as(f.owner,()=>repository.update(f.owner,professional.id,withdrawn.version,{isActive:true}));
      await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,professional.id,reactivated.version,{id:historical.id,kind:'block',startsAt:'2030-01-02T17:00:00Z',endsAt:'2030-01-02T17:30:00Z',timeZone:'UTC',isActive:true})),/new_service_timezone_must_be_brasilia/);
      assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:professional.id}})).version,reactivated.version);
      assert.deepEqual(await f.raw.availabilityException.findUnique({where:{id:historical.id}}),withdrawn.exception);
    });
    await t.test('foreign stale timezone and invalid writes leave version and exceptions unchanged',async()=>{
      const before=await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id}});
      await assert.rejects(f.as(f.foreign,()=>command.execute(f.foreign,f.professional.id,version,input('block','13:00','14:00'))),/not_found/);
      await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,1,input('block','13:00','14:00'))),/stale/);
      await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{...input('block','13:00','14:00'),timeZone:'UTC'})),/new_service_timezone_must_be_brasilia/);
      await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{...input('block','13:00','14:00'),id:'foreign-exception'})),/not_found/);
      assert.deepEqual(await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id}}),before);assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:f.professional.id}})).version,version);
      assert.deepEqual(await f.raw.availabilityException.findUnique({where:{id:foreignException.id}}),foreignException);
    });
    await t.test('later transaction failure rolls back the composed one-off and professional version together',async()=>{
      const before=await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id},orderBy:{id:'asc'}}),eventCount=events.length;
      await assert.rejects(f.as(f.owner,()=>f.scoped.$transaction(async tx=>{
        const result=await saveAvailabilityException(tx,f.owner,f.professional.id,version,input('one_off','13:00','14:00'));
        assert.equal(result.version,version+1);assert.equal(result.exception.professionalId,f.professional.id);assert.equal(result.exception.merchantId,f.owner.merchantId);assert.equal(result.exception.kind,'one_off');
        throw new Error('synthetic_after_exception_failure');
      })),/synthetic_after_exception_failure/);
      assert.deepEqual(await f.raw.availabilityException.findMany({where:{professionalId:f.professional.id},orderBy:{id:'asc'}}),before);
      assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:f.professional.id}})).version,version);assert.equal(events.length,eventCount);
    });
    await t.test('the exception command waits for the exact canonical professional resource lock',async()=>{
      const eventCount=events.length;
      let release,locked,rejectReady,holderPid;const ready=new Promise((resolve,reject)=>{locked=resolve;rejectReady=reject;}),allowCommit=new Promise(resolve=>release=resolve);
      const holder=f.raw.$transaction(async tx=>{await lockServiceProfessional(tx,f.owner.merchantId,f.professional.id);[{pid:holderPid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');locked();await allowCommit;});
      void holder.catch(rejectReady);let blocking,settled=false;
      try{
        await ready;blocking=f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,input('block','16:00','16:30')));blocking.then(()=>{settled=true;},()=>{settled=true;});
        await observeLockWait(holderPid,'service_professionals');assert.equal(settled,false,'exception must wait for the professional resource lock');
      }finally{release();await Promise.allSettled([holder,...(blocking?[blocking]:[])]);}
      await holder;const result=await blocking;version=result.version;assert.equal(result.exception.kind,'block');assert.equal(result.exception.startsAt.toISOString(),'2030-01-02T16:00:00.000Z');assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:f.professional.id}})).version,version);assert.deepEqual(await f.raw.availabilityException.findUnique({where:{id:result.exception.id}}),result.exception);assert.equal(events.length,eventCount+1);assert.deepEqual(events.at(-1).payload,{professionalId:f.professional.id,version});
    });
    await t.test('a concurrent confirmed appointment uses merchant then professional locks before a block can decide',async()=>{
      let release,locked,rejectReady;const ready=new Promise((resolve,reject)=>{locked=resolve;rejectReady=reject;}),allowCommit=new Promise(resolve=>release=resolve);
      let holderPid;const confirmation=f.raw.$transaction(async tx=>{await lockCatalogMerchant(tx,f.owner.merchantId);await lockServiceProfessional(tx,f.owner.merchantId,f.parallel.id);[{pid:holderPid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');await tx.serviceAppointment.create({data:f.appointmentData(f.parallel.id,'2030-01-02T15:00:00Z','2030-01-02T15:30:00Z')});locked();await allowCommit;});
      void confirmation.catch(rejectReady);let blocking,settled=false;
      try{
        await ready;blocking=f.as(f.owner,()=>command.execute(f.owner,f.parallel.id,1,input('block','15:15','15:45')));blocking.then(()=>{settled=true;},()=>{settled=true;});
        await observeLockWait(holderPid,'merchants');assert.equal(settled,false,'exception must wait for the canonical merchant-before-professional command');
      }finally{release();await Promise.allSettled([confirmation,...(blocking?[blocking]:[])]);}
      await confirmation;await assert.rejects(blocking,/appointment_conflict/);assert.equal(await f.raw.availabilityException.count({where:{professionalId:f.parallel.id}}),0);assert.equal(await f.raw.serviceAppointment.count({where:{professionalId:f.parallel.id,operationalStatus:'scheduled'}}),1);
    });
  }finally{await f.close();}
});
