import assert from 'node:assert/strict';
import test from 'node:test';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T24',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture();
  try{
    const product=await f.prisma.product.create({data:{merchantId:f.owner.merchant_id,name:'Synthetic duration-only service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:{create:{sku:'http-availability',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}},include:{variants:true}});
    const created=await f.request(f.path(f.owner),{...f.profile,timeZone:'UTC',productIds:[product.id]},f.owner);assert.equal(created.status,201);const professional=created.body;
    await f.prisma.professionalAvailability.create({data:{merchantId:f.owner.merchant_id,professionalId:professional.id,weekday:3,startMinute:600,endMinute:720,timeZone:'UTC'}});
    const resource='productId='+product.id+'&variantId='+product.variants[0].id+'&professionalId='+professional.id;
    const path=auth=>'/merchants/'+auth.merchant_id+'/service-availability';
    await t.test('dates precede date-specific slots with real server clock and policy/version state',async()=>{
      const dates=await f.request(path(f.owner)+'/dates?'+resource+'&fromDate=2030-01-02&toDate=2030-01-03',undefined,f.owner,'GET');assert.equal(dates.status,200,JSON.stringify(dates));assert.equal(dates.body.status,'ready');assert.deepEqual(dates.body.dates,['2030-01-02']);assert.equal(Object.hasOwn(dates.body,'slots'),false);assert.equal(dates.body.professionalVersion,1);assert.equal(dates.body.policyVersion,null);assert.ok(Math.abs(Date.now()-Date.parse(dates.body.asOf))<15_000);
      const slots=await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02',undefined,f.owner,'GET');assert.equal(slots.status,200);assert.deepEqual(slots.body.slots.map(slot=>slot.startTime),['10:00','10:30','11:00','11:30']);assert.ok(slots.body.slots.every(slot=>slot.date==='2030-01-02'&&slot.timeZone==='UTC'&&slot.durationMinutes===30));
      const empty=await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-03',undefined,f.owner,'GET');assert.equal(empty.status,200);assert.equal(empty.body.status,'empty');assert.deepEqual(empty.body.slots,[]);
      const stale=await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02&expectedVersion=2',undefined,f.owner,'GET');assert.equal(stale.status,200);assert.equal(stale.body.status,'stale');assert.deepEqual(stale.body.slots,[]);
    });
    await t.test('staff can read its own persisted dates and slots through the actual route guards without mutation',async()=>{
      const offer=await f.prisma.product.create({data:{merchantId:f.staff.merchant_id,name:'Synthetic staff availability service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:{create:{sku:'staff-availability',price:{create:{basePriceInCents:3000,currency:'BRL'}}}}},include:{variants:true}});
      const pro=await f.prisma.serviceProfessional.create({data:{merchantId:f.staff.merchant_id,publicName:'Synthetic staff availability professional',timeZone:'UTC',isPublished:true}});
      await f.prisma.professionalService.create({data:{merchantId:f.staff.merchant_id,professionalId:pro.id,productId:offer.id}});
      const grid=await f.prisma.professionalAvailability.create({data:{merchantId:f.staff.merchant_id,professionalId:pro.id,weekday:3,startMinute:600,endMinute:660,timeZone:'UTC'}});
      const selected='productId='+offer.id+'&variantId='+offer.variants[0].id+'&professionalId='+pro.id;
      const dates=await f.request(path(f.staff)+'/dates?'+selected+'&fromDate=2030-01-02&toDate=2030-01-02',undefined,f.staff,'GET');assert.equal(dates.status,200,JSON.stringify(dates));assert.deepEqual(dates.body.dates,['2030-01-02']);assert.equal(Object.hasOwn(dates.body,'slots'),false);
      const slots=await f.request(path(f.staff)+'/slots?'+selected+'&date=2030-01-02',undefined,f.staff,'GET');assert.equal(slots.status,200);assert.deepEqual(slots.body.slots.map(slot=>slot.startTime),['10:00','10:30']);assert.equal(slots.body.professionalVersion,1);assert.equal(slots.body.policyVersion,null);
      assert.deepEqual(await f.prisma.serviceProfessional.findUnique({where:{id:pro.id}}),pro);assert.deepEqual(await f.prisma.professionalAvailability.findUnique({where:{id:grid.id}}),grid);assert.equal((await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02',undefined,f.staff,'GET')).status,403);
    });
    await t.test('foreign mode malformed and excessive window requests are rejected',async()=>{
      assert.equal((await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02',undefined,f.foreign,'GET')).status,403);
      assert.equal((await f.request(path(f.foreign)+'/slots?'+resource+'&date=2030-01-02',undefined,f.foreign,'GET')).status,404);
      assert.equal((await f.request(path(f.products)+'/slots?'+resource+'&date=2030-01-02',undefined,f.products,'GET')).status,403);
      assert.equal((await f.request(path(f.owner)+'/dates?'+resource+'&fromDate=2030-01-01&toDate=2030-03-01',undefined,f.owner,'GET')).status,400);
      assert.equal((await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-02-30',undefined,f.owner,'GET')).status,400);
      assert.equal((await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02&now=2030-01-01',undefined,f.owner,'GET')).status,400);
      assert.equal((await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02',undefined,undefined,'GET')).status,401);
    });
    await t.test('database failure is an HTTP error rather than fictional empty availability',async()=>{
      await f.runtime.db.sql('ALTER TABLE professional_availability RENAME TO synthetic_http_unavailable_grid');
      try{const response=await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02',undefined,f.owner,'GET');assert.equal(response.status,500);assert.equal(Object.hasOwn(response.body,'slots'),false);assert.equal(Object.hasOwn(response.body,'dates'),false);}finally{await f.runtime.db.sql('ALTER TABLE synthetic_http_unavailable_grid RENAME TO professional_availability');}
      assert.equal((await f.request(path(f.owner)+'/slots?'+resource+'&date=2030-01-02',undefined,f.owner,'GET')).body.status,'ready');
    });
    await t.test('both read routes enforce own products mode and date queries reject auth tenant forged clock and stale selection',async()=>{
      const product=await f.prisma.product.create({data:{merchantId:f.products.merchant_id,name:'Synthetic existing product-mode service row',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:{create:{sku:'products-existing-availability',price:{create:{basePriceInCents:3000,currency:'BRL'}}}}},include:{variants:true}});
      const pro=await f.prisma.serviceProfessional.create({data:{merchantId:f.products.merchant_id,publicName:'Synthetic product-mode resource',timeZone:'UTC',isPublished:true}});
      await f.prisma.professionalService.create({data:{merchantId:f.products.merchant_id,professionalId:pro.id,productId:product.id}});
      const grid=await f.prisma.professionalAvailability.create({data:{merchantId:f.products.merchant_id,professionalId:pro.id,weekday:3,startMinute:600,endMinute:660,timeZone:'UTC'}});
      const selected='productId='+product.id+'&variantId='+product.variants[0].id+'&professionalId='+pro.id;
      for(const query of ['/dates?'+selected+'&fromDate=2030-01-02&toDate=2030-01-02','/slots?'+selected+'&date=2030-01-02'])assert.equal((await f.request(path(f.products)+query,undefined,f.products,'GET')).status,403);
      const dates='/dates?'+resource+'&fromDate=2030-01-02&toDate=2030-01-02';
      assert.equal((await f.request(path(f.owner)+dates,undefined,undefined,'GET')).status,401);
      for(const actor of [f.foreign,f.staff]){assert.equal((await f.request(path(f.owner)+dates,undefined,actor,'GET')).status,403);assert.equal((await f.request(path(actor)+dates,undefined,actor,'GET')).status,404);}
      assert.equal((await f.request(path(f.owner)+dates+'&now=2030-01-01',undefined,f.owner,'GET')).status,400);
      assert.equal((await f.request(path(f.owner)+dates+'&expectedVersion=forged',undefined,f.owner,'GET')).status,400);
      const stale=await f.request(path(f.owner)+dates+'&expectedVersion=2',undefined,f.owner,'GET');assert.equal(stale.status,200);assert.equal(stale.body.status,'stale');assert.deepEqual(stale.body.dates,[]);assert.equal(Object.hasOwn(stale.body,'slots'),false);
      const empty=await f.request(path(f.owner)+'/dates?'+resource+'&fromDate=2030-01-03&toDate=2030-01-03',undefined,f.owner,'GET');assert.equal(empty.status,200);assert.equal(empty.body.status,'empty');assert.deepEqual(empty.body.dates,[]);
      assert.deepEqual(await f.prisma.serviceProfessional.findUnique({where:{id:pro.id}}),pro);assert.deepEqual(await f.prisma.professionalAvailability.findUnique({where:{id:grid.id}}),grid);
    });
    await t.test('neither public read includes private interval or customer data and date failure stays an error',async()=>{
      const block=await f.prisma.availabilityException.create({data:{merchantId:f.owner.merchant_id,professionalId:professional.id,kind:'block',startsAt:new Date('2030-01-02T17:00:00Z'),endsAt:new Date('2030-01-02T17:30:00Z'),timeZone:'UTC',actorId:f.owner.user_id,reason:'Private HTTP availability canary'}});
      const appointment=await f.prisma.serviceAppointment.create({data:{merchantId:f.owner.merchant_id,professionalId:professional.id,productId:product.id,variantId:product.variants[0].id,customerSnapshot:{name:'Private HTTP availability customer'},startsAt:new Date('2030-01-02T18:00:00Z'),endsAt:new Date('2030-01-02T18:30:00Z'),timeZone:'UTC',durationMinutes:30,priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',operationalStatus:'scheduled',idempotencyKey:'private-http-read-canary',requestFingerprint:'private-http-read-canary'}});
      for(const query of ['/dates?'+resource+'&fromDate=2030-01-02&toDate=2030-01-02','/slots?'+resource+'&date=2030-01-02']){const result=await f.request(path(f.owner)+query,undefined,f.owner,'GET');assert.equal(result.status,200);assert.equal(result.body.status,'ready');assert.doesNotMatch(JSON.stringify(result.body),/Private HTTP availability/);}
      await f.runtime.db.sql('ALTER TABLE professional_availability RENAME TO synthetic_http_unavailable_grid');
      try{const response=await f.request(path(f.owner)+'/dates?'+resource+'&fromDate=2030-01-02&toDate=2030-01-02',undefined,f.owner,'GET');assert.equal(response.status,500);assert.equal(Object.hasOwn(response.body,'dates'),false);assert.equal(Object.hasOwn(response.body,'slots'),false);}finally{await f.runtime.db.sql('ALTER TABLE synthetic_http_unavailable_grid RENAME TO professional_availability');}
      assert.deepEqual(await f.prisma.availabilityException.findUnique({where:{id:block.id}}),block);assert.deepEqual(await f.prisma.serviceAppointment.findUnique({where:{id:appointment.id}}),appointment);
      assert.equal((await f.request(path(f.owner)+'/dates?'+resource+'&fromDate=2030-01-02&toDate=2030-01-02',undefined,f.owner,'GET')).body.status,'ready');
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
    await t.test('an authenticated admin with an API plan can read its existing professional dates and slots',async()=>{
      const admin=await f.register('services','availability-admin');
      await f.prisma.merchant.update({where:{id:admin.merchant_id},data:{plan:'API'}});
      await f.prisma.merchantUser.update({where:{id:admin.user_id},data:{role:'admin'}});await f.prisma.merchantTeamMember.updateMany({where:{userId:admin.user_id},data:{role:'ADMIN'}});
      const login=await f.request('/auth/login',{email:admin.email,password:admin.password});assert.equal(login.status,201,JSON.stringify(login));Object.assign(admin,login.body);
      const offer=await f.prisma.product.create({data:{merchantId:admin.merchant_id,name:'Synthetic admin availability service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:{create:{sku:'admin-availability',price:{create:{basePriceInCents:3000,currency:'BRL'}}}}},include:{variants:true}});
      const created=await f.request(f.path(admin),{...f.profile,timeZone:'UTC',productIds:[offer.id]},admin);assert.equal(created.status,201,JSON.stringify(created));const pro=created.body;
      const grid=await f.prisma.professionalAvailability.create({data:{merchantId:admin.merchant_id,professionalId:pro.id,weekday:3,startMinute:600,endMinute:660,timeZone:'UTC'}});
      const selected='productId='+offer.id+'&variantId='+offer.variants[0].id+'&professionalId='+pro.id;
      const dates=await f.request(path(admin)+'/dates?'+selected+'&fromDate=2030-01-02&toDate=2030-01-02',undefined,admin,'GET');assert.equal(dates.status,200);assert.deepEqual(dates.body.dates,['2030-01-02']);
      const slots=await f.request(path(admin)+'/slots?'+selected+'&date=2030-01-02',undefined,admin,'GET');assert.equal(slots.status,200);assert.deepEqual(slots.body.slots.map(slot=>slot.startTime),['10:00','10:30']);assert.deepEqual(await f.prisma.professionalAvailability.findUnique({where:{id:grid.id}}),grid);
      assert.equal((await f.prisma.merchant.findUnique({where:{id:admin.merchant_id}})).plan,'API');
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close();}
});
