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
import {ProspectAccountBindingController,ProspectBillingProposalController} from "../src/modules/platform-prospecting/presentation/prospect-billing.controller.js";
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
export async function browserServices(data:Awaited<ReturnType<typeof openBrowserData>>,origins:{dashboard:string;site:string}){
 const {prisma,client,driver,namespace}=data;
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
 const health=new SenderReadinessService(new PrismaSenderObservationStore(prisma,encryption),{async read(){return {templates:[{...fixtureTemplate,wabaId:binding.wabaId,previewText:"Olá! Esta é uma demonstração da Zyon."}],portfolioLimit:null,portfolioTier:null,entities:[],blockers:[]};}});
 const sources=new PrismaSalesKnowledgeRepository(prisma),publications=new SalesPublicationService(sources,new Neo4jSalesKnowledgeAdapter(driver,namespace));
 if(!await sources.find("local-product")){
  const draft=await sources.save("local-product",{...knowledgeDraft("Chat"),title:"Guia comercial local da Zyon",facts:[{id:"chat",subject:"Chat",predicate:"feature",value:"A Zyon reúne as conversas da loja no painel."}]},actor);
  await publications.publish("local-product",{action:"publish",expectedVersion:draft.version,contentHash:draft.contentHash,clientRequestId:"seed-local-publish"},actor);
 }
 const query=new QuerySalesKnowledge(sources,new Neo4jSalesKnowledgeReader(driver,1500,namespace));
 const crm=new PrismaProspectRepository(prisma,directory);
 const history=new PrismaProspectConversationRepository(prisma),commands=new PrismaProspectConversationCommands(history,keys,()=>({amountCents:0,currency:"BRL",validUntil:new Date(Date.now()+60000)}),offers,store.chatLinks(bridge));
 const conversation=new ProspectConversationService(history,commands,health,{async send(p){return {state:"provider_accepted",providerMessageId:"local."+p.attempt.id,acceptedAt:new Date()};}});
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
 const audience=new FreezeCampaignAudience(new PrismaAudienceRepository(prisma,keys));
 const runtime=()=>({moduleEnabled:true,workersRunning:true,dispatchMode:"controlled" as const,modelMode:"controlled" as const,ingestionEnabled:false});
 const status=new ProspectOperationalStatus({runtime,channel:()=>health.readiness(),
  async source(){const id=await directory.activeSnapshotId(),s=id?await directory.getImport(id):null;return {snapshotId:id,competence:s?.competence??null,state:s?.state??"unavailable"};},
  async knowledge(){await driver.verifyConnectivity();return {activePublications:(await sources.active(new Date())).length};}},offers);
 const entries:[any,any][]=[[PROSPECTING_PORTS.directory,directory],[SearchCompaniesQuery,new SearchCompaniesQuery(directory,cursor)],[CompanyImportService,new CompanyImportService(directory,{async competences(){return ["2026-11"];},async discover(c){return fixtureManifest(c);}},{ingestionEnabled:false})],
  [ProspectService,new ProspectService(crm)],[PROSPECTING_PORTS.segments,new PrismaSegmentRepository(prisma)],[PROSPECTING_PORTS.privacy,new PrismaProspectPrivacyRepository(prisma,directory,keys)],
  [CampaignService,new CampaignService(new PrismaCampaignCommands(prisma,offers,c=>health.forCampaign(c)))],[FreezeCampaignAudience,audience],[SenderReadinessService,health],[PlatformSenderOnboardingService,onboard],
  [KNOWLEDGE_ADMIN,{sources,publications,query}],[ProspectConversationService,conversation],[PROSPECTING_PORTS.billing,bridge],[ProspectMetricsQueryService,new ProspectMetricsQueryService(prisma)],[ProspectOperationalStatus,status]];
 return {conversationId:thread.id,leadId:lead.id,incoming,audience,conversation,controllers:[...accounts.controllers,CompanyDirectoryController,CompanyImportController,ProspectSegmentController,ProspectController,ProspectPrivacyController,ProspectCampaignController,ProspectSenderController,ProspectKnowledgeController,ProspectConversationController,ProspectMetricsController,ProspectBillingProposalController,ProspectAccountBindingController],providers:[...accounts.providers,...entries.map(([provide,useValue])=>({provide,useValue})),ProspectConversationGateway]};
}
