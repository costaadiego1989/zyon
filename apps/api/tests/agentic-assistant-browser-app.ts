import {CampaignWorkspaceController} from '../src/modules/meta-ads-agent/presentation/campaign-workspace.controller.js';
import {CampaignWorkspaceQueryService} from '../src/modules/meta-ads-agent/application/campaign-workspace-query.service.js';
import {CampaignLifecycleController} from '../src/modules/meta-ads-agent/presentation/campaign-lifecycle.controller.js';
import {CampaignLifecycleService} from '../src/modules/meta-ads-agent/application/campaign-lifecycle.service.js';
import {PreparationLimitsController} from '../src/modules/meta-ads-agent/presentation/preparation-limits.controller.js';
import {PreparationLimitsService} from '../src/modules/meta-ads-agent/application/preparation-limits.service.js';
import {CampaignSalesController} from '../src/modules/meta-ads-agent/presentation/campaign-sales.controller.js';
import {CampaignSalesQueryService} from '../src/modules/meta-ads-agent/application/campaign-sales-query.service.js';
import 'reflect-metadata';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Controller,Get,Module,Req,UseGuards} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import express,{type Request,type Response,type NextFunction} from 'express';
import {testDatabase} from './agentic-assistant-browser-database.js';
import {installCashbackBrowserSchema,createCashbackBrowserFixture} from './agentic-assistant-browser-cashback.js';
import {CashbackMerchantController} from '../src/modules/cashback/presentation/cashback.controllers.js';
import {CashbackErrorFilter} from '../src/modules/cashback/presentation/cashback-error.filter.js';
import {CashbackService} from '../src/modules/cashback/application/cashback.service.js';
import {CashbackQueriesService} from '../src/modules/cashback/application/cashback-queries.service.js';
import {createMetaAdsRuntime,type MetaAdsRuntime} from '../src/modules/meta-ads-agent/infrastructure/runtime.js';
import {createMerchantAssistantRuntime,type MerchantAssistantRuntime} from '../src/modules/merchant-assistant/infrastructure/runtime.js';
import {PrismaAuthRepository} from '../src/modules/auth/infrastructure/prisma-auth.repository.js';
import {PrismaMerchantStoreRepository} from '../src/modules/merchant/infrastructure/prisma-merchant-store.repository.js';
import {JwtService} from '../src/modules/auth/domain/services/jwt.service.js';
import {AuthCookieService} from '../src/modules/auth/domain/services/auth-cookie.service.js';
import {AuthGuard} from '../src/modules/auth/presentation/auth.guard.js';
import {currentTenantPrincipal} from '../src/shared/auth/tenant-principal.js';
import {TenantContextService} from '../src/shared/tenant/tenant-context.service.js';
import {AiGovernanceService} from '../src/modules/ai-governance/ai-governance.service.js';
import {ProductEntity} from '../src/modules/catalog/domain/entities/product.entity.js';
import {CredentialCodec} from '../src/modules/meta-ads-agent/infrastructure/credential-codec.js';
import {readOffer} from '../src/modules/meta-ads-agent/domain/offer.js';
import {MetaAdsAgentService} from '../src/modules/meta-ads-agent/application/meta-ads-agent.service.js';
import {AutomationPolicyService} from '../src/modules/meta-ads-agent/application/automation-policy.service.js';
import {FundingService} from '../src/modules/meta-ads-agent/application/funding.service.js';
import {DAILY_OBSERVATION_REPOSITORY} from '../src/modules/meta-ads-agent/domain/daily-observation.port.js';
import {AssistantApiService} from '../src/modules/merchant-assistant/application/assistant-api.service.js';
import {MetaAdsAgentController,MetaAdsHttpErrorFilter} from '../src/modules/meta-ads-agent/presentation/meta-ads-agent.controller.js';
import {AutomationReportController} from '../src/modules/meta-ads-agent/presentation/automation-report.controller.js';
import {FundingController} from '../src/modules/meta-ads-agent/presentation/funding.controller.js';
import {MerchantAssistantController,AssistantHttpErrorFilter} from '../src/modules/merchant-assistant/presentation/merchant-assistant.controller.js';
import {AgenticBrowserProvider,pixel} from './agentic-assistant-browser-provider.js';
import {installCampaignApprovalSchema} from '../src/modules/meta-ads-agent/infrastructure/__tests__/campaign-approval-database.js';
import {CampaignApprovalController} from '../src/modules/meta-ads-agent/presentation/campaign-approval.controller.js';
import {InitialLaunchService} from '../src/modules/meta-ads-agent/application/initial-launch.service.js';
import {CampaignPreparationService} from '../src/modules/meta-ads-agent/application/campaign-preparation.service.js';
import {CampaignNoticeContactService} from '../src/modules/meta-ads-agent/application/campaign-notice-contact.service.js';
import {MerchantNotificationController} from '../src/modules/notifications/presentation/http/merchant-notification.controller.js';
import {ManageMerchantNotificationInboxUseCase} from '../src/modules/notifications/application/use-cases/manage-merchant-notification-inbox.use-case.js';
import {PrismaMerchantNotificationInboxRepository} from '../src/modules/notifications/infrastructure/repositories/prisma-merchant-notification-inbox.repository.js';
import {WhatsAppTemplateSenderAdapter} from '../src/modules/whatsapp-templates/infrastructure/adapters/whatsapp-template-sender.adapter.js';
import {getTemplateDefinition} from '../src/modules/whatsapp-templates/domain/catalog/template-catalog.js';
import {HandleStatusUpdateUseCase} from '../src/modules/whatsapp-channel/application/use-cases/handle-status-update.use-case.js';

