import assert from 'node:assert/strict';
import {assertOwnedMarketingModelUnavailableEvidence} from './service-marketing-model-unavailable-fixture.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {prepareOwnedPgvector} from './local-postgres-profiles.mjs';
import {createServiceTestRedis} from './service-test-redis.mjs';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {terminateOwnedNativeWorker} from './native-prisma-admission-guards.mjs';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {bootstrapServiceSchema} from './service-migration-bootstrap.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';
import {awaitServiceStartup} from './service-test-startup.mjs';
import {createHmac,randomBytes} from 'node:crypto';
import {validateLocalWhatsAppOptions} from './service-whatsapp-provider-fixture.mjs';
import {validateServedModelScript} from './service-served-model-script.mjs';
import {isAllowedBuyerBookingFixture,isOwnedBuyerBrowserRenewalWindow} from './service-buyer-booking-fixture-options.mjs';
import {validateStorefrontRoutingProfile} from './storefront-routing-profile-fixture.mjs';
import {validateOwnedEmptyMetaCapabilitiesFixture} from './service-meta-capabilities-http-fixture.mjs';
import {validateOwnedRecoveryTemplateMonitorFixture} from './service-recovery-template-monitor-fixture.mjs';
import {validateOwnedC60MetaCapabilitiesFixture,validateOwnedC60RecoveryTemplateMonitorFixture} from './service-c60-whatsapp-http-fixture.mjs';
import {validateOwnedBookingAwaitTrace,createOwnedBookingAwaitCollector} from './service-booking-await-trace.mjs';
import {validateOwnedLocalModelFailureFixture} from './service-local-model-failure-fixture.mjs';
import {validateNative18HttpFailures} from './service-native18-http-failures.mjs';
import {validateCapturedProductPaymentOptions} from './product-captured-payment-fixture.mjs';
import {createCapturedProductPaymentChannel} from './product-captured-payment-channel.mjs';
import {validateOwnedPostalFixtureOptions} from './product-contact-delivery-postal.fixture.mjs';
import {createBuyerBrowserMailbox} from './service-buyer-browser-transport.mjs';
import {createOwnedBuyerStorefront} from './service-buyer-storefront.mjs';
import {observeProviderTrapFailure} from './whatsapp-operator-delivery-diagnostics.mjs';

const bookingControlInvalid=condition=>assert.ok(condition,'buyer_booking_fixture_control_invalid');
const bookingRecord=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bookingKeys=(value,keys)=>bookingRecord(value)&&Object.keys(value).every(key=>keys.includes(key));
const bookingId=value=>typeof value==='string'&&value.length>0&&value.length<=191&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
export function validateBuyerBookingFixtureRequest(message,runId){
  bookingControlInvalid(bookingKeys(message,['type','runId','requestId','operation','input'])&&message.type==='local_buyer_booking_request'
    &&message.runId===runId&&/^[a-f0-9]{32}$/.test(message.requestId??'')&&message.operation==='shorten');
  const value=message.input;
  bookingControlInvalid(bookingKeys(value,['token','seconds','merchantId','cartRef','origin'])&&typeof value.token==='string'&&value.token.length>0&&value.token.length<=8192
    &&Number.isInteger(value.seconds)&&value.seconds>=1&&value.seconds<=5&&bookingId(value.merchantId)&&bookingId(value.cartRef)&&typeof value.origin==='string');
  let origin;try{origin=new URL(value.origin).origin;}catch{bookingControlInvalid(false);}
  bookingControlInvalid(origin===value.origin);return structuredClone(message);
}
/** Named local fixture only. The ephemeral credential stays in this closure,
 * never the runtime facade, evidence, ready message, log or exception payload. */
