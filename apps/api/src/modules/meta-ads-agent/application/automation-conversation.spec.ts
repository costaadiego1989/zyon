import assert from 'node:assert/strict';import {test} from 'node:test';
import {assistantCampaignFixture} from './__tests__/assistant-campaign-fixture.js';
import {AssistantService} from '../../merchant-assistant/application/assistant.service.js';
import {AssistantKnowledgeRetriever} from '../../merchant-assistant/infrastructure/assistant-knowledge.retriever.js';
import {META_ADS_MERCHANT_KNOWLEDGE} from '../../merchant-assistant/infrastructure/knowledge/meta-ads.pt-BR.js';
import {automationChecklist} from './automation-briefing.js';
const reply=(text='Qual é a próxima escolha?',references:string[]=[])=>({reply:text,referenceIds:references,toolCalls:[],providerRequestId:'synthetic',costMicros:0n});
const tool=(name:string,args:Record<string,unknown>)=>({...reply(),reply:null,toolCalls:[{id:name,name,args}]});

test('ACJ-02 unfinished date interpretation is completed before a policy can be described as ready',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');
 await f.context.execute({...f.input,name:'merchant_ads_save_draft',args:{automationBriefing:{selection:{selectionKind:'product',selectionQuery:'Camisa'},scope:{variantIds:['variant-a'],campaignIds:[],allowNewCampaigns:true,actions:['pause'],destination:'store',priority:'paid_sales',country:'BR'},limits:{campaignCeilingCents:10000,storeCeilingCents:30000,cadence:'daily',startsAt:'2026-11-18T12:00:00.000Z'},endText:'Daqui a sete dias no mesmo horário'}}});
 await f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2',['Daqui a sete dias no mesmo horário',f.input.turnId]);
 const model={complete:async(state:any)=>state.completionRequirement&&state.messages.at(-1).role==='user'?tool('merchant_ads_save_draft',{automationBriefing:{limits:{endsAt:'2026-11-25T12:00:00.000Z'}}}):reply('Sua política está pronta para revisão.',state.knowledge.slice(0,1).map((item:any)=>item.reference.id))};
 const knowledge=new AssistantKnowledgeRetriever(()=>structuredClone(META_ADS_MERCHANT_KNOWLEDGE),f.clock),service=new AssistantService({repo:f.assistant.repo,context:f.context,knowledge,model,clock:f.clock});
 const response=await service.respond(f.input),review=response.artifacts.find((a:any)=>a.type==='automation_review')?.review;
 assert.ok(review);assert.equal(review.limits.endsAt,'2026-11-25T12:00:00.000Z');assert.equal(review.limits.campaignCeilingCents,10000);assert.equal(review.limits.storeCeilingCents,30000);assert.deepEqual(review.scope.actions,['pause']);assert.equal((await f.runtime.policies.view('store-a')).policy,null);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('ACJ-02 an unresolved model correction asks for the date instead of claiming a review exists',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');
 await f.context.execute({...f.input,name:'merchant_ads_save_draft',args:{automationBriefing:{selection:{selectionKind:'product',selectionQuery:'Camisa'},scope:{variantIds:['variant-a'],campaignIds:[],allowNewCampaigns:true,actions:['pause'],destination:'store',priority:'paid_sales',country:'BR'},limits:{campaignCeilingCents:10000,storeCeilingCents:30000,cadence:'daily',startsAt:'2026-11-18T12:00:00.000Z'},endText:'No último dia'}}});
 await f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2',['No último dia',f.input.turnId]);
 const model={complete:async(state:any)=>reply('Sua política está pronta para revisão.',state.knowledge.slice(0,1).map((item:any)=>item.reference.id))};
 const response=await new AssistantService({repo:f.assistant.repo,context:f.context,knowledge:new AssistantKnowledgeRetriever(()=>structuredClone(META_ADS_MERCHANT_KNOWLEDGE),f.clock),model,clock:f.clock}).respond(f.input);
 assert.match(response.reply,/Até que dia/);assert.equal(response.artifacts.some(a=>a.type==='automation_review'),false);assert.equal((await f.runtime.policies.view('store-a')).policy,null);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('ACJ-06 the model can interpret a new autonomy request and mixed answers without a parser phrase',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');
 await f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2',['Deixa você cuidando dos ajustes dos anúncios. Só quero revisar seus limites antes, sem publicar nada novo sozinha.',f.input.turnId]);
 const model={complete:async(state:any)=>state.messages.at(-1).role==='user'?tool('merchant_ads_save_draft',{planningKind:'automation',automationBriefing:{scope:{destination:'whatsapp',priority:'paid_sales'},selection:{selectionKind:'product'}}}):reply('Qual produto você quer incluir?')};
 const service=new AssistantService({repo:f.assistant.repo,context:f.context,knowledge:new AssistantKnowledgeRetriever(()=>structuredClone(META_ADS_MERCHANT_KNOWLEDGE),f.clock),model,clock:f.clock});
 await service.respond(f.input);let p=(await f.assistant.repo.readThread(f.input.scope,f.input.threadId)).campaignProgress!;
 assert.equal(p.planningKind,'automation');assert.equal(p.automationBriefing!.scope.destination,'whatsapp');assert.equal(p.automationBriefing!.scope.priority,'paid_sales');assert.equal(p.automationBriefing!.selection!.selectionKind,'product');assert.equal(p.campaignId,null);
 await f.context.execute({...f.input,name:'merchant_ads_save_draft',origin:'model',args:{automationBriefing:{selection:{selectionKind:'product',selectionQuery:'Camisa'},scope:{variantIds:['variant-a']},limits:{campaignCeilingCents:8000,storeCeilingCents:24000,cadence:'daily'}}}});
 p=(await f.assistant.repo.readThread(f.input.scope,f.input.threadId)).campaignProgress!;assert.deepEqual(p.automationBriefing!.scope.variantIds,['variant-a']);assert.equal(p.automationBriefing!.limits.campaignCeilingCents,8000);assert.equal(p.automationBriefing!.limits.storeCeilingCents,24000);assert.equal(p.automationBriefing!.limits.currency,'BRL');
 assert.deepEqual(p.automationBriefing!.selection!.productOptions,[{variantId:'variant-a',name:'Camisa'}]);
 await f.context.execute({...f.input,name:'merchant_ads_save_draft',origin:'model',args:{planningKind:'campaign',destination:'store'}});
 p=(await f.assistant.repo.readThread(f.input.scope,f.input.threadId)).campaignProgress!;assert.equal(p.planningKind,'campaign');assert.equal(p.draft.destination,'store');assert.equal(p.automationBriefing!.scope.destination,'whatsapp');
 assert.equal((await f.runtime.policies.view('store-a')).policy,null);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('ACJ-02 interpreted policy fields cannot inject acceptance foreign products campaigns or invalid ceilings',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');
 const save=(automationBriefing:any)=>f.context.execute({...f.input,name:'merchant_ads_save_draft',origin:'model' as const,args:{automationBriefing}});
 for(const value of [{approved:true},{scope:{accepted:true}},{limits:{campaignCeilingCents:10000,storeCeilingCents:5000}},{selection:{selectionQuery:'Camisa'},scope:{variantIds:['foreign-product']}},{scope:{campaignIds:['foreign-campaign']}}])await assert.rejects(save(value));
 assert.equal((await f.runtime.policies.view('store-a')).policy,null);assert.equal((await f.assistant.repo.readThread(f.input.scope,f.input.threadId)).campaignProgress,null);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('ACJ-02 complete guided policy persists through help then produces an exact review and activates only by explicit acceptance',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');let input={...f.input};let final:any;
 const knowledge=new AssistantKnowledgeRetriever(()=>structuredClone(META_ADS_MERCHANT_KNOWLEDGE),f.clock);
 const model={complete:async(state:any)=>{const current=state.messages.filter((message:any)=>message.role==='user').at(-1).content,last=state.messages.at(-1);
  if(current==='Camisa'){if(last.role==='user')return tool('merchant_ads_catalog',{query:'Camisa'});if(last.tool_call_id==='merchant_ads_catalog')return tool('merchant_ads_save_draft',{automationBriefing:{scope:{variantIds:['variant-a']}}});}
  if(current.startsWith('2026-11-18T')&&last.role==='user')return tool('merchant_ads_save_draft',{automationBriefing:{limits:{startsAt:current}}});
  if(current.startsWith('2026-11-25T')&&last.role==='user')return tool('merchant_ads_save_draft',{automationBriefing:{limits:{endsAt:current}}});
  if(current.includes('funciona'))return reply('O limite da loja soma o investimento autorizado para essas campanhas. Quer continuar a configuração?',state.knowledge.slice(0,1).map((item:any)=>item.reference.id));
  return reply();}};
 const service=new AssistantService({repo:f.assistant.repo,context:f.context,knowledge,model,clock:f.clock});
 const step=async(message:string,initial=false)=>{if(initial)await f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2',[message,input.turnId]);else{const thread=await f.assistant.repo.readThread(input.scope,input.threadId),{turn}=await f.assistant.admission.submit(input.scope,input.threadId,{message,expectedRevision:thread.revision,idempotencyKey:'step-'+thread.revision});input={...input,turnId:turn.id,leaseToken:'lease-'+turn.id};await f.assistant.repo.atomic(input.scope,input.threadId,tx=>tx.update(turn.id,{status:'running',leaseToken:input.leaseToken,leaseUntil:'2026-11-18T12:03:00Z'}));}final=await service.respond(input);assert.ok((final.reply.match(/\?/g)??[]).length<=1);await f.assistant.repo.atomic(input.scope,input.threadId,tx=>tx.update(input.turnId,{status:'completed',reply:final.reply,artifacts:final.artifacts,leaseToken:null,leaseUntil:null,budgetState:'settled',usageCostMicros:0n}));return(await f.assistant.repo.readThread(input.scope,input.threadId)).campaignProgress!;};
 await step('Quero configurar o modo automático. Me conduza uma pergunta de cada vez.',true);assert.match(final.reply,/produto específico.*categoria/);await step('Um produto específico');await step('Camisa');await step('Todas as campanhas da IA');const before=await step('Pausar e ajustar verba');assert.deepEqual((await step('Como funciona o limite?')),before);
 for(const message of ['Na loja','Mais vendas','Brasil','R$ 100','R$ 300','Por dia','2026-11-18T12:00:00.000Z','2026-11-25T12:00:00.000Z'])await step(message);
 const progress=(await f.assistant.repo.readThread(input.scope,input.threadId)).campaignProgress!;assert.equal(automationChecklist(progress).complete,true);const review=final.artifacts.find((a:any)=>a.type==='automation_review')?.review;assert.ok(review);assert.deepEqual(review.scope,{variantIds:['variant-a'],campaignIds:[],allowNewCampaigns:true,destination:'store',priority:'paid_sales',country:'BR',actions:['budget','pause']});assert.deepEqual(review.limits,{currency:'BRL',cadence:'daily',campaignCeilingCents:10000,storeCeilingCents:30000,startsAt:'2026-11-18T12:00:00.000Z',endsAt:'2026-11-25T12:00:00.000Z'});assert.equal((await f.runtime.policies.view('store-a')).mode,'manual');assert.equal((await f.runtime.policies.view('store-a')).policy,null);assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length,0);assert.deepEqual(f.writes,[]);
 const accepted=await f.runtime.policies.accept('store-a','owner-a',{scope:review.scope,limits:review.limits,version:review.version,digest:review.digest,idempotencyKey:'explicit-ui-acceptance'});assert.equal(accepted.mode,'automatic');assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});
