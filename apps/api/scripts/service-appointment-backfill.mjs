import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const fail=code=>{throw new Error(code);};
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,191}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const instant=v=>{try{if(!(v instanceof Date)&&typeof v!=='string')return null;const date=v instanceof Date?v:new Date(v);return typeof v==='string'&&!/(Z|[+-]\d\d:\d\d)$/.test(v)?null:Number.isFinite(date.getTime())?date.toISOString():null;}catch{return null;}};
function normalized(v){if(v instanceof Date)return v.toISOString();if(Array.isArray(v))return v.map(normalized);if(object(v)){if(typeof v.toJSON==='function')return normalized(v.toJSON());return Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalized(v[k])]));}return v===undefined?null:v;}
const fingerprint=v=>createHash('sha256').update(JSON.stringify(normalized(v))).digest('hex');
const projection=status=>status==='scheduled'||status==='in_service'?'reserved':status==='pending'?'cancelled':status;
function sourceSnapshot(reservation,order,professional){const{order:_ignored,...row}=reservation;return{reservation:row,order,professional:professional?{id:professional.id,merchantId:professional.merchantId,version:professional.version}:null};}
function scheduleMatches(s,a){return object(s)&&instant(s.startsAt)===instant(a.startsAt)&&instant(s.endsAt)===instant(a.endsAt)&&s.timeZone===a.timeZone&&s.durationMinutes===a.durationMinutes&&(s.professionalId===undefined||s.professionalId===a.professionalId)&&(s.policyVersion===undefined||s.policyVersion===a.policyVersion);}

export function parseBackfillRequest(input){
 if(!object(input)||!id(input.merchantId))fail('backfill_invalid_merchant');
 const apply=input.apply===true,limit=input.limit??100,mappings=input.mappings??[];
 if(input.apply!==undefined&&typeof input.apply!=='boolean')fail('backfill_invalid_mode');
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('backfill_invalid_limit');
 if(!Array.isArray(mappings)||mappings.length>10000)fail('backfill_invalid_mappings');
 const seen=new Set();
 for(const m of mappings){
  if(!object(m)||m.merchantId!==input.merchantId)fail('backfill_tenant_mismatch');
  if(Object.keys(m).some(k=>!['merchantId','legacyReservationId','professionalId','appointmentId','expectedSourceFingerprint','expectedAppointmentFingerprint','expectedAppointmentVersion'].includes(k))||!id(m.legacyReservationId)||m.professionalId!==undefined&&!id(m.professionalId)||m.appointmentId!==undefined&&!id(m.appointmentId))fail('backfill_invalid_mapping');
  if(seen.has(m.legacyReservationId))fail('backfill_duplicate_mapping');seen.add(m.legacyReservationId);
 }
 if(apply&&(!id(input.actorId)||!mappings.length||mappings.some(m=>!id(m.professionalId)||!id(m.appointmentId)||!positive(m.expectedAppointmentVersion)||!hex(m.expectedSourceFingerprint)||!hex(m.expectedAppointmentFingerprint))))fail('backfill_apply_review_required');
 const copied=structuredClone(mappings).sort((a,b)=>a.legacyReservationId<b.legacyReservationId?-1:a.legacyReservationId>b.legacyReservationId?1:0);
 const mappingFingerprint=fingerprint(copied);let after;
 if(input.cursor!==undefined){
  let c;try{c=JSON.parse(Buffer.from(input.cursor,'base64url').toString());}catch{fail('backfill_invalid_cursor');}
  if(!object(c)||Object.keys(c).some(k=>!['version','merchantId','after','mappingFingerprint','apply'].includes(k))||c.version!==1||c.merchantId!==input.merchantId||c.mappingFingerprint!==mappingFingerprint||c.apply!==apply||!id(c.after))fail('backfill_cursor_scope_mismatch');after=c.after;
 }
 return{merchantId:input.merchantId,actorId:input.actorId,apply,limit,mappings:copied,mappingFingerprint,after};
}
function cursor(request,after){return after?Buffer.from(JSON.stringify({version:1,merchantId:request.merchantId,after,mappingFingerprint:request.mappingFingerprint,apply:request.apply})).toString('base64url'):null;}

/** Existing canonical facts only. The mapping selects references, never creates
 * historical policy, money, attendance, timezone or a replacement professional. */
