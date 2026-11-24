import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {runServiceAppointmentBackfill} from '../scripts/service-appointment-backfill.mjs';
import {hasUnclassifiedServiceReservations} from '../src/shared/bookings/service-legacy-readiness.js';

// Keep the accepted T5 migration file/root/oracles untouched. This is the whole
// separate T84 companion, using actual owned SQL and canonical locks/audits.
test('T84',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
 assertServiceArtifacts();const db=await createDisposablePostgres({transport:'loopback-exec'});let prisma;
 try{
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  await bootstrapServiceSchema(db);prisma=new PrismaClient({datasources:{db:{url:db.prismaUrl}}});
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:db.runId}]);
  const merchantId='backfill-services',foreignId='backfill-foreign',productsId='backfill-products';
  const at=new Date('2019-12-01T10:00:00.000Z');
  for(const id of[merchantId,foreignId,productsId])await prisma.merchant.create({data:{id,name:'Synthetic '+id,businessMode:id===productsId?'products':'services',businessModeSelectedAt:at}});
  await prisma.serviceBusinessPolicy.create({data:{merchantId,admissionsEnabled:false,holdEnabled:true,holdMinutes:4,paymentMode:'online',version:2,configuredAt:at}});
  await prisma.product.create({data:{id:'backfill-service',merchantId,name:'Synthetic historical service',type:'service',metadata:{serviceSchedule:{timeZone:'Europe/Lisbon',durationMinutes:30,slots:[]}},variants:{create:{id:'backfill-variant',sku:'OLD-SERVICE',price:{create:{basePriceInCents:9999,currency:'EUR'}}}}}});
  await prisma.product.create({data:{id:'backfill-physical',merchantId:productsId,name:'Synthetic preserved physical',type:'physical',variants:{create:{id:'backfill-physical-variant',sku:'PRESERVE-STOCK',price:{create:{basePriceInCents:2000,currency:'BRL'}},stock:{create:{quantity:11,reserved:2}}}}}});
  await prisma.serviceProfessional.create({data:{id:'backfill-professional',merchantId,publicName:'Historical professional',isActive:false,isPublished:false,timeZone:'Europe/Lisbon',version:3}});
  await prisma.professionalService.create({data:{merchantId,professionalId:'backfill-professional',productId:'backfill-service',isActive:false}});
  await prisma.serviceProfessional.create({data:{id:'backfill-foreign-professional',merchantId:foreignId,publicName:'Foreign professional',timeZone:'UTC'}});
  await prisma.product.create({data:{id:'backfill-foreign-service',merchantId:foreignId,name:'Foreign preserved service',type:'service',variants:{create:{id:'backfill-foreign-variant',sku:'FOREIGN-SERVICE'}}}});
  await prisma.professionalService.create({data:{merchantId:foreignId,professionalId:'backfill-foreign-professional',productId:'backfill-foreign-service'}});
  await prisma.serviceAppointment.create({data:{id:'backfill-foreign-appointment',merchantId:foreignId,professionalId:'backfill-foreign-professional',productId:'backfill-foreign-service',variantId:'backfill-foreign-variant',customerSnapshot:{name:'Synthetic foreign customer'},startsAt:new Date('2020-01-01T10:00:00Z'),endsAt:new Date('2020-01-01T10:30:00Z'),timeZone:'UTC',durationMinutes:30,priceInCents:7000,currency:'BRL',policyVersion:1,policySnapshot:{holdEnabled:false,paymentMode:'at_attendance'},origin:'manual',idempotencyKey:'foreign-history',requestFingerprint:'foreign-history'}});
  async function historical(suffix,withAppointment=true){
   const sessionId='backfill-session-'+suffix,orderId='backfill-order-'+suffix,unitId='unit-'+suffix;
   const day='2020-02-'+String(Number(suffix)).padStart(2,'0');
   const schedule={slotId:'historical-'+suffix,professionalId:'backfill-professional',professionalVersion:3,policyVersion:2,date:day,startsAt:day+'T10:00:00.000Z',endsAt:day+'T10:30:00.000Z',timeZone:'Europe/Lisbon',durationMinutes:30};
   const line={lineId:unitId,snapshotVersion:2,sku:'OLD-SERVICE',variantId:'backfill-variant',productType:'service',fulfillmentStrategy:'scheduled_service',unitPriceCents:5700,quantity:1,schedule};
   await prisma.checkoutSession.create({data:{merchantId,sessionId,globalUserId:'synthetic-historical-buyer',conversationId:'backfill-conversation-'+suffix,cart:{currency:'EUR',total:57,items:[]},customer:{fullName:'PRIVATE HISTORICAL CUSTOMER'},createdAt:at,updatedAt:at}});
   await prisma.paymentIntent.create({data:{id:'backfill-payment-'+suffix,merchantId,sessionId,idempotencyKey:'backfill-payment-'+suffix,amountCents:5700,approvedAmountCents:5700,currency:'EUR',method:'pix',status:'approved',providerPaymentId:'synthetic-provider-'+suffix}});
   await prisma.completedOrder.create({data:{id:orderId,merchantId,sessionId,externalOrderId:'synthetic-provider-'+suffix,orderTotal:57,currency:'EUR',completedAt:at,lineItemsJson:[line],fulfillmentJson:{schemaVersion:1,units:[{id:unitId,lineId:unitId,sku:line.sku,variantId:line.variantId,name:'Historical',productType:'service',strategy:'scheduled_service',quantity:1,completedQuantity:0,selectedOptions:[],status:'scheduled',schedule}]}}});
   const appointmentId='backfill-appointment-'+suffix;
   if(withAppointment)await prisma.serviceAppointment.create({data:{id:appointmentId,merchantId,professionalId:'backfill-professional',productId:'backfill-service',variantId:'backfill-variant',buyerGlobalUserId:'synthetic-historical-buyer',customerSnapshot:{name:'PRIVATE HISTORICAL CUSTOMER'},startsAt:new Date(schedule.startsAt),endsAt:new Date(schedule.endsAt),timeZone:schedule.timeZone,durationMinutes:30,priceInCents:5700,currency:'EUR',policyVersion:2,policySnapshot:{holdEnabled:true,holdMinutes:4,paymentMode:'online'},origin:'storefront',operationalStatus:'scheduled',version:4,idempotencyKey:'old-appointment-'+suffix,requestFingerprint:'old-fingerprint-'+suffix,orderId,orderUnitId:unitId,confirmedAt:at}});
   await prisma.serviceReservation.create({data:{id:'legacy-'+suffix,merchantId,orderId,unitId,resourceId:'backfill-variant',startsAt:new Date(schedule.startsAt),endsAt:new Date(schedule.endsAt),status:'reserved'}});
   return{merchantId,legacyReservationId:'legacy-'+suffix,professionalId:'backfill-professional',appointmentId};
  }
  // Existing canonical capacities start on distinct historical days.
  const first=await historical('01'),second=await historical('02'),unknown=await historical('03',false);
  const snapshot=async()=>({merchants:await prisma.merchant.findMany({orderBy:{id:'asc'}}),policies:await prisma.serviceBusinessPolicy.findMany(),professionals:await prisma.serviceProfessional.findMany({orderBy:{id:'asc'}}),links:await prisma.professionalService.findMany({orderBy:{id:'asc'}}),products:await prisma.product.findMany({orderBy:{id:'asc'}}),variants:await prisma.productVariant.findMany({orderBy:{id:'asc'}}),prices:await prisma.productPrice.findMany({orderBy:{id:'asc'}}),appointments:await prisma.serviceAppointment.findMany({orderBy:{id:'asc'}}),payments:await prisma.paymentIntent.findMany({orderBy:{id:'asc'}}),balances:await prisma.appointmentPayment.findMany(),receipts:await prisma.attendanceReceipt.findMany(),orders:await prisma.completedOrder.findMany({orderBy:{id:'asc'}}),checkouts:await prisma.checkoutSession.findMany({orderBy:{id:'asc'}}),stock:await prisma.productStock.findMany(),movements:await prisma.inventoryMovement.findMany(),outbox:await prisma.outboxMessage.findMany()});
  const old=await snapshot(),reservationsBefore=await prisma.serviceReservation.findMany({orderBy:{id:'asc'}});
  let reviewed;
  await t.test('default dry-run is read-only, pages are scoped, and absent historical facts stay unresolved',async()=>{
   const report=await runServiceAppointmentBackfill(prisma,{merchantId,mappings:[first,second,unknown]});assert.equal(report.dryRun,true);assert.equal(report.scope,'bounded_page');assert.equal(report.counts.reviewable,2);assert.equal(report.counts.unresolved,1);assert.ok(report.rows[2].reasons.includes('canonical_appointment_required'));assert.equal(report.activationAuthorized,false);assert.equal(report.appointmentCreation,'none');assert.equal(report.financialOperation,'none');
   assert.equal(JSON.stringify(report).includes('PRIVATE HISTORICAL CUSTOMER'),false);assert.deepEqual(await snapshot(),old);assert.deepEqual(await prisma.serviceReservation.findMany({orderBy:{id:'asc'}}),reservationsBefore);
   reviewed=report.rows.slice(0,2).map((row,i)=>({...([first,second][i]),expectedSourceFingerprint:row.expectedSourceFingerprint,expectedAppointmentFingerprint:row.expectedAppointmentFingerprint,expectedAppointmentVersion:row.expectedAppointmentVersion}));
   const page=await runServiceAppointmentBackfill(prisma,{merchantId,mappings:[first,second],limit:1});assert.ok(page.nextCursor);const next=await runServiceAppointmentBackfill(prisma,{merchantId,mappings:[first,second],limit:1,cursor:page.nextCursor});assert.equal(next.rows[0].legacyReservationId,second.legacyReservationId);
   await assert.rejects(runServiceAppointmentBackfill(prisma,{merchantId:foreignId,mappings:[first,second],cursor:page.nextCursor}),/backfill_tenant_mismatch|backfill_cursor_scope_mismatch/);
  });
  await t.test('foreign professional and stale reviewed snapshots cannot clear classification or change a canonical record',async()=>{
   const foreign=await runServiceAppointmentBackfill(prisma,{merchantId,mappings:[{...first,professionalId:'backfill-foreign-professional'}]});assert.equal(foreign.rows[0].state,'unresolved');
   const refused=await runServiceAppointmentBackfill(prisma,{merchantId,apply:true,actorId:'synthetic-operator',mappings:[{...reviewed[0],professionalId:'backfill-foreign-professional'}]});assert.equal(refused.rows[0].state,'unresolved');assert.ok(refused.rows[0].reasons.includes('canonical_resource_unproven'));
   const foreignAppointment=await runServiceAppointmentBackfill(prisma,{merchantId,apply:true,actorId:'synthetic-operator',mappings:[{...reviewed[0],appointmentId:'backfill-foreign-appointment'}]});assert.equal(foreignAppointment.rows[0].state,'unresolved');assert.ok(foreignAppointment.rows[0].reasons.includes('canonical_appointment_required'));
   const stale=await runServiceAppointmentBackfill(prisma,{merchantId,apply:true,actorId:'synthetic-operator',mappings:[{...reviewed[0],expectedAppointmentVersion:99}]});assert.equal(stale.rows[0].state,'unresolved');assert.ok(stale.rows[0].reasons.includes('reviewed_facts_changed'));assert.deepEqual(await snapshot(),old);assert.deepEqual(await prisma.serviceReservation.findMany({orderBy:{id:'asc'}}),reservationsBefore);
  });
  await t.test('the real CLI entry defaults to dry-run on the explicitly owned database and emits no customer or DSN',async()=>{
   const result=await promisify(execFile)(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,'--loader',new URL('./ready-prod-loader.mjs',import.meta.url).href,fileURLToPath(new URL('../scripts/service-appointment-backfill.mjs',import.meta.url)),'--merchant',merchantId],{cwd:new URL('../',import.meta.url),env:{...constructionOnlyEnvironment(process.env),SERVICE_BACKFILL_DATABASE_URL:db.prismaUrl},windowsHide:true,timeout:15000,maxBuffer:1000000});
   const report=JSON.parse(result.stdout);assert.equal(report.dryRun,true);assert.equal(report.counts.unresolved,3);assert.equal(report.activationAuthorized,false);assert.equal(result.stdout.includes('PRIVATE HISTORICAL CUSTOMER'),false);assert.equal(result.stdout.includes(db.prismaUrl),false);assert.deepEqual(await snapshot(),old);assert.deepEqual(await prisma.serviceReservation.findMany({orderBy:{id:'asc'}}),reservationsBefore);
  });
  await t.test('one failed audit rolls back only that projection and resumes with no duplicate appointment or receipt',async()=>{
   await db.sql("CREATE FUNCTION synthetic_reject_backfill_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='legacy_reservation_linked' AND NEW.appointment_id='backfill-appointment-02' THEN RAISE EXCEPTION 'synthetic-only-backfill-failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER synthetic_reject_backfill_audit BEFORE INSERT ON appointment_audits FOR EACH ROW EXECUTE FUNCTION synthetic_reject_backfill_audit();");
   let partial;try{partial=await runServiceAppointmentBackfill(prisma,{merchantId,apply:true,actorId:'synthetic-operator',mappings:reviewed});}finally{await db.sql('DROP TRIGGER synthetic_reject_backfill_audit ON appointment_audits; DROP FUNCTION synthetic_reject_backfill_audit();');}
   assert.equal(partial.status,'partial_failure');assert.equal(partial.counts.linked,1);assert.ok(partial.nextCursor);assert.equal((await prisma.serviceReservation.findUniqueOrThrow({where:{id:second.legacyReservationId}})).appointmentId,null);assert.equal(await prisma.appointmentAudit.count({where:{action:'legacy_reservation_linked'}}),1);
   const resumed=await runServiceAppointmentBackfill(prisma,{merchantId,apply:true,actorId:'synthetic-operator',mappings:reviewed,cursor:partial.nextCursor});assert.equal(resumed.status,'page_complete');assert.equal(resumed.counts.linked,1);
   const replay=await runServiceAppointmentBackfill(prisma,{merchantId,apply:true,actorId:'synthetic-operator',mappings:reviewed});assert.equal(replay.counts.alreadyLinked,2);assert.equal(await prisma.appointmentAudit.count({where:{action:'legacy_reservation_linked'}}),2);assert.deepEqual(await snapshot(),old);
   for(const mapped of[first,second]){const row=await prisma.serviceReservation.findUniqueOrThrow({where:{id:mapped.legacyReservationId}});assert.equal(row.appointmentId,mapped.appointmentId);assert.equal(row.classificationPending,false);const prior=reservationsBefore.find(r=>r.id===row.id);assert.deepEqual({...row,appointmentId:null,classificationPending:true},prior);}
   assert.equal((await prisma.serviceReservation.findUniqueOrThrow({where:{id:unknown.legacyReservationId}})).classificationPending,true);assert.equal(await hasUnclassifiedServiceReservations(prisma,merchantId),true);assert.equal((await prisma.serviceBusinessPolicy.findUniqueOrThrow({where:{merchantId}})).admissionsEnabled,false);
  });
 }finally{
  const errors=[];try{await prisma?.$disconnect();}catch(error){errors.push(error);}try{await db.dispose();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'backfill_owned_cleanup_failed');
 }
 assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});
});
