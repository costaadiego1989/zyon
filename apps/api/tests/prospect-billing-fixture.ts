import {readFileSync} from "node:fs";
import Stripe from "stripe";
import {createConversationFixture} from "./prospect-conversation-fixture.js";
import {knowledgeDraft} from "./prospect-knowledge-fixture.js";
import {ZyonSalesLlmAdapter} from "../src/modules/platform-prospecting/infrastructure/knowledge/zyon-sales-llm.adapter.js";
import {ZyonSalesAgentService} from "../src/modules/platform-prospecting/application/knowledge/zyon-sales-agent.service.js";
import {PrismaSalesKnowledgeRepository} from "../src/modules/platform-prospecting/infrastructure/knowledge/prisma-sales-knowledge.repository.js";
import {PrismaCampaignRepository} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign.repository.js";
import {PrismaProspectConversationCommands} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation-commands.js";
import {ProspectConversationService} from "../src/modules/platform-prospecting/application/conversations/prospect-conversation.service.js";
import {createProspectingFixture} from "./prospecting-fixture.js";
import {AuthGuard} from "../src/modules/auth/presentation/auth.guard.js";
import {JwtService} from "../src/modules/auth/domain/services/jwt.service.js";
import {AuthCookieService} from "../src/modules/auth/domain/services/auth-cookie.service.js";
import {PrismaAuthRepository} from "../src/modules/auth/infrastructure/prisma-auth.repository.js";
import {PlatformSalesOffers} from "../src/modules/payment/public-platform-sales-offers.js";
import {PublicSubscriptionFacts} from "../src/modules/payment/public-subscription-facts.js";
import {PrismaPaymentPlatformRepository} from "../src/modules/payment/infrastructure/prisma-payment-platform.repository.js";
import {PrismaPaymentRepository} from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import {HandleStripeWebhookUseCase} from "../src/modules/payment/application/handle-stripe-webhook.use-case.js";
import {HandleStripePlatformEventUseCase} from "../src/modules/payment/application/payment-platform/platform-events/handle-stripe-platform-event.use-case.js";
import {HandleAsaasBillingWebhookUseCase} from "../src/modules/payment/application/payment-platform/billing/handle-asaas-billing-webhook.use-case.js";
import {StripeWebhookController} from "../src/modules/payment/presentation/http/stripe-webhook.controller.js";
import {AsaasBillingWebhookController} from "../src/modules/payment/presentation/http/asaas-billing-webhook.controller.js";
import {SUBSCRIPTION_ATTRIBUTION} from "../src/modules/payment/domain/ports/subscription-attribution.port.js";
import {quoteBilling} from "../src/modules/payment/infrastructure/billing-offers.js";
import {ProspectBillingBridgeService} from "../src/modules/platform-prospecting/application/billing/prospect-billing-bridge.service.js";
import {PrismaProspectBillingStore} from "../src/modules/platform-prospecting/infrastructure/billing/prisma-prospect-billing.store.js";
import {ProspectConversionHistoryQuery} from "../src/modules/platform-prospecting/application/billing/prospect-conversion-history.query.js";
import {ProspectConversionController,ProspectAccountBindingController,ProspectBillingProposalController} from "../src/modules/platform-prospecting/presentation/prospect-billing.controller.js";
import {PROSPECTING_PORTS} from "../src/modules/platform-prospecting/domain/prospecting.ports.js";

