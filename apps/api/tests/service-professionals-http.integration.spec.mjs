import assert from 'node:assert/strict';
import test from 'node:test';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T19',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture();
  try{
    const {request,path,owner,foreign,products,staff,prisma,profile}=f;
    let professional;
    await t.test('real list create edit and deactivate routes persist complete profile state',async()=>{
      const empty=await request(path(owner),undefined,owner,'GET');assert.equal(empty.status,200);assert.deepEqual(empty.body,{items:[],nextCursor:null});
      const created=await request(path(owner),profile,owner);assert.equal(created.status,201,JSON.stringify(created));professional=created.body;
      assert.equal(professional.publicName,profile.publicName);assert.deepEqual(professional.publicProfile,profile.publicProfile);assert.equal(professional.version,1);assert.equal(professional.isPublished,true);assert.equal(professional.merchantId,owner.merchant_id);
      assert.equal((await prisma.serviceProfessional.findUnique({where:{id:professional.id}})).timeZone,profile.timeZone);
      // Existing synthetic appointment fixture. Admission itself belongs to
      // Phase 4; this asserts that real HTTP profile mutations preserve it.
      const service=await prisma.product.create({data:{merchantId:owner.merchant_id,name:'Synthetic historical service',type:'service',variants:{create:{sku:'http-professional-history',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}},include:{variants:true}});
      await prisma.professionalService.create({data:{merchantId:owner.merchant_id,professionalId:professional.id,productId:service.id}});
      const appointment=await prisma.serviceAppointment.create({data:{merchantId:owner.merchant_id,professionalId:professional.id,productId:service.id,variantId:service.variants[0].id,customerSnapshot:{name:'Synthetic historical buyer'},startsAt:new Date('2030-01-02T10:00:00Z'),endsAt:new Date('2030-01-02T10:30:00Z'),timeZone:'UTC',durationMinutes:30,priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',operationalStatus:'scheduled',idempotencyKey:'synthetic-http-history',requestFingerprint:'synthetic-http-history'}});
      const edit=await request(path(owner)+'/'+professional.id,{expectedVersion:1,publicName:'Edited professional',publicProfile:{description:''}},owner,'PATCH');assert.equal(edit.status,200,JSON.stringify(edit));professional=edit.body;
      assert.equal(professional.version,2);assert.equal(professional.publicName,'Edited professional');assert.deepEqual(professional.publicProfile,{description:''});
      const deactivate=await request(path(owner)+'/'+professional.id+'/deactivate',{expectedVersion:2},owner);assert.equal(deactivate.status,201,JSON.stringify(deactivate));professional=deactivate.body;
      assert.equal(professional.version,3);assert.equal(professional.isActive,false);assert.equal(professional.isPublished,false);
      const persisted=await prisma.serviceProfessional.findUnique({where:{id:professional.id}});assert.equal(persisted.isActive,false);assert.equal(persisted.version,3);
      assert.deepEqual(await prisma.serviceAppointment.findUnique({where:{id:appointment.id}}),appointment);
    });
    await t.test('invalid input products forbidden and foreign routes do not mutate state',async()=>{
      const before=await prisma.serviceProfessional.findMany({where:{merchantId:owner.merchant_id}});
      const foreignService=await prisma.product.create({data:{merchantId:foreign.merchant_id,name:'Synthetic foreign service',type:'service'}});
      for(const invalid of [{...profile,publicName:''},{...profile,timeZone:'Missing/Zone'},{...profile,userId:'fake-login'},{...profile,publicProfile:{privateNotes:'private'}},{...profile,productIds:[foreignService.id]},{...profile,productIds:['missing-service']}]){
        const response=await request(path(owner),invalid,owner);assert.equal(response.status,400,JSON.stringify(response));
      }
      assert.equal((await request(path(products),profile,products)).status,403);
      assert.equal((await request(path(staff),profile,staff)).status,403);
      for(const [suffix,body,method]of [['',profile,'POST'],['/'+professional.id,{expectedVersion:3,publicName:'Foreign'},'PATCH'],['/'+professional.id+'/deactivate',{expectedVersion:3},'POST'],['',undefined,'GET']])assert.equal((await request(path(owner)+suffix,body,foreign,method)).status,403);
      for(const [suffix,body,method]of [['/'+professional.id,{expectedVersion:3,publicName:'Foreign'},'PATCH'],['/'+professional.id+'/deactivate',{expectedVersion:3},'POST']])assert.equal((await request(path(foreign)+suffix,body,foreign,method)).status,404);
      assert.equal((await request(path(owner),undefined,undefined,'GET')).status,401);
      assert.deepEqual(await prisma.serviceProfessional.findMany({where:{merchantId:owner.merchant_id}}),before);
      assert.equal(await prisma.serviceProfessional.count({where:{merchantId:products.merchant_id}}),0);
    });
    await t.test('stale edits and malformed envelopes roll back while pages remain tenant scoped',async()=>{
      const before=await prisma.serviceProfessional.findUnique({where:{id:professional.id}});
      assert.equal((await request(path(owner)+'/'+professional.id,{expectedVersion:1,publicName:'Stale'},owner,'PATCH')).status,409);
      assert.equal((await request(path(owner)+'/'+professional.id+'/deactivate',{expectedVersion:1},owner)).status,409);
      assert.equal((await request(path(owner)+'/'+professional.id,{publicName:'No version'},owner,'PATCH')).status,400);
      assert.equal((await request(path(owner)+'/'+professional.id+'/deactivate',{expectedVersion:3,force:true},owner)).status,400);
      assert.deepEqual(await prisma.serviceProfessional.findUnique({where:{id:professional.id}}),before);
      for(const limit of ['0','101','invalid','1.5'])assert.equal((await request(path(owner)+'?limit='+limit,undefined,owner,'GET')).status,400);
      const other=await request(path(owner),{...profile,publicName:'Second professional'},owner);assert.equal(other.status,201);
      const first=await request(path(owner)+'?limit=1',undefined,owner,'GET');assert.equal(first.status,200);assert.equal(first.body.items.length,1);assert.ok(first.body.nextCursor);
      const next=await request(path(owner)+'?limit=1&cursor='+first.body.nextCursor,undefined,owner,'GET');assert.equal(next.body.items.length,1);assert.notEqual(next.body.items[0].id,first.body.items[0].id);assert.equal(next.body.nextCursor,null);
      assert.ok([...first.body.items,...next.body.items].every(item=>item.merchantId===owner.merchant_id));
      const staffRead=await request(path(staff),undefined,staff,'GET');assert.equal(staffRead.status,200);assert.deepEqual(staffRead.body.items,[]);
    });
    await t.test('staff and products-mode refusals protect existing own-tenant resources on every mutation route',async()=>{
      for(const auth of [staff,products]){
        const existing=await prisma.serviceProfessional.create({data:{merchantId:auth.merchant_id,publicName:'Synthetic existing resource',timeZone:'UTC'}});
        const read=await request(path(auth),undefined,auth,'GET');assert.equal(read.status,auth===staff?200:403);
        if(auth===staff){assert.equal(read.body.items.length,1);assert.equal(read.body.items[0].id,existing.id);}
        for(const [suffix,body,method]of [['',{...profile},'POST'],['/'+existing.id,{expectedVersion:1,publicName:'Forbidden edit'},'PATCH'],['/'+existing.id+'/deactivate',{expectedVersion:1},'POST']]){
          const response=await request(path(auth)+suffix,body,auth,method);assert.equal(response.status,403,JSON.stringify(response));
        }
        assert.deepEqual(await prisma.serviceProfessional.findUnique({where:{id:existing.id}}),existing);
        assert.equal(await prisma.serviceProfessional.count({where:{merchantId:auth.merchant_id}}),1);
      }
    });
    await t.test('services mode with an API plan can manage professionals without an invented catalog tier',async()=>{
      const apiOwner=await f.register('services','api-plan');
      await prisma.merchant.update({where:{id:apiOwner.merchant_id},data:{plan:'API'}});
      const created=await request(path(apiOwner),profile,apiOwner);assert.equal(created.status,201,JSON.stringify(created));assert.equal(created.body.version,1);
      const list=await request(path(apiOwner),undefined,apiOwner,'GET');assert.equal(list.status,200);assert.equal(list.body.items.length,1);assert.equal(list.body.items[0].id,created.body.id);
      const edited=await request(path(apiOwner)+'/'+created.body.id,{expectedVersion:1,publicName:'API plan professional'},apiOwner,'PATCH');assert.equal(edited.status,200);assert.equal(edited.body.version,2);
      const withdrawn=await request(path(apiOwner)+'/'+created.body.id+'/deactivate',{expectedVersion:2},apiOwner);assert.equal(withdrawn.status,201);assert.equal(withdrawn.body.isActive,false);assert.equal(withdrawn.body.isPublished,false);
      assert.equal((await prisma.merchant.findUnique({where:{id:apiOwner.merchant_id}})).plan,'API');
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close();}
});
