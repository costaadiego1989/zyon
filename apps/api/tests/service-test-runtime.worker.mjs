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
import {observeCanonicalLiveReader} from './business-rag-canonical-live-observer.mjs';
import {validateBuyerBookingFixtureRequest} from './service-test-runtime.mjs';
import {validateStorefrontRoutingProfile,selectStorefrontRoutingProfile} from './storefront-routing-profile-fixture.mjs';
import {validateOwnedEmptyMetaCapabilitiesFixture,installOwnedEmptyMetaCapabilitiesHttpFixture} from './service-meta-capabilities-http-fixture.mjs';
import {validateOwnedRecoveryTemplateMonitorFixture,isolateOwnedRecoveryTemplateAutoStart} from './service-recovery-template-monitor-fixture.mjs';
import {validateOwnedC60MetaCapabilitiesFixture,validateOwnedC60RecoveryTemplateMonitorFixture,installOwnedC60EmptyMetaCapabilitiesHttpFixture} from './service-c60-whatsapp-http-fixture.mjs';
import {validateOwnedBookingAwaitTrace,observeOwnedBookingAwaits} from './service-booking-await-trace.mjs';
import {validateOwnedLocalModelFailureFixture,installOwnedLocalModelFailureFixture} from './service-local-model-failure-fixture.mjs';
import {validateNative18HttpFailures,installNative18HttpFailures} from './service-native18-http-failures.mjs';
import {createOwnedServiceReleaseFixture} from './service-release-owned-fixture.mjs';
import {createBuyerBrowserEmailCapture} from './service-buyer-browser-transport.mjs';
import {createCapturedAsaasProductFixture,validateCapturedProductPaymentOptions,validateCapturedProductPaymentControl} from './product-captured-payment-fixture.mjs';
import {createOwnedPostalTransport,validateOwnedPostalFixtureOptions} from './product-contact-delivery-postal.fixture.mjs';
import {isAllowedBuyerBookingFixture,isOwnedBuyerBrowserRenewalWindow} from './service-buyer-booking-fixture-options.mjs';

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
assert.ok(extra.length<=1);let localWhatsApp;let localSupportQueryModel=false,localStorefrontQueryModel=false,localModelScript,localBusinessRagObservation=false,localBuyerBooking=false,localStorefrontRoutingProfile,localMetaCapabilitiesFixture,localRecoveryTemplateMonitorFixture,localC60MetaCapabilitiesFixture,localC60RecoveryTemplateMonitorFixture,localBookingAwaitTrace,localModelFailureFixture,localNative18HttpFailures,localServiceReleaseFixture,localBuyerBrowser=false,localCapturedProductPayments=false,localPostalFixture,ownedPostal;
if(extra.length){
  assert.ok(extra[0].length<=8192);const parsed=JSON.parse(extra[0]);
  assert.ok(parsed&&typeof parsed==='object'&&!Array.isArray(parsed));
  const{supportQueryModel,storefrontQueryModel,modelScript,businessRagObservation,buyerBooking,storefrontRoutingProfile,metaCapabilitiesFixture,recoveryTemplateMonitorFixture,c60MetaCapabilitiesFixture,c60RecoveryTemplateMonitorFixture,bookingAwaitTrace,localModelFailureFixture:requestedModelFailureFixture,native18HttpFailures,serviceReleaseFixture,buyerBrowser,capturedProductPayments,postalFixture,...whatsappOptions}=parsed;
  assert.ok(buyerBooking===undefined||buyerBooking===true,'local_buyer_booking_flag_invalid');
  localBuyerBooking=buyerBooking===true;
  assert.ok(serviceReleaseFixture===undefined||['matching','missing'].includes(serviceReleaseFixture),'local_release_fixture_invalid');
  localServiceReleaseFixture=serviceReleaseFixture;
  assert.ok(buyerBrowser===undefined||buyerBrowser===true&&localBuyerBooking,'local_buyer_browser_flag_invalid');
  localBuyerBrowser=buyerBrowser===true;
  localPostalFixture=validateOwnedPostalFixtureOptions({local:true,postalFixture,buyerBooking,buyerBrowser,storefrontQueryModel,storefrontRoutingProfile,supportQueryModel,observeBusinessRag:businessRagObservation,whatsapp:Object.keys(whatsappOptions).length>0});
  localCapturedProductPayments=validateCapturedProductPaymentOptions({capturedProductPayments,buyerBooking,buyerBrowser,
    ...(Object.keys(whatsappOptions).length?{whatsapp:true}:{}),supportQueryModel,observeBusinessRag:businessRagObservation});
  assert.ok(!localBuyerBooking||Object.keys(whatsappOptions).length===0&&isAllowedBuyerBookingFixture({buyerBooking,buyerBrowser,supportQueryModel,storefrontQueryModel,modelScript,
    ...(businessRagObservation===undefined?{}:{observeBusinessRag:businessRagObservation})}),'local_buyer_booking_fixture_exclusive');
  assert.ok(businessRagObservation===undefined||businessRagObservation===true);
  assert.ok(!businessRagObservation||supportQueryModel&&!storefrontQueryModel&&Object.keys(whatsappOptions).length===0);
  localBusinessRagObservation=businessRagObservation===true;
  assert.ok(supportQueryModel===undefined||supportQueryModel===true,'local_support_query_flag_invalid');
  assert.ok(storefrontQueryModel===undefined||storefrontQueryModel===true,'local_storefront_query_flag_invalid');
  assert.ok(!(supportQueryModel&&storefrontQueryModel),'local_model_flags_mutually_exclusive');
  localModelScript=modelScript===undefined?undefined:validateServedModelScript(modelScript);
  assert.ok(!localModelScript||supportQueryModel||storefrontQueryModel);
  localSupportQueryModel=supportQueryModel===true;
  localStorefrontQueryModel=storefrontQueryModel===true;
  localStorefrontRoutingProfile=validateStorefrontRoutingProfile({storefrontRoutingProfile,storefrontQueryModel,supportQueryModel});
  if(Object.keys(whatsappOptions).length){
    assert.match(whatsappOptions.metaSecret,/^[a-f0-9]{64}$/);
    const{metaSecret,...providerOptions}=whatsappOptions;localWhatsApp={metaSecret,...validateLocalWhatsAppOptions(providerOptions)};
  }else assert.ok(localSupportQueryModel||localStorefrontQueryModel||localBuyerBooking||localServiceReleaseFixture,'local_provider_fixture_required');
  localMetaCapabilitiesFixture=validateOwnedEmptyMetaCapabilitiesFixture({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,metaCapabilitiesFixture});
  localRecoveryTemplateMonitorFixture=validateOwnedRecoveryTemplateMonitorFixture({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,metaCapabilitiesFixture:localMetaCapabilitiesFixture,recoveryTemplateMonitorFixture});
  localC60MetaCapabilitiesFixture=validateOwnedC60MetaCapabilitiesFixture({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,c60MetaCapabilitiesFixture,c60RecoveryTemplateMonitorFixture,metaCapabilitiesFixture,recoveryTemplateMonitorFixture,bookingAwaitTrace,localModelFailureFixture:requestedModelFailureFixture,native18HttpFailures});
  localC60RecoveryTemplateMonitorFixture=validateOwnedC60RecoveryTemplateMonitorFixture({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,c60MetaCapabilitiesFixture,c60RecoveryTemplateMonitorFixture,metaCapabilitiesFixture,recoveryTemplateMonitorFixture,bookingAwaitTrace,localModelFailureFixture:requestedModelFailureFixture,native18HttpFailures});
  localBookingAwaitTrace=validateOwnedBookingAwaitTrace({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,metaCapabilitiesFixture:localMetaCapabilitiesFixture,recoveryTemplateMonitorFixture:localRecoveryTemplateMonitorFixture,bookingAwaitTrace,modelScript,supportQueryModel,storefrontQueryModel});
  localModelFailureFixture=validateOwnedLocalModelFailureFixture({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,metaCapabilitiesFixture:localMetaCapabilitiesFixture,recoveryTemplateMonitorFixture:localRecoveryTemplateMonitorFixture,bookingAwaitTrace,localModelFailureFixture:requestedModelFailureFixture,modelScript,supportQueryModel,storefrontQueryModel});
  localNative18HttpFailures=validateNative18HttpFailures({local:true,whatsapp:localWhatsApp,buyerBooking:localBuyerBooking,metaCapabilitiesFixture:localMetaCapabilitiesFixture,recoveryTemplateMonitorFixture:localRecoveryTemplateMonitorFixture,bookingAwaitTrace,localModelFailureFixture:requestedModelFailureFixture,native18HttpFailures,modelScript,supportQueryModel,storefrontQueryModel});
}
assertConstructionOnlyAmbient(process.env);assertServiceArtifacts();stage('artifacts_checked');
const database=assertNativePrismaUrl(databaseUrl);assertSyntheticRedisIdentity(redisUrl,redisRunId,redisRunId);
inspectNativePrismaClient(fileURLToPath(new URL('../',import.meta.url)));
const {PrismaClient}=await import('@prisma/client'),verify=new PrismaClient({datasources:{db:{url:databaseUrl}},log:[]});
try{assert.deepEqual(await verify.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:databaseRunId}]);}finally{await verify.$disconnect();}
const {Redis}=await import('ioredis');const redis=new Redis(redisUrl,{lazyConnect:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
try{await redis.connect();assertSyntheticRedisIdentity(redisUrl,redisRunId,await redis.get('aacp:synthetic:run'));}finally{redis.disconnect();}
stage('owned_markers_checked');
let app,tracker,trap,closed=false,fixture,fixtureOverrideNames=[],modelFixture,modelTokens,modelOverrideNames=[],businessReaderObserver,storefrontRoutingSelection,storefrontRoutingEvidence,metaCapabilitiesTransport,recoveryMonitorIsolation,bookingAwaitObserver,syntheticModelFailureTransport,native18FailureTransport,buyerEmailCapture,capturedProductPayment,capturedPaymentEnvironment;
async function close(){
  if(closed)return;closed=true;const errors=[];
  modelFixture?.closeModelScript?.();
  buyerEmailCapture?.close();
  stage('closing_capture');
  try{if(tracker)await tracker.capture({ping:false});}catch(e){errors.push(e);}
  stage('closing_app');
  try{if(app)await bounded(app.close(),25_000,'service_app_close_timeout');}catch(e){errors.push(e);}
  const capturedPaymentEvidence=capturedProductPayment?.evidence();
  try{capturedProductPayment?.close();capturedPaymentEnvironment?.restore();}catch(e){errors.push(e);}
  stage('closing_owned_clients');
  try{if(tracker)await tracker.close();}catch(e){errors.push(e);}
  const businessObservation=businessReaderObserver?.evidence();
  try{businessReaderObserver?.restore();}catch(e){errors.push(e);}
  try{ownedPostal?.close();}catch(error){errors.push(error);}
  try{bookingAwaitObserver?.restore();}catch(e){errors.push(e);}
  const bookingAwaitEvidence=bookingAwaitObserver?.evidence();
  try{recoveryMonitorIsolation?.restore();}catch(e){errors.push(e);}
  const recoveryMonitorEvidence=recoveryMonitorIsolation?.evidence();
  try{native18FailureTransport?.restore();}catch(e){errors.push(e);}
  const native18FailureEvidence=native18FailureTransport?.evidence();
  try{syntheticModelFailureTransport?.restore();}catch(e){errors.push(e);}
  const syntheticModelFailureEvidence=syntheticModelFailureTransport?.evidence();
  try{metaCapabilitiesTransport?.restore();}catch(e){errors.push(e);}
  const metaCapabilitiesEvidence=metaCapabilitiesTransport?.evidence();
  const provider=trap?.evidence();
  try{if(trap)await trap.dispose();}catch(e){errors.push(e);}
  if(provider?.providerCalls&&native18FailureEvidence)process.stderr.write('service_native18_http_failure_observation:'+JSON.stringify(native18FailureEvidence)+'\n');
  if(provider?.providerCalls)errors.push(new Error('service_provider_attempt_forbidden:'+JSON.stringify(trap.diagnostics())));
  // Keep the private selector active through AppModule and owned-client cleanup.
  // Restore it on successful close and setup/close failure without changing defaults.
  try{if(storefrontRoutingEvidence)storefrontRoutingEvidence=storefrontRoutingSelection.evidence();}catch(e){errors.push(e);}
  try{storefrontRoutingSelection?.restore();}catch(e){errors.push(e);}
  if(errors.length)throw new AggregateError(errors,'service_app_cleanup_failed:'+errors.map(error=>String(error.message).slice(0,1400)).join('|'));
  return{appClosed:true,...(capturedPaymentEvidence?{localCapturedProductPayments:capturedPaymentEvidence}:{}),...(buyerEmailCapture?{localBuyerEmail:buyerEmailCapture.evidence()}:{}),...(native18FailureEvidence?{localNative18HttpFailures:native18FailureEvidence}:{}),...(syntheticModelFailureEvidence?{localSyntheticModelFailureHttp:syntheticModelFailureEvidence}:{}),...(bookingAwaitEvidence?{localBookingAwaitObservation:bookingAwaitEvidence}:{}),...(recoveryMonitorEvidence?{backgroundSchedulerExclusions:[recoveryMonitorEvidence]}:{}),...(metaCapabilitiesEvidence?{localMetaCapabilitiesHttp:metaCapabilitiesEvidence}:{}),...(storefrontRoutingEvidence?{localStorefrontRoutingProfile:storefrontRoutingEvidence}:{}),...(businessObservation?{businessRagObservation:businessObservation}:{}),providerCalls:provider?.providerCalls??0,localProviderAttempts:fixture?.attempts()??0,...(modelFixture?(localSupportQueryModel?{localSupportModel:modelFixture.evidence()}:{localStorefrontModel:modelFixture.evidence()}):{} )};
}
try{
  trap=await installConstructionProviderTrap(Number(database.port),Number(new URL(redisUrl).port));
  metaCapabilitiesTransport=installOwnedEmptyMetaCapabilitiesHttpFixture(localMetaCapabilitiesFixture,globalThis,process.env);
  if(localC60MetaCapabilitiesFixture)metaCapabilitiesTransport=installOwnedC60EmptyMetaCapabilitiesHttpFixture(localC60MetaCapabilitiesFixture,globalThis,process.env);
  Object.assign(process.env,{DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,JWT_SECRET:randomBytes(48).toString('hex'),
    BUYER_JWT_SECRET:randomBytes(48).toString('hex'),EMBED_TOKEN_SECRET:randomBytes(48).toString('hex'),
    INTERNAL_SERVICE_TOKEN:randomBytes(48).toString('hex'),AACP_PAYMENT_ENC_KEY:randomBytes(32).toString('hex'),
    AACP_PII_ENC_KEY:randomBytes(32).toString('hex'),LOCAL_LLM_API_KEY:randomBytes(32).toString('hex'),
    LOCAL_LLM_BASE_URL:trap.baseUrl,LOCAL_LLM_MODEL:'synthetic-only',LOG_LEVEL:'silent'});
  syntheticModelFailureTransport=installOwnedLocalModelFailureFixture(localModelFailureFixture,{baseUrl:trap.baseUrl,apiKey:process.env.LOCAL_LLM_API_KEY,model:process.env.LOCAL_LLM_MODEL},globalThis);
  native18FailureTransport=installNative18HttpFailures(localNative18HttpFailures,{baseUrl:trap.baseUrl,apiKey:process.env.LOCAL_LLM_API_KEY,model:process.env.LOCAL_LLM_MODEL,additionalNoticeRecipients:[['900046000015','5511998000016']]},globalThis);
  storefrontRoutingSelection=selectStorefrontRoutingProfile(localStorefrontRoutingProfile,process.env);
  if(localCapturedProductPayments){
    capturedProductPayment=createCapturedAsaasProductFixture(databaseRunId,evidence=>process.send({type:'local_product_payment_evidence',runId:databaseRunId,evidence}),{pixImage:'nonpayable-png-v1'});
    capturedPaymentEnvironment=capturedProductPayment.installEnvironment(process.env);
  }
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
  let releaseInstallation,releaseFixture,releaseTypes,emailInstallation,capturedPaymentInstallation;
  try{
  if(localServiceReleaseFixture){
    const protocol=await import('../dist/shared/bookings/service-release-manifest.js');
    const artifact=await import('../dist/shared/bookings/service-release-artifact.js');
    const {ServiceActivationModule,SERVICE_RELEASE_ARTIFACT_SOURCE}=await import('../dist/shared/bookings/service-activation.module.js');
    const runtime=artifact.measureServiceReleaseRuntime(fileURLToPath(new URL('../',import.meta.url)),'e'.repeat(40));
    releaseTypes=artifact;
    releaseFixture=createOwnedServiceReleaseFixture({runtime,protocol,onEvidence:()=>{},variant:localServiceReleaseFixture});
    releaseInstallation=releaseFixture.install(ServiceActivationModule,SERVICE_RELEASE_ARTIFACT_SOURCE);
  }

  if(localBuyerBrowser){
    const{BuyerAccountModule}=await import('../dist/modules/buyer-account/buyer-account.module.js');
    const{EMAIL_OTP_PROVIDER}=await import('../dist/modules/buyer-account/domain/ports/email-otp.port.js');
    buyerEmailCapture=createBuyerBrowserEmailCapture(databaseRunId,event=>process.send(event));
    emailInstallation=buyerEmailCapture.install(BuyerAccountModule,EMAIL_OTP_PROVIDER);
  }

  if(capturedProductPayment){
    const{PaymentModule}=await import('../dist/modules/payment/payment.module.js');
    const{PAYMENT_PROVIDER_PORT}=await import('../dist/modules/payment/domain/ports/payment-provider.port.js');
    const{PRISMA_CLIENT}=await import('../dist/shared/persistence/persistence.module.js');
    const{resolvePaymentProvider}=await import('../dist/modules/payment/infrastructure/e2e-payment-provider.js');
    const{readAsaasConnection,isAsaasConfigured}=await import('../dist/modules/payment/infrastructure/asaas-env.js');
    const{readMercadoPagoConnection,isMercadoPagoConfigured}=await import('../dist/modules/payment/infrastructure/mercadopago-env.js');
    const{isStripeConfigured}=await import('../dist/modules/payment/infrastructure/stripe-env.js');
    capturedPaymentInstallation=capturedProductPayment.install(PaymentModule,{PAYMENT_PROVIDER_PORT,PRISMA_CLIENT,resolvePaymentProvider,readAsaasConnection,readMercadoPagoConnection,isAsaasConfigured,isMercadoPagoConfigured,isStripeConfigured});
  }
  if(localPostalFixture){
    const {HttpModule}=await import('../dist/shared/http/http.module.js');
    const {HttpClientService}=await import('../dist/shared/http/http-client.service.js');
    const {MODULE_METADATA}=await import('@nestjs/common/constants.js');
    const matches=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,HttpModule).filter(value=>value&&typeof value==='object'&&value.provide===HttpClientService);
    assert.equal(matches.length,1,'postal_exact_http_provider_required');
    assert.ok(matches[0].useValue instanceof HttpClientService,'postal_original_http_instance_required');
    ownedPostal=createOwnedPostalTransport(databaseRunId,event=>process.send({type:'local_postal_event',event}));
    ownedPostal.install(matches[0].useValue);
  }

  stage('constructing_app');app=await bounded(NestFactory.create(AppModule,{abortOnError:false,logger:false,rawBody:true}),45_000,'service_app_construct_timeout');
  }
  finally{try{capturedPaymentInstallation?.restore();}finally{try{emailInstallation?.restore();}finally{try{releaseInstallation?.restore();}finally{modelInstallation?.restore();fixtureInstallation?.restore();}}}}
  if(ownedPostal){
    const {HttpModule}=await import('../dist/shared/http/http.module.js');
    const {HttpClientService}=await import('../dist/shared/http/http-client.service.js');
    const {MODULE_METADATA}=await import('@nestjs/common/constants.js');
    const provider=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,HttpModule).find(value=>value&&typeof value==='object'&&value.provide===HttpClientService);
    assert.equal(app.get(HttpClientService),provider.useValue,'postal_original_http_binding_required');
  }

  if(fixture){assert.equal(app.get(channelToken),fixture.sender);if(localWhatsApp.voiceTranscripts&&Object.keys(localWhatsApp.voiceTranscripts).length)assert.equal(app.get(mediaType),fixture.media);}
  if(modelFixture)modelFixture.assertBindings(app,modelTokens);
  if(releaseFixture)releaseFixture.assertBindings(app,releaseTypes);
  if(storefrontRoutingSelection){
    assert.ok(localStorefrontQueryModel&&modelTokens);
    const original=app.select(modelTokens.StorefrontModule).get(modelTokens.StorefrontConversationAdapter,{strict:true});
    storefrontRoutingSelection.bindAdapter(original);storefrontRoutingEvidence=storefrontRoutingSelection.evidence();
  }
  if(localBusinessRagObservation){
    const{PrismaCurrentServiceFactsReader}=await import('../dist/modules/knowledge-base/infrastructure/prisma-current-service-facts-reader.js');
    const{PublicBusinessLiveTools}=await import('../dist/modules/knowledge-base/application/services/public-business-live-tools.js');
    const reader=app.get(PrismaCurrentServiceFactsReader);
    assert.ok(reader instanceof PrismaCurrentServiceFactsReader);assert.equal(app.get(PublicBusinessLiveTools).live,reader);
    assert.equal(app.get(modelTokens.ServiceBusinessAnswerFactory).live,app.get(PublicBusinessLiveTools));
    let sequence=0;
    businessReaderObserver=observeCanonicalLiveReader(reader,PrismaCurrentServiceFactsReader.prototype.read,observation=>{
      const event={runId:databaseRunId,sequence:++sequence,...observation};
      assert.ok(Buffer.byteLength(JSON.stringify(event))<=100000,'evaluation_observation_bounds');
      process.send({type:'local_business_read_observation',event});
    });
  }
  if(localBookingAwaitTrace){
    const{WhatsAppServiceBookingService}=await import('../dist/modules/whatsapp-channel/application/services/whatsapp-service-booking.service.js');
    const{ServiceBookingService}=await import('../dist/modules/checkout/application/service-booking.service.js');
    const{StartCheckoutUseCase}=await import('../dist/modules/checkout/application/use-cases/start-checkout.use-case.js');
    const{ServiceSlotHoldsService}=await import('../dist/shared/bookings/service-slot-holds.service.js');
    const native=app.get(WhatsAppServiceBookingService),booking=app.get(ServiceBookingService),start=app.get(StartCheckoutUseCase),holds=app.get(ServiceSlotHoldsService);
    assert.ok(native instanceof WhatsAppServiceBookingService&&booking instanceof ServiceBookingService&&start instanceof StartCheckoutUseCase&&holds instanceof ServiceSlotHoldsService,'booking_await_trace_real_instances_required');
    assert.equal(native.booking,booking);assert.equal(native.holds,holds);assert.equal(booking.start,start);assert.equal(booking.holds,holds);assert.equal(start.serviceSlots,holds);
    bookingAwaitObserver=observeOwnedBookingAwaits(localBookingAwaitTrace,[
      {instance:native,prototype:WhatsAppServiceBookingService.prototype,method:'respond',label:'native.respond'},
      {instance:booking,prototype:ServiceBookingService.prototype,method:'select',label:'booking.select'},
      {instance:booking,prototype:ServiceBookingService.prototype,method:'prepare',label:'booking.prepare'},
      {instance:booking,prototype:ServiceBookingService.prototype,method:'reviewNativeCheckout',label:'booking.review'},
      {instance:start,prototype:StartCheckoutUseCase.prototype,method:'execute',label:'checkout.start'},
      {instance:holds,prototype:ServiceSlotHoldsService.prototype,method:'prepareProfessionalCheckout',label:'holds.prepare'},
      {instance:holds,prototype:ServiceSlotHoldsService.prototype,method:'state',label:'holds.state'}
    ],event=>process.send({type:'local_booking_await_event',runId:databaseRunId,event}));
  }
  if(localRecoveryTemplateMonitorFixture||localC60RecoveryTemplateMonitorFixture){
    const{WhatsAppTemplatesModule}=await import('../dist/modules/whatsapp-templates/whatsapp-templates.module.js');
    const{RecoveryTemplateMonitorJob}=await import('../dist/modules/whatsapp-templates/infrastructure/recovery-template-monitor.job.js');
    const job=app.select(WhatsAppTemplatesModule).get(RecoveryTemplateMonitorJob,{strict:true});
    recoveryMonitorIsolation=isolateOwnedRecoveryTemplateAutoStart(localRecoveryTemplateMonitorFixture??localC60RecoveryTemplateMonitorFixture,job,RecoveryTemplateMonitorJob);
  }
  stage('app_constructed');
  tracker=createOwnedJourneyClientTracker(app,Number(new URL(redisUrl).port));
  const {apiVersioningMiddleware}=await import('../dist/shared/http/api-versioning.js');app.use(apiVersioningMiddleware);
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  await bounded(app.init(),45_000,'service_app_init_timeout');stage('app_initialized');await app.listen(0,'127.0.0.1');stage('http_listening');
  if(recoveryMonitorIsolation)assert.equal(recoveryMonitorIsolation.evidence().excludedInitializerCalls,1,'recovery_monitor_fixture_expected_initializer');
  stage('warming_owned_clients');
  await tracker.capture({warmLazy:true});
  stage('clients_ready');
  const address=app.getHttpServer().address();assert.equal(address.address,'127.0.0.1');
  if(localWhatsApp?.operatorStatusCallbacks)process.env.API_PUBLIC_URL=`http://127.0.0.1:${address.port}`;
  assert.equal(trap.evidence().providerCalls,0);
  // Private IPC capability, never included in ready/evidence/stdout/stderr.
  // Parent uses its verified owned HTTP origin; the worker trap stays intact.
  if(localBuyerBooking)process.send({type:'local_buyer_booking_credential',runId:databaseRunId,credential:process.env.INTERNAL_SERVICE_TOKEN});
  process.send({type:'ready',apiOrigin:`http://127.0.0.1:${address.port}`,evidence:{canonicalAppModule:true,
    repositoryOverrides:false,authOverrides:false,providerCalls:0,
    ...(localPostalFixture?{localContactDelivery:{transport:'HttpClientService.fetch.third-argument',postalZips:['01310100','01310200'],platformFeeBrl:app.get(Symbol.for('CheckoutExperienceConfig')).platformFeeBrl}}:{}),
    ...(capturedProductPayment?{localCapturedProductPayments:capturedProductPayment.evidence(),localPaymentTransportOverrides:capturedPaymentInstallation.overrides}:{}),
    ...(localBuyerBrowser?{localBuyerBrowser:true,localBuyerTransportOverrides:['buyer-account.EMAIL_OTP_PROVIDER']}:{}),

    ...(releaseFixture?{localServiceReleaseFixture:releaseFixture.evidence}:{}),
    ...(native18FailureTransport?{localNative18HttpFailures:native18FailureTransport.evidence()}:{}),
    ...(syntheticModelFailureTransport?{localSyntheticModelFailureHttp:syntheticModelFailureTransport.evidence()}:{}),
    ...(bookingAwaitObserver?{localBookingAwaitObservation:bookingAwaitObserver.evidence()}:{}),
    ...(recoveryMonitorIsolation?{backgroundSchedulerExclusions:[recoveryMonitorIsolation.evidence()]}:{}),
    ...(metaCapabilitiesTransport?{localMetaCapabilitiesHttp:metaCapabilitiesTransport.evidence()}:{}),
    ...(storefrontRoutingEvidence?{localStorefrontRoutingProfile:storefrontRoutingEvidence}:{}),
    ...(localBusinessRagObservation?{localBusinessRagObservation:true}:{}),localProviderOverrides:fixtureOverrideNames,
    ...(localWhatsApp?.operatorStatusCallbacks?{localOperatorStatusCallbacks:true}:{}),...(modelFixture?{localModelOverrides:modelOverrideNames}:{}),embeddingRuntime:{allowRemoteModels:transformersEnvironment.allowRemoteModels}}});
  process.on('message',async message=>{
    if(message?.type==='local_product_payment_request'){
      if(!capturedProductPayment)return;
      try{
        const control=validateCapturedProductPaymentControl(message,databaseRunId);assert.equal(closed,false);
        const{TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
        const tenantContext=app.get(TenantContextService);
        let result;
        if(control.operation==='bind'){
          const{JwtService}=await import('../dist/modules/auth/domain/services/jwt.service.js');
          result=await capturedProductPayment.bindOwner(control.input.ownerToken,{jwt:app.get(JwtService),tenantContext});
        }else result=await capturedProductPayment.notification(control.input.intentId,control.input.variant,tenantContext);
        if(process.connected)process.send({type:'local_product_payment_result',runId:databaseRunId,requestId:control.requestId,result});
      }catch{
        if(process.connected)process.send({type:'local_product_payment_result',runId:databaseRunId,requestId:message.requestId,error:'captured_product_payment_control_failed'});
      }
      return;
    }
    if(message?.type==='local_buyer_booking_request'){
      if(!localBuyerBooking)return;
      try{
        const control=validateBuyerBookingFixtureRequest(message,databaseRunId);assert.equal(closed,false);
        const{EmbedTokenService}=await import('../dist/modules/embed/domain/embed-token.service.js');
        const tokens=app.get(EmbedTokenService,{strict:false}),claims=tokens.verify(control.input.token),input=control.input;
        assert.ok(claims.merchantId===input.merchantId&&claims.storefrontCartRef===input.cartRef&&claims.allowedOrigin===input.origin
          &&claims.nonce!=='dev_bypass'&&claims.scopes?.includes('checkout:start')
          &&(claims.expiresAtUnix-claims.issuedAtUnix===60||isOwnedBuyerBrowserRenewalWindow(claims,localBuyerBrowser)),'buyer_booking_fixture_original_capability_required');
        const expiresAtUnix=Math.floor(Date.now()/1000)+input.seconds;
        assert.ok(expiresAtUnix<claims.expiresAtUnix&&expiresAtUnix>claims.issuedAtUnix,'buyer_booking_fixture_only_reduce_expiry');
        const shortened={...claims,expiresAtUnix},{expiresAtUnix:_old,...oldClaims}=claims,{expiresAtUnix:_new,...newClaims}=shortened;
        assert.deepEqual(newClaims,oldClaims);
        const token=tokens.sign(shortened);assert.deepEqual(tokens.verify(token),shortened);
        process.send({type:'local_buyer_booking_result',runId:databaseRunId,requestId:control.requestId,result:{token,expiresAtUnix,fixtureShortTTL:true}});
      }catch{
        if(process.connected)process.send({type:'local_buyer_booking_result',runId:databaseRunId,requestId:message.requestId,error:'buyer_booking_fixture_control_failed'});
      }
      return;
    }
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
