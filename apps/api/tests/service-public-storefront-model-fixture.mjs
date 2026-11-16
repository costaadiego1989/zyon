import assert from 'node:assert/strict';
import {MODULE_METADATA} from '@nestjs/common/constants.js';

export const STOREFRONT_RAG_QUESTION='Como o texto oficial orienta as tratativas depois do recebimento?';
export const STOREFRONT_RAG_REPLY='Consulte o texto oficial atual que a loja disponibilizou.';

/** Real Query class/repository/canonical admission and real storefront provider.
 * Only query embeddings and the existing optional provider fetch token are local.
 * This fixture NEVER invokes network fetch and never grants scope/identity. */
export function createPublicStorefrontModelFixture(runId,onEvent){
 assert.match(runId,/^[a-f0-9-]{36}$/);assert.equal(typeof onEvent,'function');
 const vector=[1,...Array(383).fill(0)];let sequence=0,queryBinding,embeddingCalls=0,providerCalls=0;
 const emit=(kind,input,result)=>{
  assert.ok(sequence<40,'local_storefront_model_event_limit');
  const event={runId,sequence:++sequence,kind,input:structuredClone(input),result:structuredClone(result)};
  assert.ok(Buffer.byteLength(JSON.stringify(event))<=100000,'local_storefront_model_event_size');onEvent(event);
 };
 const embedding={isAvailable:()=>true,async generate(text){
  assert.equal(text,STOREFRONT_RAG_QUESTION,'the actual unchanged buyer query must reach QueryKnowledge');embeddingCalls++;
  emit('queryEmbedding',{text},{dimensions:384,synthetic:true});return [...vector];
 }};
 const fetchFactory=channel=>{
  assert.ok(['primary','fallback'].includes(channel));
  return async(input,init)=>{
   assert.equal(channel,'primary','no unplanned failover in the fixed fixture');
   const url=new URL(input instanceof Request?input.url:String(input));
   assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
   assert.match(url.pathname,/\/chat\/completions$/);assert.equal(init?.method,'POST');
   if(init.signal?.aborted)throw new Error('local_storefront_request_aborted');
   assert.equal(typeof init.body,'string');const body=JSON.parse(init.body);
   assert.equal(body.stream,false);assert.ok(Array.isArray(body.messages)&&body.messages.length<=100);
   assert.ok(body.messages.every(message=>typeof message.content==='string'&&message.content.length<=80000));
   const prompt=JSON.parse(body.messages[0].content);let phase,payload;
   if(prompt.id==='storefront.intent'){
    phase='classifier';payload={schemaVersion:2,domain:'STORE_SUPPORT',intent:'COMPLEX_QUESTION',confidence:1,
     requiresTool:false,needsProductDiscovery:false,shoppingPhase:null};
   }else if(prompt.id==='storefront.sales'){
    phase='answer';payload={schemaVersion:1,message:STOREFRONT_RAG_REPLY};
   }else if(prompt.id==='storefront.reply-review'){
    phase='review';payload={schemaVersion:1,verdict:'ALLOW',confidence:1};
   }else throw new Error('local_storefront_unexpected_prompt');
   providerCalls++;
   emit('providerFetch',{channel,phase,messages:body.messages,model:body.model,
    responseFormat:body.response_format?.type,toolNames:(body.tools??[]).map(tool=>tool.function.name)},
   {synthetic:true,payload});
   return new Response(JSON.stringify({id:'synthetic-storefront-'+providerCalls,model:body.model,
    choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(payload)}}],
    usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});
  };
 };
 function install(tokens){
  const {KnowledgeBaseModule,QueryKnowledgeUseCase,KNOWLEDGE_REPOSITORY,BillingPlanMeteringService,
   PUBLIC_KNOWLEDGE_SEARCH,RevalidatePublicSourceService,StorefrontModule,STOREFRONT_PROVIDER_FETCH_FACTORY}=tokens;
  const originalQuery=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,KnowledgeBaseModule);
  const originalStore=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,StorefrontModule);
  assert.ok(Array.isArray(originalQuery)&&Array.isArray(originalStore));
  const matches=originalQuery.filter(provider=>provider===QueryKnowledgeUseCase||provider?.provide===QueryKnowledgeUseCase);
  assert.equal(matches.length,1);assert.equal(originalStore.filter(provider=>provider===STOREFRONT_PROVIDER_FETCH_FACTORY
   ||provider?.provide===STOREFRONT_PROVIDER_FETCH_FACTORY).length,0,'optional fetch token must be absent before this opt-in');
  const queryProviders=originalQuery.map(provider=>provider!==matches[0]?provider:{provide:QueryKnowledgeUseCase,
   useFactory:(repository,billing,graph,canonical)=>{
    const query=new QueryKnowledgeUseCase(embedding,repository,billing,graph,canonical);
    queryBinding={query,repository,billing,graph,canonical};return query;
   },inject:[KNOWLEDGE_REPOSITORY,BillingPlanMeteringService,PUBLIC_KNOWLEDGE_SEARCH,RevalidatePublicSourceService]});
  const storeProviders=[...originalStore,{provide:STOREFRONT_PROVIDER_FETCH_FACTORY,useValue:fetchFactory}];
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,queryProviders,KnowledgeBaseModule);
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,storeProviders,StorefrontModule);
  let restored=false;
  return{overrides:['QueryKnowledgeUseCase.embeddingService','storefront.STOREFRONT_PROVIDER_FETCH_FACTORY'],restore(){
   if(restored)return;assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,KnowledgeBaseModule),queryProviders);
   assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,StorefrontModule),storeProviders);
   Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,originalStore,StorefrontModule);
   Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,originalQuery,KnowledgeBaseModule);restored=true;
  }};
 }
 function assertBindings(app,tokens){
  assert.ok(queryBinding);assert.equal(app.get(tokens.QueryKnowledgeUseCase),queryBinding.query);
  assert.equal(queryBinding.query.embeddingService,embedding);assert.equal(queryBinding.query.knowledgeRepo,app.get(tokens.KNOWLEDGE_REPOSITORY));
  assert.equal(queryBinding.query.publicSources,app.get(tokens.RevalidatePublicSourceService));
  assert.equal(queryBinding.query.graph,app.get(tokens.PUBLIC_KNOWLEDGE_SEARCH));
  assert.equal(queryBinding.query.billing,queryBinding.billing);assert.ok(queryBinding.billing instanceof tokens.BillingPlanMeteringService);
  assert.notEqual(app.get(tokens.EMBEDDING_PORT),embedding,'index embedding provider remains original');
  const scope=app.select(tokens.StorefrontModule),adapter=scope.get(tokens.StorefrontConversationAdapter,{strict:true});
  assert.ok(adapter instanceof tokens.StorefrontConversationAdapter);assert.equal(adapter.queryKnowledge,queryBinding.query);
  assert.equal(scope.get(tokens.STOREFRONT_PROVIDER_FETCH_FACTORY,{strict:true}),fetchFactory);
 }
 return{install,assertBindings,evidence:()=>({runId,embeddingCalls,providerCalls,queryDimensions:384,synthetic:true})};
}
