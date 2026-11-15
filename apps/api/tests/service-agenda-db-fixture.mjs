import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';

export async function createAgendaDbFixture(){
  assertServiceArtifacts();
  const db=await createDisposablePostgres({transport:'loopback-exec'});
  let raw;
  try{
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    raw=new PrismaClient({datasources:{db:{url:db.prismaUrl}}});
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const contexts=new TenantContextService(),scoped=registerTenantMiddleware(raw,contexts);
    const owner={merchantId:'agenda-owner',userId:'synthetic-owner',role:'owner'},foreign={merchantId:'agenda-foreign',userId:'synthetic-other',role:'owner'},products={merchantId:'agenda-products',userId:'synthetic-products',role:'owner'};
    for(const actor of [owner,foreign,products])await raw.merchant.create({data:{id:actor.merchantId,name:'Synthetic '+actor.merchantId,businessMode:actor===products?'products':'services',businessModeSelectedAt:new Date()}});
    for(const actor of [owner,foreign]){
      await raw.productCategory.create({data:{id:actor.merchantId+'-category',merchantId:actor.merchantId,name:'Synthetic category',slug:'synthetic'}});
      for(const suffix of ['service','other-service'])await raw.product.create({data:{id:actor.merchantId+'-'+suffix,merchantId:actor.merchantId,name:'Canonical '+suffix,type:'service',categoryId:actor.merchantId+'-category',metadata:{serviceSchedule:{durationMinutes:suffix==='service'?30:20,timeZone:'UTC',slots:[]}},variants:{create:{id:actor.merchantId+'-'+suffix+'-variant',sku:actor.merchantId+'-'+suffix,price:{create:{basePriceInCents:suffix==='service'?5000:7000,currency:'BRL'}}}}}});
      await raw.serviceBusinessPolicy.create({data:{merchantId:actor.merchantId,holdEnabled:false,paymentMode:'at_attendance',version:1,configuredAt:new Date(),admissionsEnabled:true}});
    }
    const professional=await raw.serviceProfessional.create({data:{id:'agenda-professional',merchantId:owner.merchantId,publicName:'Synthetic first professional',isPublished:true,timeZone:'UTC'}});
    const parallel=await raw.serviceProfessional.create({data:{id:'agenda-parallel',merchantId:owner.merchantId,publicName:'Synthetic parallel professional',isPublished:true,timeZone:'UTC'}});
    const foreignProfessional=await raw.serviceProfessional.create({data:{id:'agenda-foreign-professional',merchantId:foreign.merchantId,publicName:'Synthetic foreign professional',isPublished:true,timeZone:'UTC'}});
    for(const pro of [professional,parallel])for(const suffix of ['service','other-service'])await raw.professionalService.create({data:{merchantId:owner.merchantId,professionalId:pro.id,productId:owner.merchantId+'-'+suffix}});
    await raw.professionalService.create({data:{merchantId:foreign.merchantId,professionalId:foreignProfessional.id,productId:foreign.merchantId+'-service'}});
    const selection={merchantId:owner.merchantId,productId:owner.merchantId+'-service',variantId:owner.merchantId+'-service-variant',professionalId:professional.id};
    const appointmentData=(professionalId,startsAt,endsAt,extra={})=>({merchantId:owner.merchantId,professionalId,productId:selection.productId,variantId:selection.variantId,customerSnapshot:{name:'Synthetic buyer'},startsAt:new Date(startsAt),endsAt:new Date(endsAt),timeZone:'UTC',durationMinutes:Math.round((new Date(endsAt)-new Date(startsAt))/60_000),priceInCents:5000,currency:'BRL',policyVersion:1,policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',operationalStatus:'scheduled',idempotencyKey:'synthetic-'+professionalId+'-'+startsAt,requestFingerprint:'synthetic-'+professionalId+'-'+startsAt,...extra});
    const as=(actor,work)=>contexts.run(actor,async()=>await work());
    return {db,raw,scoped,owner,foreign,products,professional,parallel,foreignProfessional,selection,appointmentData,as,close:async()=>{await raw.$disconnect();await db.dispose();assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});}};
  }catch(error){if(raw)await raw.$disconnect();await db.dispose();throw error;}
}