export function createBuyerBookingFixtureChannel({enabled=false,browserEnabled=false,runId,apiOrigin,send,fetchOwned=globalThis.fetch}){
  if(!enabled)return undefined;
  bookingControlInvalid(typeof browserEnabled==='boolean');
  bookingControlInvalid(typeof runId==='string'&&/^[a-f0-9-]{36}$/.test(runId)&&typeof apiOrigin==='function'&&typeof send==='function'&&typeof fetchOwned==='function');
  let credential,closed=false;const issued=new Map(),pending=new Map(),requests=new Set();
  const mailbox=browserEnabled?createBuyerBrowserMailbox(runId):undefined;
  let storefront,storefrontPending;
  const alive=()=>assert.ok(!closed,'buyer_booking_fixture_closed');
  const readToken=value=>{bookingControlInvalid(typeof value==='string'&&value.length<=8192&&value.split('.').length===2);try{return JSON.parse(Buffer.from(value.split('.')[0],'base64url').toString('utf8'));}catch{bookingControlInvalid(false);}};
  const facade=Object.freeze({
    ...(browserEnabled?{
      async openStorefront(){
        alive();assert.ok(credential,'buyer_booking_fixture_credential_unavailable');
        if(storefront)return storefront;if(storefrontPending)return storefrontPending;
        storefrontPending=(async()=>{const owned=await createOwnedBuyerStorefront({runId,apiOrigin:apiOrigin(),credential});
          if(closed){await owned.close();throw Error('buyer_booking_fixture_closed');}storefront=owned;return owned;})();
        try{return await storefrontPending;}finally{storefrontPending=undefined;}
      },
      emailCode(recipient){alive();return mailbox.codeFor(recipient);},
      browserEvidence(){alive();return mailbox.evidence();},
    }:{}),
    async issue(raw){
      alive();assert.ok(credential,'buyer_booking_fixture_credential_unavailable');
      bookingControlInvalid(bookingKeys(raw,['merchantId','body'])&&bookingId(raw.merchantId)&&bookingKeys(raw.body,['cart_ref','conversation_token','allowed_origin','scopes','ttl_seconds','previous_embed_token','buyer_access_token'])
        &&bookingId(raw.body.cart_ref)&&typeof raw.body.conversation_token==='string'&&raw.body.conversation_token.length>0&&raw.body.conversation_token.length<=8192&&typeof raw.body.allowed_origin==='string'
        &&Array.isArray(raw.body.scopes)&&raw.body.scopes.length>0&&raw.body.scopes.length<=9&&new Set(raw.body.scopes).size===raw.body.scopes.length
        &&raw.body.scopes.every(scope=>['checkout:start','checkout:track','checkout:chat','appointments:confirm','payment:intents:create','payment:intents:confirm','payment:intents:read','offers:apply','coupons:apply'].includes(scope))
        &&(raw.body.previous_embed_token===undefined||typeof raw.body.previous_embed_token==='string'&&raw.body.previous_embed_token.length>0&&raw.body.previous_embed_token.length<=8192)
        &&(raw.body.buyer_access_token===undefined||typeof raw.body.buyer_access_token==='string'&&raw.body.buyer_access_token.length>0&&raw.body.buyer_access_token.length<=4096)
        &&(raw.body.ttl_seconds===undefined||Number.isInteger(raw.body.ttl_seconds)&&raw.body.ttl_seconds>=60&&raw.body.ttl_seconds<=900));
      let issuerOrigin;try{issuerOrigin=new URL(raw.body.allowed_origin).origin;}catch{bookingControlInvalid(false);}
      bookingControlInvalid(issuerOrigin===raw.body.allowed_origin);
      assert.ok(issued.size<64,'buyer_booking_fixture_issue_bound');const input=structuredClone(raw);
      let target;try{target=new URL(apiOrigin());}catch{throw Error('buyer_booking_fixture_owned_http_required');}
      assert.ok(target.protocol==='http:'&&target.hostname==='127.0.0.1'&&Number(target.port)>1024&&!target.username&&!target.password&&target.pathname==='/'&&!target.search&&!target.hash,'buyer_booking_fixture_owned_http_required');
      const issuedAfter=Math.floor(Date.now()/1000);
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15_000);requests.add(abort);
      try{
        const response=await fetchOwned(target.origin+'/embed-sessions',{method:'POST',redirect:'error',signal:abort.signal,
          headers:{'content-type':'application/json','x-internal-service-token':credential,'x-merchant-id':input.merchantId,'idempotency-key':randomBytes(16).toString('hex')},body:JSON.stringify(input.body)});
        const body=await response.json();alive();
        if(response.status===201){const claims=readToken(body.embed_session_token);bookingControlInvalid(claims.merchantId===input.merchantId
          &&claims.storefrontCartRef===input.body.cart_ref&&claims.allowedOrigin===input.body.allowed_origin&&typeof claims.nonce==='string');
          const receivedAt=Math.floor(Date.now()/1000);
          let browserRenewal=false;
          if(browserEnabled&&typeof input.body.previous_embed_token==='string'&&typeof input.body.buyer_access_token==='string'
            &&isOwnedBuyerBrowserRenewalWindow(claims,browserEnabled,receivedAt)
            &&claims.expiresAtUnix>=issuedAfter+900&&claims.expiresAtUnix<=receivedAt+900){
            const previous=readToken(input.body.previous_embed_token);
            const {expiresAtUnix:_oldExpiry,scopes:oldScopes,...oldBinding}=previous;
            const {expiresAtUnix:_newExpiry,scopes:newScopes,...newBinding}=claims;
            browserRenewal=JSON.stringify(oldBinding)===JSON.stringify(newBinding)&&Array.isArray(oldScopes)
              &&newScopes.every(scope=>oldScopes.includes(scope));
          }
          issued.set(body.embed_session_token,{merchantId:input.merchantId,cartRef:input.body.cart_ref,origin:input.body.allowed_origin,claims,browserRenewal});}
        return{status:response.status,body};
      }catch(error){if(closed)throw Error('buyer_booking_fixture_closed');if(error?.message?.startsWith('buyer_booking_fixture_'))throw error;throw Error('buyer_booking_fixture_http_failed');}
      finally{clearTimeout(timer);requests.delete(abort);}
    },
    async shorten(raw){
      alive();const original=issued.get(raw?.token);
      assert.ok(original&&raw.merchantId===original.merchantId&&raw.cartRef===original.cartRef&&raw.origin===original.origin
        &&(original.claims.expiresAtUnix-original.claims.issuedAtUnix===60
          ||original.browserRenewal===true&&isOwnedBuyerBrowserRenewalWindow(original.claims,browserEnabled)),'buyer_booking_fixture_original_capability_required');
      const requestId=randomBytes(16).toString('hex'),message=validateBuyerBookingFixtureRequest({type:'local_buyer_booking_request',runId,requestId,operation:'shorten',input:raw},runId);
      assert.ok(pending.size<16,'buyer_booking_fixture_pending_bound');
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('buyer_booking_fixture_control_timeout'));},15_000);
        pending.set(requestId,{resolve,reject,timer,claims:original.claims});
        try{assert.ok(send(message)!==false,'buyer_booking_fixture_worker_unavailable');}
        catch{clearTimeout(timer);pending.delete(requestId);reject(Error('buyer_booking_fixture_worker_unavailable'));}
      });
    },
  });
  return Object.freeze({public:facade,
    accept(message){
      bookingControlInvalid(bookingRecord(message)&&message.runId===runId);
      if(closed)return false;
      if(message.type==='local_buyer_browser_email'){
        bookingControlInvalid(browserEnabled&&mailbox);mailbox.accept(message);return true;
      }
      if(message.type==='local_buyer_booking_credential'){
        bookingControlInvalid(bookingKeys(message,['type','runId','credential'])&&typeof message.credential==='string'&&/^[a-f0-9]{96}$/.test(message.credential));
        assert.ok(!credential,'buyer_booking_fixture_credential_duplicate');credential=message.credential;return true;
      }
      bookingControlInvalid(bookingKeys(message,['type','runId','requestId','result','error'])&&message.type==='local_buyer_booking_result'&&/^[a-f0-9]{32}$/.test(message.requestId??''));
      const entry=pending.get(message.requestId);assert.ok(entry,'buyer_booking_fixture_reply_unknown');clearTimeout(entry.timer);pending.delete(message.requestId);
      if(message.error){entry.reject(Error('buyer_booking_fixture_control_failed'));return true;}
      try{
        const result=message.result;bookingControlInvalid(bookingKeys(result,['token','expiresAtUnix','fixtureShortTTL'])&&result.fixtureShortTTL===true);
        const claims=readToken(result.token),{expiresAtUnix:oldExpiry,...original}=entry.claims,{expiresAtUnix:newExpiry,...shortened}=claims;
        bookingControlInvalid(Number.isSafeInteger(newExpiry)&&newExpiry<oldExpiry&&newExpiry>Math.floor(Date.now()/1000)&&newExpiry===result.expiresAtUnix);
        bookingControlInvalid(JSON.stringify(original)===JSON.stringify(shortened));entry.resolve(structuredClone(result));return true;
      }catch(error){entry.reject(Error('buyer_booking_fixture_control_invalid'));throw error;}
    },
    async closeStorefront(){if(storefrontPending){try{await storefrontPending;}catch{}}if(storefront)await storefront.close();},
    close(){if(closed)return;closed=true;mailbox?.close();credential=undefined;issued.clear();for(const controller of requests)controller.abort();requests.clear();
      for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('buyer_booking_fixture_closed'));}pending.clear();},
  });
}