export function inspectLegacyAppointment({merchantId,reservation:r,order:o,appointment:a,professional:p,link,variant,mapping:m}){
 const reasons=[];if(!object(r)||r.merchantId!==merchantId)fail('backfill_tenant_mismatch');
 const expectedSourceFingerprint=fingerprint(sourceSnapshot(r,o,p));
 const row={legacyReservationId:r.id,merchantId,orderId:r.orderId,unitId:r.unitId,professionalId:m?.professionalId??null,appointmentId:a?.id??null,expectedSourceFingerprint,expectedAppointmentFingerprint:a?fingerprint(a):null,expectedAppointmentVersion:a?.version??null};
 if(!m?.professionalId)reasons.push('professional_mapping_required');
 if(!m?.appointmentId)reasons.push('canonical_appointment_mapping_required');
 if(m&&m.merchantId!==merchantId)reasons.push('mapping_tenant_mismatch');
 if(!a)reasons.push('canonical_appointment_required');
 if(!o||o.id!==r.orderId||o.merchantId!==merchantId)reasons.push('historical_order_required');
 if(a){
  if(a.merchantId!==merchantId||a.id!==m?.appointmentId||a.orderId!==r.orderId||a.orderUnitId!==r.unitId||a.professionalId!==m?.professionalId)reasons.push('canonical_identity_mismatch');
  if(!p||p.merchantId!==merchantId||p.id!==m?.professionalId||!positive(p.version)||!link||link.merchantId!==merchantId||link.professionalId!==a.professionalId||link.productId!==a.productId||!variant||variant.id!==a.variantId||variant.productId!==a.productId)reasons.push('canonical_resource_unproven');
  if(!positive(a.version)||!positive(a.policyVersion)||!object(a.policySnapshot)||typeof a.policySnapshot.holdEnabled!=='boolean'||!['online','at_attendance'].includes(a.policySnapshot.paymentMode)||a.policySnapshot.holdEnabled&&!positive(a.policySnapshot.holdMinutes))reasons.push('historical_policy_unproven');
  const starts=instant(r.startsAt),ends=instant(r.endsAt);
  if(!starts||!ends||starts>=ends||starts!==instant(a.startsAt)||ends!==instant(a.endsAt)||r.resourceId!==a.variantId||!Number.isSafeInteger(a.durationMinutes)||a.durationMinutes<5||a.durationMinutes>480||Date.parse(ends)-Date.parse(starts)!==a.durationMinutes*60000)reasons.push('historical_interval_mismatch');
  if(!Number.isSafeInteger(a.priceInCents)||a.priceInCents<0||typeof a.currency!=='string'||! /^[A-Z]{3}$/.test(a.currency))reasons.push('historical_money_unproven');
  if(!['pending','scheduled','in_service','completed','no_show','cancelled'].includes(a.operationalStatus)||r.status!==projection(a.operationalStatus)||a.operationalStatus==='scheduled'&&!instant(a.confirmedAt)||a.operationalStatus==='in_service'&&!instant(a.startedAt)||a.operationalStatus==='completed'&&!instant(a.completedAt)||a.operationalStatus==='no_show'&&!instant(a.noShowAt)||a.operationalStatus==='cancelled'&&!instant(a.cancelledAt))reasons.push('historical_state_unproven');
  const lines=Array.isArray(o?.lineItemsJson)?o.lineItemsJson.filter(v=>object(v)&&v.lineId===r.unitId):[];
  const line=lines.length===1?lines[0]:undefined,s=line?.schedule;
  const units=Array.isArray(o?.fulfillmentJson?.units)?o.fulfillmentJson.units.filter(v=>object(v)&&v.id===r.unitId):[];
  if(lines.length!==1||line.snapshotVersion!==2||line.productType!=='service'||line.fulfillmentStrategy!=='scheduled_service'||line.quantity!==1||line.variantId!==a.variantId||!Number.isSafeInteger(line.unitPriceCents)||line.unitPriceCents!==a.priceInCents||o.currency!==a.currency||!scheduleMatches(s,a)||units.length!==1||units[0].status!==a.operationalStatus||units[0].variantId!==a.variantId||units[0].productType!=='service'||units[0].strategy!=='scheduled_service'||units[0].quantity!==1||!scheduleMatches(units[0].schedule,a))reasons.push('historical_snapshot_mismatch');
  try{new Intl.DateTimeFormat('en',{timeZone:a.timeZone}).format();}catch{reasons.push('historical_timezone_unproven');}
  if(m?.expectedSourceFingerprint!==undefined&&m.expectedSourceFingerprint!==expectedSourceFingerprint||m?.expectedAppointmentFingerprint!==undefined&&m.expectedAppointmentFingerprint!==row.expectedAppointmentFingerprint||m?.expectedAppointmentVersion!==undefined&&m.expectedAppointmentVersion!==a.version)reasons.push('reviewed_facts_changed');
 }
 if(r.appointmentId!==null&&r.appointmentId!==a?.id||typeof r.classificationPending!=='boolean'||r.appointmentId===null&&!r.classificationPending||r.appointmentId!==null&&r.classificationPending)reasons.push('existing_classification_conflict');
 return{...row,state:reasons.length?'unresolved':r.appointmentId?'already_linked':'reviewable',reasons:[...new Set(reasons)]};
}
async function loadFacts(tx,merchantId,reservation,mapping){
 const r=reservation,order=r.order;
 const appointment=mapping?.appointmentId?await tx.serviceAppointment.findFirst({where:{merchantId,id:mapping.appointmentId}}):await tx.serviceAppointment.findUnique({where:{merchantId_orderId_orderUnitId:{merchantId,orderId:r.orderId,orderUnitId:r.unitId}}});
 const professional=mapping?.professionalId?await tx.serviceProfessional.findFirst({where:{merchantId,id:mapping.professionalId}}):null;
 const link=appointment&&mapping?.professionalId?await tx.professionalService.findUnique({where:{merchantId_professionalId_productId:{merchantId,professionalId:mapping.professionalId,productId:appointment.productId}}}):null;
 const variant=appointment?await tx.productVariant.findFirst({where:{id:appointment.variantId,productId:appointment.productId,product:{merchantId}},select:{id:true,productId:true}}):null;
 return{merchantId,reservation:r,order,appointment,professional,link,variant,mapping};
}
const commandId=(merchantId,m)=>'legacy-link:'+fingerprint([merchantId,m.legacyReservationId,m.appointmentId]);
async function applyOne(prisma,request,mapping,legacyId,locks){
 return prisma.$transaction(async tx=>{
  await locks.lockCatalogMerchant(tx,request.merchantId);
  if(!await tx.serviceProfessional.findFirst({where:{merchantId:request.merchantId,id:mapping.professionalId},select:{id:true}}))return{legacyReservationId:legacyId,state:'unresolved',reasons:['canonical_resource_unproven']};
  await locks.lockServiceProfessional(tx,request.merchantId,mapping.professionalId);
  const first=await tx.serviceReservation.findFirst({where:{merchantId:request.merchantId,id:legacyId},select:{orderId:true}});if(!first)return{legacyReservationId:legacyId,state:'unresolved',reasons:['legacy_reservation_missing']};
  await tx.$queryRaw`SELECT id FROM completed_orders WHERE id=${first.orderId} AND merchant_id=${request.merchantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM service_appointments WHERE id=${mapping.appointmentId} AND merchant_id=${request.merchantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM service_reservations WHERE id=${legacyId} AND merchant_id=${request.merchantId} FOR UPDATE`;
  const reservation=await tx.serviceReservation.findFirst({where:{merchantId:request.merchantId,id:legacyId},include:{order:true}});if(!reservation)return{legacyReservationId:legacyId,state:'unresolved',reasons:['legacy_reservation_missing']};
  const command=commandId(request.merchantId,mapping),receipt=await tx.appointmentAudit.findUnique({where:{merchantId_commandId:{merchantId:request.merchantId,commandId:command}}});
  if(receipt){
   if(receipt.action!=='legacy_reservation_linked'||receipt.appointmentId!==mapping.appointmentId||receipt.after?.legacyReservationId!==legacyId||receipt.after?.professionalId!==mapping.professionalId||!hex(receipt.after?.sourceFingerprint)||!hex(receipt.after?.appointmentFingerprint)||reservation.appointmentId!==mapping.appointmentId||reservation.classificationPending)fail('backfill_receipt_conflict');
   return{legacyReservationId:legacyId,appointmentId:mapping.appointmentId,state:'already_linked',reasons:[]};
  }
  const facts=await loadFacts(tx,request.merchantId,reservation,mapping),review=inspectLegacyAppointment(facts);
  if(review.state!=='reviewable')return review;
  if(await tx.serviceReservation.findFirst({where:{merchantId:request.merchantId,appointmentId:mapping.appointmentId,id:{not:legacyId}},select:{id:true}}))return{...review,state:'unresolved',reasons:['canonical_appointment_already_projected']};
  const changed=await tx.serviceReservation.updateMany({where:{id:legacyId,merchantId:request.merchantId,appointmentId:null,classificationPending:true},data:{appointmentId:mapping.appointmentId,classificationPending:false}});
  if(changed.count!==1)fail('backfill_legacy_changed');
  await tx.appointmentAudit.create({data:{merchantId:request.merchantId,appointmentId:mapping.appointmentId,commandId:command,version:facts.appointment.version,action:'legacy_reservation_linked',actorId:request.actorId,origin:'migration',before:{appointmentId:null,classificationPending:true},after:{legacyReservationId:legacyId,professionalId:mapping.professionalId,appointmentId:mapping.appointmentId,sourceFingerprint:review.expectedSourceFingerprint,appointmentFingerprint:review.expectedAppointmentFingerprint}}});
  return{...review,state:'linked',reasons:[]};
 },{timeout:15000});
}

