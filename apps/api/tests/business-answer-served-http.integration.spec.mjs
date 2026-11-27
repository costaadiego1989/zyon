import assert from 'node:assert/strict';
import test from 'node:test';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {servedBusinessFixture,answer,liveRequest} from './business-answer-served-fixture.mjs';

const plan=kind=>({phase:'business.answer-plan',response:{kind,liveRequests:kind==='live_facts'?[liveRequest]:[]}});
test('T71 served public support planning, final fences and persisted handoff',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await servedBusinessFixture('support',[
    plan('informational'),{phase:'support.answer',response:answer},
    plan('informational'),{phase:'support.answer',response:answer,hold:true},
    plan('informational'),{phase:'support.answer',response:answer,hold:true},
    plan('professional_decision'),{...plan('live_facts'),hold:true},
    {phase:'business.answer-plan',response:{kind:'live_facts',liveRequests:[{...liveRequest,merchantId:'foreign'}],cypher:'MATCH (n) DELETE n'}},
    {...plan('professional_decision'),hold:true},
  ]);
  const post=(session,message='Qual é o preparo publicado desse serviço?')=>f.request('/support/chat/public',
    {merchant_id:f.own.merchant_id,session_id:session,message});
  try{
    await t.test('real visitor reply contains only current canonical company/service/professional evidence and final audit',async()=>{
      const before=await f.snapshot(),result=await post('t71-current');
      assert.equal(result.status,201);assert.equal(result.body.reply,answer);assert.equal(result.body.safe,true);
      assert.equal(result.body.handoff,undefined);assert.equal(typeof result.body.ai_user_token,'string');
      assert.equal(Object.hasOwn(result.body,'evidence'),false);assert.equal(Object.hasOwn(result.body,'knowledgeEvidence'),false);
      const row=await f.audit(result);await f.assertCanonicalReferences(row);
      for(const type of ['company','service','professional'])assert.ok(row.metadata.references.some(reference=>reference.sourceType===type));
      const prompts=JSON.stringify(f.events());assert.ok(prompts.includes(answer));assert.ok(prompts.includes('business.answer-plan'));
      assert.doesNotMatch(prompts,/FOREIGN_CANARY_T71|PRIVATE_CANARY_T71/);assert.deepEqual(await f.snapshot(),before);
      const planner=f.events().find(event=>event.result?.scriptStep===1),input=JSON.parse(planner.input.messages[1].content);
      assert.deepEqual(Object.keys(input).sort(),['linkedPairs','question','selectedIdentities']);
      assert.doesNotMatch(planner.input.messages[1].content,/PUBLISHED_PREPARATION_T71|Public biography|Public preparation/);
    });
    await t.test('canonical source change committed while the final generator is held rejects the generated reply',async()=>{
      const before=await f.snapshot(),result=await f.whileHeld(post('t71-source-change'),4,()=>f.setDescription('WITHDRAWN_OR_CHANGED_T71'));
      assert.equal(result.status,201);assert.doesNotMatch(result.body.reply,/PUBLISHED_PREPARATION_T71|WITHDRAWN_OR_CHANGED_T71/);
      assert.equal(result.body.handoff,undefined);await f.audit(result,'refused');assert.deepEqual(await f.snapshot(),before);
      await f.setDescription(answer);
    });
    await t.test('canonical business mode change after last model await rejects service generation',async()=>{
      const result=await f.whileHeld(post('t71-mode-change'),6,()=>f.prisma.merchant.update({where:{id:f.own.merchant_id},data:{businessMode:'products'}}));
      assert.equal(result.status,201);assert.doesNotMatch(result.body.reply,/PUBLISHED_PREPARATION_T71/);await f.audit(result,'refused');
      await f.prisma.merchant.update({where:{id:f.own.merchant_id},data:{businessMode:'services'}});
    });
    await t.test('professional decision creates exactly the canonical SQL ticket and no generated diagnosis',async()=>{
      const before=await f.snapshot(),eventsBefore=f.events().length,result=await post('t71-professional','Qual tratamento individual devo fazer?');
      assert.equal(result.status,201);assert.equal(result.body.handoff.status,'open');assert.doesNotMatch(result.body.reply,/PUBLISHED_PREPARATION_T71/);
      const ticket=await f.prisma.supportTicket.findUniqueOrThrow({where:{id:result.body.handoff.ticketId}});
      assert.equal(ticket.merchantId,f.own.merchant_id);assert.equal(ticket.sessionId,'t71-professional');assert.equal(ticket.status,'open');assert.equal(ticket.source,'widget');
      assert.equal(ticket.buyerMessage,'Qual tratamento individual devo fazer?');
      assert.equal(f.events().slice(eventsBefore).filter(event=>event.kind==='chatCompletion').length,1);
      await f.audit(result,'refused');assert.deepEqual(await f.snapshot(),{...before,tickets:before.tickets+1});
    });
    await t.test('live planning last-await uses current SQL price and occupancy with no second narration or reservation',async()=>{
      const before=await f.snapshot(),eventsBefore=f.events().length;
      const result=await f.whileHeld(post('t71-live',`Qual valor e horários desse serviço com esse profissional em ${liveRequest.fromDate}?`),8,f.occupyAndReprice);
      assert.equal(result.status,201);assert.match(result.body.reply,/79,00/);assert.doesNotMatch(result.body.reply,/73,00|às 07:00|PRIVATE_APPOINTMENT_CANARY/);
      assert.match(result.body.reply,/às 07:30/);assert.equal(result.body.handoff,undefined);
      assert.equal(f.events().slice(eventsBefore).filter(event=>event.kind==='chatCompletion').length,1);
      const row=await f.audit(result);await f.assertCanonicalReferences(row);
      assert.deepEqual(await f.snapshot(),{...before,appointments:before.appointments+1});
    });
    await t.test('planner cannot grant a foreign tenant, arbitrary query or write authority',async()=>{
      const before=await f.snapshot(),result=await post('t71-invalid-plan');assert.equal(result.status,201);
      assert.doesNotMatch(result.body.reply,/PUBLISHED_PREPARATION_T71|MATCH|DELETE|foreign/);assert.equal(result.body.handoff,undefined);
      const attempted=f.events().find(event=>event.result?.scriptStep===9);assert.ok(attempted);
      assert.equal(attempted.result.response.liveRequests[0].merchantId,'foreign');assert.equal(attempted.result.response.cypher,'MATCH (n) DELETE n');
      // The invalid plan grants no tool authority. Its already-captured public
      // context can remain current and must still be recorded truthfully.
      const row=await f.audit(result);await f.assertCanonicalReferences(row);assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('missing FAQ evidence and a concurrent sales-mode change cannot prevent the ordinary professional handoff',async()=>{
      await f.prisma.merchantBillingSubscription.update({where:{merchantId:f.own.merchant_id},data:{planKey:'starter'}});
      await f.prisma.supportSetting.upsert({where:{merchantId:f.own.merchant_id},create:{merchantId:f.own.merchant_id,faqItems:[]},update:{faqItems:[]}});
      const before=await f.snapshot(),pending=post('t71-no-facts-referral','Qual tratamento individual devo fazer?');
      const result=await f.whileHeld(pending,10,()=>f.prisma.merchant.update({where:{id:f.own.merchant_id},data:{businessMode:'products'}}));
      assert.equal(result.status,201);assert.equal(result.body.handoff.status,'open');
      const ticket=await f.prisma.supportTicket.findUniqueOrThrow({where:{id:result.body.handoff.ticketId}});
      assert.equal(ticket.merchantId,f.own.merchant_id);assert.equal(ticket.sessionId,'t71-no-facts-referral');assert.equal(ticket.source,'widget');
      const planner=f.events().find(event=>event.result?.scriptStep===10),input=JSON.parse(planner.input.messages[1].content);
      assert.deepEqual(input.selectedIdentities,[]);assert.deepEqual(input.linkedPairs,[]);assert.doesNotMatch(result.body.reply,/PUBLISHED_PREPARATION_T71/);
      await f.audit(result,'refused');assert.deepEqual(await f.snapshot(),{...before,tickets:before.tickets+1});
    });
    f.assertTransport();
  }finally{await f.close();}
});

const classify=kind=>({phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_SUPPORT',intent:'COMPLEX_QUESTION',
  confidence:1,requiresTool:kind==='live_facts',needsProductDiscovery:false,shoppingPhase:null,serviceRequest:kind}});
