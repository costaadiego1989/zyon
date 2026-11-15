import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T23',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const {getProfessionalAvailability}=await import('../dist/modules/catalog/application/get-professional-availability.js');
    const query={...f.selection,fromDate:'2030-01-02',toDate:'2030-01-03',now:new Date('2030-01-01T00:00:00Z')};
    const read=input=>f.as(f.owner,()=>f.scoped.$transaction(tx=>getProfessionalAvailability(tx,input),{isolationLevel:'RepeatableRead'}));
    for(const professionalId of [f.professional.id,f.parallel.id])await f.raw.professionalAvailability.create({data:{merchantId:f.owner.merchantId,professionalId,weekday:3,startMinute:600,endMinute:720,timeZone:'UTC'}});
    await t.test('duration-only canonical offers expose dates and date-specific slots from professional capacity',async()=>{
      const actual=await read(query);assert.equal(actual.status,'ready');assert.deepEqual(actual.dates,['2030-01-02']);assert.deepEqual(actual.slots.map(slot=>slot.startTime),['10:00','10:30','11:00','11:30']);assert.equal(actual.durationMinutes,30);assert.equal(actual.policyVersion,1);assert.equal(actual.professionalVersion,1);
      assert.deepEqual((await f.raw.product.findUnique({where:{id:f.selection.productId}})).metadata.serviceSchedule.slots,[]);
      const selected=await read({...query,fromDate:'2030-01-03',toDate:'2030-01-03'});assert.equal(selected.status,'empty');assert.deepEqual(selected.slots,[]);
    });
    await t.test('another service occupies the same professional while a parallel professional remains available',async()=>{
      const before=await read(query);
      await f.raw.serviceAppointment.create({data:f.appointmentData(f.professional.id,'2030-01-02T10:00:00Z','2030-01-02T10:20:00Z',{productId:f.owner.merchantId+'-other-service',variantId:f.owner.merchantId+'-other-service-variant',durationMinutes:20})});
      const actual=await read(query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),['10:30','11:00','11:30']);assert.deepEqual(actual.slots[0],before.slots[1]);
      const otherOffer=await read({...query,productId:f.owner.merchantId+'-other-service',variantId:f.owner.merchantId+'-other-service-variant'});assert.deepEqual(otherOffer.slots.map(slot=>slot.startTime),['10:20','10:40','11:00','11:20','11:40']);
      assert.equal((await read({...query,professionalId:f.parallel.id})).slots.length,4);
      await f.raw.serviceAppointment.create({data:f.appointmentData(f.professional.id,'2030-01-02T11:00:00Z','2030-01-02T11:30:00Z',{operationalStatus:'pending'})});assert.ok((await read(query)).slots.some(slot=>slot.startTime==='11:00'));
    });
    await t.test('one-offs union without duplicate slots and blocks subtract only the selected resource',async()=>{
      await f.raw.availabilityException.createMany({data:[{merchantId:f.owner.merchantId,professionalId:f.professional.id,kind:'one_off',startsAt:new Date('2030-01-02T11:30:00Z'),endsAt:new Date('2030-01-02T12:30:00Z'),timeZone:'UTC',actorId:f.owner.userId},{merchantId:f.owner.merchantId,professionalId:f.professional.id,kind:'block',startsAt:new Date('2030-01-02T11:00:00Z'),endsAt:new Date('2030-01-02T11:30:00Z'),timeZone:'UTC',actorId:f.owner.userId,reason:'Private canary never returned'}]});
      const actual=await read(query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),['10:30','11:30','12:00']);assert.equal(new Set(actual.slots.map(slot=>slot.startsAt)).size,actual.slots.length);assert.doesNotMatch(JSON.stringify(actual),/Private canary/);assert.equal((await read({...query,professionalId:f.parallel.id})).slots.length,4);
    });
    await t.test('stored rule zones and original fifty-minute day anchors agree across isolated and multi-date reads',async()=>{
      const mixed=await f.raw.professionalAvailability.create({data:{merchantId:f.owner.merchantId,professionalId:f.professional.id,weekday:1,startMinute:1380,endMinute:1440,timeZone:'America/Sao_Paulo'}});
      const selected={...query,fromDate:'2030-01-08',toDate:'2030-01-08'},day=await read(selected),window=await read({...selected,fromDate:'2030-01-07'});assert.deepEqual(day.slots.map(slot=>slot.startTime),['02:00','02:30']);assert.deepEqual(day.slots,window.slots.filter(slot=>slot.date==='2030-01-08'));
      await f.raw.professionalAvailability.update({where:{id:mixed.id},data:{validFrom:new Date('2030-01-08T02:05:00Z')}});assert.deepEqual((await read(selected)).slots.map(slot=>slot.startTime),['02:30']);
      const offer=await f.raw.product.create({data:{merchantId:f.owner.merchantId,name:'Synthetic fifty-minute boundary service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:50,slots:[]}},variants:{create:{sku:'fifty-minute-source-boundary',price:{create:{basePriceInCents:1000,currency:'BRL'}}}}},include:{variants:true}});
      const professional=await f.raw.serviceProfessional.create({data:{merchantId:f.owner.merchantId,publicName:'Synthetic source-boundary professional',timeZone:'UTC',isPublished:true}});
      await f.raw.professionalService.create({data:{merchantId:f.owner.merchantId,professionalId:professional.id,productId:offer.id}});await f.raw.professionalAvailability.createMany({data:[3,4,5].map(weekday=>({merchantId:f.owner.merchantId,professionalId:professional.id,weekday,startMinute:0,endMinute:1440,timeZone:'UTC'}))});
      const fifty={merchantId:f.owner.merchantId,professionalId:professional.id,productId:offer.id,variantId:offer.variants[0].id,fromDate:'2030-01-03',toDate:'2030-01-03',now:query.now};
      const isolated=await read(fifty),surrounding=await read({...fifty,fromDate:'2030-01-02',toDate:'2030-01-04'});assert.equal(isolated.slots.length,29);assert.equal(isolated.slots[0].startTime,'00:00');assert.equal(isolated.slots.at(-1).startTime,'23:20');assert.deepEqual(isolated.slots,surrounding.slots.filter(slot=>slot.date==='2030-01-03'));
    });
    await t.test('the full valid thirty-one-day window returns bounded complete capacity inside the ordinary transaction deadline',async()=>{
      const offer=await f.raw.product.create({data:{merchantId:f.owner.merchantId,name:'Synthetic bounded five-minute capacity',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:5,slots:[]}},variants:{create:{sku:'bounded-capacity-five-minute',price:{create:{basePriceInCents:1000,currency:'BRL'}}}}},include:{variants:true}});
      const professional=await f.raw.serviceProfessional.create({data:{merchantId:f.owner.merchantId,publicName:'Synthetic bounded window professional',timeZone:'UTC',isPublished:true}});
      await f.raw.professionalService.create({data:{merchantId:f.owner.merchantId,professionalId:professional.id,productId:offer.id}});
      await f.raw.professionalAvailability.createMany({data:Array.from({length:7},(_,weekday)=>({merchantId:f.owner.merchantId,professionalId:professional.id,weekday,startMinute:0,endMinute:1440,timeZone:'UTC'}))});
      const actual=await read({merchantId:f.owner.merchantId,professionalId:professional.id,productId:offer.id,variantId:offer.variants[0].id,fromDate:'2030-01-02',toDate:'2030-02-01',now:new Date('2029-12-31T00:00:00Z')});
      assert.equal(actual.status,'ready');assert.equal(actual.dates.length,31);assert.equal(actual.slots.length,8928);assert.equal(new Set(actual.slots.map(slot=>slot.startsAt)).size,8928);assert.equal(actual.slots[0].startsAt,'2030-01-02T00:00:00.000Z');assert.equal(actual.slots.at(-1).endsAt,'2030-02-02T00:00:00.000Z');
    });
    await t.test('empty stale invalid foreign and database failure remain distinct results',async()=>{
      const stale=await read({...query,expectedVersion:2});assert.equal(stale.status,'stale');assert.deepEqual(stale.slots,[]);
      await assert.rejects(read({...query,professionalId:f.foreignProfessional.id}),/not_found/);await assert.rejects(read({...query,toDate:'2030-03-01'}),/window/);
      await f.db.sql('ALTER TABLE professional_availability RENAME TO synthetic_unavailable_grid');
      try{await assert.rejects(read(query),error=>error.code==='P2021');}finally{await f.db.sql('ALTER TABLE synthetic_unavailable_grid RENAME TO professional_availability');}
      assert.equal((await read(query)).status,'ready');
    });
  }finally{await f.close();}
});
