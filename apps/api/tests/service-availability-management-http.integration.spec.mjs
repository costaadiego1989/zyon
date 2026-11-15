import assert from 'node:assert/strict';
import test from 'node:test';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T25',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture();
  try{
    const product=await f.prisma.product.create({data:{merchantId:f.owner.merchant_id,name:'Synthetic managed service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},variants:{create:{sku:'managed-availability',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}},include:{variants:true}});
    const created=await f.request(f.path(f.owner),{...f.profile,timeZone:'UTC',productIds:[product.id]},f.owner);assert.equal(created.status,201);const professional=created.body;
    const base=auth=>f.path(auth)+'/'+professional.id,resource='productId='+product.id+'&variantId='+product.variants[0].id+'&professionalId='+professional.id;
    const readPath='/merchants/'+f.owner.merchant_id+'/service-availability',grid={timeZone:'UTC',rows:[{weekday:3,startMinute:600,endMinute:720}]};
    const exception=(kind,start,end)=>({kind,startsAt:'2030-01-02T'+start+':00Z',endsAt:'2030-01-02T'+end+':00Z',timeZone:'UTC',reason:'Private schedule canary'});
    const snapshot=async()=>({professionals:await f.prisma.serviceProfessional.findMany({orderBy:{id:'asc'}}),rows:await f.prisma.professionalAvailability.findMany({orderBy:{id:'asc'}}),exceptions:await f.prisma.availabilityException.findMany({orderBy:{id:'asc'}}),appointments:await f.prisma.serviceAppointment.findMany({orderBy:{id:'asc'}})});
    const observeWait=async(holderPid,professionalOnly=false)=>{
      assert.ok(Number.isInteger(holderPid));const deadline=Date.now()+2000;let waiting=false;
      do{waiting=Number(await f.runtime.db.sql("SELECT count(*) FROM pg_stat_activity WHERE "+holderPid+"=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'"+(professionalOnly?" AND position('service_professionals' in query)>0 AND position('FOR UPDATE' in upper(query))>0":"")+";"))>0;}while(!waiting&&Date.now()<deadline);
      assert.equal(waiting,true,'PostgreSQL must observe the actual HTTP request waiting behind the exact holder');
    };
    let version=1;
    await t.test('actual save/edit grid one-off block and reload share canonical availability',async()=>{
      const saved=await f.request(base(f.owner)+'/availability',{...grid,expectedVersion:version},f.owner,'PUT');assert.equal(saved.status,200,JSON.stringify(saved));version=saved.body.version;assert.equal(version,2);assert.equal(saved.body.rows[0].startMinute,600);
      const edited=await f.request(base(f.owner)+'/availability',{...grid,expectedVersion:version,rows:[{weekday:3,startMinute:600,endMinute:750}]},f.owner,'PUT');assert.equal(edited.status,200);version=edited.body.version;assert.equal(version,3);
      const one=await f.request(base(f.owner)+'/availability-exceptions',{...exception('one_off','12:00','13:00'),expectedVersion:version},f.owner);assert.equal(one.status,201,JSON.stringify(one));version=one.body.version;
      const block=await f.request(base(f.owner)+'/availability-exceptions',{...exception('block','10:30','11:00'),expectedVersion:version},f.owner);assert.equal(block.status,201);version=block.body.version;
      const reload=await f.request(base(f.owner)+'/availability',undefined,f.owner,'GET');assert.equal(reload.status,200);assert.equal(reload.body.version,version);assert.equal(reload.body.rows.length,1);assert.equal(reload.body.rows[0].endMinute,750);assert.equal(reload.body.exceptions.length,2);
      const slots=await f.request(readPath+'/slots?'+resource+'&date=2030-01-02',undefined,f.owner,'GET');assert.equal(slots.status,200);assert.deepEqual(slots.body.slots.map(slot=>slot.startTime),['10:00','11:00','11:30','12:00','12:30']);assert.doesNotMatch(JSON.stringify(slots.body),/Private schedule canary/);
      const dates=await f.request(readPath+'/dates?'+resource+'&fromDate=2030-01-02&toDate=2030-01-02',undefined,f.owner,'GET');assert.deepEqual(dates.body.dates,['2030-01-02']);assert.equal(dates.body.professionalVersion,version);
      const {getProfessionalAvailability}=await import('../dist/modules/catalog/application/get-professional-availability.js');const canonical=await f.prisma.$transaction(tx=>getProfessionalAvailability(tx,{merchantId:f.owner.merchant_id,professionalId:professional.id,productId:product.id,variantId:product.variants[0].id,fromDate:'2030-01-02',toDate:'2030-01-02',now:new Date(slots.body.asOf)}));assert.deepEqual(canonical.slots,slots.body.slots);
      const moved=await f.request(base(f.owner)+'/availability-exceptions/'+block.body.exception.id,{...exception('block','11:00','11:30'),expectedVersion:version},f.owner,'PATCH');assert.equal(moved.status,200);version=moved.body.version;assert.equal(moved.body.exception.version,2);assert.deepEqual((await f.request(readPath+'/slots?'+resource+'&date=2030-01-02',undefined,f.owner,'GET')).body.slots.map(slot=>slot.startTime),['10:00','10:30','11:30','12:00','12:30']);
    });
    await t.test('invalid products foreign forbidden stale and overlap mutations preserve state',async()=>{
      const before=await f.prisma.availabilityException.findMany({where:{professionalId:professional.id}}),pro=await f.prisma.serviceProfessional.findUnique({where:{id:professional.id}});
      assert.equal((await f.request(base(f.owner)+'/availability',{...grid,expectedVersion:version,rows:[{weekday:3,startMinute:600,endMinute:600}]},f.owner,'PUT')).status,400);
      assert.equal((await f.request(base(f.owner)+'/availability',{...grid,expectedVersion:1},f.owner,'PUT')).status,409);
      for(const actor of [f.foreign,f.products,f.staff]){assert.equal((await f.request(base(f.owner)+'/availability',{...grid,expectedVersion:version},actor,'PUT')).status,403);assert.equal((await f.request(base(actor)+'/availability',{...grid,expectedVersion:version},actor,'PUT')).status,actor===f.foreign?404:403);}
      assert.equal((await f.request(base(f.owner)+'/availability-exceptions',{...exception('one_off','11:00','11:30'),expectedVersion:version},f.owner)).status,409);
      assert.equal((await f.request(base(f.owner)+'/availability-exceptions',{...exception('block','14:00','15:00'),expectedVersion:version,id:'foreign'},f.owner)).status,400);
      assert.deepEqual(await f.prisma.availabilityException.findMany({where:{professionalId:professional.id}}),before);assert.deepEqual(await f.prisma.serviceProfessional.findUnique({where:{id:professional.id}}),pro);
    });
    await t.test('HTTP block waits for the same resource as a confirmed write and rolls back on conflict',async()=>{
      const {lockServiceProfessional}=await import('../dist/shared/bookings/service-professional-lock.js'),{lockCatalogMerchant}=await import('../dist/shared/persistence/catalog-stock-ledger.js');let release,locked,rejectReady,holderPid;const ready=new Promise((resolve,reject)=>{locked=resolve;rejectReady=reject;}),allowCommit=new Promise(resolve=>release=resolve);
      const confirmation=f.prisma.$transaction(async tx=>{await lockCatalogMerchant(tx,f.owner.merchant_id);await lockServiceProfessional(tx,f.owner.merchant_id,professional.id);[{pid:holderPid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');await tx.serviceAppointment.create({data:{merchantId:f.owner.merchant_id,professionalId:professional.id,productId:product.id,variantId:product.variants[0].id,customerSnapshot:{name:'Synthetic buyer'},startsAt:new Date('2030-01-02T15:00:00Z'),endsAt:new Date('2030-01-02T15:30:00Z'),timeZone:'UTC',durationMinutes:30,priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',operationalStatus:'scheduled',idempotencyKey:'synthetic-http-race',requestFingerprint:'synthetic-http-race'}});locked();await allowCommit;});
      void confirmation.catch(rejectReady);let blocking,settled=false;
      try{await ready;blocking=f.request(base(f.owner)+'/availability-exceptions',{...exception('block','15:15','15:45'),expectedVersion:version},f.owner);blocking.then(()=>{settled=true;},()=>{settled=true;});await observeWait(holderPid);assert.equal(settled,false);}finally{release();await Promise.allSettled([confirmation,...(blocking?[blocking]:[])]);}
      await confirmation;const response=await blocking;assert.equal(response.status,409,JSON.stringify(response));assert.equal((await f.prisma.serviceProfessional.findUnique({where:{id:professional.id}})).version,version);assert.equal(await f.prisma.availabilityException.count({where:{professionalId:professional.id,startsAt:new Date('2030-01-02T15:15:00Z')}}),0);assert.equal(await f.prisma.serviceAppointment.count({where:{professionalId:professional.id,operationalStatus:'scheduled'}}),1);
    });
    await t.test('an actual HTTP exception waits on a professional-only holder before persisting its version',async()=>{
      const {lockServiceProfessional}=await import('../dist/shared/bookings/service-professional-lock.js');
      const target=await f.prisma.serviceProfessional.create({data:{merchantId:f.owner.merchant_id,publicName:'Synthetic HTTP lock resource',timeZone:'UTC'}});
      let release,locked,rejectReady,holderPid;const ready=new Promise((resolve,reject)=>{locked=resolve;rejectReady=reject;}),allowCommit=new Promise(resolve=>release=resolve);
      const holder=f.prisma.$transaction(async tx=>{await lockServiceProfessional(tx,f.owner.merchant_id,target.id);[{pid:holderPid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');locked();await allowCommit;});
      void holder.catch(rejectReady);let blocking,settled=false;
      try{await ready;blocking=f.request(f.path(f.owner)+'/'+target.id+'/availability-exceptions',{...exception('block','16:00','16:30'),expectedVersion:target.version},f.owner);blocking.then(()=>{settled=true;},()=>{settled=true;});await observeWait(holderPid,true);assert.equal(settled,false);}finally{release();await Promise.allSettled([holder,...(blocking?[blocking]:[])]);}
      await holder;const response=await blocking;assert.equal(response.status,201,JSON.stringify(response));assert.equal(response.body.version,target.version+1);assert.equal((await f.prisma.serviceProfessional.findUnique({where:{id:target.id}})).version,target.version+1);assert.equal(response.body.exception.professionalId,target.id);assert.equal(response.body.exception.kind,'block');assert.equal(response.body.exception.startsAt,'2030-01-02T16:00:00.000Z');assert.equal((await f.prisma.availabilityException.findUnique({where:{id:response.body.exception.id}})).professionalId,target.id);
    });
    await t.test('all four routes refuse anonymous foreign products and staff requests against existing resources',async()=>{
      const ownerException=await f.prisma.availabilityException.findFirstOrThrow({where:{professionalId:professional.id,isActive:true}}),own=new Map();
      for(const actor of [f.foreign,f.products,f.staff]){
        const target=await f.prisma.serviceProfessional.create({data:{merchantId:actor.merchant_id,publicName:'Synthetic forbidden own resource',timeZone:'UTC'}});
        await f.prisma.professionalAvailability.create({data:{merchantId:actor.merchant_id,professionalId:target.id,weekday:3,startMinute:600,endMinute:660,timeZone:'UTC'}});
        const row=await f.prisma.availabilityException.create({data:{merchantId:actor.merchant_id,professionalId:target.id,kind:'block',startsAt:new Date('2030-01-02T18:00:00Z'),endsAt:new Date('2030-01-02T18:30:00Z'),timeZone:'UTC',actorId:actor.user_id}});own.set(actor,{target,row});
      }
      const requests=(root,id,expectedVersion)=>[['GET',root+'/availability',undefined],['PUT',root+'/availability',{...grid,expectedVersion}],['POST',root+'/availability-exceptions',{...exception('block','18:00','18:30'),expectedVersion}],['PATCH',root+'/availability-exceptions/'+id,{...exception('block','18:00','18:30'),expectedVersion}]];
      const before=await snapshot();
      for(const [method,path,body] of requests(base(f.owner),ownerException.id,version)){
        assert.equal((await f.request(path,body,undefined,method)).status,401,method+' anonymous');
        for(const actor of [f.foreign,f.products,f.staff])assert.equal((await f.request(path,body,actor,method)).status,403,method+' foreign path');
      }
      for(const [method,path,body] of requests(base(f.foreign),ownerException.id,version))assert.equal((await f.request(path,body,f.foreign,method)).status,404,method+' foreign resource');
      for(const actor of [f.products,f.staff]){const {target,row}=own.get(actor);for(const [method,path,body] of requests(f.path(actor)+'/'+target.id,row.id,target.version))assert.equal((await f.request(path,body,actor,method)).status,403,method+' own mode/role');}
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('invalid envelopes precise active input and stale exception edits preserve all agenda state',async()=>{
      const row=await f.prisma.availabilityException.findFirstOrThrow({where:{professionalId:professional.id,isActive:true}}),before=await snapshot();
      for(const [method,path,input] of [['PUT',base(f.owner)+'/availability',grid],['POST',base(f.owner)+'/availability-exceptions',exception('block','18:00','18:30')],['PATCH',base(f.owner)+'/availability-exceptions/'+row.id,exception('block','18:00','18:30')]]){
        for(const body of [undefined,[],input,{...input,expectedVersion:'forged'},{...input,expectedVersion:version,actorId:'forged'},{...input,expectedVersion:version,id:'foreign'}])assert.equal((await f.request(path,body,f.owner,method)).status,400,method+' invalid envelope');
      }
      assert.equal((await f.request(base(f.owner)+'/availability-exceptions',{...exception('block','18:00','18:30'),expectedVersion:1},f.owner)).status,409);
      assert.equal((await f.request(base(f.owner)+'/availability-exceptions/'+row.id,{...exception('block','18:00','18:30'),expectedVersion:1},f.owner,'PATCH')).status,409);
      assert.equal((await f.request(base(f.owner)+'/availability',{...grid,rows:[{...grid.rows[0],validFrom:'2030-01-01T00:00:00.001Z'}],expectedVersion:version},f.owner,'PUT')).status,400);
      for(const method of ['POST','PATCH'])assert.equal((await f.request(base(f.owner)+'/availability-exceptions'+(method==='PATCH'?'/'+row.id:''),{...exception('block','18:00','18:30'),startsAt:'2030-01-02T18:00:30.123Z',expectedVersion:version},f.owner,method)).status,400);
      assert.equal((await f.request(base(f.owner)+'/availability?cursor='+'x'.repeat(192),undefined,f.owner,'GET')).status,400);assert.deepEqual(await snapshot(),before);
    });
    await t.test('HTTP withdrawal after a profile timezone edit preserves the precise historical interval',async()=>{
      const historical=await f.prisma.availabilityException.create({data:{merchantId:f.owner.merchant_id,professionalId:professional.id,kind:'block',startsAt:new Date('2030-01-02T17:00:30.123Z'),endsAt:new Date('2030-01-02T17:30:30.123Z'),timeZone:'UTC',actorId:f.owner.user_id,reason:'Historical HTTP private canary'}});
      const edited=await f.request(base(f.owner),{timeZone:'America/Sao_Paulo',expectedVersion:version},f.owner,'PATCH');assert.equal(edited.status,200,JSON.stringify(edited));version=edited.body.version;
      const appointment=await f.prisma.serviceAppointment.findMany({where:{professionalId:professional.id}});
      const withdrawn=await f.request(base(f.owner)+'/availability-exceptions/'+historical.id,{...exception('one_off','19:00','19:30'),expectedVersion:version,isActive:false,reason:'Replacement must not rewrite history'},f.owner,'PATCH');assert.equal(withdrawn.status,200,JSON.stringify(withdrawn));version=withdrawn.body.version;
      const actual=await f.prisma.availabilityException.findUnique({where:{id:historical.id}}),{updatedAt:actualUpdated,...actualFields}=actual,{updatedAt:oldUpdated,...oldFields}=historical;
      assert.deepEqual(actualFields,{...oldFields,isActive:false,version:historical.version+1,actorId:f.owner.user_id});assert.deepEqual(await f.prisma.serviceAppointment.findMany({where:{professionalId:professional.id}}),appointment);
      const restored=await f.request(base(f.owner),{timeZone:'UTC',expectedVersion:version},f.owner,'PATCH');assert.equal(restored.status,200);version=restored.body.version;
    });
    await t.test('a database failure after grid deactivation rolls the actual HTTP mutation back',async()=>{
      const before=await snapshot();await f.runtime.db.sql('ALTER TABLE professional_availability ADD CONSTRAINT synthetic_t25_reject_700 CHECK (start_minute <> 700);');
      try{const result=await f.request(base(f.owner)+'/availability',{timeZone:'UTC',rows:[{weekday:3,startMinute:700,endMinute:730}],expectedVersion:version},f.owner,'PUT');assert.equal(result.status,500,JSON.stringify(result));assert.deepEqual(await snapshot(),before);}finally{await f.runtime.db.sql('ALTER TABLE professional_availability DROP CONSTRAINT synthetic_t25_reject_700;');}
    });
    await t.test('config pagination returns every active own exception once with a bounded page',async()=>{
      await f.prisma.availabilityException.createMany({data:Array.from({length:101},(_,index)=>({id:'synthetic-t25-page-'+String(index).padStart(3,'0'),merchantId:f.owner.merchant_id,professionalId:professional.id,kind:'one_off',startsAt:new Date('2030-01-04T10:00:00Z'),endsAt:new Date('2030-01-04T10:30:00Z'),timeZone:'UTC',actorId:f.owner.user_id}))});
      const first=await f.request(base(f.owner)+'/availability',undefined,f.owner,'GET');assert.equal(first.status,200);assert.equal(first.body.exceptions.length,100);assert.ok(first.body.nextCursor);
      const second=await f.request(base(f.owner)+'/availability?cursor='+encodeURIComponent(first.body.nextCursor),undefined,f.owner,'GET');assert.equal(second.status,200);assert.equal(second.body.exceptions.length,3);assert.equal(second.body.nextCursor,null);
      const rows=[...first.body.exceptions,...second.body.exceptions];assert.equal(rows.length,103);assert.equal(new Set(rows.map(row=>row.id)).size,103);assert.ok(rows.every(row=>row.merchantId===f.owner.merchant_id&&row.professionalId===professional.id&&row.isActive));assert.equal(first.body.version,version);assert.equal(second.body.version,version);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
    await t.test('an authenticated admin with an API plan saves edits and reloads all four own availability routes',async()=>{
      const admin=await f.register('services','availability-admin');
      await f.prisma.merchant.update({where:{id:admin.merchant_id},data:{plan:'API'}});
      await f.prisma.merchantUser.update({where:{id:admin.user_id},data:{role:'admin'}});await f.prisma.merchantTeamMember.updateMany({where:{userId:admin.user_id},data:{role:'ADMIN'}});
      const login=await f.request('/auth/login',{email:admin.email,password:admin.password});assert.equal(login.status,201,JSON.stringify(login));Object.assign(admin,login.body);
      const created=await f.request(f.path(admin),{...f.profile,timeZone:'UTC'},admin);assert.equal(created.status,201,JSON.stringify(created));const pro=created.body,adminBase=f.path(admin)+'/'+pro.id;
      const saved=await f.request(adminBase+'/availability',{...grid,expectedVersion:pro.version},admin,'PUT');assert.equal(saved.status,200);assert.equal(saved.body.version,pro.version+1);
      const one=await f.request(adminBase+'/availability-exceptions',{...exception('one_off','18:00','18:30'),expectedVersion:saved.body.version},admin);assert.equal(one.status,201);assert.equal(one.body.exception.actorId,admin.user_id);
      const edited=await f.request(adminBase+'/availability-exceptions/'+one.body.exception.id,{...exception('one_off','18:30','19:00'),expectedVersion:one.body.version},admin,'PATCH');assert.equal(edited.status,200);assert.equal(edited.body.exception.startsAt,'2030-01-02T18:30:00.000Z');assert.equal(edited.body.exception.version,2);
      const read=await f.request(adminBase+'/availability',undefined,admin,'GET');assert.equal(read.status,200);assert.equal(read.body.version,edited.body.version);assert.equal(read.body.rows.length,1);assert.equal(read.body.exceptions.length,1);assert.equal(read.body.exceptions[0].id,one.body.exception.id);assert.equal((await f.prisma.serviceProfessional.findUnique({where:{id:pro.id}})).version,edited.body.version);
      assert.equal((await f.prisma.merchant.findUnique({where:{id:admin.merchant_id}})).plan,'API');
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close();}
});