export async function runServiceAppointmentBackfill(prisma,input){
 const request=parseBackfillRequest(input),mappingById=new Map(request.mappings.map(m=>[m.legacyReservationId,m]));
 const read=await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  if(!await tx.merchant.findUnique({where:{id:request.merchantId},select:{id:true}}))fail('backfill_merchant_not_found');
  const rows=await tx.serviceReservation.findMany({where:{merchantId:request.merchantId,...(request.after?{id:{gt:request.after}}:{})},orderBy:{id:'asc'},take:request.limit+1,include:{order:true}});
  const page=rows.slice(0,request.limit),reviews=[];
  for(const reservation of page)reviews.push(inspectLegacyAppointment(await loadFacts(tx,request.merchantId,reservation,mappingById.get(reservation.id))));
  return{reviews,hasMore:rows.length>request.limit};
 },{isolationLevel:'RepeatableRead',timeout:15000});
 let last=request.after;const rows=[];let failure;
 let locks;
 if(request.apply){const[merchant,professional]=await Promise.all([import('../dist/shared/persistence/catalog-stock-ledger.js'),import('../dist/shared/bookings/service-professional-lock.js')]);locks={lockCatalogMerchant:merchant.lockCatalogMerchant,lockServiceProfessional:professional.lockServiceProfessional};}
 for(const review of read.reviews){
  if(!request.apply||!mappingById.has(review.legacyReservationId)){rows.push(review);last=review.legacyReservationId;continue;}
  try{rows.push(await applyOne(prisma,request,mappingById.get(review.legacyReservationId),review.legacyReservationId,locks));last=review.legacyReservationId;}
  catch(error){failure={legacyReservationId:review.legacyReservationId,code:['backfill_receipt_conflict','backfill_legacy_changed'].includes(error?.message)?error.message:'backfill_row_transaction_failed'};break;}
 }
 const counts={scanned:read.reviews.length,processed:rows.length,reviewable:0,linked:0,alreadyLinked:0,unresolved:0};for(const row of rows)counts[row.state==='already_linked'?'alreadyLinked':row.state]++;
 return{merchantId:request.merchantId,dryRun:!request.apply,scope:'bounded_page',status:failure?'partial_failure':'page_complete',rows,counts,nextCursor:failure||read.hasMore?cursor(request,last):null,hasMore:!!failure||read.hasMore,...(failure?{failure}:{}),activationAuthorized:false,appointmentCreation:'none',financialOperation:'none'};
}