const front=process.env.AGENTIC_TEST_FRONTEND_URL??'http://127.0.0.1:5179';
if(!['http://127.0.0.1:5179','http://127.0.0.1:5249','http://127.0.0.1:5250'].includes(front))throw Error('agentic_test_frontend_invalid');
export async function startAgenticBrowserApp({nonce,port}:{nonce:string;port:number}) {
  // This fixture function uses an immutable loopback URL, never DATABASE_URL or .env.
  const initialInstant=process.env.AGENTIC_TEST_CONTEXT==='cashback'?'2026-11-19T12:00:00Z':'2026-11-16T12:00:00Z';
  const db=await testDatabase();let now=new Date(initialInstant);const clock=()=>now;
  try{
    await db.sql.query(await readFile(new URL('../prisma/migrations/20261116103000_merchant_assistant/migration.sql',import.meta.url),'utf8'));
    await db.sql.query(`
      ALTER TABLE merchants ADD COLUMN name TEXT, ADD COLUMN billing_account_merchant_id TEXT, ADD COLUMN store_settings JSONB;
      UPDATE merchants SET name=CASE id WHEN 'store-a' THEN 'Loja Aurora' ELSE 'Loja Horizonte' END,billing_account_merchant_id=id,store_settings='{"company":{"email":"owner@example.test"}}';
      CREATE TABLE merchant_users(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),email TEXT NOT NULL UNIQUE,password_hash TEXT,role TEXT NOT NULL,auth_version INTEGER NOT NULL DEFAULT 0,disabled_at TIMESTAMPTZ,oauth_provider TEXT,oauth_provider_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TYPE "MerchantRole" AS ENUM ('OWNER','ADMIN','STAFF');
      CREATE TABLE merchant_team_members(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES merchant_users(id),role "MerchantRole" NOT NULL,invited_by TEXT,joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(merchant_id,user_id));
      CREATE TABLE merchant_auth_sessions(id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES merchant_users(id),merchant_id TEXT NOT NULL,auth_version INTEGER NOT NULL,refresh_expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO merchant_users(id,merchant_id,email,role) VALUES ('owner-a','store-a','owner@example.test','owner'),('admin-a','store-a','admin@example.test','admin'),('staff-a','store-a','staff@example.test','staff');
      INSERT INTO merchant_team_members(id,merchant_id,user_id,role) VALUES ('owner-a-store-a','store-a','owner-a','OWNER'),('owner-a-store-b','store-b','owner-a','OWNER'),('admin-a-store-a','store-a','admin-a','ADMIN'),('staff-a-store-a','store-a','staff-a','STAFF');
      CREATE TABLE agentic_whatsapp_assets(merchant_id TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT TRUE,approved BOOLEAN NOT NULL DEFAULT TRUE);
      INSERT INTO agentic_whatsapp_assets(merchant_id) VALUES('store-a'),('store-b');
      CREATE TABLE agentic_catalog(merchant_id TEXT PRIMARY KEY,product_id TEXT,variant_id TEXT,name TEXT,price_cents INTEGER,stock INTEGER);
      INSERT INTO agentic_catalog VALUES ('store-a','product-a','variant-a','Camisa',9900,8),('store-b','product-b','variant-b','Bolsa',14900,5);
      CREATE TABLE agentic_billing(merchant_id TEXT PRIMARY KEY,plan_key TEXT,status TEXT);
      INSERT INTO agentic_billing VALUES ('store-a','growth','active'),('store-b','growth','active');
      CREATE TABLE ai_price_versions(id TEXT PRIMARY KEY,provider TEXT,model TEXT,channel TEXT,component TEXT,currency TEXT,input_micros_per_million BIGINT,output_micros_per_million BIGINT,rates JSONB,effective_from TIMESTAMPTZ,effective_to TIMESTAMPTZ);
      INSERT INTO ai_price_versions VALUES ('price','openai','gpt-4o-mini','chat','text_generation','USD',10000,20000,'{"input":"10000","output":"20000"}','2026-01-01',NULL);
      CREATE TABLE ai_actor_teams(merchant_id TEXT,actor_id TEXT,team_id TEXT,updated_by TEXT,updated_at TIMESTAMPTZ,PRIMARY KEY(merchant_id,actor_id));
      CREATE TABLE ai_governance_policies(merchant_id TEXT PRIMARY KEY,grants JSONB,version INTEGER,updated_by TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
      CREATE TABLE ai_governance_decisions(id TEXT PRIMARY KEY,merchant_id TEXT,actor_id TEXT,actor_role TEXT,team_id TEXT,source TEXT,resource_kind TEXT,resource TEXT,allowed BOOLEAN,reason TEXT,policy_version INTEGER,correlation_id TEXT,created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE completed_orders(id TEXT PRIMARY KEY,merchant_id TEXT,completed_at TIMESTAMPTZ);
    `);
    await installCampaignApprovalSchema(db.sql);
    await installCashbackBrowserSchema(db.sql);
    await db.sql.query(`ALTER TABLE completed_orders ADD COLUMN session_id TEXT,ADD COLUMN external_order_id TEXT,ADD COLUMN order_total NUMERIC,ADD COLUMN currency TEXT,ADD COLUMN line_items_json JSONB;
      ALTER TABLE payment_intents ADD COLUMN approved_amount_cents INT,ADD COLUMN currency TEXT,ADD COLUMN status_history JSONB,ADD COLUMN updated_at TIMESTAMP;
      CREATE TABLE returns(id TEXT PRIMARY KEY,merchant_id TEXT,order_id TEXT);
      CREATE TABLE return_refunds(return_id TEXT,amount_in_cents INT,status TEXT);`);
  }catch(error){await db.close();throw error;}
  const provider=new AgenticBrowserProvider(clock),tenant=new TenantContextService(),memberships=new PrismaMerchantStoreRepository(db.prisma);
  const governance=new AiGovernanceService(db.prisma,tenant),authRepo=new PrismaAuthRepository(db.prisma),jwt=new JwtService(randomBytes(32).toString('base64'),3600,authRepo),cookies=new AuthCookieService('aacp_access_token',false);
  // Uninjected network calls are forbidden even if the operator has credentials in another shell.
  globalThis.fetch=async(url,init)=>{const target=new URL(String(url));if(target.hostname==='graph.facebook.com'&&/^\/v\d+\.\d+\/\d+\/messages$/.test(target.pathname))return provider.request(url,init);throw new Error('uncontrolled_external_transport');};
  const env:Record<string,string>={META_ADS_AGENT_ENABLED:'true',META_ADS_AGENT_GENERATION_WORKER_ENABLED:'true',MERCHANT_ASSISTANT_ENABLED:'true',META_ADS_AGENT_AUTOMATION_ENABLED:'true',META_ADS_AGENT_OBSERVATION_ENABLED:'true',META_ADS_AGENT_REMOTE_WRITES_ENABLED:'true',META_ADS_GRAPH_API_VERSION:'v26.0',META_ADS_CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('base64'),META_ADS_ATTRIBUTION_SIGNING_KEY:randomBytes(32).toString('base64'),META_ADS_DASHBOARD_URL:front,STOREFRONT_PUBLIC_URL:'https://store.example.test',OPENAI_API_KEY:'synthetic-provider-key',OPENAI_MODEL:'gpt-4o-mini',META_ADS_IMAGE_API_KEY:'synthetic-image-key',META_ADS_IMAGE_SOURCE_HOSTS:'media.example.test'};
  const codec=new CredentialCodec(env.META_ADS_CREDENTIAL_ENCRYPTION_KEY);
  Object.assign(env,{META_ADS_AGENT_CAMPAIGN_APPROVAL_ENABLED:'true',META_ADS_AGENT_CAMPAIGN_NOTICES_ENABLED:'true',META_ADS_CAMPAIGN_REVIEW_URL:'https://dashboard.example.test'});
  const configs={findByMerchantId:async(merchantId:string)=>{const row=(await db.sql.query('SELECT * FROM agentic_whatsapp_assets WHERE merchant_id=$1',[merchantId])).rows[0];return row?{id:'config-'+merchantId,merchantId,enabled:row.enabled,provider:'META_CLOUD',status:'ACTIVE',credentials:{accessToken:'controlled-'+merchantId,wabaId:merchantId==='store-a'?'123456789':'123456780',phoneNumberId:merchantId==='store-a'?'987654321':'987654320'},whatsappNumber:merchantId==='store-a'?'+5511999990000':'+5511999990001',createdAt:clock(),updatedAt:clock()}:null;}};
  const templates={findByMerchantAndType:async(merchantId:string)=>{const row=(await db.sql.query('SELECT * FROM agentic_whatsapp_assets WHERE merchant_id=$1',[merchantId])).rows[0];if(!row)return null;const def=getTemplateDefinition('campaign_ready',merchantId==='store-a'?'Loja Aurora':'Loja Horizonte');return{id:'template-'+merchantId,merchantId,type:'campaign_ready',channel:'whatsapp',name:def.label,body:def.freeformBody,subject:null,isActive:true,metaCategory:def.category,metaLanguage:'pt_BR',metaTemplateBody:def.metaBody,metaVariableMap:def.variableMap,twilioContentSid:'store_campaign_ready',metaStatus:row.approved?'approved':'pending',metaRejectionReason:null,metaWabaId:merchantId==='store-a'?'123456789':'123456780',metaRevision:1,metaLastCheckedAt:new Date(),createdAt:clock(),updatedAt:clock()};}};
  const templateSender=new WhatsAppTemplateSenderAdapter(configs as never,templates as never,{createAndSubmit:async()=>{throw Error('template_submission_forbidden_in_fixture');},syncStatus:async(merchantId,sid)=>({status:(await templates.findByMerchantAndType(merchantId))?.metaStatus==='approved'?'approved':'pending',contentSid:sid})});
  const inbox=new ManageMerchantNotificationInboxUseCase(new PrismaMerchantNotificationInboxRepository(db.prisma)),receipts=new HandleStatusUpdateUseCase(db.prisma);
  const products=async(merchantId:string,query?:string,variantIds?:string[])=>{
    const row=(await db.sql.query('SELECT * FROM agentic_catalog WHERE merchant_id=$1',[merchantId])).rows[0];if(!row||query&&!row.name.toLowerCase().includes(query.toLowerCase())||variantIds&&!variantIds.includes(row.variant_id))return [];
    return [new ProductEntity({id:row.product_id,merchantId,name:row.name,description:'Produto do catálogo de teste',type:'physical',isActive:true,createdAt:new Date('2026-11-01'),updatedAt:new Date('2026-11-01'),variants:[{id:row.variant_id,sku:merchantId==='store-a'?'CA':'BO',attributes:{},isActive:true,basePriceInCents:row.price_cents,costInCents:0,taxPercent:0,currency:'BRL',stockQuantity:row.stock,stockReserved:0,media:[{id:'source-'+row.variant_id,url:'https://media.example.test/product.png',type:'IMAGE',order:0}]}]})];
  };
  const catalog={findByVariantIds:(merchantId:string,ids:string[])=>products(merchantId,undefined,ids),search:async(input:{merchantId:string;query?:string})=>({products:await products(input.merchantId,input.query)})};
  const merchants={getProfile:async(id:string)=>{const row=(await db.sql.query('SELECT id,name,store_settings FROM merchants WHERE id=$1',[id])).rows[0];return row?{id:row.id,name:row.name,slug:id,storeSettings:row.store_settings}:undefined;}};
  const billing={getBilling:async(merchantId:string)=>{const row=(await db.sql.query('SELECT * FROM agentic_billing WHERE merchant_id=$1',[merchantId])).rows[0];return row?{merchantId,planKey:row.plan_key,status:row.status}:undefined;}};
  const cashback=createCashbackBrowserFixture(db.prisma,db.sql,clock);
  let assistant:MerchantAssistantRuntime,meta:MetaAdsRuntime;
  const compose=()=>{
    assistant=createMerchantAssistantRuntime({prisma:db.prisma,memberships,tenant,governance,env,transport:provider.request,clock});
    cashback.register(assistant);
    meta=createMetaAdsRuntime({prisma:db.prisma,catalog:catalog as never,merchants:merchants as never,billing:billing as never,storage:{isConfigured:()=>true,upload:async(_bytes,_type,_folder,name)=>({url:`https://media.example.test/${name}.png`,key:name})},whatsapp:configs as never,templates:templates as never,templateSender,env,assistant,memberships,request:provider.request,clock});
  };
  async function seed(){
    for(const merchantId of ['store-a','store-b'])await meta.service.repo.mutate(merchantId,[],state=>{
      const second=merchantId==='store-b',account={id:second?'101':'100',name:second?'Conta da loja B':'Conta da loja A'},page={id:second?'111':'110',name:'Página da loja',accountId:account.id},dataset={id:second?'121':'120',name:'Compras',accountId:account.id};
      state.subscription={id:'contract-'+merchantId,offer:readOffer(env),status:'active',provider:'stripe',currentPeriodStart:'2026-11-01T00:00:00Z',currentPeriodEnd:'2026-12-01T00:00:00Z',cancelAtPeriodEnd:false,acceptedAt:'2026-11-01T00:00:00Z',checkoutId:'synthetic-'+merchantId,providerSubscriptionId:'sub-'+merchantId,providerCustomerId:'customer-'+merchantId};
      state.credits.monthlyAvailable=30;state.credits.periodKey='period-'+merchantId;state.credits.periodEndsAt='2026-12-01T00:00:00Z';
      state.automation={version:0,activePolicyId:null,lastPolicyId:null};
      Object.assign(state.connection,{status:'connected',epoch:1,account,page,dataset,whatsapp:{id:second?'5511988888888':'5511999999999',name:'WhatsApp da loja',accountId:account.id,pageId:page.id},whatsappNumbers:[{id:second?'5511988888888':'5511999999999',name:'WhatsApp da loja',accountId:account.id,pageId:page.id}],accounts:[account],pages:[page],datasets:[dataset],capabilities:{prepare:true,publish:true,optimize:true,insights:true,catalog:true,whatsapp:true},encryptedAccessToken:codec.encrypt(merchantId,'controlled-'+merchantId),clientConversationId:second?'LocalTestSession0002':'LocalTestSession0001',scopes:['ads_mcp_management','ads_management','catalog_management'],connectedAt:clock().toISOString(),expiresAt:'2026-12-01T00:00:00Z'});return{result:null};
    });
  }
  const stopWorkers=async()=>{await assistant.worker.onModuleDestroy();await meta.preparationWorker.onModuleDestroy();await meta.generationWorker.onModuleDestroy();await meta.noticeWorker.onModuleDestroy();await meta.launches.onModuleDestroy();await meta.observation.onModuleDestroy();await meta.automatic.onModuleDestroy();};
  const startWorkers=()=>{assistant.worker.onModuleInit();meta.generationWorker.onModuleInit();meta.preparationWorker.onModuleInit();meta.noticeWorker.onModuleInit();meta.launches.onModuleInit();meta.automatic.onModuleInit();meta.observation.onModuleInit();};
  compose();await seed();await cashback.seed();
  const proxy=<T extends object>(select:()=>T)=>new Proxy({} as T,{get(_target,key){const target=select(),value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  Reflect.defineMetadata('design:paramtypes',[JwtService,AuthCookieService],AuthGuard);
  Reflect.defineMetadata('design:paramtypes',[ManageMerchantNotificationInboxUseCase],MerchantNotificationController);
  Reflect.defineMetadata('design:paramtypes',[CashbackService,CashbackQueriesService],CashbackMerchantController);
  @Controller('agentic-test') @UseGuards(AuthGuard) class SessionController{@Get('session') session(@Req() request:Request){const principal=currentTenantPrincipal(request);return{merchantId:principal.tenantId,userId:principal.userId,role:principal.role};}}
  @Module({controllers:[CampaignWorkspaceController,CampaignLifecycleController,PreparationLimitsController,CampaignSalesController,CashbackMerchantController,MetaAdsAgentController,FundingController,AutomationReportController,MerchantAssistantController,CampaignApprovalController,MerchantNotificationController,SessionController],providers:[{provide:CampaignWorkspaceQueryService,useValue:proxy(()=>meta.workspace)},{provide:CampaignLifecycleService,useValue:proxy(()=>meta.lifecycle)},{provide:PreparationLimitsService,useValue:proxy(()=>meta.preparationLimits)},{provide:CampaignSalesQueryService,useValue:proxy(()=>meta.sales)},AuthGuard,CashbackErrorFilter,{provide:CashbackService,useValue:cashback.service},{provide:CashbackQueriesService,useValue:cashback.queries},MetaAdsHttpErrorFilter,AssistantHttpErrorFilter,{provide:JwtService,useValue:jwt},{provide:AuthCookieService,useValue:cookies},{provide:MetaAdsAgentService,useValue:proxy(()=>meta.service)},{provide:FundingService,useValue:proxy(()=>meta.funding)},{provide:AutomationPolicyService,useValue:proxy(()=>meta.policies)},{provide:DAILY_OBSERVATION_REPOSITORY,useValue:proxy(()=>meta.daily)},{provide:AssistantApiService,useValue:proxy(()=>assistant.api)},{provide:InitialLaunchService,useValue:proxy(()=>meta.launches)},{provide:CampaignPreparationService,useValue:proxy(()=>meta.preparation)},{provide:CampaignNoticeContactService,useValue:proxy(()=>meta.contacts)},{provide:ManageMerchantNotificationInboxUseCase,useValue:inbox}]})class BrowserModule{}
  const app=await NestFactory.create(BrowserModule,{logger:false,forceCloseConnections:true});app.setGlobalPrefix('v1');app.enableCors({origin:front,credentials:true});app.use(express.json({limit:'64kb'}));
  let closing:Promise<void>|undefined,dropNextTurnResponse=false,dropNextLaunchResponse=false;
  const close=()=>closing??=(async()=>{provider.setImageHold(false);provider.setModelHold(false);await stopWorkers();await app.close();await db.close();})();
  app.use(async(req:Request,res:Response,next:NextFunction)=>{
    if(!req.path.startsWith('/__test/')){
      if(dropNextLaunchResponse&&req.method==='POST'&&req.path.endsWith('/approve-launch')){
        const send=res.json.bind(res);res.json=body=>{if(res.statusCode>=200&&res.statusCode<300){dropNextLaunchResponse=false;res.type('application/json').end('{"incomplete":');return res;}return send(body);};
      }
      if(dropNextTurnResponse&&req.method==='POST'&&/^\/v1\/merchant-assistant\/contexts\/(?:meta-ads|cashback)\/threads\/[^/]+\/turns$/.test(req.path)){
        const send=res.json.bind(res);res.json=body=>{if(res.statusCode>=200&&res.statusCode<300){dropNextTurnResponse=false;res.type('application/json').end('{"incomplete":');return res;}return send(body);};
      }
      return next();
    }
    if(req.path==='/__test/health')return res.json({ready:true,scope:'dedicated-loopback-fixture'});
    if(req.headers['x-agentic-test-nonce']!==nonce||req.headers.origin&&req.headers.origin!==front)return res.status(403).json({code:'test_control_forbidden'});
    try{
      if(req.path==='/__test/login'&&req.method==='POST'){
        const store=req.body?.store,role=req.body?.role==='staff'?'staff':req.body?.role==='admin'?'admin':'owner',actor=role+'-a';if(!['store-a','store-b'].includes(store)||!await memberships.findMembership(actor,store))return res.status(403).end();
        const token=await jwt.issue({merchantId:store,userId:actor,email:role+'@example.test',role});res.setHeader('Set-Cookie',cookies.create({access_token:token,expires_in:3600,token_type:'Bearer'}));return res.json({merchantId:store});
      }
      if(req.path==='/__test/workspace'&&req.method==='POST'){
        const count=req.body?.count;if(!Number.isSafeInteger(count)||count<1||count>80)return res.status(400).end();
        const product=(await meta.service.commerce.products('store-a',{variantIds:['variant-a']}))[0];
        await meta.service.repo.mutate('store-a',[],state=>{const records=[];for(let i=0;i<count;i++){const id='workspace-'+i,remote=i<2;const c={id,createdByAgent:true,managed:true,remoteCampaignId:remote?String(2000+i):null,remoteAdSetId:remote?String(3000+i):null,remoteAdIds:remote?[String(5000+i)]:[],remoteAccountId:remote?'100':null,status:i===0?'delivered':i===1?'remote_paused':'draft',createdAt:new Date(clock().getTime()-i*1000).toISOString(),updatedAt:new Date(clock().getTime()-i*1000).toISOString(),products:[product],draft:{name:'Camisa '+(i+1)+' · Mais vendas · Loja',variantIds:['variant-a'],destination:'store',priority:'paid_sales',country:'BR',mediaIds:[],headline:'Camisa para o seu dia',primaryText:'Conheça a camisa da loja.',budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:clock().toISOString(),endsAt:'2026-11-23T12:00:00Z'}}} as const;state.campaigns[id]=structuredClone(c) as never;records.push({key:'campaign-origin:'+id,kind:'audit' as const,payload:{source:'agent',campaignId:id},createdAt:clock().toISOString()});if(remote)provider.seedWorkspaceCampaign(c,i===0);}
        return{result:null,records};});return res.json({seeded:count,synthetic:true});
      }
      if(req.path==='/__test/opportunities'&&req.method==='POST'){await meta.opportunityWorker.drain();return res.json({drained:true});}
      if(req.path==='/__test/workspace-purchase'&&req.method==='POST'){
        const sessionId='workspace-checkout';await meta.attribution.captureStore('store-a',{sessionId,token:meta.attribution.trackingToken('store-a','workspace-0'),consent:false,consentVersion:'qa-v1',idempotencyKey:'workspace-first-click'});
        now=new Date(clock().getTime()+60000);await meta.attribution.captureStore('store-a',{sessionId,token:meta.attribution.trackingToken('store-a','workspace-1'),consent:false,consentVersion:'qa-v1',idempotencyKey:'workspace-last-click'});
        now=new Date(clock().getTime()+60000);
        await db.sql.query("INSERT INTO completed_orders(id,merchant_id,session_id,external_order_id,order_total,currency,completed_at,line_items_json) VALUES('workspace-order','store-a',$1,'workspace-order',100,'BRL',$2,$3)",[sessionId,clock(),JSON.stringify([{variantId:'variant-a',quantity:1}])]);
        await db.sql.query("INSERT INTO payment_intents(id,merchant_id,session_id,status,amount_cents,approved_amount_cents,currency,status_history,updated_at) VALUES('workspace-payment','store-a',$1,'approved',10000,10000,'BRL',$2,$3)",[sessionId,JSON.stringify([{status:'approved',occurredAt:clock().toISOString()}]),clock()]);
        await db.sql.query("INSERT INTO returns VALUES('workspace-return','store-a','workspace-order');INSERT INTO return_refunds VALUES('workspace-return',2000,'COMPLETED')");
        const purchase=await meta.attribution.reconcilePurchase('store-a','workspace-order');return res.json({campaignId:purchase?.campaignId,rule:purchase?.attribution?.rule});
      }
      if(req.path==='/__test/reset'&&req.method==='POST'){
        provider.setImageHold(false);provider.setModelHold(false);dropNextTurnResponse=false;dropNextLaunchResponse=false;await stopWorkers();await db.sql.query('DELETE FROM meta_ads_campaign_ready_notices; DELETE FROM meta_ads_campaign_preparations; DELETE FROM meta_ads_campaign_notice_contacts; DELETE FROM merchant_notifications; DELETE FROM whatsapp_deliveries; UPDATE agentic_whatsapp_assets SET enabled=TRUE,approved=TRUE; DELETE FROM merchant_assistant_threads; DELETE FROM meta_ads_daily_runs; DELETE FROM meta_ads_agent_records; DELETE FROM meta_ads_agent_stores; DELETE FROM ai_governance_decisions; DELETE FROM merchant_auth_sessions; DELETE FROM return_refunds; DELETE FROM returns; DELETE FROM completed_orders');now=new Date(initialInstant);await cashback.reset();provider.reset();env.META_ADS_IMAGE_API_KEY='synthetic-image-key';env.MERCHANT_ASSISTANT_ENABLED='true';env.META_ADS_AGENT_CAMPAIGN_APPROVAL_ENABLED='true';env.META_ADS_AGENT_CAMPAIGN_NOTICES_ENABLED='true';compose();await seed();startWorkers();return res.json({reset:true});
      }
      if(req.path==='/__test/cashback-assistant'&&req.method==='POST'){if(typeof req.body?.enabled!=='boolean')return res.status(400).end();env.MERCHANT_ASSISTANT_ENABLED=String(req.body.enabled);return res.json({configured:true});}
      if(req.path==='/__test/funding'&&req.method==='POST'){
        if(!['prepaid','postpaid','unknown'].includes(req.body?.mode))return res.status(400).end();provider.fundingMode=req.body.mode;provider.blocked=req.body.blocked===true;return res.json({configured:true});
      }
      if(req.path==='/__test/budget'&&req.method==='POST'){const value=req.body?.minimumDailyBudgetCents;if(!Number.isSafeInteger(value)||value<=0)return res.status(400).end();provider.minimumDailyBudgetCents=value;return res.json({configured:true});}
      if(req.path==='/__test/catalog-photo'&&req.method==='POST'){if(typeof req.body?.enabled!=='boolean')return res.status(400).end();await stopWorkers();env.META_ADS_IMAGE_API_KEY=req.body.enabled?'':'synthetic-image-key';compose();startWorkers();return res.json({configured:true,generationConfigured:!!env.META_ADS_IMAGE_API_KEY});}
      if(req.path==='/__test/ad-phone'&&req.method==='POST'){if(typeof req.body?.linked!=='boolean')return res.status(400).end();provider.pageWhatsAppLinked=req.body.linked;await meta.service.repo.mutate('store-a',[],state=>{if(!req.body.linked){state.connection.whatsapp=null;state.connection.whatsappNumbers=[];}return{result:null};});return res.json({configured:true});}
      if(req.path==='/__test/images'&&req.method==='POST'){if(typeof req.body?.hold!=='boolean')return res.status(400).end();provider.setImageHold(req.body.hold);return res.json({configured:true});}
      if(req.path==='/__test/model'&&req.method==='POST'){if(typeof req.body?.hold!=='boolean'&&!Array.isArray(req.body?.script))return res.status(400).end();if(Array.isArray(req.body?.script))provider.setModelScript(req.body.script);if(typeof req.body?.hold==='boolean')provider.setModelHold(req.body.hold);return res.json({configured:true});}
      if(req.path==='/__test/metrics'&&req.method==='POST'){if(typeof req.body?.unavailable!=='boolean'||req.body.sampleData!==undefined&&typeof req.body.sampleData!=='boolean')return res.status(400).end();provider.metricsUnavailable=req.body.unavailable;provider.sampleMetrics=req.body.sampleData??false;return res.json({configured:true});}
      if(req.path==='/__test/drop-turn-response'&&req.method==='POST'){dropNextTurnResponse=true;return res.json({configured:true});}
      if(req.path==='/__test/pause-timeout'&&req.method==='POST'){if(typeof req.body?.enabled!=='boolean')return res.status(400).end();provider.pauseTimeout=req.body.enabled;return res.json({configured:true});}
      if(req.path==='/__test/drop-launch-response'&&req.method==='POST'){dropNextLaunchResponse=true;return res.json({configured:true});}
      if(req.path==='/__test/engine'&&req.method==='POST'){if(typeof req.body?.enabled!=='boolean')return res.status(400).end();env.META_ADS_AGENT_CAMPAIGN_APPROVAL_ENABLED=String(req.body.enabled);return res.json({configured:true});}
      if(req.path==='/__test/whatsapp'&&req.method==='POST'){
        if(!['store-a','store-b'].includes(req.body?.store??'store-a')||req.body?.mode&&!['accepted','timeout','reject'].includes(req.body.mode))return res.status(400).end();
        if(typeof req.body?.enabled==='boolean')await db.sql.query('UPDATE agentic_whatsapp_assets SET enabled=$1 WHERE merchant_id=$2',[req.body.enabled,req.body.store??'store-a']);
        if(typeof req.body?.approved==='boolean')await db.sql.query('UPDATE agentic_whatsapp_assets SET approved=$1 WHERE merchant_id=$2',[req.body.approved,req.body.store??'store-a']);
        if(req.body?.mode)provider.whatsappMode=req.body.mode;return res.json({configured:true});
      }
      if(req.path==='/__test/workers'&&req.method==='POST'){
        if(req.body?.restart){await stopWorkers();compose();startWorkers();}
        await meta.preparationWorker.drain();await meta.generationWorker.drain();
        // The fixture clock is frozen. Explicitly advance scheduled retries, never
        // bypass a lease, a business guard or a production job transition.
        const scheduled=await db.sql.query("SELECT next_attempt_at FROM meta_ads_campaign_preparations WHERE status='creative_pending' UNION ALL SELECT next_attempt_at FROM meta_ads_campaign_ready_notices WHERE whatsapp_status='blocked'");
        for(const row of scheduled.rows)if(new Date(row.next_attempt_at)>now)now=new Date(row.next_attempt_at);
        await meta.preparationWorker.drain();await meta.noticeWorker.drain();await meta.launches.drain();return res.json({drained:true});
      }
      if(req.path==='/__test/receipt'&&req.method==='POST'){
        const store=req.body?.store??'store-a';if(!['store-a','store-b'].includes(store)||!['sent','delivered','read','failed'].includes(req.body?.status))return res.status(400).end();
        const delivery=await db.prisma.whatsAppDelivery.findFirst({where:{merchantId:store,campaignReadyNoticeId:{not:null}},orderBy:{createdAt:'desc'}});
        if(!delivery)return res.status(404).end();await receipts.receiveMetaReceipt({merchantId:store,configId:delivery.configId,messageId:delivery.providerMessageId??'wamid.controlled-unknown',correlationId:delivery.id,status:req.body.status});return res.json({received:true});
      }
      if(req.path==='/__test/automatic'&&req.method==='POST'){await meta.automatic.drain();return res.json({drained:true});}
      if(req.path==='/__test/clock'&&req.method==='POST'){
        const value=new Date(req.body?.now);if(!Number.isFinite(value.getTime())||value.getUTCFullYear()!==2026)return res.status(400).end();now=value;await meta.observation.run();return res.json({now:clock().toISOString()});
      }
      if(req.path==='/__test/facts'){
        const row=(await db.sql.query(`SELECT (SELECT count(*) FROM merchant_assistant_threads) threads,(SELECT count(*) FROM merchant_assistant_turns) turns,(SELECT count(*) FROM merchant_auth_sessions) sessions,(SELECT COALESCE(sum(usage_cost_micros),0) FROM merchant_assistant_turns) cost,(SELECT count(*) FROM ai_governance_decisions) decisions`)).rows[0];
        const usage=(await db.sql.query('SELECT merchant_id,count(*) turns,COALESCE(sum(usage_cost_micros),0) cost,array_agg(status ORDER BY ordinal) statuses FROM merchant_assistant_turns GROUP BY merchant_id')).rows;
        const states=await Promise.all(['store-a','store-b'].map(async merchantId=>{const state=await meta.service.repo.read(merchantId),executions=Object.values(state.executions),measured=usage.find(row=>row.merchant_id===merchantId);const authorities=await Promise.all(executions.map(async execution=>(await meta.service.repo.getRecord<{authority:unknown}>(merchantId,`execution-input:${execution.id}`))?.payload.authority));return{merchantId,campaigns:Object.values(state.campaigns),media:Object.values(state.media),proposals:Object.values(state.proposals),executions,generations:Object.values(state.generations),credits:{monthlyAvailable:state.credits.monthlyAvailable,extraAvailable:state.credits.extraAvailable},automation:state.automation,policy:await meta.policies.view(merchantId),exposure:state.exposure??{allocations:{},pending:{}},authorities,preparations:(await Promise.all(Object.keys(state.campaigns).map(id=>meta.preparations.list(merchantId,id)))).flat(),notices:(await Promise.all(Object.keys(state.campaigns).map(id=>meta.notices.list(merchantId,id)))).flat(),assistant:{turns:Number(measured?.turns??0),cost:Number(measured?.cost??0),statuses:measured?.statuses??[]}};}));
        return res.json({cashback:await cashback.facts(),databaseHost:'127.0.0.1',threads:Number(row.threads),turns:Number(row.turns),authSessions:Number(row.sessions),confirmedAiCostMicros:Number(row.cost),governanceDecisions:Number(row.decisions),retrievedReferenceIds:[...new Set(provider.retrievedReferenceIds)],writes:provider.writes,images:provider.images,catalogCopies:provider.catalogCopies,generationConfigured:!!env.META_ADS_IMAGE_API_KEY,reviewCalls:provider.reviewCalls,modelCalls:provider.modelCalls,modelPending:provider.modelPending,whatsappRequests:provider.whatsappRequests,notifications:await db.prisma.merchantNotification.findMany(),states});
      }
      if(req.path==='/__test/pixel')return res.type('png').send(pixel);
      if(req.path==='/__test/shutdown'&&req.method==='POST'){res.once('finish',()=>{void close().then(()=>process.exit(0)).catch(()=>process.exit(1));});return res.json({closing:true});}
      return res.status(404).end();
    }catch(error){return res.status(500).json({code:'test_control_failed',message:error instanceof Error?error.message:'unexpected'});}
  });
  await app.listen(port,'127.0.0.1');startWorkers();
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void close().then(()=>process.exit(0)).catch(()=>process.exit(1));});
  process.stdout.write(JSON.stringify({ready:true,host:'127.0.0.1',port})+'\n');
}
