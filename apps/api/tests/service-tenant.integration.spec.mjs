import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {registerTenantMiddleware} from '../dist/shared/persistence/tenant.middleware.js';
import {TenantContextService} from '../dist/shared/tenant/tenant-context.service.js';

const at=new Date('2030-01-01T00:00:00Z');
const models=['serviceBusinessPolicy','serviceProfessional','professionalService','professionalAvailability',
  'availabilityException','serviceAppointment','appointmentPayment','attendanceReceipt','appointmentAudit',
  'whatsAppHandoffBinding','publicSourceWork'];
const changes={serviceBusinessPolicy:{holdEnabled:false},serviceProfessional:{publicName:'Changed locally'},
  professionalService:{isActive:false},professionalAvailability:{isActive:false},availabilityException:{reason:'Changed locally'},
  serviceAppointment:{customerSnapshot:{name:'Changed locally'}},appointmentPayment:{requiresRegularization:true},
  attendanceReceipt:{paymentMethod:'cash'},appointmentAudit:{action:'changed'},whatsAppHandoffBinding:{epoch:1},publicSourceWork:{attempts:1}};
function rows(tenant){
  const base={merchantId:tenant};
  return {
    serviceBusinessPolicy:{...base},
    serviceProfessional:{...base,id:tenant+'-professional',publicName:tenant+' private',timeZone:'UTC'},
    professionalService:{...base,id:tenant+'-link',professionalId:tenant+'-professional',productId:tenant+'-service'},
    professionalAvailability:{...base,id:tenant+'-availability',professionalId:tenant+'-professional',weekday:1,startMinute:600,endMinute:900,timeZone:'UTC'},
    availabilityException:{...base,id:tenant+'-exception',professionalId:tenant+'-professional',kind:'one_off',startsAt:at,endsAt:new Date(at.getTime()+1800000),timeZone:'UTC',actorId:'synthetic-operator'},
    serviceAppointment:{...base,id:tenant+'-appointment',professionalId:tenant+'-professional',productId:tenant+'-service',variantId:tenant+'-variant',customerSnapshot:{name:tenant+' private'},
      startsAt:at,endsAt:new Date(at.getTime()+1800000),timeZone:'UTC',durationMinutes:30,priceInCents:5000,currency:'BRL',policyVersion:1,
      policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',idempotencyKey:'appointment',requestFingerprint:'appointment'},
    appointmentPayment:{...base,id:tenant+'-payment',appointmentId:tenant+'-appointment',mode:'at_attendance',amountCents:5000,currency:'BRL',idempotencyKey:'payment',requestFingerprint:'payment'},
    attendanceReceipt:{...base,id:tenant+'-receipt',appointmentPaymentId:tenant+'-payment',amountCents:5000,currency:'BRL',paymentMethod:'local',operatorId:'synthetic-operator',idempotencyKey:'receipt',requestFingerprint:'receipt'},
    appointmentAudit:{...base,id:tenant+'-audit',appointmentId:tenant+'-appointment',commandId:'audit',version:1,action:'created',origin:'manual'},
    whatsAppHandoffBinding:{...base,id:tenant+'-handoff',configId:tenant+'-config',whatsappSessionId:tenant+'-session'},
    publicSourceWork:{...base,id:tenant+'-source',sourceType:'company',sourceId:'company',sourceVersion:'1',sourceHash:'synthetic-hash',publicationState:'published'},
  };
}

test('T6',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  assertServiceArtifacts();
  const db=await createDisposablePostgres({transport:'loopback-exec'});
  let raw;
  try{
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    raw=new PrismaClient({datasources:{db:{url:db.prismaUrl}}});
    const contexts=new TenantContextService(),scoped=registerTenantMiddleware(raw,contexts);
    // PrismaPromise is lazy; consume it within the request's ALS scope.
    const asA=fn=>contexts.run({merchantId:'tenant-a',userId:'synthetic-user',role:'owner'},async()=>await fn());
    for(const tenant of ['tenant-a','tenant-b']){
      await raw.merchant.create({data:{id:tenant,name:'Synthetic '+tenant,businessMode:'services'}});
      await raw.product.create({data:{id:tenant+'-service',merchantId:tenant,name:'Synthetic service',type:'service'}});
      await raw.productVariant.create({data:{id:tenant+'-variant',productId:tenant+'-service',sku:tenant}});
      await raw.whatsAppChannelConfig.create({data:{id:tenant+'-config',merchantId:tenant}});
      await raw.whatsAppSession.create({data:{id:tenant+'-session',merchantId:tenant,buyerPhone:'synthetic-'+tenant,deviceId:'synthetic-device'}});
      for(const model of models)await raw[model].create({data:rows(tenant)[model]});
    }
    const before={};for(const model of models)before[model]=await raw[model].findMany({where:{merchantId:'tenant-b'}});
    for(const model of models)await t.test(model+' denies foreign reads and mutations',async()=>{
      const foreign=rows('tenant-b')[model];
      assert.deepEqual((await asA(()=>scoped[model].findMany({where:{merchantId:'tenant-b'}}))).map(r=>r.merchantId),['tenant-a']);
      assert.equal(await asA(()=>scoped[model].count({where:{merchantId:'tenant-b'}})),1);
      if(model==='serviceBusinessPolicy'){
        const policy=await asA(()=>scoped[model].findUnique({where:{merchantId:'tenant-b'}}));
        assert.equal(policy.merchantId,'tenant-a');
        await asA(()=>scoped[model].update({where:{merchantId:'tenant-b'},data:{...changes[model],merchantId:'tenant-b'}}));
      }else{
        assert.equal(await asA(()=>scoped[model].findUnique({where:{id:foreign.id}})),null);
        await assert.rejects(asA(()=>scoped[model].update({where:{id:foreign.id},data:changes[model]})),{code:'P2025'});
        await assert.rejects(asA(()=>scoped[model].delete({where:{id:foreign.id}})),{code:'P2025'});
        assert.equal((await asA(()=>scoped[model].updateMany({where:{id:foreign.id},data:changes[model]}))).count,0);
        assert.equal((await asA(()=>scoped[model].deleteMany({where:{id:foreign.id}}))).count,0);
      }
      assert.deepEqual(await raw[model].findMany({where:{merchantId:'tenant-b'}}),before[model]);
    });
    await t.test('bulk create stamps the caller and forbids tenant reassignment',async()=>{
      await asA(()=>scoped.serviceProfessional.createMany({data:[{id:'bulk-one',merchantId:'tenant-b',publicName:'Synthetic one',timeZone:'UTC'},
        {id:'bulk-two',merchantId:'tenant-b',publicName:'Synthetic two',timeZone:'UTC'}]}));
      assert.deepEqual((await raw.serviceProfessional.findMany({where:{id:{in:['bulk-one','bulk-two']}},orderBy:{id:'asc'}})).map(r=>r.merchantId),['tenant-a','tenant-a']);
      await asA(()=>scoped.serviceProfessional.updateMany({where:{id:{in:['bulk-one','bulk-two']}},data:{merchantId:'tenant-b',publicName:'Owned'}}));
      assert.equal(await raw.serviceProfessional.count({where:{id:{in:['bulk-one','bulk-two']},merchantId:'tenant-a',publicName:'Owned'}}),2);
      assert.deepEqual(await raw.serviceProfessional.findMany({where:{merchantId:'tenant-b'}}),before.serviceProfessional);
    });
    await t.test('scoped composite key cannot recover another source',async()=>{
      const found=await asA(()=>scoped.publicSourceWork.findUnique({where:{merchantId_sourceType_sourceId_sourceVersion:{merchantId:'tenant-b',sourceType:'company',sourceId:'company',sourceVersion:'1'}}}));
      assert.equal(found.id,'tenant-a-source');assert.equal(found.merchantId,'tenant-a');
    });
    await t.test('cross-tenant links fail and the preceding transaction write rolls back',async()=>{
      await assert.rejects(asA(()=>scoped.$transaction(async tx=>{
        await tx.serviceProfessional.create({data:{id:'rollback-professional',merchantId:'tenant-a',publicName:'Synthetic rollback',timeZone:'UTC'}});
        await tx.professionalService.create({data:{merchantId:'tenant-a',professionalId:'rollback-professional',productId:'tenant-b-service'}});
      })),{code:'P2003'});
      assert.equal(await raw.serviceProfessional.count({where:{id:'rollback-professional'}}),0);
      for(const data of [{...rows('tenant-a').serviceAppointment,id:'foreign-professional',idempotencyKey:'foreign-professional',professionalId:'tenant-b-professional'},
        {...rows('tenant-a').serviceAppointment,id:'foreign-variant',idempotencyKey:'foreign-variant',variantId:'tenant-b-variant'}])
        await assert.rejects(asA(()=>scoped.serviceAppointment.create({data})),{code:'P2003'});
      await assert.rejects(asA(()=>scoped.appointmentPayment.create({data:{...rows('tenant-a').appointmentPayment,id:'foreign-payment',idempotencyKey:'foreign-payment',appointmentId:'tenant-b-appointment'}})),{code:'P2003'});
      await assert.rejects(asA(()=>scoped.whatsAppHandoffBinding.create({data:{...rows('tenant-a').whatsAppHandoffBinding,id:'foreign-handoff',whatsappSessionId:'tenant-b-session'}})),{code:'P2003'});
      for(const model of models)assert.deepEqual(await raw[model].findMany({where:{merchantId:'tenant-b'}}),before[model]);
    });
  }finally{if(raw)await raw.$disconnect();await db.dispose();}
  assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});
});
