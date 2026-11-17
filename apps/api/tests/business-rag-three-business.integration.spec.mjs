import assert from 'node:assert/strict';
import test from 'node:test';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {servedBusinessFixture,serviceId,professionalId} from './business-answer-served-fixture.mjs';

// Synthetic model transport, actual HTTP/auth/SQL/factory/audit. This proves
// generic source composition, not the semantic accuracy of a real provider.
const profiles=[
  {business:'clinic',company:'Synthetic Clinic',service:'Published clinic appointment',professional:'Clinic Professional'},
  {business:'salon',company:'Synthetic Salon',service:'Published salon appointment',professional:'Salon Professional'},
  {business:'consulting',company:'Synthetic Consulting',service:'Published consulting appointment',professional:'Consulting Professional'},
];

test('T71 actual public composition uses each business own published context',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  for(const profile of profiles)await t.test(profile.business,async()=>{
    const description=profile.company+' provides '+profile.service+'.',
      reply=description+' '+profile.professional+'. Monday: 09:00-18:00.';
    const f=await servedBusinessFixture('support',[
      {phase:'business.answer-plan',response:{kind:'informational',liveRequests:[]}},
      {phase:'support.answer',response:reply},
    ]);
    try{
      await f.prisma.$transaction(async tx=>{
        await tx.merchant.update({where:{id:f.own.merchant_id},data:{name:profile.company,storeSettings:{
          company:{description,serviceNames:[profile.service]},
          businessHours:[{day:'Monday',startTime:'09:00',endTime:'18:00',closed:false}],
          privateCanary:'PRIVATE_CANARY_T71',
        }}});
        await tx.product.update({where:{id:serviceId},data:{name:profile.service,description:'Public service for '+profile.business}});
        await tx.serviceProfessional.update({where:{id:professionalId},data:{publicName:profile.professional,
          publicProfile:{description:'Public profile for '+profile.business,specialties:[profile.business]}}});
      });
      const before=await f.snapshot();
      const result=await f.request('/support/chat/public',{merchant_id:f.own.merchant_id,
        session_id:'generic-'+profile.business,message:'Present the company, published service, professional and business hours.'});
      assert.equal(result.status,201);assert.equal(result.body.reply,reply);assert.equal(result.body.safe,true);
      assert.equal(result.body.handoff,undefined);
      const audit=await f.audit(result);await f.assertCanonicalReferences(audit);
      for(const type of ['company','business_hours','service','professional'])
        assert.ok(audit.metadata.references.some(reference=>reference.sourceType===type),type);
      const events=f.events(),generator=events.find(event=>event.result?.scriptStep===2);
      assert.ok(generator);assert.equal(events.filter(event=>event.kind==='chatCompletion').length,2);
      const quoted=generator.input.messages[0].content;
      for(const value of [description,profile.service,profile.professional,'09:00','18:00'])assert.ok(quoted.includes(value),value);
      for(const other of profiles.filter(item=>item!==profile))assert.equal(quoted.includes(other.company),false);
      assert.doesNotMatch(quoted,/FOREIGN_CANARY_T71|PRIVATE_CANARY_T71/);
      assert.deepEqual(await f.snapshot(),before);f.assertTransport();
    }finally{await f.close();}
  });
});