export async function createProspectBillingFixture(provider="stripe"){
 const f=await createConversationFixture();
 const keys=["STRIPE_SECRET_KEY_TEST","STRIPE_WEBHOOK_SECRET_TEST","ASAAS_WEBHOOK_TOKEN"] as const;
 const prior=keys.map(k=>process.env[k]);const restore=()=>keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});
 process.env.STRIPE_SECRET_KEY_TEST="sk_test_prospect_fixture";process.env.STRIPE_WEBHOOK_SECRET_TEST="whsec_prospect_fixture";process.env.ASAAS_WEBHOOK_TOKEN="local-provider-fixture";
 let http:Awaited<ReturnType<typeof createProspectingFixture>>|undefined;
 try{
  await f.pg.query(readFileSync(new URL("./prospect-billing-fixture.sql",import.meta.url),"utf8"));
  const jwt=new JwtService("account-fixture-secret-"+ "x".repeat(32),3600,new PrismaAuthRepository(f.prisma));
  const tokens:Record<string,string>={};
  const price=quoteBilling("growth").amountCents;
  for(const id of ["merchant","other"]){
   await f.prisma.merchant.create({data:{id,name:id}});
   const userId=id==="merchant"?"owner":"other-owner";
   for(const [user,role] of [[userId,"owner"],...(id==="merchant"?[["staff","staff"]]:[])]){
    const email=user+"@prospecting.test";
    await f.prisma.merchantUser.create({data:{id:user,merchantId:id,email,role}});
    await f.prisma.merchantTeamMember.create({data:{userId:user,merchantId:id,role:role==="owner"?"OWNER":"STAFF"}});
    tokens[user]=await jwt.issue({merchantId:id,userId:user,role:role as "owner"|"staff",email});
   }
   await f.prisma.merchantBillingSubscription.create({data:{merchantId:id,provider,status:"trialing",trialEndsAt:new Date(Date.now()+86400000),planKey:"growth",billingAmountCents:price,...(provider==="stripe"?{stripeCustomerId:"cus_"+id,stripeSubscriptionId:"sub_"+id}:{asaasCustomerId:"cus_"+id,asaasSubscriptionId:"sub_"+id})}});
  }
  const offers=new PlatformSalesOffers("https://dashboard.example.test","https://website.example.test/");
  const store=new PrismaProspectBillingStore(f.prisma,86400000);
  const service=new ProspectBillingBridgeService(store,offers,new PublicSubscriptionFacts(f.prisma),"proposal-signing-fixture-"+"c".repeat(32));
  const billing=new PrismaPaymentPlatformRepository(f.prisma);
  const payments=new PrismaPaymentRepository(f.prisma);
  const verifiedStripe=new HandleStripeWebhookUseCase({recordProcessedProviderEvent:payments.recordProcessedProviderEvent.bind(payments),deleteProcessedProviderEvent:payments.deleteProcessedProviderEvent.bind(payments)} as never,{} as never,undefined,new HandleStripePlatformEventUseCase(billing),undefined,undefined,{
   async retrieveBillingSubscription(subscriptionId:string){const merchantId=subscriptionId.slice(4);return {merchantId,customerId:"cus_"+merchantId,subscriptionId,priceId:"growth",status:"active",cancelAtPeriodEnd:false,billingAmountCents:price};}
  } as never,undefined,undefined,undefined,undefined,service);
  http=await createProspectingFixture({rawBody:true,controllers:[ProspectConversionController,ProspectBillingProposalController,ProspectAccountBindingController,StripeWebhookController,AsaasBillingWebhookController],providers:[
   {provide:ProspectConversionHistoryQuery,useValue:new ProspectConversionHistoryQuery(f.prisma)},{provide:PROSPECTING_PORTS.billing,useValue:service},{provide:HandleStripeWebhookUseCase,useValue:verifiedStripe},{provide:HandleAsaasBillingWebhookUseCase,useValue:new HandleAsaasBillingWebhookUseCase(billing)},
   {provide:SUBSCRIPTION_ATTRIBUTION,useValue:service},{provide:JwtService,useValue:jwt},{provide:AuthCookieService,useValue:new AuthCookieService()},{provide:AuthGuard,useValue:new AuthGuard(jwt,new AuthCookieService())}]});
  const base=http.url+"/v1",admin=http.operators.admin;await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[admin.id]);
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
  const propose=(token=admin.token,key="proposal")=>post("/platform/prospecting/prospects/"+f.lead.id+"/billing-proposal",{planKey:"growth",clientRequestId:key},{Authorization:"Bearer "+token});
  const bind=(token:string,user=tokens.owner,extra={})=>post("/billing/prospect-proposal/bind",{token,...extra},{Authorization:"Bearer "+user});
  const bindProposal=async()=>{const p=await(await propose()).json();const res=await bind(new URL(p.url).searchParams.get("proposal")!);if(res.status!==200)throw Error("bind_fixture_failed");return p;};
  const signature=new Stripe("sk_test_prospect_fixture");
  const fixtureSdk=(verifiedStripe as unknown as {stripe:Stripe}).stripe;
  const splitInvoice=()=>({id:"in_merchant",customer:"cus_merchant",currency:"brl",status:"paid",amount_paid:price,billing_reason:"subscription_create",parent:{subscription_details:{subscription:"sub_merchant"}},payments:{has_more:false,data:[2000,price-2000].map((amount_paid,i)=>({status:"paid",currency:"brl",invoice:"in_merchant",amount_paid,payment:{type:"payment_intent",payment_intent:i?"pi_second":"pi_merchant"}}))}});
  const singleInvoice=()=>({...splitInvoice(),payments:{has_more:false,data:[{...splitInvoice().payments.data[0],amount_paid:price}]}});
  fixtureSdk.invoicePayments.list=(async()=>singleInvoice().payments) as typeof fixtureSdk.invoicePayments.list;
  fixtureSdk.invoices.retrieve=(async()=>singleInvoice()) as unknown as typeof fixtureSdk.invoices.retrieve;
  const stripe=(type:string,id:string,opt:{foreign?:boolean;signature?:string;partial?:boolean;split?:boolean;truncated?:boolean}={})=>{
   const account=opt.foreign?"other":"merchant",sub="sub_"+account,customer="cus_"+account;
   const obj=type==="charge.refunded"?{id:"ch_"+account,customer,currency:"brl",amount:price,amount_refunded:opt.partial?1:price,refunded:!opt.partial,payment_intent:"pi_"+account,metadata:{}}:
    {id:"in_"+account,customer,status:type==="invoice.paid"?"paid":"open",billing_reason:"subscription_create",amount_paid:type==="invoice.paid"?price:0,currency:"brl",metadata:{merchant_id:"merchant",prospect_id:f.lead.id},
    parent:{subscription_details:{subscription:sub,metadata:{}}},payments:{data:[{status:"paid",invoice:"in_"+account,currency:"brl",payment:{type:"payment_intent",payment_intent:"pi_"+account},amount_paid:price}]}};
   if(opt.split){
    if(type==="invoice.paid")Object.assign(obj,splitInvoice());
    else{
     Object.assign(obj,{amount:2000,amount_refunded:2000,refunded:true});
     fixtureSdk.invoicePayments.list=(async()=>({has_more:false,data:[splitInvoice().payments.data[0]]})) as typeof fixtureSdk.invoicePayments.list;
     fixtureSdk.invoices.retrieve=(async()=>splitInvoice()) as unknown as typeof fixtureSdk.invoices.retrieve;
    }
   }
   if(opt.truncated&&obj.payments)Object.assign(obj.payments,{has_more:true});
   const event={id,type,livemode:false,created:Math.floor(Date.now()/1000)+1,data:{object:obj}};
   return post("/webhooks/stripe",event,{"stripe-signature":opt.signature??signature.webhooks.generateTestHeaderString({payload:JSON.stringify(event),secret:"whsec_prospect_fixture"})});
  };
  const asaas=(event:string,id:string,opt:{token?:string;value?:number;paymentId?:string}={})=>post("/webhooks/asaas/billing",{id,event,dateCreated:new Date().toISOString(),payment:{id:opt.paymentId??"pay_first",customer:"cus_merchant",subscription:"sub_merchant",value:opt.value??price/100,paymentDate:new Date().toISOString(),dueDate:new Date().toISOString().slice(0,10)}},{"asaas-access-token":opt.token??"local-provider-fixture"});
  const chatLink=async(destination:"signup"|"site",ambiguous:boolean)=>{
   if(ambiguous){
    const other=await f.prisma.platformProspect.create({data:{cnpj:"11222333000181",sourceSnapshotId:"search-old"}});
    await f.prisma.prospectContactBinding.create({data:{prospectId:other.id,endpointId:f.endpoint.id,confirmationState:"confirmed"}});
   }
   const campaign=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
   if(!await campaign.reserveAttempt(f.recipient.id,"origin",new Date()))throw Error("fixture_missing_origin");
   const knowledge=new PrismaSalesKnowledgeRepository(f.prisma),draft=await knowledge.save("product",knowledgeDraft("chat-link"),f.actor);
   const fact=draft.draft[0];
   await f.prisma.salesKnowledgePublication.update({where:{id:fact.publicationId},data:{state:"published",projectedHash:draft.contentHash,projectedCount:draft.draft.length}});
   await f.prisma.salesKnowledgeActivePublication.create({data:{sourceId:fact.sourceId,version:1,publicationId:fact.publicationId}});
   const inbound=await f.prisma.prospectMessage.create({data:{conversationId:f.c.id,sequence:1,senderBindingId:"sender",direction:"inbound",authorType:"prospect",state:"received",providerId:"first-in",content:destination==="signup"?"Quero contratar o Growth":"Qual o site da Zyon?"}});
   await f.prisma.prospectConversation.update({where:{id:f.c.id},data:{lastSequence:1}});
   const commands=new PrismaProspectConversationCommands(f.repo,f.keys,f.quote,offers,store.chatLinks(service)),sent:string[]=[];
   const conversation=new ProspectConversationService(f.repo,commands,{readiness:async()=>({binding:f.binding,status:"ready",blockers:[],templates:[],portfolioLimit:100,portfolioUsed:null,updatedAt:new Date().toISOString()})},{async send(packet){sent.push(packet.content);return {state:"provider_accepted",providerMessageId:"sent."+packet.attempt.id,acceptedAt:new Date()};}});
   const model=new ZyonSalesLlmAdapter({enabled:false,model:"fixture",apiKey:"fixture",maximumCostCents:2,timeoutMs:100,quote:()=>1},commands,async()=>Response.json({model:"fixture",choices:[{message:{tool_calls:[{type:"function",function:{name:"allowed_link",arguments:JSON.stringify({destination})}}]}}]}));
   const agent=new ZyonSalesAgentService(commands,conversation,{async queryPublishedKnowledge(){return [fact];}},offers,model,{maximumCostCents:2,timeoutMs:100});
   const result=await agent.respond({conversationId:f.c.id,messageId:inbound.id,expectedEpoch:0,planKey:"growth",query:{operation:"explain_feature",params:{feature:"Chat"}}});
   return {result,conversation,sent};
  };
  const history=(id=f.lead.id,query="",token=admin.token)=>fetch(base+"/platform/prospecting/prospects/"+id+"/conversions"+query,{headers:token?{Authorization:"Bearer "+token}:{}});
  return {...f,history,supportToken:http.operators.support.token,chatLink,owner:tokens.owner,staff:tokens.staff,other:tokens["other-owner"],propose,bind,bindProposal,stripe,asaas,async close(){await http!.close();await f.close();restore();}};
 }catch(e){await http?.close();await f.close();restore();throw e;}
}
