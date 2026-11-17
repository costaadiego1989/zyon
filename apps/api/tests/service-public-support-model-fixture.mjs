import assert from 'node:assert/strict';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createServedModelScript} from './service-served-model-script.mjs';

/** Test child only. The original query use case remains the real class;
 * only its embedding provider and the support completion port are local. */
export function createPublicSupportModelFixture(runId,onEvent,modelScript){
 assert.match(runId,/^[a-f0-9-]{36}$/);assert.equal(typeof onEvent,'function');
 const script=createServedModelScript(modelScript);
 const vector=[1,...Array(383).fill(0)],reply='Consulte a politica publica atual apresentada pela loja.';
 let sequence=0,queryBinding,embeddingCalls=0,completionCalls=0;
 const emit=(kind,input,result)=>{assert.ok(sequence<40,'local_support_model_event_limit');const event={runId,sequence:++sequence,kind,input:structuredClone(input),result:structuredClone(result)};
  assert.ok(Buffer.byteLength(JSON.stringify(event))<=100000,'local_support_model_event_size');onEvent(event);return result;};
 const embedding={isAvailable:()=>true,async generate(text){assert.ok(typeof text==='string'&&text.length>0&&text.length<=4000);embeddingCalls++;
  emit('queryEmbedding',{text},{dimensions:384,synthetic:true});return [...vector];}};
 const chat={async complete(messages){assert.ok(Array.isArray(messages)&&messages.length===2&&messages[0].role==='system'&&messages[1].role==='user');
  assert.ok(messages.every(item=>typeof item.content==='string'&&item.content.length<=80000),'local_support_prompt_invalid');completionCalls++;
  if(script){
   const phase=messages[0].content.startsWith('{"id":"business.answer-plan"')?'business.answer-plan':'support.answer';
   const selected=await script.next(phase,step=>emit('chatCompletion',{messages},{synthetic:true,...step}));
   return typeof selected.response==='string'?selected.response:JSON.stringify(selected.response);
  }
  return emit('chatCompletion',{messages},reply);}};
 function replace(module,token,replacement){
  const original=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module);assert.ok(Array.isArray(original));
  const matches=original.filter(provider=>provider===token||provider&&typeof provider==='object'&&provider.provide===token);
  assert.equal(matches.length,1,'local_support_exact_provider_required');const providers=original.map(item=>matches.includes(item)?replacement:item);
  assert.equal(providers.filter((item,index)=>item!==original[index]).length,1);
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,providers,module);let restored=false;
  return()=>{if(restored)return;assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module),providers);Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,module);assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module),original);restored=true;};
 }
 function install(tokens){
  const {KnowledgeBaseModule,QueryKnowledgeUseCase,ServiceBusinessAnswerFactory,KNOWLEDGE_REPOSITORY,BillingPlanMeteringService,PUBLIC_KNOWLEDGE_SEARCH,RevalidatePublicSourceService,SupportModule,CHAT_COMPLETION_PORT}=tokens;
  const restoreQuery=replace(KnowledgeBaseModule,QueryKnowledgeUseCase,{provide:QueryKnowledgeUseCase,
   useFactory:(repository,billing,graph,canonical,businessAnswers)=>{const query=new QueryKnowledgeUseCase(embedding,repository,billing,graph,canonical,businessAnswers);
    queryBinding={query,repository,billing,graph,canonical,businessAnswers};return query;},
   inject:[KNOWLEDGE_REPOSITORY,BillingPlanMeteringService,PUBLIC_KNOWLEDGE_SEARCH,RevalidatePublicSourceService,ServiceBusinessAnswerFactory]});
  let restoreChat;
  try{restoreChat=replace(SupportModule,CHAT_COMPLETION_PORT,{provide:CHAT_COMPLETION_PORT,useValue:chat});}
  catch(error){restoreQuery();throw error;}
  return{overrides:['QueryKnowledgeUseCase.embeddingService','support.CHAT_COMPLETION_PORT'],restore(){restoreChat();restoreQuery();}};
 }
 function assertBindings(app,tokens){
  assert.ok(queryBinding);assert.equal(queryBinding.query.businessAnswers,app.get(tokens.ServiceBusinessAnswerFactory));
  assert.ok(queryBinding,'local_support_query_construction_required');assert.equal(app.get(tokens.QueryKnowledgeUseCase),queryBinding.query);
  assert.equal(queryBinding.query.embeddingService,embedding);assert.equal(queryBinding.query.knowledgeRepo,app.get(tokens.KNOWLEDGE_REPOSITORY));
  assert.equal(queryBinding.query.billing,queryBinding.billing);assert.ok(queryBinding.billing instanceof tokens.BillingPlanMeteringService);
  assert.equal(queryBinding.query.publicSources,app.get(tokens.RevalidatePublicSourceService));
  assert.equal(queryBinding.query.graph,app.get(tokens.PUBLIC_KNOWLEDGE_SEARCH));
  assert.notEqual(app.get(tokens.EMBEDDING_PORT),embedding,'index_embedding_provider_must_remain_real');
  const support=app.select(tokens.SupportModule);
  assert.equal(support.get(tokens.CHAT_COMPLETION_PORT,{strict:true}),chat);
  assert.equal(support.get(tokens.SendSupportMessageUseCase,{strict:true}).chat,chat);
 }
 return{install,assertBindings,...(script?{releaseModelStep:step=>script.release(step),closeModelScript:()=>script.close()}:{}),evidence:()=>({runId,embeddingCalls,completionCalls,queryDimensions:384}),reply};
}
