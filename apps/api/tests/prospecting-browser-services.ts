import {WhatsAppWebhookController} from "../src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.js";
import {WHATSAPP_CONFIG_REPOSITORY} from "../src/modules/whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import {AcceptBubbleWhatsWebhookUseCase} from "../src/modules/whatsapp-channel/application/use-cases/accept-bubblewhats-webhook.use-case.js";
import {PROSPECT_META_DISPATCH} from "../src/shared/integrations/prospect-meta-dispatch.port.js";
import {ProspectEffectQueue} from "../src/modules/platform-prospecting/infrastructure/prospecting-workers.js";
import {ProspectFollowUpWorker} from "../src/modules/platform-prospecting/application/campaigns/prospect-follow-up.worker.js";
import {ProspectDispatchWorker} from "../src/modules/platform-prospecting/application/campaigns/prospect-dispatch.worker.js";
import {PrismaCampaignRepository} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign.repository.js";
import type {ProspectSendPacket} from "../src/modules/platform-prospecting/domain/prospecting.ports.js";
import type {openBrowserData} from "./prospecting-browser-data.js";
import {operator,browserAccounts} from "./prospecting-browser-accounts.js";
import {fixtureManifest} from "./company-directory-fixture.js";
import {knowledgeDraft} from "./prospect-knowledge-fixture.js";
import {fixtureTemplate} from "./prospect-campaign-fixture.js";
import {PROSPECTING_PORTS} from "../src/modules/platform-prospecting/domain/prospecting.ports.js";
import {CompanyDirectoryController} from "../src/modules/platform-prospecting/presentation/company-directory.controller.js";
import {CompanyImportController} from "../src/modules/platform-prospecting/presentation/company-import.controller.js";
import {ProspectController} from "../src/modules/platform-prospecting/presentation/prospect.controller.js";
import {ProspectCampaignController} from "../src/modules/platform-prospecting/presentation/prospect-campaign.controller.js";
import {ProspectConversationController} from "../src/modules/platform-prospecting/presentation/prospect-conversation.controller.js";
import {ProspectKnowledgeController,KNOWLEDGE_ADMIN} from "../src/modules/platform-prospecting/presentation/prospect-knowledge.controller.js";
import {ProspectPrivacyController} from "../src/modules/platform-prospecting/presentation/prospect-privacy.controller.js";
import {ProspectSegmentController} from "../src/modules/platform-prospecting/presentation/prospect-segment.controller.js";
import {ProspectSenderController} from "../src/modules/platform-prospecting/presentation/prospect-sender.controller.js";
import {ProspectMetricsController,ProspectOperationalStatus} from "../src/modules/platform-prospecting/presentation/prospect-metrics.controller.js";
import {ProspectConversionHistoryQuery} from "../src/modules/platform-prospecting/application/billing/prospect-conversion-history.query.js";
import {ProspectConversionController,ProspectAccountBindingController,ProspectBillingProposalController} from "../src/modules/platform-prospecting/presentation/prospect-billing.controller.js";
import {ProspectConversationGateway} from "../src/modules/platform-prospecting/presentation/prospect-conversation.gateway.js";
import {SearchCompaniesQuery} from "../src/modules/platform-prospecting/application/company-directory/search-companies.query.js";
import {CompanyImportService} from "../src/modules/platform-prospecting/application/company-directory/company-import.service.js";
import {ProspectService} from "../src/modules/platform-prospecting/application/crm/prospect.service.js";
import {ProspectMetricsQueryService} from "../src/modules/platform-prospecting/application/crm/prospect-metrics.query.js";
import {ProspectConversationService} from "../src/modules/platform-prospecting/application/conversations/prospect-conversation.service.js";
import {ProcessProspectInbound} from "../src/modules/platform-prospecting/application/conversations/process-prospect-inbound.service.js";
import {CampaignService} from "../src/modules/platform-prospecting/application/campaigns/campaign.service.js";
import {FreezeCampaignAudience} from "../src/modules/platform-prospecting/application/campaigns/freeze-campaign-audience.js";
import {SenderReadinessService} from "../src/modules/platform-prospecting/application/campaigns/sender-readiness.service.js";
import {PlatformSenderOnboardingService} from "../src/modules/platform-prospecting/application/campaigns/platform-sender-onboarding.service.js";
import {QuerySalesKnowledge} from "../src/modules/platform-prospecting/application/knowledge/query-sales-knowledge.js";
import {ZyonSalesAgentService} from "../src/modules/platform-prospecting/application/knowledge/zyon-sales-agent.service.js";
import {ProspectBillingBridgeService} from "../src/modules/platform-prospecting/application/billing/prospect-billing-bridge.service.js";
import {PrismaDirectoryRepository} from "../src/modules/platform-prospecting/infrastructure/company-directory/prisma-directory.repository.js";
import {PrismaProspectRepository} from "../src/modules/platform-prospecting/infrastructure/crm/prisma-prospect.repository.js";
import {PrismaSegmentRepository} from "../src/modules/platform-prospecting/infrastructure/crm/prisma-segment.repository.js";
import {PrismaProspectPrivacyRepository,protectedContactLookups} from "../src/modules/platform-prospecting/infrastructure/crm/prisma-prospect-privacy.repository.js";
import {PrismaSenderBindingRepository} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-sender-binding.repository.js";
import {PrismaSenderObservationStore} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-sender-observation.store.js";
import {PrismaCampaignCommands} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign-commands.js";
import {PrismaAudienceRepository} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-audience.repository.js";
import {PrismaProspectConversationRepository} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation.repository.js";
import {PrismaProspectConversationCommands} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation-commands.js";
import {PrismaProspectMetaInbox} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-meta-inbox.js";
import {PrismaSalesKnowledgeRepository} from "../src/modules/platform-prospecting/infrastructure/knowledge/prisma-sales-knowledge.repository.js";
import {Neo4jSalesKnowledgeAdapter,SalesPublicationService} from "../src/modules/platform-prospecting/infrastructure/knowledge/neo4j-sales-knowledge.adapter.js";
import {Neo4jSalesKnowledgeReader} from "../src/modules/platform-prospecting/infrastructure/knowledge/neo4j-sales-knowledge.reader.js";
import {PrismaProspectBillingStore} from "../src/modules/platform-prospecting/infrastructure/billing/prisma-prospect-billing.store.js";
import {PublicSubscriptionFacts} from "../src/modules/payment/public-subscription-facts.js";
import {PlatformSalesOffers} from "../src/modules/payment/public-platform-sales-offers.js";
import {CampaignDraftService} from "../src/modules/platform-prospecting/application/campaigns/campaign-drafts.js";
import {CampaignDraftAudience} from "../src/modules/platform-prospecting/application/campaigns/campaign-draft-audience.js";
import {CampaignPlanner} from "../src/modules/platform-prospecting/application/campaigns/campaign-planner.js";
import {CampaignPreparation,CampaignExecutionIdentity} from "../src/modules/platform-prospecting/application/campaigns/campaign-preparation.js";
import {PlatformTemplateService} from "../src/modules/platform-prospecting/application/campaigns/platform-template.service.js";
import {PrismaCampaignDrafts} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign-drafts.js";
import {PrismaCampaignDraftAudience} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign-draft-audience.js";
import {PrismaCampaignPlanner} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign-planner.js";
import {PrismaCampaignPreparation} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign-preparation.js";
import {PrismaPlatformTemplateStore} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-platform-template.store.js";
import {ProspectCampaignDraftController} from "../src/modules/platform-prospecting/presentation/prospect-campaign-draft.controller.js";
import {ProspectCampaignCompaniesController} from "../src/modules/platform-prospecting/presentation/prospect-campaign-companies.controller.js";
import {ProspectCampaignPlannerController} from "../src/modules/platform-prospecting/presentation/prospect-campaign-planner.controller.js";
import {ProspectPlatformTemplateController} from "../src/modules/platform-prospecting/presentation/prospect-platform-template.controller.js";
export async function browserServices(data:Awaited<ReturnType<typeof openBrowserData>>,origins:{dashboard:string;site:string}){
 const {prisma,client,driver,namespace}=data;
 if(process.env.PROSPECTING_CAMPAIGN_FLOW_PREVIEW==="true"){
  await client.companyEstablishment.updateMany({where:{snapshotId:"search-old",uf:"SP"},data:{mainCnae:"4781400"}});
  await client.sourceDomain.upsert({where:{snapshotId_kind_code:{snapshotId:"search-old",kind:"cnaes",code:"4781400"}},create:{snapshotId:"search-old",kind:"cnaes",code:"4781400",label:"Comércio varejista de artigos do vestuário e acessórios"},update:{}});
  await client.companyEntity.upsert({where:{snapshotId_baseCnpj:{snapshotId:'search-old',baseCnpj:'56000000'}},create:{snapshotId:'search-old',baseCnpj:'56000000',legalName:'Rede de lojas de vestuário do ambiente local',normalizedLegalName:'REDE DE LOJAS DE VESTUARIO DO AMBIENTE LOCAL'},update:{}});
  const digit=(raw:string,weights:number[])=>{const remainder=[...raw].reduce((sum,value,index)=>sum+Number(value)*weights[index],0)%11;return remainder<2?'0':String(11-remainder);};
  for(let index=1;index<=23;index++){
   const raw='56000000'+String(index).padStart(4,'0'),first=raw+digit(raw,[5,4,3,2,9,8,7,6,5,4,3,2]),cnpj=first+digit(first,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
   await client.companyEstablishment.upsert({where:{snapshotId_cnpj:{snapshotId:'search-old',cnpj}},create:{snapshotId:'search-old',cnpj,baseCnpj:'56000000',tradeName:'Loja local '+index,uf:'SP',cityCode:'7107',mainCnae:'4781400',status:'02',matrixBranch:'branch'},update:{}});
  }
 }
 const actor={operatorId:operator.id,correlationId:"local-preview"};
 const keys={currentVersion:1,keys:{1:"c".repeat(64)}},encryption="d".repeat(64),cursor="e".repeat(64);
 const directory=new PrismaDirectoryRepository(client,cursor);
 const offers=new PlatformSalesOffers(origins.dashboard,origins.site);
 const store=new PrismaProspectBillingStore(prisma,7*86400000);
 const bridge=new ProspectBillingBridgeService(store,offers,new PublicSubscriptionFacts(prisma),"local-browser-fixture-proposal-signing-key");
 const accounts=await browserAccounts(prisma,bridge);
 const senderConfig={appId:"100001",configId:"100002",businessId:"100003",phoneNumberId:"100004",appSecret:"local-app",encryptionKey:encryption};
 const bindings=new PrismaSenderBindingRepository(prisma,encryption);
 const onboard=new PlatformSenderOnboardingService(senderConfig,bindings,{
  async authorize(input){if(input.code!=="local-sdk-authorization"||input.wabaId!=="100005")throw Error("sender_identity_mismatch");return {accessToken:"local-captured-token",phoneNumberId:"100004",wabaId:"100005",whatsappNumber:"+15550100001",phoneRegistered:true};},
  async isSubscribed(){return true;},async subscribe(){},async registerPhone(){},async isPhoneRegistered(){return true;}
 });
 if(!await bindings.binding()){
  const state=await onboard.signupState(actor,"seed-local-state");
  await onboard.connect({clientRequestId:"seed-local-connect",state:state.state,code:"local-sdk-authorization",businessId:"100003",phoneNumberId:"100004",wabaId:"100005",messagingAccountIds:["100005"],isOnBizApp:false},actor);
 }
 const binding=(await bindings.binding())!;
 const templateStore=new PrismaPlatformTemplateStore(prisma);
 const observations=new PrismaSenderObservationStore(prisma,encryption);
 const health=new SenderReadinessService(observations,{async read(){const registered=(await templateStore.list()).filter(d=>d.state==='APPROVED'&&d.providerId&&d.providerRevision).map(d=>({id:d.providerId!,wabaId:binding.wabaId,name:d.name,language:d.language,revision:d.providerRevision!,category:'MARKETING' as const,status:'APPROVED',previewText:d.body,requiresParameters:false,...(d.maxPrice?{maxPrice:d.maxPrice}:{})}));return {templates:[{...fixtureTemplate,wabaId:binding.wabaId,previewText:"Olá! Esta é uma demonstração da Zyon."},...registered],portfolioLimit:null,portfolioTier:null,entities:[],blockers:[]};}});
 const templates=new PlatformTemplateService(templateStore,observations,{
  async submit(d){if(d.name.includes('unknown'))throw Error('controlled_outcome_unknown');return {state:'PENDING',providerId:'controlled.'+d.id,providerRevision:null,reason:null};},
  async sync(d){return {state:d.name.includes('reject')?'REJECTED':d.state==='submission_unknown'?'PENDING':'APPROVED',providerId:'controlled.'+d.id,providerRevision:d.name.includes('mismatch')?null:d.contentHash,reason:d.name.includes('mismatch')?'template_content_mismatch':d.name.includes('reject')?'Controlled provider rejection':null};}
 },health);
 const sources=new PrismaSalesKnowledgeRepository(prisma),publications=new SalesPublicationService(sources,new Neo4jSalesKnowledgeAdapter(driver,namespace));
 if(!await sources.find("local-product")){
  const draft=await sources.save("local-product",{...knowledgeDraft("Chat"),title:"Guia comercial local da Zyon",facts:[{id:"chat",subject:"Chat",predicate:"feature",value:"A Zyon reúne as conversas da loja no painel."},{id:"site-growth",subject:"Como funciona o site do Growth?",predicate:"feature",value:"O site apresenta a Zyon."}]},actor);
  await publications.publish("local-product",{action:"publish",expectedVersion:draft.version,contentHash:draft.contentHash,clientRequestId:"seed-local-publish"},actor);
 }
 const query=new QuerySalesKnowledge(sources,new Neo4jSalesKnowledgeReader(driver,1500,namespace));
 const crm=new PrismaProspectRepository(prisma,directory);
 const history=new PrismaProspectConversationRepository(prisma),commands=new PrismaProspectConversationCommands(history,keys,()=>({amountCents:0,currency:"BRL",validUntil:new Date(Date.now()+60000)}),offers,store.chatLinks(bridge));
 const capture={async send(packet:ProspectSendPacket){
  await data.pg.query("INSERT INTO browser_provider_requests(effect_id) VALUES ($1)",[packet.attempt.id]);
  return {state:"provider_accepted" as const,providerMessageId:"local."+packet.attempt.id,acceptedAt:new Date()};
 }};
 const conversation=new ProspectConversationService(history,commands,health,capture);
 const reservations=new PrismaCampaignRepository(prisma,keys,()=>({amountCents:1,currency:"BRL",validUntil:new Date(Date.now()+60000)}));
 const identity=new CampaignExecutionIdentity(offers,async()=>({knowledge:await sources.active(new Date()),mode:'controlled',quote:1}));
 const initial=new ProspectDispatchWorker(reservations,health,offers,capture,()=>new Date(),identity.current.bind(identity));
 const eligible=await prisma.platformProspect.findUnique({where:{cnpj:"11222333000181"}});
 if(eligible && !await prisma.contactPermissionReceipt.findFirst({where:{evidenceRef:"browser-synthetic-explicit-consent"}})){
  const identity={kind:"phone" as const,value:"+15550100009",businessScope:null};
  await prisma.$transaction(async tx=>{
   const ep=await tx.prospectEndpoint.create({data:{channel:"whatsapp",senderBindingId:binding.id,normalizedValue:identity.value,...protectedContactLookups(identity,keys)[0]}});
   await tx.prospectContactBinding.create({data:{endpointId:ep.id,prospectId:eligible.id,confirmationState:"confirmed",evidenceRef:"browser-synthetic-confirmation"}});
   await tx.contactPermissionReceipt.create({data:{endpointId:ep.id,senderBindingId:binding.id,purpose:"zyon_sales",source:"zyon_platform",status:"opted_in",evidenceRef:"browser-synthetic-explicit-consent",occurredAt:new Date()}});
  });
 }
 const agent=new ZyonSalesAgentService(commands,conversation,query,offers,{async respond(input){
  const linkDestination=input.input.includes("site")?"site":"signup";
  return {answer:linkDestination==="site"?input.siteUrl!:input.offer.canonicalUrl,offer:input.offer,facts:input.facts,sources:[],handoff:false,reason:null,callMode:"controlled",linkDestination};
 }},{maximumCostCents:1,timeoutMs:1000});
 const lead=await prisma.platformProspect.findUniqueOrThrow({where:{cnpj:"00000000000191"}});
 const phone={kind:"phone" as const,value:"+15550100002",businessScope:null};
 let endpoint=await prisma.prospectEndpoint.findFirst({where:{senderBindingId:binding.id,normalizedValue:phone.value}});
 if(!endpoint){
  endpoint=await prisma.prospectEndpoint.create({data:{channel:"whatsapp",senderBindingId:binding.id,normalizedValue:phone.value,...protectedContactLookups(phone,keys)[0]}});
  await prisma.prospectContactBinding.create({data:{prospectId:lead.id,endpointId:endpoint.id,confirmationState:"confirmed",evidenceRef:"local-synthetic-contact"}});
 }
 const inbox=new PrismaProspectMetaInbox(prisma,keys),inbound=new ProcessProspectInbound(history);
 const effects=new ProspectEffectQueue(prisma,commands,agent,conversation,initial,new ProspectFollowUpWorker(reservations,initial));
 const incoming=async(text:string,id:string)=>{
  await inbox.accept({appId:binding.appId,wabaId:binding.wabaId,phoneNumberId:binding.phoneNumberId,value:{messages:[{id,from:phone.value.slice(1),timestamp:String(Math.floor(Date.now()/1000)),type:"text",text:{body:text}}]}});
  await inbound.processNext();
  const message=await prisma.prospectMessage.findUniqueOrThrow({where:{senderBindingId_providerId:{senderBindingId:binding.id,providerId:id}},include:{conversation:true}});
  const result=await agent.respond({conversationId:message.conversationId,messageId:message.id,expectedEpoch:message.conversation.controlEpoch,planKey:"growth",query:{operation:"explain_feature",params:{feature:"Chat"}}});
  if(!result.messageId)throw Error("controlled_chat_"+result.reason);
  await conversation.dispatch(result.messageId);
 };
 if(!await prisma.prospectMessage.findFirst({where:{clientRequestId:{startsWith:"sales."},conversation:{endpointId:endpoint.id}}}))await incoming("Quero o link para contratar o Growth.","local.seed.inbound");
 const thread=await prisma.prospectConversation.findUniqueOrThrow({where:{endpointId:endpoint.id}});
 const audienceStore=new PrismaAudienceRepository(prisma,keys);
 const audience=new FreezeCampaignAudience(audienceStore);
 const planner=new CampaignPlanner(new PrismaCampaignPlanner(prisma,{enabled:false,quote:()=>null,interpret:async()=>{throw Error('real_model_disabled');}}));
 const preparation=new CampaignPreparation(new PrismaCampaignPreparation(prisma,templates,identity,audienceStore));
 const runtime=()=>({moduleEnabled:true,workersRunning:true,dispatchMode:"controlled" as const,modelMode:"controlled" as const,ingestionEnabled:false});
 const status=new ProspectOperationalStatus({runtime,channel:()=>health.readiness(),
  async source(){const id=await directory.activeSnapshotId(),s=id?await directory.getImport(id):null;return {snapshotId:id,competence:s?.competence??null,state:s?.state??"unavailable"};},
  async knowledge(){await driver.verifyConnectivity();return {activePublications:(await sources.active(new Date())).length};}},offers);
 const entries:[any,any][]=[[PROSPECT_META_DISPATCH,inbox],[WHATSAPP_CONFIG_REPOSITORY,{findByMetaPhoneNumberId:async()=>null}],[AcceptBubbleWhatsWebhookUseCase,{}],[PROSPECTING_PORTS.directory,directory],[SearchCompaniesQuery,new SearchCompaniesQuery(directory,cursor)],[CompanyImportService,new CompanyImportService(directory,{async competences(){return ["2026-11"];},async discover(c){return fixtureManifest(c);}},{ingestionEnabled:false})],
  [ProspectService,new ProspectService(crm)],[PROSPECTING_PORTS.segments,new PrismaSegmentRepository(prisma)],[PROSPECTING_PORTS.privacy,new PrismaProspectPrivacyRepository(prisma,directory,keys)],
  [CampaignService,new CampaignService(new PrismaCampaignCommands(prisma,offers,c=>health.forCampaign(c),identity.current.bind(identity)))],[FreezeCampaignAudience,audience],[SenderReadinessService,health],[PlatformSenderOnboardingService,onboard],
  [CampaignDraftService,new CampaignDraftService(new PrismaCampaignDrafts(prisma))],[CampaignDraftAudience,new CampaignDraftAudience(new PrismaCampaignDraftAudience(prisma))],[CampaignPlanner,planner],[CampaignPreparation,preparation],[PlatformTemplateService,templates],
  [KNOWLEDGE_ADMIN,{sources,publications,query}],[ProspectConversationService,conversation],[PROSPECTING_PORTS.billing,bridge],[ProspectConversionHistoryQuery,new ProspectConversionHistoryQuery(prisma)],[ProspectMetricsQueryService,new ProspectMetricsQueryService(prisma)],[ProspectOperationalStatus,status]];
 return {inbound,effects,initial,planner,conversationId:thread.id,leadId:lead.id,incoming,audience,conversation,controllers:[...accounts.controllers,WhatsAppWebhookController,CompanyDirectoryController,CompanyImportController,ProspectSegmentController,ProspectController,ProspectPrivacyController,ProspectCampaignController,ProspectCampaignDraftController,ProspectCampaignCompaniesController,ProspectCampaignPlannerController,ProspectPlatformTemplateController,ProspectSenderController,ProspectKnowledgeController,ProspectConversationController,ProspectMetricsController,ProspectBillingProposalController,ProspectAccountBindingController,ProspectConversionController],providers:[...accounts.providers,...entries.map(([provide,useValue])=>({provide,useValue})),ProspectConversationGateway]};
}
