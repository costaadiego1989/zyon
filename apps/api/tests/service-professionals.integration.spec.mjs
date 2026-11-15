import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T18',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  assertServiceArtifacts();
  const db=await createDisposablePostgres({transport:'loopback-exec'});
  let prisma;
  try{
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    prisma=new PrismaClient({datasources:{db:{url:db.prismaUrl}}});
    const {PrismaServiceProfessionalRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-service-professional.repository.js');
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const contexts=new TenantContextService(),scoped=registerTenantMiddleware(prisma,contexts),repo=new PrismaServiceProfessionalRepository(scoped);
    const owner={merchantId:'professional-a',userId:'synthetic-owner',role:'owner'},foreign={merchantId:'professional-b',userId:'synthetic-other',role:'owner'};
    const as=(actor,work)=>contexts.run(actor,async()=>await work());
    for(const actor of [owner,foreign]){
      await prisma.merchant.create({data:{id:actor.merchantId,name:'Synthetic '+actor.merchantId,businessMode:'services',businessModeSelectedAt:new Date()}});
      await prisma.product.create({data:{id:actor.merchantId+'-service',merchantId:actor.merchantId,name:'Canonical service',type:'service',variants:{create:{id:actor.merchantId+'-variant',sku:actor.merchantId+'-sku',price:{create:{basePriceInCents:5000}}}}}});
    }
    const profile={publicName:'Synthetic professional',publicProfile:{description:'Published business biography',specialties:['Consulting']},timeZone:'America/Sao_Paulo',isPublished:true,productIds:[owner.merchantId+'-service']};
    let professional;
    await t.test('create and edit a resource with canonical offers without creating a login',async()=>{
      professional=await as(owner,()=>repo.create(owner,profile));
      assert.equal(professional.merchantId,owner.merchantId);assert.equal(professional.publicName,profile.publicName);
      assert.deepEqual(professional.publicProfile,profile.publicProfile);assert.equal(professional.isPublished,true);assert.equal(professional.version,1);
      assert.equal(professional.services.length,1);assert.equal(professional.services[0].productId,owner.merchantId+'-service');
      assert.equal(await prisma.merchantUser.count({where:{merchantId:owner.merchantId}}),0);
      professional=await as(owner,()=>repo.update(owner,professional.id,1,{publicName:'Edited public name',publicProfile:{description:''}}));
      assert.equal(professional.publicName,'Edited public name');assert.deepEqual(professional.publicProfile,{description:''});assert.equal(professional.version,2);
    });
    await t.test('foreign, wrong type, duplicate and invalid associations roll back atomically',async()=>{
      await prisma.product.create({data:{id:'professional-physical',merchantId:owner.merchantId,name:'Legacy product',type:'physical'}});
      for(const ids of [[foreign.merchantId+'-service'],['professional-physical'],['missing'],[owner.merchantId+'-service',owner.merchantId+'-service']]){
        const before=await prisma.serviceProfessional.count({where:{merchantId:owner.merchantId}});
        await assert.rejects(as(owner,()=>repo.create(owner,{...profile,productIds:ids})),/professional_service|professional_services/);
        assert.equal(await prisma.serviceProfessional.count({where:{merchantId:owner.merchantId}}),before);
      }
      const before=await prisma.serviceProfessional.findUnique({where:{id:professional.id}});
      await assert.rejects(as(owner,()=>repo.update(owner,professional.id,professional.version,{publicName:'Must roll back',productIds:[foreign.merchantId+'-service']})),/professional_service_not_found/);
      assert.deepEqual(await prisma.serviceProfessional.findUnique({where:{id:professional.id}}),before);
      await assert.rejects(as(foreign,()=>repo.update(foreign,professional.id,professional.version,{publicName:'Foreign private overwrite'})),/service_professional_not_found/);
      assert.deepEqual(await prisma.serviceProfessional.findUnique({where:{id:professional.id}}),before);
    });
    await t.test('versioned concurrent edits have one winner and preserve service link identities',async()=>{
      const links=await prisma.professionalService.findMany({where:{professionalId:professional.id}});
      const results=await Promise.allSettled(['one','two'].map(name=>as(owner,()=>repo.update(owner,professional.id,professional.version,{publicName:name}))));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
      assert.match(results.find(r=>r.status==='rejected').reason.message,/service_professional_stale/);
      professional=await prisma.serviceProfessional.findUnique({where:{id:professional.id}});assert.equal(professional.version,3);
      assert.deepEqual(await prisma.professionalService.findMany({where:{professionalId:professional.id}}),links);
    });
    await t.test('deactivation preserves canonical appointments, offer prices and history',async()=>{
      const appointment=await prisma.serviceAppointment.create({data:{merchantId:owner.merchantId,professionalId:professional.id,productId:owner.merchantId+'-service',variantId:owner.merchantId+'-variant',customerSnapshot:{name:'Synthetic historical buyer'},startsAt:new Date('2030-01-02T10:00:00Z'),endsAt:new Date('2030-01-02T10:30:00Z'),timeZone:'UTC',durationMinutes:30,priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',operationalStatus:'scheduled',idempotencyKey:'synthetic-history',requestFingerprint:'synthetic-history'}});
      professional=await as(owner,()=>repo.deactivate(owner,professional.id,professional.version));
      assert.equal(professional.isActive,false);assert.equal(professional.isPublished,false);assert.equal(professional.version,4);
      assert.deepEqual(await prisma.serviceAppointment.findUnique({where:{id:appointment.id}}),appointment);
      assert.equal((await prisma.productPrice.findUnique({where:{variantId:owner.merchantId+'-variant'}})).basePriceInCents,5000);
      assert.equal(await prisma.professionalService.count({where:{professionalId:professional.id}}),1);
      // The same resource remains lockable and editable after deactivation.
      const edited=await as(owner,()=>repo.update(owner,professional.id,4,{publicName:'Inactive historical professional'}));assert.equal(edited.version,5);assert.equal(edited.isActive,false);
    });
    await t.test('database constraints prevent foreign resource links and rollback a preceding write',async()=>{
      const other=await as(foreign,()=>repo.create(foreign,{...profile,productIds:[foreign.merchantId+'-service']}));
      await assert.rejects(prisma.$transaction(async tx=>{await tx.serviceProfessional.update({where:{id:professional.id},data:{publicName:'Must roll back'}});await tx.professionalService.create({data:{merchantId:owner.merchantId,professionalId:other.id,productId:owner.merchantId+'-service'}});}),{code:'P2003'});
      assert.equal((await prisma.serviceProfessional.findUnique({where:{id:professional.id}})).publicName,'Inactive historical professional');
    });
    await t.test('list is tenant scoped and bounded while products and staff writes are denied',async()=>{
      const page=await as(owner,()=>repo.list(owner,{limit:1}));assert.equal(page.items.length,1);assert.ok(page.items.every(item=>item.merchantId===owner.merchantId));
      const staff={...owner,role:'staff'};
      assert.equal((await as(staff,()=>repo.list(staff))).items.length,1);
      await assert.rejects(as(staff,()=>repo.create(staff,profile)),/service_operator_required/);
      for(const limit of [0,-1,101,1.5])await assert.rejects(as(owner,()=>repo.list(owner,{limit})),/invalid_professional_page/);
      await prisma.merchant.create({data:{id:'professional-products',name:'Synthetic products',businessMode:'products',businessModeSelectedAt:new Date()}});
      const productOwner={...owner,merchantId:'professional-products'};
      await assert.rejects(as(productOwner,()=>repo.create(productOwner,{...profile,productIds:[]})),/services_mode_required/);
      assert.equal(await prisma.serviceProfessional.count({where:{merchantId:'professional-products'}}),0);
    });
  }finally{if(prisma)await prisma.$disconnect();await db.dispose();}
  assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});
});