test('T71 served storefront capability, fixed read tool and final review fence',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await servedBusinessFixture('storefront',[
    classify('informational'),{phase:'storefront.sales',response:{schemaVersion:1,message:answer}},
    {phase:'storefront.reply-review',response:{schemaVersion:1,verdict:'ALLOW',confidence:1},hold:true},
    classify('live_facts'),{phase:'storefront.sales',toolCall:liveRequest,hold:true},classify('professional_decision'),
  ]);
  try{
    const start=await f.request('/storefront/conversations',{merchant_id:f.own.merchant_id});assert.equal(start.status,201);
    const path='/storefront/conversations/'+start.body.conversation_id+'/messages',token=start.body.conversation_token;
    const post=message=>f.request(path,{user_message:message,history:[]},token);
    await t.test('a browser cannot replace the real capability cart identity to redirect a handoff',async()=>{
      const before=await f.snapshot(),result=await f.request(path,{user_message:'Preciso de um profissional',cart_id:'foreign-cart'},token);
      assert.equal(result.status,403);assert.match(JSON.stringify(result.body),/conversation_cart_mismatch/);
      assert.deepEqual(f.events(),[]);assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('last real review await cannot serve prose whose canonical source changed',async()=>{
      const before=await f.snapshot(),result=await f.whileHeld(post('Qual é o preparo publicado desse serviço?'),3,()=>f.setDescription('WITHDRAWN_OR_CHANGED_T71'));
      assert.equal(result.status,201);assert.doesNotMatch(result.body.message,/PUBLISHED_PREPARATION_T71|WITHDRAWN_OR_CHANGED_T71/);
      await f.audit(result,'refused');assert.deepEqual(await f.snapshot(),before);await f.setDescription(answer);
    });
    await t.test('announced fixed tool reaches canonical live reads after last model await and excludes newly occupied slot',async()=>{
      const before=await f.snapshot(),result=await f.whileHeld(post(`Qual valor e horários desse serviço com esse profissional em ${liveRequest.fromDate}?`),5,f.occupyAndReprice);
      assert.equal(result.status,201);assert.match(result.body.message,/79,00/);assert.match(result.body.message,/às 07:30/);
      assert.doesNotMatch(result.body.message,/73,00|às 07:00|PRIVATE_APPOINTMENT_CANARY/);
      const step=f.events().find(event=>event.result?.scriptStep===5);assert.deepEqual(step.input.toolNames,['get_current_service_facts']);
      const row=await f.audit(result);await f.assertCanonicalReferences(row);assert.deepEqual(await f.snapshot(),{...before,appointments:before.appointments+1});
    });
    await t.test('professional classifier invokes the real handoff without another model answer',async()=>{
      const before=await f.snapshot(),eventsBefore=f.events().length,result=await post('Qual tratamento individual devo fazer?');
      assert.equal(result.status,201);assert.doesNotMatch(result.body.message,/PUBLISHED_PREPARATION_T71/);
      const tickets=await f.prisma.supportTicket.findMany({where:{merchantId:f.own.merchant_id,status:'open'}});
      assert.equal(tickets.length,before.tickets+1);assert.equal(tickets.at(-1).sessionId,start.body.conversation_id);
      assert.equal(f.events().slice(eventsBefore).filter(event=>event.kind==='providerFetch').length,1);
      await f.audit(result,'refused');assert.deepEqual(await f.snapshot(),{...before,tickets:before.tickets+1});
    });
    f.assertTransport();
  }finally{await f.close();}
});
