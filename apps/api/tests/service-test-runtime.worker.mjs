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

const [databaseUrl,databaseRunId,redisUrl,redisRunId,...extra]=process.argv.slice(2);
const stage=(name,details={})=>process.send?.({type:'stage',stage:name,...details});
stage('worker_started');
assert.equal(extra.length,0);assertConstructionOnlyAmbient(process.env);assertServiceArtifacts();stage('artifacts_checked');
const database=assertNativePrismaUrl(databaseUrl);assertSyntheticRedisIdentity(redisUrl,redisRunId,redisRunId);
inspectNativePrismaClient(fileURLToPath(new URL('../',import.meta.url)));
const {PrismaClient}=await import('@prisma/client'),verify=new PrismaClient({datasources:{db:{url:databaseUrl}},log:[]});
try{assert.deepEqual(await verify.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:databaseRunId}]);}finally{await verify.$disconnect();}
const {Redis}=await import('ioredis');const redis=new Redis(redisUrl,{lazyConnect:true,maxRetriesPerRequest:0,retryStrategy:()=>null});
try{await redis.connect();assertSyntheticRedisIdentity(redisUrl,redisRunId,await redis.get('aacp:synthetic:run'));}finally{redis.disconnect();}
stage('owned_markers_checked');
let app,tracker,trap,closed=false;
async function close(){
  if(closed)return;closed=true;const errors=[];
  stage('closing_capture');
  try{if(tracker)await tracker.capture({ping:false});}catch(e){errors.push(e);}
  stage('closing_app');
  try{if(app)await bounded(app.close(),25_000,'service_app_close_timeout');}catch(e){errors.push(e);}
  stage('closing_owned_clients');
  try{if(tracker)await tracker.close();}catch(e){errors.push(e);}
  const provider=trap?.evidence();
  try{if(trap)await trap.dispose();}catch(e){errors.push(e);}
  if(provider?.providerCalls)errors.push(new Error('service_provider_attempt_forbidden'));
  if(errors.length)throw new AggregateError(errors,'service_app_cleanup_failed:'+errors.map(error=>String(error.message).slice(0,1400)).join('|'));
  return{appClosed:true,providerCalls:provider?.providerCalls??0};
}
try{
  trap=await installConstructionProviderTrap(Number(database.port),Number(new URL(redisUrl).port));
  Object.assign(process.env,{DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,JWT_SECRET:randomBytes(48).toString('hex'),
    BUYER_JWT_SECRET:randomBytes(48).toString('hex'),EMBED_TOKEN_SECRET:randomBytes(48).toString('hex'),
    INTERNAL_SERVICE_TOKEN:randomBytes(48).toString('hex'),AACP_PAYMENT_ENC_KEY:randomBytes(32).toString('hex'),
    AACP_PII_ENC_KEY:randomBytes(32).toString('hex'),LOCAL_LLM_API_KEY:randomBytes(32).toString('hex'),
    LOCAL_LLM_BASE_URL:trap.baseUrl,LOCAL_LLM_MODEL:'synthetic-only',LOG_LEVEL:'silent'});
  const {NestFactory}=await import('@nestjs/core'),{ValidationPipe}=await import('@nestjs/common');
  const {AppModule}=await import('../dist/app.module.js');
  stage('constructing_app');
  app=await bounded(NestFactory.create(AppModule,{abortOnError:false,logger:false,rawBody:true}),45_000,'service_app_construct_timeout');
  stage('app_constructed');
  tracker=createOwnedJourneyClientTracker(app,Number(new URL(redisUrl).port));
  const {apiVersioningMiddleware}=await import('../dist/shared/http/api-versioning.js');app.use(apiVersioningMiddleware);
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  await bounded(app.init(),45_000,'service_app_init_timeout');stage('app_initialized');await app.listen(0,'127.0.0.1');stage('http_listening');
  stage('warming_owned_clients');
  await tracker.capture({warmLazy:true});
  stage('clients_ready');
  const address=app.getHttpServer().address();assert.equal(address.address,'127.0.0.1');
  assert.equal(trap.evidence().providerCalls,0);
  process.send({type:'ready',apiOrigin:`http://127.0.0.1:${address.port}`,evidence:{canonicalAppModule:true,
    repositoryOverrides:false,authOverrides:false,providerCalls:0}});
  process.on('message',async message=>{
    if(message?.type!=='close')return;
    try{const evidence=await close();process.send({type:'closed',evidence},()=>process.disconnect());}
    catch(error){process.send({type:'failure',code:error.message},()=>{process.exitCode=1;process.disconnect();});}
  });
  process.on('disconnect',()=>{if(!closed)close().catch(()=>{process.exitCode=1;});});
}catch(error){
  stage('failure_cleanup_started',{failure:String(error.message).slice(0,1000)});
  try{await close();}catch(cleanup){error=new AggregateError([error,cleanup],'service_setup_cleanup_failed');}
  const causes=error instanceof AggregateError?error.errors.map(e=>String(e.message).slice(0,800)).join(';'):error.message;
  process.send?.({type:'failure',code:`${error.name}:${causes}`},()=>{process.exitCode=1;process.disconnect?.();});
}
