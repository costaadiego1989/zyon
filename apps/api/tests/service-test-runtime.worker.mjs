import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {assertNativePrismaUrl,inspectNativePrismaClient} from './native-prisma-admission-guards.mjs';
import {assertSyntheticRedisIdentity} from './local-disposable-redis.mjs';
import {assertConstructionOnlyAmbient} from './nest-construction-only.guards.mjs';
import {installConstructionProviderTrap} from './nest-construction-provider-trap.mjs';
import {createOwnedJourneyClientTracker,journeyBounded as bounded} from './storefront-journey-owned-clients.mjs';
import {fileURLToPath} from 'node:url';
import {createHook} from 'node:async_hooks';
import {createLocalWhatsAppProviderFixture,validateLocalWhatsAppOptions} from './service-whatsapp-provider-fixture.mjs';
import {createPublicSupportModelFixture} from './service-public-support-model-fixture.mjs';
import {validateServedModelScript} from './service-served-model-script.mjs';
import {createPublicStorefrontModelFixture} from './service-public-storefront-model-fixture.mjs';

const [databaseUrl,databaseRunId,redisUrl,redisRunId,...extra]=process.argv.slice(2);
const stage=(name,details={})=>process.send?.({type:'stage',stage:name,...details});
const diagnosticTimers=new Map();
createHook({init(id,type,_trigger,resource){if(type==='Timeout')diagnosticTimers.set(id,{resource,frames:new Error().stack.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(1,10)});},destroy(id){diagnosticTimers.delete(id);}}).enable();
const cleanupResources=stage=>{
  const handles=process._getActiveHandles().map(handle=>{
    const type=handle.constructor?.name??'unknown';
    if(type!=='Server')return{type};
    const address=handle.address();
    return{type,listening:handle.listening,connections:handle._connections,
      loopback:address&&typeof address==='object'?['127.0.0.1','::1'].includes(address.address):null,
      appHttpServer:handle===app?.getHttpServer()};
  });
  const timers=[...diagnosticTimers.values()].filter(({resource})=>!resource._destroyed&&resource.hasRef()).map(({resource,frames})=>({delayMs:resource._idleTimeout,ref:resource.hasRef(),frames}));
  process.stderr.write('service_cleanup_resources:'+JSON.stringify({stage,resourceTypes:process.getActiveResourcesInfo(),handles,timers})+'\n');
};
stage('worker_started');
assert.ok(extra.length<=1);let localWhatsApp;let localSupportQueryModel=false,localStorefrontQueryModel=false,localModelScript;
if(extra.length){
  assert.ok(extra[0].length<=8192);const parsed=JSON.parse(extra[0]);
  assert.ok(parsed&&typeof parsed==='object'&&!Array.isArray(parsed));
  const{supportQueryModel,storefrontQueryModel,modelScript,...whatsappOptions}=parsed;
  assert.ok(supportQueryModel===undefined||supportQueryModel===true,'local_support_query_flag_invalid');
  assert.ok(storefrontQueryModel===undefined||storefrontQueryModel===true,'local_storefront_query_flag_invalid');
  assert.ok(!(supportQueryModel&&storefrontQueryModel),'local_model_flags_mutually_exclusive');
  localModelScript=modelScript===undefined?undefined:validateServedModelScript(modelScript);
  assert.ok(!localModelScript||supportQueryModel||storefrontQueryModel);
  localSupportQueryModel=supportQueryModel===true;
  localStorefrontQueryModel=storefrontQueryModel===true;
  if(Object.keys(whatsappOptions).length){
    assert.match(whatsappOptions.metaSecret,/^[a-f0-9]{64}$/);
    const{metaSecret,...providerOptions}=whatsappOptions;localWhatsApp={metaSecret,...validateLocalWhatsAppOptions(providerOptions)};
  }else assert.ok(localSupportQueryModel||localStorefrontQueryModel,'local_provider_fixture_required');
}
assertConstructionOnlyAmbient(process.env);assertServiceArtifacts();stage('artifacts_checked');
const database=assertNativePrismaUrl(databaseUrl);assertSyntheticRedisIdentity(redisUrl,redisRunId,redisRunId);
inspectNativePrismaClient(fileURLToPath(new URL('../',import.meta.url)));
const {PrismaClient}=await import('@prisma/client'),verify=new PrismaClient({datasources:{db:{url:databaseUrl}},log:[]});
try{assert.deepEqual(await verify.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:databaseRunId}]);}finally{await verify.$disconnect();}
const {Redis}=await import('ioredis');const redis=new Redis(redisUrl,{lazyConnect:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
try{await redis.connect();assertSyntheticRedisIdentity(redisUrl,redisRunId,await redis.get('aacp:synthetic:run'));}finally{redis.disconnect();}
stage('owned_markers_checked');
let app,tracker,trap,closed=false,fixture,fixtureOverrideNames=[],modelFixture,modelTokens,modelOverrideNames=[];
async function close(){
  if(closed)return;closed=true;const errors=[];
  modelFixture?.closeModelScript?.();
  stage('closing_capture');
  try{if(tracker)await tracker.capture({ping:false});}catch(e){errors.push(e);}
  stage('closing_app');
  try{if(app)await bounded(app.close(),25_000,'service_app_close_timeout');}catch(e){errors.push(e);}
  stage('closing_owned_clients');
  try{if(tracker)await tracker.close();}catch(e){errors.push(e);}
  const provider=trap?.evidence();
  try{if(trap)await trap.dispose();}catch(e){errors.push(e);}
  if(provider?.providerCalls)errors.push(new Error('service_provider_attempt_forbidden:'+JSON.stringify(trap.diagnostics())));
  if(errors.length)throw new AggregateError(errors,'service_app_cleanup_failed:'+errors.map(error=>String(error.message).slice(0,1400)).join('|'));
  return{appClosed:true,providerCalls:provider?.providerCalls??0,localProviderAttempts:fixture?.attempts()??0,...(modelFixture?(localSupportQueryModel?{localSupportModel:modelFixture.evidence()}:{localStorefrontModel:modelFixture.evidence()}):{} )};
}
try{
  trap=await installConstructionProviderTrap(Number(database.port),Number(new URL(redisUrl).port));
  Object.assign(process.env,{DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,JWT_SECRET:randomBytes(48).toString('hex'),
    BUYER_JWT_SECRET:randomBytes(48).toString('hex'),EMBED_TOKEN_SECRET:randomBytes(48).toString('hex'),
    INTERNAL_SERVICE_TOKEN:randomBytes(48).toString('hex'),AACP_PAYMENT_ENC_KEY:randomBytes(32).toString('hex'),
    AACP_PII_ENC_KEY:randomBytes(32).toString('hex'),LOCAL_LLM_API_KEY:randomBytes(32).toString('hex'),
    LOCAL_LLM_BASE_URL:trap.baseUrl,LOCAL_LLM_MODEL:'synthetic-only',LOG_LEVEL:'silent'});
  const {NestFactory}=await import('@nestjs/core'),{ValidationPipe}=await import('@nestjs/common');
  // The owned runtime exercises the real missing-model fallback. A catalog
  // event must never download embedding assets or weaken the provider trap.
  const {env:transformersEnvironment}=await import('@huggingface/transformers');
  transformersEnvironment.allowRemoteModels=false;
  assert.equal(transformersEnvironment.allowRemoteModels,false);
  stage('offline_embeddings_configured',{allowRemoteModels:transformersEnvironment.allowRemoteModels});
  const {AppModule}=await import('../dist/app.module.js');
  let fixtureInstallation,channelToken,mediaType;
  if(localWhatsApp){
    const{WhatsAppChannelModule}=await import('../dist/modules/whatsapp-channel/whatsapp-channel.module.js');
    const{WHATSAPP_SENDER_PORT}=await import('../dist/modules/whatsapp-channel/domain/ports/whatsapp-sender.port.js');
    const{WHATSAPP_SENDER_PORT:notificationToken}=await import('../dist/modules/notifications/domain/ports/whatsapp-sender.port.js');
    const{MetaInboundMediaAdapter}=await import('../dist/modules/whatsapp-channel/infrastructure/adapters/meta-inbound-media.adapter.js');
    assert.notEqual(WHATSAPP_SENDER_PORT,notificationToken,'notification_transport_must_remain_original');
    channelToken=WHATSAPP_SENDER_PORT;mediaType=MetaInboundMediaAdapter;process.env.META_APP_SECRET=localWhatsApp.metaSecret;
    const{currentWhatsAppSubmissionScope,startWhatsAppRequest}=await import('../dist/shared/whatsapp/whatsapp-automation-context.js');
    const{metaSecret:fixtureSecret,...fixtureOptions}=localWhatsApp;
    fixture=createLocalWhatsAppProviderFixture(fixtureOptions,event=>process.send({type:'local_whatsapp_event',event}),
      {currentScope:currentWhatsAppSubmissionScope,start:startWhatsAppRequest});
    fixtureInstallation=fixture.install(WhatsAppChannelModule,channelToken,mediaType);fixtureOverrideNames=fixtureInstallation.overrides;
  }
  let modelInstallation;
  if(localSupportQueryModel||localStorefrontQueryModel){
    const{KnowledgeBaseModule}=await import('../dist/modules/knowledge-base/knowledge-base.module.js');
    const{QueryKnowledgeUseCase}=await import('../dist/modules/knowledge-base/application/use-cases/query-knowledge.use-case.js');
    const{ServiceBusinessAnswerFactory}=await import('../dist/modules/knowledge-base/application/services/service-business-answer.factory.js');
    const{KNOWLEDGE_REPOSITORY}=await import('../dist/modules/knowledge-base/domain/ports/knowledge-repository.port.js');
    const{EMBEDDING_PORT}=await import('../dist/modules/knowledge-base/domain/ports/embedding.port.js');
    const{BillingPlanMeteringService}=await import('../dist/modules/payment/domain/billing-plan-guard.js');
    const{PUBLIC_KNOWLEDGE_SEARCH}=await import('../dist/modules/knowledge-base/domain/ports/public-knowledge-search.port.js');
    const{RevalidatePublicSourceService}=await import('../dist/modules/knowledge-base/application/use-cases/revalidate-public-source.service.js');
    const{SupportModule}=await import('../dist/modules/support/support.module.js');
    const{CHAT_COMPLETION_PORT}=await import('../dist/modules/support/domain/ports/chat-completion.port.js');
    const{SendSupportMessageUseCase}=await import('../dist/modules/support/application/send-support-message.use-case.js');
    modelTokens={KnowledgeBaseModule,QueryKnowledgeUseCase,ServiceBusinessAnswerFactory,KNOWLEDGE_REPOSITORY,EMBEDDING_PORT,BillingPlanMeteringService,
      PUBLIC_KNOWLEDGE_SEARCH,RevalidatePublicSourceService,SupportModule,CHAT_COMPLETION_PORT,SendSupportMessageUseCase};
    if(localStorefrontQueryModel){
      const{StorefrontModule}=await import('../dist/modules/storefront/storefront.module.js');
      const{StorefrontConversationAdapter,STOREFRONT_PROVIDER_FETCH_FACTORY}=await import('../dist/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.js');
      Object.assign(modelTokens,{StorefrontModule,StorefrontConversationAdapter,STOREFRONT_PROVIDER_FETCH_FACTORY});
    }
    modelFixture=localSupportQueryModel
      ?createPublicSupportModelFixture(databaseRunId,event=>process.send({type:'local_support_model_event',event}),localModelScript)
      :createPublicStorefrontModelFixture(databaseRunId,event=>process.send({type:'local_storefront_model_event',event}),localModelScript);
    modelInstallation=modelFixture.install(modelTokens);modelOverrideNames=modelInstallation.overrides;
  }
  try{stage('constructing_app');app=await bounded(NestFactory.create(AppModule,{abortOnError:false,logger:false,rawBody:true}),45_000,'service_app_construct_timeout');}
  finally{modelInstallation?.restore();fixtureInstallation?.restore();}
  if(fixture){assert.equal(app.get(channelToken),fixture.sender);if(localWhatsApp.voiceTranscripts&&Object.keys(localWhatsApp.voiceTranscripts).length)assert.equal(app.get(mediaType),fixture.media);}
  if(modelFixture)modelFixture.assertBindings(app,modelTokens);
  stage('app_constructed');
  tracker=createOwnedJourneyClientTracker(app,Number(new URL(redisUrl).port));
  const {apiVersioningMiddleware}=await import('../dist/shared/http/api-versioning.js');app.use(apiVersioningMiddleware);
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  await bounded(app.init(),45_000,'service_app_init_timeout');stage('app_initialized');await app.listen(0,'127.0.0.1');stage('http_listening');
  stage('warming_owned_clients');
  await tracker.capture({warmLazy:true});
  stage('clients_ready');
  const address=app.getHttpServer().address();assert.equal(address.address,'127.0.0.1');
  if(localWhatsApp?.operatorStatusCallbacks)process.env.API_PUBLIC_URL=`http://127.0.0.1:${address.port}`;
  assert.equal(trap.evidence().providerCalls,0);
  process.send({type:'ready',apiOrigin:`http://127.0.0.1:${address.port}`,evidence:{canonicalAppModule:true,
    repositoryOverrides:false,authOverrides:false,providerCalls:0,localProviderOverrides:fixtureOverrideNames,
    ...(localWhatsApp?.operatorStatusCallbacks?{localOperatorStatusCallbacks:true}:{}),...(modelFixture?{localModelOverrides:modelOverrideNames}:{}),embeddingRuntime:{allowRemoteModels:transformersEnvironment.allowRemoteModels}}});
  process.on('message',async message=>{
    if(message?.type==='local_model_release'){
      assert.ok(localModelScript&&message.runId===databaseRunId&&Object.keys(message).every(key=>['type','runId','step'].includes(key)));
      modelFixture.releaseModelStep(message.step);return;
    }
    if(message?.type!=='close')return;
    try{const evidence=await close();cleanupResources('before_closed_ack');process.send({type:'closed',evidence},()=>process.disconnect());}
    catch(error){process.send({type:'failure',code:error.message},()=>{process.exitCode=1;process.disconnect();});}
  });
  process.on('disconnect',()=>{cleanupResources('disconnected');if(!closed)close().catch(()=>{process.exitCode=1;});});
}catch(error){
  stage('failure_cleanup_started',{failure:String(error.message).slice(0,1000)});
  try{await close();}catch(cleanup){error=new AggregateError([error,cleanup],'service_setup_cleanup_failed');}
  const causes=error instanceof AggregateError?error.errors.map(e=>String(e.message).slice(0,800)).join(';'):error.message;
  process.send?.({type:'failure',code:`${error.name}:${causes}`},()=>{process.exitCode=1;process.disconnect?.();});
}