async function main(){
 const args=process.argv.slice(2),values={};let apply=false;
 for(let n=0;n<args.length;n++){const key=args[n];if(key==='--apply'){apply=true;continue;}if(!['--merchant','--mapping','--actor','--cursor','--limit'].includes(key)||!args[n+1]||args[n+1].startsWith('--'))fail('backfill_invalid_arguments');values[key]=args[++n];}
 let manifest={mappings:[]};if(values['--mapping']){manifest=JSON.parse(await readFile(values['--mapping'],'utf8'));if(manifest.schemaVersion!==1||manifest.merchantId!==values['--merchant']||!Array.isArray(manifest.mappings))fail('backfill_invalid_manifest');}
 const input={merchantId:values['--merchant'],mappings:manifest.mappings,actorId:values['--actor'],cursor:values['--cursor'],limit:values['--limit']===undefined?undefined:Number(values['--limit']),apply};parseBackfillRequest(input);
 const url=process.env.SERVICE_BACKFILL_DATABASE_URL;if(!url)fail('backfill_explicit_database_required');
 const{PrismaClient}=await import('@prisma/client');const prisma=new PrismaClient({datasources:{db:{url}}});
 try{const report=await runServiceAppointmentBackfill(prisma,input);process.stdout.write(JSON.stringify(report,null,2)+'\n');if(report.status==='partial_failure')process.exitCode=1;}finally{await prisma.$disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('service_appointment_backfill_failed\n');process.exitCode=1;});
