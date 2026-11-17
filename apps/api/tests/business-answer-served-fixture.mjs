import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createServiceTestRuntime} from './service-test-runtime.mjs';

export const serviceId='synthetic-t71-service',variantId='synthetic-t71-variant',professionalId='synthetic-t71-professional';
const future=new Date();future.setUTCDate(future.getUTCDate()+2);
export const liveDate=future.toISOString().slice(0,10);
export const liveRequest={productId:serviceId,professionalId,variantId,fromDate:liveDate,toDate:liveDate};
export const answer='PUBLISHED_PREPARATION_T71: consulte as orientações públicas da equipe.';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function servedBusinessFixture(channel,modelScript){
  const runtime=await createServiceTestRuntime({local:true,[channel==='support'?'supportQueryModel':'storefrontQueryModel']:true,modelScript});
  let prisma;
  try{
    const{PrismaClient}=await import('@prisma/client');prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const request=async(path,body,token,method='POST')=>{
      const correlationId=randomUUID(),response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','idempotency-key':randomUUID(),'x-correlation-id':correlationId,
          ...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,body:await response.json(),correlationId};
    };
    const register=async suffix=>{
      const result=await request('/auth/register',{merchant_name:'Synthetic T71 '+suffix,email:channel+'-'+suffix+'@t71.example.test',
        password:'SyntheticPassword123!',business_mode:'services'});
      assert.equal(result.status,201,JSON.stringify(result));return result.body;
    };
    const own=await register('own'),foreign=await register('foreign');
    // Named synthetic seeds, as in existing availability fixtures. No repo or
    // authorization replacement. Public source selection remains productive.
    for(const auth of [own,foreign]){
      await prisma.merchant.update({where:{id:auth.merchant_id},data:{plan:'STORE_ONLY',storeSettings:{
        company:{description:auth===own?answer:'FOREIGN_CANARY_T71'},privateCanary:'PRIVATE_CANARY_T71'}}});
      await prisma.merchantBillingSubscription.upsert({where:{merchantId:auth.merchant_id},
        create:{merchantId:auth.merchant_id,planKey:'growth',status:'active'},update:{planKey:'growth',status:'active'}});
    }
    await prisma.product.create({data:{id:serviceId,merchantId:own.merchant_id,name:'Current T71 service',type:'service',
      description:'Public preparation only',metadata:{serviceSchedule:{durationMinutes:30,timeZone:'UTC',slots:[]}},
      variants:{create:{id:variantId,sku:'T71-SERVED',price:{create:{basePriceInCents:7300,currency:'BRL'}}}}}});
    await prisma.serviceProfessional.create({data:{id:professionalId,merchantId:own.merchant_id,publicName:'Current T71 professional',
      isPublished:true,timeZone:'UTC',publicProfile:{description:'Public biography only',specialties:['Consulting']}}});
    await prisma.professionalService.create({data:{merchantId:own.merchant_id,professionalId,productId:serviceId}});
    await prisma.professionalAvailability.create({data:{merchantId:own.merchant_id,professionalId,
      weekday:new Date(liveDate+'T00:00:00Z').getUTCDay(),startMinute:600,endMinute:720,timeZone:'UTC'}});
    const policy={holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',version:1,configuredAt:new Date(),admissionsEnabled:true};
    await prisma.serviceBusinessPolicy.upsert({where:{merchantId:own.merchant_id},create:{merchantId:own.merchant_id,...policy},update:policy});
    const events=()=>runtime[channel==='support'?'supportQueryModel':'storefrontQueryModel'].events();
    const waitHeld=async step=>{
      const end=Date.now()+5000;let event;
      do{event=events().find(item=>item.result?.scriptStep===step&&item.result?.held===true);if(event)return event;await pause(10);}while(Date.now()<end);
      assert.fail('actual_model_transport_hold_not_observed');
    };
    const whileHeld=async(pending,step,mutate)=>{
      await waitHeld(step);let mutationError;
      try{await mutate();}catch(error){mutationError=error;}finally{runtime.modelScript.release(step);}
      const result=await pending;if(mutationError)throw mutationError;return result;
    };
    const setDescription=async description=>{
      const row=await prisma.merchant.findUniqueOrThrow({where:{id:own.merchant_id}});
      await prisma.merchant.update({where:{id:own.merchant_id},data:{storeSettings:{...row.storeSettings,
        company:{...row.storeSettings.company,description}}}});
    };
    const occupyAndReprice=async()=>{
      const startsAt=new Date(liveDate+'T10:00:00Z'),endsAt=new Date(liveDate+'T10:30:00Z'),
        customer={name:'PRIVATE_APPOINTMENT_CANARY_T71',email:'synthetic-t71-buyer@example.test'};
      // Same ordered identity fields as the current admission fingerprint;
      // this is a named synthetic SQL seed, not a claimed admission execution.
      const requestFingerprint=hash(JSON.stringify(['service-appointment-admission-v1',own.merchant_id,professionalId,serviceId,variantId,
        liveDate,startsAt.toISOString(),endsAt.toISOString(),1,1,7300,'BRL',customer.name,null,customer.email,null,
        'manual','synthetic-t71-fixture','at_attendance',null,null]));
      await prisma.$transaction(async tx=>{
        await tx.serviceAppointment.create({data:{merchantId:own.merchant_id,professionalId,productId:serviceId,variantId,
          customerSnapshot:customer,startsAt,endsAt,timeZone:'UTC',durationMinutes:30,priceInCents:7300,currency:'BRL',policyVersion:1,
          policySnapshot:{holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance'},origin:'manual',operationalStatus:'scheduled',
          confirmedAt:new Date(),idempotencyKey:'synthetic-t71-occupancy',requestFingerprint}});
        await tx.productPrice.update({where:{variantId},data:{basePriceInCents:7900}});
      });
    };
    const audit=async(result,status='ready')=>{
      const rows=await prisma.merchantAuditEvent.findMany({where:{merchantId:own.merchant_id,correlationId:result.correlationId,action:'knowledge.response'}});
      assert.equal(rows.length,1,'served_response_requires_one_settled_audit');const row=rows[0];
      assert.equal(row.actorType,'service');assert.equal(row.actorId,'knowledge-response');assert.equal(row.outcome,'success');
      assert.equal(row.metadata.channel,channel);assert.equal(row.metadata.evidenceRole,'admitted_context');
      assert.equal(row.metadata.responseStage,'application_reply');assert.equal(row.metadata.responseSha256,hash(result.body.reply??result.body.message));
      if(status==='ready')assert.equal(row.metadata.evidenceStatus,'ready');else{
        assert.notEqual(row.metadata.evidenceStatus,'ready');assert.deepEqual(row.metadata.references,[]);
      }
      assert.equal(await prisma.merchantAuditEvent.count({where:{merchantId:foreign.merchant_id,action:'knowledge.response'}}),0);
      const encoded=JSON.stringify(row.metadata);
      for(const forbidden of [answer,'FOREIGN_CANARY_T71','PRIVATE_CANARY_T71','PRIVATE_APPOINTMENT_CANARY_T71',result.body.ai_user_token].filter(Boolean))
        assert.equal(encoded.includes(forbidden),false);
      return row;
    };
    const assertCanonicalReferences=async row=>{
      const{readCanonicalPublicBusinessSourceWithin}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
      assert.ok(row.metadata.references.length>0);
      for(const reference of row.metadata.references){
        assert.equal(reference.merchantId,own.merchant_id);
        const canonical=await prisma.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM merchants WHERE id=${own.merchant_id} FOR SHARE`;
          return readCanonicalPublicBusinessSourceWithin(tx,own.merchant_id,reference.sourceType,reference.sourceId);
        });
        assert.ok(canonical);assert.equal(reference.sourceHash,canonical.sourceHash);assert.equal(reference.sourceVersion,canonical.sourceVersion);
        assert.equal(reference.publicationState,'published');
      }
    };
    const snapshot=async()=>({orders:await prisma.completedOrder.count({where:{merchantId:own.merchant_id}}),
      payments:await prisma.paymentIntent.count({where:{merchantId:own.merchant_id}}),appointments:await prisma.serviceAppointment.count({where:{merchantId:own.merchant_id}}),
      tickets:await prisma.supportTicket.count({where:{merchantId:own.merchant_id}})});
    const assertTransport=()=>{
      assert.equal(runtime.evidence().canonicalAppModule,true);assert.equal(runtime.evidence().authOverrides,false);
      assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().providerCalls,0);
      assert.deepEqual(runtime.evidence().localProviderOverrides,[]);
      assert.deepEqual(runtime.evidence().localModelOverrides,['QueryKnowledgeUseCase.embeddingService',
        channel==='support'?'support.CHAT_COMPLETION_PORT':'storefront.STOREFRONT_PROVIDER_FETCH_FACTORY']);
    };
    assertTransport();
    return{runtime,prisma,own,foreign,request,events,waitHeld,whileHeld,setDescription,occupyAndReprice,audit,assertCanonicalReferences,snapshot,assertTransport,
      async close(){await prisma.$disconnect();await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}};
  }catch(error){if(prisma)await prisma.$disconnect();await runtime.close();throw error;}
}
