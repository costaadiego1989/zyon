import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLegacyAppointment,parseBackfillRequest} from './service-appointment-backfill.mjs';

function facts(){
 const schedule={startsAt:'2020-02-01T10:00:00.000Z',endsAt:'2020-02-01T10:30:00.000Z',timeZone:'Europe/Lisbon',durationMinutes:30,professionalId:'professional-a',professionalVersion:3,policyVersion:2};
 const line={lineId:'unit-a',snapshotVersion:2,productType:'service',fulfillmentStrategy:'scheduled_service',sku:'old-service',variantId:'variant-a',unitPriceCents:5700,quantity:1,schedule};
 const reservation={id:'legacy-a',merchantId:'tenant-a',orderId:'order-a',unitId:'unit-a',resourceId:'variant-a',startsAt:new Date(schedule.startsAt),endsAt:new Date(schedule.endsAt),status:'reserved',appointmentId:null,classificationPending:true};
 const appointment={id:'appointment-a',merchantId:'tenant-a',professionalId:'professional-a',productId:'product-a',variantId:'variant-a',orderId:'order-a',orderUnitId:'unit-a',version:4,policyVersion:2,policySnapshot:{holdEnabled:true,holdMinutes:4,paymentMode:'online'},customerSnapshot:{name:'PRIVATE CUSTOMER'},startsAt:new Date(schedule.startsAt),endsAt:new Date(schedule.endsAt),timeZone:schedule.timeZone,durationMinutes:30,priceInCents:5700,currency:'EUR',operationalStatus:'scheduled',confirmedAt:new Date('2019-12-01T10:00:00Z')};
 return{merchantId:'tenant-a',reservation,appointment,order:{id:'order-a',merchantId:'tenant-a',currency:'EUR',lineItemsJson:[line],fulfillmentJson:{schemaVersion:1,units:[{id:'unit-a',variantId:'variant-a',productType:'service',strategy:'scheduled_service',quantity:1,status:'scheduled',schedule}]}},professional:{id:'professional-a',merchantId:'tenant-a',version:3,isActive:false},link:{merchantId:'tenant-a',professionalId:'professional-a',productId:'product-a'},variant:{id:'variant-a',productId:'product-a'},mapping:{merchantId:'tenant-a',legacyReservationId:'legacy-a',professionalId:'professional-a',appointmentId:'appointment-a'}};
}
test('T84 dry-run is the default and tenant/cursor/mapping scope is explicit',()=>{
 const request=parseBackfillRequest({merchantId:'tenant-a'});assert.equal(request.apply,false);assert.equal(request.limit,100);assert.deepEqual(request.mappings,[]);
 assert.throws(()=>parseBackfillRequest({merchantId:'tenant-a',apply:true}),/backfill_apply_review_required/);
 assert.throws(()=>parseBackfillRequest({merchantId:'tenant-a',mappings:[{merchantId:'foreign',legacyReservationId:'legacy-a',professionalId:'p',appointmentId:'a'}]}),/backfill_tenant_mismatch/);
 assert.throws(()=>parseBackfillRequest({merchantId:'tenant-a',limit:1001}),/backfill_invalid_limit/);
 for(const forbidden of[{priceInCents:0},{operationalStatus:'completed'},{paid:true},{policySnapshot:{holdEnabled:false}}])assert.throws(()=>parseBackfillRequest({merchantId:'tenant-a',mappings:[{merchantId:'tenant-a',legacyReservationId:'legacy-a',professionalId:'professional-a',appointmentId:'appointment-a',...forbidden}]}),/backfill_invalid_mapping/);
});
test('T84 unknown historical facts never become new appointments, policy, presence or money',()=>{
 const f=facts();const before=structuredClone(f);
 assert.equal(inspectLegacyAppointment({...f,mapping:undefined}).state,'unresolved');
 assert.ok(inspectLegacyAppointment({...f,appointment:null}).reasons.includes('canonical_appointment_required'));
 const incomplete=structuredClone(f);incomplete.order.lineItemsJson[0].schedule.timeZone=undefined;
 assert.equal(inspectLegacyAppointment(incomplete).state,'unresolved');
 assert.equal(JSON.stringify(inspectLegacyAppointment(f)).includes('PRIVATE CUSTOMER'),false);assert.deepEqual(f,before);
});
test('T84 exact canonical historical references are reviewable without replacing inactive resources or time zones',()=>{
 const f=facts();const row=inspectLegacyAppointment(f);assert.equal(row.state,'reviewable');assert.equal(row.appointmentId,'appointment-a');assert.equal(row.professionalId,'professional-a');assert.equal(row.expectedAppointmentVersion,4);assert.match(row.expectedSourceFingerprint,/^[a-f0-9]{64}$/);assert.match(row.expectedAppointmentFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(f.appointment.timeZone,'Europe/Lisbon');assert.equal(f.appointment.priceInCents,5700);assert.equal(f.professional.isActive,false);
});
test('T84 foreign, conflicting intervals, status, price, policy and reviewed version are unresolved rather than rewritten',()=>{
 for(const alter of[f=>{f.appointment.merchantId='foreign';},f=>{f.appointment.professionalId='other';},f=>{f.reservation.endsAt=new Date('2020-02-01T10:45:00Z');},f=>{f.appointment.priceInCents=0;},f=>{f.order.fulfillmentJson.units[0].status='completed';},f=>{f.appointment.policyVersion=9;},f=>{f.mapping.expectedAppointmentVersion=3;},f=>{f.mapping.expectedSourceFingerprint='a'.repeat(64);},f=>{f.appointment.policySnapshot={};},f=>{f.appointment.confirmedAt=null;}]){const f=facts();alter(f);assert.equal(inspectLegacyAppointment(f).state,'unresolved');}
});
test('T84 a past reservation is not evidence of completed attendance or an automatic professional choice',()=>{
 const f=facts();f.appointment.operationalStatus='completed';f.appointment.completedAt=new Date('2020-02-01T10:30:00Z');
 assert.equal(inspectLegacyAppointment(f).state,'unresolved');
 f.order.fulfillmentJson.units[0].status='completed';f.reservation.status='completed';assert.equal(inspectLegacyAppointment(f).state,'reviewable');
 assert.equal(inspectLegacyAppointment({...f,mapping:{...f.mapping,professionalId:undefined}}).state,'unresolved');
});