export const serviceTestEnvironment=source=>constructionOnlyEnvironment(source);
export function assertServiceCaseSummary(value){
  assert.ok(Number.isSafeInteger(value.executed)&&value.executed>0,'service_nonzero_tests_required');
  assert.equal(value.failed,0,'service_failed_case');assert.equal(value.skipped,0,'service_skipped_case');
  return Object.freeze({...value});
}
export async function createServiceTestRuntime(options){
  assert.ok(options&&options.local===true&&Object.keys(options).every(k=>['local','graph','whatsapp','postgresProfile','supportQueryModel','storefrontQueryModel','modelScript','observeBusinessRag','buyerBooking','storefrontRoutingProfile','metaCapabilitiesFixture','recoveryTemplateMonitorFixture','c60MetaCapabilitiesFixture','c60RecoveryTemplateMonitorFixture','bookingAwaitTrace','localModelFailureFixture','native18HttpFailures','serviceReleaseFixture','buyerBrowser','capturedProductPayments','postalFixture'].includes(k))
    &&(options.graph===undefined||typeof options.graph==='boolean')
    &&(options.supportQueryModel===undefined||options.supportQueryModel===true)
    &&(options.storefrontQueryModel===undefined||options.storefrontQueryModel===true)
    &&!(options.supportQueryModel&&options.storefrontQueryModel)
    &&(options.postgresProfile===undefined||options.postgresProfile==='pgvector16'),'service_local_options_required');
  assert.ok(options.buyerBooking===undefined||options.buyerBooking===true,'local_buyer_booking_flag_invalid');
  const buyerBooking=options.buyerBooking===true;
  assert.ok(options.serviceReleaseFixture===undefined||['matching','missing'].includes(options.serviceReleaseFixture),'local_release_fixture_invalid');
  const serviceReleaseFixture=options.serviceReleaseFixture;
  assert.ok(options.buyerBrowser===undefined||options.buyerBrowser===true&&buyerBooking,'local_buyer_browser_flag_invalid');
  const buyerBrowser=options.buyerBrowser===true;
  const capturedProductPayments=validateCapturedProductPaymentOptions(options);
  const postalFixture=validateOwnedPostalFixtureOptions(options),postalEvents=[];
  assert.ok(!buyerBooking||isAllowedBuyerBookingFixture(options),'local_buyer_booking_fixture_exclusive');
  const whatsapp=options.whatsapp===undefined?undefined:validateLocalWhatsAppOptions(options.whatsapp);
  const supportQueryModel=options.supportQueryModel===true;
  const storefrontQueryModel=options.storefrontQueryModel===true;
  const storefrontRoutingProfile=validateStorefrontRoutingProfile(options);
  const metaCapabilitiesFixture=validateOwnedEmptyMetaCapabilitiesFixture(options);
  const recoveryTemplateMonitorFixture=validateOwnedRecoveryTemplateMonitorFixture(options);
  const c60MetaCapabilitiesFixture=validateOwnedC60MetaCapabilitiesFixture(options);
  const c60RecoveryTemplateMonitorFixture=validateOwnedC60RecoveryTemplateMonitorFixture(options);
  const bookingAwaitTrace=validateOwnedBookingAwaitTrace(options);
  const localModelFailureFixture=validateOwnedLocalModelFailureFixture(options);
  const native18HttpFailures=validateNative18HttpFailures(options);
  const bookingAwaitCollector=bookingAwaitTrace?createOwnedBookingAwaitCollector():undefined;
  assert.ok(options.observeBusinessRag===undefined||options.observeBusinessRag===true,'local_business_observation_flag_invalid');
  const observeBusinessRag=options.observeBusinessRag===true;
  assert.ok(!observeBusinessRag||supportQueryModel&&!whatsapp&&!options.graph,'local_business_observation_requires_support_fixture');
  const modelScript=options.modelScript===undefined?undefined:validateServedModelScript(options.modelScript);
  assert.ok(!modelScript||supportQueryModel||storefrontQueryModel,'local_model_script_requires_model_fixture');
  const fixtureSecret=whatsapp?randomBytes(32).toString('hex'):undefined,localEvents=[],localModelEvents=[],localStorefrontModelEvents=[],businessReadEvents=[];
  const fixtureArgument=whatsapp||supportQueryModel||storefrontQueryModel||buyerBooking||serviceReleaseFixture?JSON.stringify({...(c60MetaCapabilitiesFixture?{c60MetaCapabilitiesFixture}:{}),...(c60RecoveryTemplateMonitorFixture?{c60RecoveryTemplateMonitorFixture}:{}),...(postalFixture?{postalFixture}:{}),...(capturedProductPayments?{capturedProductPayments:true}:{}),...(buyerBrowser?{buyerBrowser:true}:{}),...(serviceReleaseFixture?{serviceReleaseFixture}:{}),...(native18HttpFailures?{native18HttpFailures}:{}),...(localModelFailureFixture?{localModelFailureFixture}:{}),...(bookingAwaitTrace?{bookingAwaitTrace}:{}),...(recoveryTemplateMonitorFixture?{recoveryTemplateMonitorFixture}:{}),...(metaCapabilitiesFixture?{metaCapabilitiesFixture}:{}),...(storefrontRoutingProfile?{storefrontRoutingProfile}:{}),...(buyerBooking?{buyerBooking:true}:{}),...(observeBusinessRag?{businessRagObservation:true}:{}),...(modelScript?{modelScript}:{}),...(whatsapp?{...whatsapp,metaSecret:fixtureSecret}:{}),...(supportQueryModel?{supportQueryModel:true}:{}),...(storefrontQueryModel?{storefrontQueryModel:true}:{})}):undefined;
  assert.ok(fixtureArgument===undefined||fixtureArgument.length<=8192,'local_whatsapp_fixture_size_invalid');
  const build=assertServiceArtifacts(),apiRoot=fileURLToPath(new URL('../',import.meta.url));
  let vectorEvidence;
  let db,redis,graph,worker,workerExited,closed=false,appEvidence,cleanup,lastStage='unspawned',cleanupDiagnostics=[],buyerBookingChannel,ownedApiOrigin,productPaymentChannel,productPaymentEvidence={localCapturedPSPCalls:0,refusedCapturedRequests:0,externalProviderCalls:0};
  let readyResolve,readyReject,preflightResolve,preflightReject,closeResolve,closeReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const preflight=new Promise((resolve,reject)=>{preflightResolve=resolve;preflightReject=reject;});
  ready.catch(()=>{});preflight.catch(()=>{});
  const appClosed=new Promise((resolve,reject)=>{closeResolve=resolve;closeReject=reject;});
  // A setup failure may occur before the close acknowledgement is awaited.
  appClosed.catch(()=>{});
  async function close(){
    if(closed)return;closed=true;const errors=[];
    buyerBookingChannel?.close();productPaymentChannel?.close();
    try{await buyerBookingChannel?.closeStorefront();}catch(error){errors.push(error);}
    try{if(worker&&appEvidence){
      if(worker.exitCode===null&&worker.connected)worker.send({type:'close'});
      const final=await deadline(appClosed,35_000,'service_close_ack_timeout');assert.equal(final.appClosed,true);assert.equal(final.providerCalls,0);
      const marketingModelProof=assertOwnedMarketingModelUnavailableEvidence(final.localMarketingModel);
      appEvidence=Object.freeze({...appEvidence,localMarketingModel:marketingModelProof});
      console.info('service_marketing_model_unavailable_fixture',JSON.stringify(marketingModelProof));
      if(storefrontRoutingProfile)assert.deepEqual(final.localStorefrontRoutingProfile,appEvidence.localStorefrontRoutingProfile,'storefront_routing_profile_lifetime_required');
      if(capturedProductPayments){const value=final.localCapturedProductPayments;
        assert.equal(value.externalProviderCalls,0);assert.deepEqual({localCapturedPSPCalls:value.localCapturedPSPCalls,
          refusedCapturedRequests:value.refusedCapturedRequests,externalProviderCalls:value.externalProviderCalls},productPaymentEvidence);}
      if(native18HttpFailures){
        const proof=final.localNative18HttpFailures;
        assert.deepEqual(Object.keys(proof??{}).sort(),['capturedCheckoutModelFailures','capturedServiceNoticeFailures','delegatedAttempts','modelMismatchCount','modelMismatches','profile','restored','status']);
        assert.equal(proof.profile,native18HttpFailures);assert.equal(proof.status,503);assert.equal(proof.restored,true);
        for(const key of['capturedCheckoutModelFailures','capturedServiceNoticeFailures','delegatedAttempts','modelMismatchCount'])assert.ok(Number.isSafeInteger(proof[key])&&proof[key]>=0);
        assert.ok(Array.isArray(proof.modelMismatches)&&proof.modelMismatches.length<=3);
        for(const sample of proof.modelMismatches){assert.deepEqual(Object.keys(sample).sort(),['bodyCheckout','bodyModel','bodySdk','headersCheckout','headersSdk','initCheckout','initSdk','methodPost','ownedRoute','signal']);assert.ok(Object.values(sample).every(value=>typeof value==='boolean'));}
        appEvidence=Object.freeze({...appEvidence,localNative18HttpFailures:structuredClone(proof)});
      }
      if(localModelFailureFixture){
        const proof=final.localSyntheticModelFailureHttp;assert.deepEqual(Object.keys(proof??{}).sort(),['capturedFailures','delegatedAttempts','profile','restored','status']);
        assert.equal(proof.profile,localModelFailureFixture);assert.equal(proof.status,503);assert.equal(proof.restored,true);
        assert.ok(Number.isSafeInteger(proof.capturedFailures)&&proof.capturedFailures>=0&&Number.isSafeInteger(proof.delegatedAttempts)&&proof.delegatedAttempts>=0);
        appEvidence=Object.freeze({...appEvidence,localSyntheticModelFailureHttp:structuredClone(proof)});
      }
      if(bookingAwaitTrace){
        assert.equal(final.localBookingAwaitObservation?.profile,bookingAwaitTrace);assert.equal(final.localBookingAwaitObservation?.restored,true);
        assert.equal(final.localBookingAwaitObservation?.observerFaults,0);
        appEvidence=Object.freeze({...appEvidence,localBookingAwaitObservation:structuredClone(final.localBookingAwaitObservation)});
      }
      if(recoveryTemplateMonitorFixture||c60RecoveryTemplateMonitorFixture){
        assert.ok(Array.isArray(final.backgroundSchedulerExclusions)&&final.backgroundSchedulerExclusions.length===1);const proof=final.backgroundSchedulerExclusions[0];
        assert.deepEqual(Object.keys(proof??{}).sort(),['excludedInitializerCalls','excludedLifecycle','profile','restored']);
        assert.equal(proof.profile,recoveryTemplateMonitorFixture??c60RecoveryTemplateMonitorFixture);assert.equal(proof.restored,true);
        assert.equal(proof.excludedLifecycle,'RecoveryTemplateMonitorJob.onModuleInit');assert.equal(proof.excludedInitializerCalls,1);
        appEvidence=Object.freeze({...appEvidence,backgroundSchedulerExclusions:[structuredClone(proof)]});
      }
      if(metaCapabilitiesFixture||c60MetaCapabilitiesFixture){
        const proof=final.localMetaCapabilitiesHttp;
        assert.deepEqual(Object.keys(proof??{}).sort(),['capturedReads','delegatedAttempts','profile','restored']);
        assert.equal(proof.profile,metaCapabilitiesFixture??c60MetaCapabilitiesFixture);assert.equal(proof.restored,true);assert.equal(proof.delegatedAttempts,0);
        assert.deepEqual(Object.keys(proof.capturedReads).sort(),['flows','product_catalogs']);
        for(const value of Object.values(proof.capturedReads))assert.ok(Number.isSafeInteger(value)&&value>=0);
        appEvidence=Object.freeze({...appEvidence,localMetaCapabilitiesHttp:structuredClone(proof)});
      }
      if(observeBusinessRag){assert.equal(final.businessRagObservation.observerFaults,0,'evaluation_observation_fault');
        assert.equal(final.businessRagObservation.observedReads,businessReadEvents.length,'evaluation_observation_missing');}
      const exit=await deadline(workerExited,5000,'service_worker_natural_exit_required');assert.equal(exit.code,0);assert.equal(exit.signal,null);
    }}
    catch(e){errors.push(e);}
    try{await terminateOwnedNativeWorker(worker);}catch(e){errors.push(e);}
    for(const owned of [graph,redis,db])if(owned){try{await owned.dispose();if(owned.bridgeStatus)assert.deepEqual(owned.bridgeStatus(),{listening:false,sockets:0,children:0});}catch(e){errors.push(e);}}
    if(errors.length){
      for(const error of errors)observeProviderTrapFailure(error);
      console.error('service_runtime_cleanup_failure',JSON.stringify({stage:lastStage,causes:errors.map(error=>({name:error.name,
        codes:[...String(error.message).matchAll(/\b(?:service|owned|native|construction|journey)_[a-z0-9_]+\b/g)].map(match=>match[0]).slice(0,8)}))}));
      throw new AggregateError(errors,`service_runtime_cleanup_failed:${lastStage}:${errors.map(error=>String(error.message).slice(0,1800)).join('|')}:${JSON.stringify(cleanupDiagnostics)}`);
    }
    cleanup={appClosed:true,remainingContainers:0,remainingBridgeSockets:0};
  }
  try{
    db=await createDisposablePostgres({transport:'loopback-exec',...(options.postgresProfile?{profile:options.postgresProfile}:{})});redis=await createServiceTestRedis();
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    if(options.postgresProfile==='pgvector16')vectorEvidence=await prepareOwnedPgvector(db);
    if(options.graph)graph=await createServiceTestNeo4j();
    worker=spawn(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,
      fileURLToPath(new URL('./service-test-runtime.worker.mjs',import.meta.url)),db.prismaUrl,db.runId,redis.url,redis.runId,...(fixtureArgument?[fixtureArgument]:[])],
      {cwd:apiRoot,env:serviceTestEnvironment(process.env),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    let outputBytes=0,stderr='',stageFailure='';lastStage='spawned';
    const limit=chunk=>{outputBytes+=chunk.length;if(outputBytes>2_000_000){readyReject(new Error('service_worker_output_limit'));worker.kill();}};
    let diagnosticBuffer='';
    worker.stdout.on('data',limit);worker.stderr.on('data',chunk=>{
      limit(chunk);if(stderr.length<20_000)stderr+=chunk.toString();
      diagnosticBuffer+=chunk.toString();const lines=diagnosticBuffer.split('\n');diagnosticBuffer=lines.pop().slice(-4000);
      for(const line of lines)if(line.startsWith('service_cleanup_resources:')){
        const value=JSON.parse(line.slice('service_cleanup_resources:'.length));
        assert.ok(['before_closed_ack','disconnected'].includes(value.stage)&&Array.isArray(value.resourceTypes)&&value.resourceTypes.every(type=>typeof type==='string'));
        cleanupDiagnostics.push(value);
        console.info('service_cleanup_resources',JSON.stringify(value));
      }
    });
    buyerBookingChannel=createBuyerBookingFixtureChannel({enabled:buyerBooking,browserEnabled:buyerBrowser,runId:db.runId,apiOrigin:()=>ownedApiOrigin,send:message=>worker.send(message)});
    productPaymentChannel=createCapturedProductPaymentChannel({enabled:capturedProductPayments,runId:db.runId,apiOrigin:()=>ownedApiOrigin,send:message=>worker.send(message)});
    worker.on('error',error=>{buyerBookingChannel?.close();productPaymentChannel?.close();preflightReject(error);readyReject(error);closeReject(error);});
    worker.on('message',message=>{
      if(message?.type==='local_postal_event'){
        const event=message.event;
        assert.ok(postalFixture&&event?.runId===db.runId&&event.sequence===postalEvents.length+1&&event.kind==='capturedPostalLookup'
          &&['01310100','01310200'].includes(event.zip)&&event.method==='GET'
          &&Object.keys(event).sort().join(',')==='kind,method,runId,sequence,zip','local_postal_event_invalid');
        assert.ok(postalEvents.length<20,'local_postal_event_bound');postalEvents.push(structuredClone(event));
      }
      else if(message?.type==='local_product_payment_result'){
        assert.ok(productPaymentChannel,'captured_product_payment_fixture_disabled');productPaymentChannel.accept(message);
      }
      else if(message?.type==='local_product_payment_evidence'){
        const value=message.evidence;
        assert.ok(capturedProductPayments&&message.runId===db.runId&&value&&Object.keys(value).length===3
          &&Number.isSafeInteger(value.localCapturedPSPCalls)&&value.localCapturedPSPCalls>=productPaymentEvidence.localCapturedPSPCalls&&value.localCapturedPSPCalls<=120
          &&Number.isSafeInteger(value.refusedCapturedRequests)&&value.refusedCapturedRequests>=productPaymentEvidence.refusedCapturedRequests
          &&value.externalProviderCalls===0,'captured_product_payment_evidence_invalid');
        productPaymentEvidence=Object.freeze({...value});
      }
      else if(message?.type==='local_booking_await_event'){
        assert.ok(bookingAwaitCollector&&message.runId===db.runId&&Object.keys(message).every(key=>['type','runId','event'].includes(key)),'booking_await_trace_ipc_invalid');
        bookingAwaitCollector.accept(message.event);
      }
      else if(message?.type==='local_buyer_booking_credential'||message?.type==='local_buyer_booking_result'||message?.type==='local_buyer_browser_email'){
        assert.ok(buyerBookingChannel,'local_buyer_booking_fixture_disabled');buyerBookingChannel.accept(message);
      }
      else if(message?.type==='local_whatsapp_event'){
        assert.ok(whatsapp&&message.event?.sequence===localEvents.length+1&&['sendText','sendMedia','voiceInterpret'].includes(message.event.kind),'local_whatsapp_event_invalid');
        assert.ok(localEvents.length<2000,'local_whatsapp_event_limit');localEvents.push(message.event);
      }
      else if(message?.type==='local_support_model_event'){
        const event=message.event;
        assert.ok(supportQueryModel&&event?.runId===db.runId&&event.sequence===localModelEvents.length+1
          &&['queryEmbedding','chatCompletion'].includes(event.kind),'local_support_model_event_invalid');
        assert.ok(localModelEvents.length<40&&Buffer.byteLength(JSON.stringify(event))<=100000,'local_support_model_event_bounds');
        localModelEvents.push(event);
      }
      else if(message?.type==='local_storefront_model_event'){
        const event=message.event;
        assert.ok(storefrontQueryModel&&event?.runId===db.runId&&event.sequence===localStorefrontModelEvents.length+1
          &&['queryEmbedding','providerFetch'].includes(event.kind),'local_storefront_model_event_invalid');
        assert.ok(localStorefrontModelEvents.length<40&&Buffer.byteLength(JSON.stringify(event))<=100000,'local_storefront_model_event_bounds');
        localStorefrontModelEvents.push(event);
      }
      else if(message?.type==='local_business_read_observation'){
        const event=message.event;
        assert.ok(observeBusinessRag&&event?.runId===db.runId&&event.sequence===businessReadEvents.length+1,'evaluation_observation_scope');
        assert.ok(businessReadEvents.length<20&&Buffer.byteLength(JSON.stringify(event))<=100000,'evaluation_observation_bounds');
        assert.deepEqual(Object.keys(event).sort(),['choice','merchantId','result','runId','sequence']);
        businessReadEvents.push(structuredClone(event));
      }
      else if(message?.type==='stage'){lastStage=message.stage;if(message.failure)stageFailure=message.failure;
        if(message.stage==='owned_markers_checked')preflightResolve();}
      else if(message?.type==='ready')readyResolve(message);
      else if(message?.type==='closed')closeResolve(message.evidence);
      else if(message?.type==='failure'){const error=new Error(message.code??'service_worker_failed');preflightReject(error);readyReject(error);closeReject(error);}
    });
    workerExited=new Promise(resolve=>worker.once('close',(code,signal)=>resolve({code,signal})));
    worker.on('exit',(code,signal)=>{buyerBookingChannel?.close();productPaymentChannel?.close();if(!appEvidence){
      console.error('service_worker_before_ready_diagnostic',JSON.stringify({pid:worker.pid,code,signal,lastStage}));
      const error=new Error(`service_worker_exit_before_ready:${code}:${stderr.slice(-4000)}`);
      preflightReject(error);readyReject(error);}if(code!==0)closeReject(new Error(`service_worker_exit:${code}`));});
    let info,timings;
    try{({info,timings}=await awaitServiceStartup(preflight,ready));}
    catch(error){if(['service_preflight_timeout','service_app_ready_timeout'].includes(error.message))throw new Error(`${error.message}:${lastStage}:${stageFailure}`);throw error;}
    const origin=new URL(info.apiOrigin);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');
    ownedApiOrigin=origin.origin;
    assert.ok(Number(origin.port)>1024);appEvidence=Object.freeze({...info.evidence,checkedBuild:build,startupTimings:timings,...(vectorEvidence?{postgresVector:vectorEvidence}:{})});
    return Object.freeze({db,redis,graph,apiOrigin:info.apiOrigin,evidence:()=>capturedProductPayments?Object.freeze({...appEvidence,...(whatsapp?{localProviderEvents:localEvents.length}:{}),localCapturedProductPayments:{...productPaymentEvidence}}):whatsapp?Object.freeze({...appEvidence,localProviderEvents:localEvents.length}):appEvidence,cleanupEvidence:()=>cleanup,close,
      ...(bookingAwaitCollector?{bookingAwaitTrace:Object.freeze({snapshot:()=>bookingAwaitCollector.snapshot()})}:{}),
      ...(buyerBookingChannel?{buyerBooking:buyerBookingChannel.public}:{}),
      ...(productPaymentChannel?{productPayments:productPaymentChannel.public}:{}),
      ...(postalFixture?{postal:Object.freeze({events:()=>structuredClone(postalEvents),evidence:()=>({capturedPostalLookups:postalEvents.length,externalPostalCalls:0})})}:{}),
      ...(modelScript?{modelScript:Object.freeze({release(step){assert.ok(Number.isSafeInteger(step)&&modelScript[step-1]?.hold===true);assert.equal(closed,false);worker.send({type:'local_model_release',runId:db.runId,step});}})}:{}),
      ...(observeBusinessRag?{businessRagObservation:Object.freeze({events:()=>structuredClone(businessReadEvents)})}:{}),
      ...(supportQueryModel?{supportQueryModel:Object.freeze({events:()=>structuredClone(localModelEvents),
        counts:()=>({queryEmbeddings:localModelEvents.filter(event=>event.kind==='queryEmbedding').length,
          completions:localModelEvents.filter(event=>event.kind==='chatCompletion').length})})}:{}),
      ...(storefrontQueryModel?{storefrontQueryModel:Object.freeze({events:()=>structuredClone(localStorefrontModelEvents),
        counts:()=>({queryEmbeddings:localStorefrontModelEvents.filter(event=>event.kind==='queryEmbedding').length,
          providerFetches:localStorefrontModelEvents.filter(event=>event.kind==='providerFetch').length})})}:{}),
      ...(whatsapp?{whatsapp:Object.freeze({events:()=>structuredClone(localEvents),signature:body=>{
        assert.equal(typeof body,'string');assert.ok(body.length<=1_000_000);return 'sha256='+createHmac('sha256',fixtureSecret).update(body).digest('hex');
      }})}:{})});
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'service_runtime_setup_cleanup_failed');}throw error;}
}
async function deadline(promise,milliseconds,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}finally{clearTimeout(timer);}}
