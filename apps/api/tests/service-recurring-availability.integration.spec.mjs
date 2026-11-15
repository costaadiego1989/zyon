import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T21',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const {SaveProfessionalAvailabilityUseCase}=await import('../dist/modules/catalog/application/save-professional-availability.use-case.js');
    const events=[],command=new SaveProfessionalAvailabilityUseCase(f.scoped,{publish:async event=>{const pro=await f.raw.serviceProfessional.findUnique({where:{id:event.payload.professionalId}});assert.equal(pro.version,event.payload.version);events.push(event);}});
    const grid={timeZone:'America/Sao_Paulo',rows:[{weekday:3,startMinute:600,endMinute:720,validFrom:'2030-01-01T00:00:00Z',validUntil:'2031-01-01T00:00:00Z'}]};
    let version=1,preciseHistory;
    await t.test('save replace and timezone changes preserve inactive rows and appointment snapshots',async()=>{
      const appointment=await f.raw.serviceAppointment.create({data:f.appointmentData(f.professional.id,'2030-01-02T15:00:00Z','2030-01-02T15:30:00Z')});
      const first=await f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,grid));version=first.version;
      assert.equal(version,2);assert.equal(first.rows.length,1);assert.equal(first.rows[0].weekday,3);assert.equal(first.rows[0].startMinute,600);assert.equal(first.rows[0].timeZone,grid.timeZone);assert.equal(first.rows[0].validUntil.toISOString(),'2031-01-01T00:00:00.000Z');
      const second=await f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{timeZone:'UTC',rows:[{weekday:3,startMinute:540,endMinute:600}]}));version=second.version;
      assert.equal(version,3);assert.equal(second.rows[0].startMinute,540);assert.equal(second.rows[0].timeZone,'UTC');
      const history=await f.raw.professionalAvailability.findUnique({where:{id:first.rows[0].id}});assert.equal(history.isActive,false);assert.equal(history.timeZone,grid.timeZone);assert.equal(history.startMinute,600);
      assert.deepEqual(await f.raw.serviceAppointment.findUnique({where:{id:appointment.id}}),appointment);
      assert.deepEqual(events.map(event=>event.payload),[{professionalId:f.professional.id,version:2},{professionalId:f.professional.id,version:3}]);assert.ok(events.every(event=>event.eventType==='service.availability.changed'&&event.merchantId===f.owner.merchantId));
    });
    await t.test('stale invalid foreign staff and products writes preserve the stored grid',async()=>{
      const before=await f.raw.professionalAvailability.findMany({where:{professionalId:f.professional.id}});
      for(const [actor,id,expected,payload,reason]of [[f.owner,f.professional.id,1,grid,/stale/],[f.owner,f.professional.id,version,{...grid,rows:[{weekday:3,startMinute:600,endMinute:600}]},/recurring_interval/],[f.foreign,f.professional.id,version,grid,/not_found/],[{...f.owner,role:'staff'},f.professional.id,version,grid,/operator_required/],[f.products,f.professional.id,version,grid,/services_mode/]])await assert.rejects(f.as(actor,()=>command.execute(actor,id,expected,payload)),reason);
      assert.deepEqual(await f.raw.professionalAvailability.findMany({where:{professionalId:f.professional.id}}),before);assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:f.professional.id}})).version,version);
    });
    await t.test('new grid precision refusals and a later successful replacement preserve a precise historical appointment',async()=>{
      preciseHistory=await f.raw.serviceAppointment.create({data:f.appointmentData(f.professional.id,'2030-01-02T15:40:30.123Z','2030-01-02T16:10:30.123Z')});
      const before=await f.raw.professionalAvailability.findMany({where:{professionalId:f.professional.id}}),eventCount=events.length;
      for(const field of ['validFrom','validUntil'])for(const instant of ['2030-01-01T00:00:01Z','2030-01-01T00:00:00.001Z'])await assert.rejects(f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{timeZone:'UTC',rows:[{weekday:3,startMinute:600,endMinute:720,[field]:instant}]})),/availability_minute_precision_required/);
      assert.deepEqual(await f.raw.professionalAvailability.findMany({where:{professionalId:f.professional.id}}),before);assert.equal((await f.raw.serviceProfessional.findUnique({where:{id:f.professional.id}})).version,version);assert.equal(events.length,eventCount);assert.deepEqual(await f.raw.serviceAppointment.findUnique({where:{id:preciseHistory.id}}),preciseHistory);
    });
    await t.test('concurrent same-version replacements produce one coherent winner and one event',async()=>{
      const before=events.length,results=await Promise.allSettled([600,720].map(startMinute=>f.as(f.owner,()=>command.execute(f.owner,f.professional.id,version,{timeZone:'UTC',rows:[{weekday:3,startMinute,endMinute:startMinute+60}]}))));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/stale/);assert.equal(events.length,before+1);
      const winner=results.find(r=>r.status==='fulfilled').value,active=await f.raw.professionalAvailability.findMany({where:{professionalId:f.professional.id,isActive:true}});assert.equal(active.length,1);assert.equal(active[0].startMinute,winner.rows[0].startMinute);assert.equal(active[0].version,version+1);assert.deepEqual(await f.raw.serviceAppointment.findUnique({where:{id:preciseHistory.id}}),preciseHistory);
    });
  }finally{await f.close();}
});
