import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Keep all measured machine facts. Only the live asOf scalar is evaluated
 * against the real HTTP time bracket instead of an invented frozen clock.
 * This function neither calls nor replaces the canonical reader. */
export function projectObservedLive(result,{startedAt,finishedAt}={}){
  assert.ok(Number.isFinite(startedAt)&&Number.isFinite(finishedAt)&&startedAt<=finishedAt,'evaluation_clock_bracket');
  assert.ok(object(result)&&object(result.facts)&&object(result.publicLabels)&&object(result.availability),'evaluation_live_result');
  const {asOf,...availability}=result.availability,timestamp=Date.parse(asOf);
  assert.ok(typeof asOf==='string'&&Number.isFinite(timestamp)&&timestamp>=startedAt&&timestamp<=finishedAt,'evaluation_live_clock');
  return structuredClone({...result,availability});
}

/** Ground truth from the named synthetic SQL fixture BEFORE each HTTP turn.
 * Public projection serialization is the same approved source contract; live
 * slots below come independently from the asserted UTC seed and occupancy,
 * not from getProfessionalAvailability or PrismaCurrentServiceFactsReader.
 */
export async function canonicalEvaluationTruth(f,{serviceId,variantId,professionalId,date}){
  const merchantId=f.own.merchant_id;
  const {readCanonicalPublicBusinessSourceWithin}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const {publicBusinessTextChunks}=await import('../dist/modules/graph-rag/application/public-business-projection.service.js');
  return f.prisma.$transaction(async tx=>{
    assert.deepEqual(await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR SHARE`,[{id:merchantId}]);
    const company=await tx.merchant.findUniqueOrThrow({where:{id:merchantId}}),
      link=await tx.professionalService.findFirstOrThrow({where:{merchantId,professionalId,productId:serviceId},
        include:{professional:true,product:{include:{variants:{where:{id:variantId},include:{price:true}}}}}}),
      policy=await tx.serviceBusinessPolicy.findUniqueOrThrow({where:{merchantId}}),
      recurring=await tx.professionalAvailability.findMany({where:{merchantId,professionalId,isActive:true}}),
      exceptions=await tx.availabilityException.findMany({where:{merchantId,professionalId,isActive:true}}),
      appointments=await tx.serviceAppointment.findMany({where:{merchantId,professionalId,
        operationalStatus:{in:['scheduled','in_service','completed','no_show']}}});
    assert.equal(company.businessMode,'services');assert.ok(company.businessModeSelectedAt);assert.equal(company.businessModeNeedsReview,false);
    assert.equal(link.isActive,true);assert.equal(link.professional.isActive,true);assert.equal(link.professional.isPublished,true);
    assert.equal(link.professional.timeZone,'UTC');assert.equal(link.product.type,'service');assert.equal(link.product.isActive,true);
    assert.equal(link.product.deletedAt,null);assert.equal(link.product.metadata.serviceSchedule.durationMinutes,30);
    assert.equal(link.product.variants.length,1);const variant=link.product.variants[0];assert.equal(variant.isActive,true);assert.ok(variant.price);
    assert.equal(policy.admissionsEnabled,true);assert.equal(policy.holdEnabled,false);assert.equal(policy.paymentMode,'at_attendance');
    assert.ok(policy.configuredAt);assert.equal(policy.version,1);assert.equal(recurring.length,1);assert.deepEqual(exceptions,[]);
    const row=recurring[0];assert.equal(row.weekday,new Date(date+'T00:00:00Z').getUTCDay());
    assert.equal(row.startMinute,600);assert.equal(row.endMinute,720);assert.equal(row.timeZone,'UTC');
    assert.equal(row.validFrom,null);assert.equal(row.validUntil,null);
    assert.ok(appointments.length===0||appointments.length===1);
    for(const appointment of appointments){
      assert.equal(appointment.startsAt.toISOString(),date+'T10:00:00.000Z');
      assert.equal(appointment.endsAt.toISOString(),date+'T10:30:00.000Z');
      assert.equal(appointment.productId,serviceId);assert.equal(appointment.variantId,variantId);
    }
    const ids=[['company',merchantId],['business_hours',merchantId],['professional',professionalId],['service',serviceId]];
    const support=await tx.supportSetting.findUnique({where:{merchantId},select:{faqItems:true}});
    if(support)assert.deepEqual(support.faqItems,[]);
    assert.equal(await tx.merchantPolicy.count({where:{merchantId}}),0);
    const references=[];
    for(const [sourceType,sourceId]of ids){
      const source=await readCanonicalPublicBusinessSourceWithin(tx,merchantId,sourceType,sourceId);
      assert.ok(source);assert.equal(source.publicationState,'published');
      const chunks=publicBusinessTextChunks(source.text);assert.equal(chunks.length,1);
      references.push({origin:'canonical_sql',namespace:'canonical-public',merchantId,sourceType,sourceId,
        sourceVersion:source.sourceVersion,sourceHash:source.sourceHash,publicWorkVersion:null,publicationState:'published',
        embeddingModel:null,embeddingDimensions:null,chunkId:hash(JSON.stringify([sourceType,sourceId,0])),contentHash:hash(chunks[0])});
    }
    const starts=[['10:00','07:00'],['10:30','07:30'],['11:00','08:00'],['11:30','08:30']].slice(appointments.length?1:0),
      slots=starts.map(([utcTime,startTime])=>({date,startTime,startsAt:date+'T'+utcTime+':00.000Z',
        endsAt:new Date(Date.parse(date+'T'+utcTime+':00Z')+30*60000).toISOString(),timeZone:'America/Sao_Paulo',durationMinutes:30}));
    return{references,live:{facts:{merchantId,professionalId,professionalVersion:link.professional.version,
      professionalServiceId:link.id,productId:serviceId,variantId,categoryId:link.product.categoryId,durationMinutes:30,
      timeZone:'America/Sao_Paulo',priceInCents:variant.price.basePriceInCents,currency:variant.price.currency},
      publicLabels:{serviceName:link.product.name,professionalName:link.professional.publicName},
      availability:{professionalVersion:link.professional.version,policyVersion:policy.version,timeZone:'America/Sao_Paulo',durationMinutes:30,
        status:'ready',dates:[date],slots}}};
  });
}
