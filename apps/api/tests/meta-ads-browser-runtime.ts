// Loopback-only acceptance fixture. Never imported by the production application.
import "reflect-metadata";
import {randomUUID} from "node:crypto";
import {Module} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import type {Request, Response, NextFunction} from "express";
import type {MetaAdsCampaign, MetaAdsExecution, CheckoutSession} from "@zyon/shared-types";
import {applicationFixture} from "../src/modules/meta-ads-agent/application/__tests__/fixture.js";
import {AuthGuard} from "../src/modules/auth/presentation/auth.guard.js";
import {AuthCookieService} from "../src/modules/auth/domain/services/auth-cookie.service.js";
import {JwtService} from "../src/modules/auth/domain/services/jwt.service.js";
import {MetaAdsAgentService} from "../src/modules/meta-ads-agent/application/meta-ads-agent.service.js";
import {BillingService} from "../src/modules/meta-ads-agent/application/billing.service.js";
import {ConnectionService} from "../src/modules/meta-ads-agent/application/connection.service.js";
import {CampaignService} from "../src/modules/meta-ads-agent/application/campaign.service.js";
import {GenerationService} from "../src/modules/meta-ads-agent/application/generation.service.js";
import {ProposalService} from "../src/modules/meta-ads-agent/application/proposal.service.js";
import {ExecutionService} from "../src/modules/meta-ads-agent/application/execution.service.js";
import {GenerationWorker} from "../src/modules/meta-ads-agent/infrastructure/generation.worker.js";
import {AttributionService} from "../src/modules/meta-ads-agent/application/attribution.service.js";
import {AttributionController} from "../src/modules/meta-ads-agent/presentation/attribution.controller.js";
import {CheckoutSessionBindingAdapter} from "../src/modules/meta-ads-agent/infrastructure/checkout-session-binding.adapter.js";
import {RealtimeCapabilityService} from "../src/shared/auth/realtime-capability.js";
import {readOffer} from "../src/modules/meta-ads-agent/domain/offer.js";
import {MetaAdsAgentController, MetaAdsHttpErrorFilter} from "../src/modules/meta-ads-agent/presentation/meta-ads-agent.controller.js";
import {MetaAdsError,META_ADS_SESSION_BINDING,type RemoteSnapshot,type PaidOrderFact,type AttributionReceipt} from "../src/modules/meta-ads-agent/domain/types.js";

const front = "http://127.0.0.1:5178";
const f = await applicationFixture(); f.setNow("2026-11-15T12:00:00Z");
const offer = readOffer({META_ADS_AGENT_ENABLED:"true", META_ADS_AGENT_COMMERCIAL_READY:"true", META_ADS_AGENT_COST_BENCHMARK_RESULTS:"40", META_ADS_AGENT_COST_BENCHMARK_SHA256:"f".repeat(64)});
const writes: string[] = []; let images = 0, remoteSequence = 1000;
let buyerFact: PaidOrderFact | null = null, buyerSignals=0, buyerEventId="", buyerCapability="";
f.commerce.paidOrder=async(merchantId,orderId)=>merchantId==="store-a"&&["canonical-a","external-a"].includes(orderId)&&buyerFact?{...buyerFact}:null;
const remote = new Map<string, RemoteSnapshot>(); const confirmations = new Map<string, number>();
const refs = (c: MetaAdsCampaign): MetaAdsExecution["objects"] => [{type:"campaign",id:c.remoteCampaignId!},{type:"ad_set",id:c.remoteAdSetId!},...c.remoteAdIds.map(id=>({type:"ad" as const,id})),...(c.remoteCreativeIds ?? []).map(id=>({type:"creative" as const,id}))];
f.commerce.products = async (_merchantId, options) => options?.query && !"Bolsa Aurora BA1".toLowerCase().includes(options.query.toLowerCase()) ? [] : [{productId:"product-a",variantId:"variant-a",name:"Bolsa Aurora",description:"Bolsa de couro",sku:"BA1",imageUrl:"https://media.example.test/source.png",priceCents:9900,currency:"BRL",stockQuantity:10,active:true,storefrontUrl:"https://store.example.test/bolsa",commercialVersion:"v1"}];
f.oauth.authorizationUrl = state => `https://www.facebook.com/v27.0/dialog/oauth?state=${encodeURIComponent(state)}`;
f.provider.existingCampaigns = async () => [{id:"98765",name:"Zyon externa",status:"ACTIVE"}];
f.provider.snapshot = async (_access, c) => {const snapshot = remote.get(c.remoteCampaignId!); if (!snapshot) throw new Error("missing controlled remote object"); return structuredClone(snapshot);};
f.provider.prepare = async (access, c, _media, progress) => {
  await access.assertWriteAuthorized?.(); writes.push("prepare");
  const campaignId = String(++remoteSequence), adSetId = String(++remoteSequence), adId = String(++remoteSequence), creativeId = String(++remoteSequence);
  const snapshot: RemoteSnapshot = {campaignId,adSetId,adIds:[adId],creativeIds:[creativeId],status:"PAUSED",effectiveStatus:"PAUSED",budget:{[c.draft.budget!.cadence === "daily" ? "daily_budget" : "lifetime_budget"]:String(c.draft.budget!.amountCents)},targeting:{geo_locations:{countries:[c.draft.country]}}};
  remote.set(campaignId,snapshot); const objects: MetaAdsExecution["objects"] = [{type:"campaign",id:campaignId},{type:"ad_set",id:adSetId},{type:"ad",id:adId},{type:"creative",id:creativeId}]; await progress(objects); return {status:"remote_paused",objects};
};
f.provider.execute = async (access, c, p) => {
  await access.assertWriteAuthorized?.(); writes.push(p.kind); const snapshot = remote.get(c.remoteCampaignId!)!;
  if (p.kind === "publish") {snapshot.status = snapshot.effectiveStatus = "ACTIVE"; confirmations.set(c.id,0); return {status:"publishing",objects:refs(c)};}
  if (p.kind === "pause") snapshot.status = snapshot.effectiveStatus = "PAUSED";
  if (p.kind === "budget") {const b = p.after.budget as NonNullable<MetaAdsCampaign["draft"]["budget"]>; snapshot.budget = {[b.cadence === "daily" ? "daily_budget" : "lifetime_budget"]:String(b.amountCents)};}
  if (p.kind === "audience") snapshot.targeting = {geo_locations:{countries:[p.after.country]}};
  return {status:snapshot.status === "PAUSED" ? "remote_paused" : "active_unconfirmed",objects:refs(c)};
};
f.provider.reconcile = async (_access,c) => {const active = remote.get(c.remoteCampaignId!)?.status === "ACTIVE"; const read = (confirmations.get(c.id) ?? 0) + 1; confirmations.set(c.id,read); return {status:active ? read >= 2 ? "delivered" : "active_unconfirmed" : "remote_paused",objects:refs(c)};};
const connection = new ConnectionService(f.repo,f.commerce,f.oauth,f.codec,f.provider,front+"/?tab=meta-ads-agent",f.clock);
const billing = new BillingService(f.repo,f.commerce,{quote:async()=>({amountCents:14900,currency:"BRL",cadence:"monthly"}),createCheckout:async input=>({id:randomUUID(),url:"https://checkout.stripe.com/c/controlled",kind:input.kind,amountCents:input.kind === "subscription" ? input.offer.monthlyPriceCents : input.offer.extraImagePriceCents,currency:"BRL",offerVersion:input.offer.version}),cancelRenewal:async()=>undefined,verifiedEvent:async()=>null},()=>offer,f.clock);
const campaigns = new CampaignService(f.repo,f.commerce,connection,f.provider,f.clock);
const generations = new GenerationService(f.repo,f.commerce,{configured:()=>true,generate:async input=>{images++; return {status:"succeeded",url:`https://media.example.test/${input.generationId}-${input.imageIndex}.svg`,usage:{provider:"openai",model:"gpt-image-controlled-test",providerRequestId:randomUUID(),inputTextTokens:1,inputImageTokens:1,outputImageTokens:1,costMicros:"1",currency:"USD",costStatus:"estimated"},error:null,commercialReview:{status:"verified",productVersion:input.product.commercialVersion,imageSha256:"a".repeat(64)}};}},f.clock);
const proposals = new ProposalService(f.repo,f.commerce,campaigns,connection,f.provider,f.clock);
const executions = new ExecutionService(f.repo,f.commerce,campaigns,connection,f.provider,f.clock);
const service = new MetaAdsAgentService(f.repo,f.commerce,billing,connection,campaigns,generations,proposals,executions,f.provider,{META_ADS_DASHBOARD_URL:front});
const attribution=new AttributionService(f.repo,f.commerce,connection,{send:async(access,signal)=>{await access.assertWriteAuthorized?.();buyerSignals++;buyerEventId=signal.eventId;return{status:"sent",error:null};}},Buffer.alloc(32,3).toString("base64"),f.clock);
const binding=new CheckoutSessionBindingAdapter({getSession:async(merchantId,sessionId)=>merchantId==="store-a"&&sessionId==="checkout-a"?{merchantId,sessionId,cart:{source:"storefront",cart_ref:"conversation-a"}} as unknown as CheckoutSession:undefined});
const capabilities=new RealtimeCapabilityService("local-browser-capability-secret-at-least-32-characters");
const jwt = {authenticate:async(token:string)=>{if (token!=="owner-a") throw new Error("invalid test token"); return {merchantId:"store-a",userId:"owner-a",email:"owner@example.test",role:"owner"};}} as unknown as JwtService;
Reflect.defineMetadata("design:paramtypes",[JwtService,AuthCookieService],AuthGuard);
@Module({controllers:[MetaAdsAgentController,AttributionController],providers:[{provide:MetaAdsAgentService,useValue:service},{provide:AttributionService,useValue:attribution},{provide:META_ADS_SESSION_BINDING,useValue:binding},{provide:RealtimeCapabilityService,useValue:capabilities},{provide:JwtService,useValue:jwt},{provide:AuthCookieService,useValue:new AuthCookieService("aacp_access_token",false)},AuthGuard,MetaAdsHttpErrorFilter]}) class BrowserModule {}
const app = await NestFactory.create(BrowserModule,{logger:false}); app.setGlobalPrefix("v1"); app.enableCors({origin:front,credentials:true});
let worker = new GenerationWorker(f.repo,generations,true,f.clock);
async function reset() {
  await worker.onModuleDestroy(); await f.sql.query('DELETE FROM "meta_ads_agent_records"'); await f.sql.query('DELETE FROM "meta_ads_agent_stores"'); f.setPlan("growth"); writes.length=0; images=0; remote.clear(); confirmations.clear();
  buyerFact=null;buyerSignals=0;buyerEventId="";buyerCapability="";f.discovery.datasets=[{id:"120",name:"Compras",accountId:"100"}];
  await f.repo.mutate("store-a",[],state=>{state.subscription={id:"contract-a",offer,status:"active",provider:"stripe",currentPeriodStart:"2026-11-01T00:00:00Z",currentPeriodEnd:"2026-12-01T00:00:00Z",cancelAtPeriodEnd:false,acceptedAt:"2026-11-01T00:00:00Z",checkoutId:"cs-a",providerSubscriptionId:"sub-a",providerCustomerId:"cus-a"}; state.credits.monthlyAvailable=30;state.credits.periodKey="period-a";state.credits.periodEndsAt="2026-12-01T00:00:00Z";return {result:null};});
  worker = new GenerationWorker(f.repo,generations,true,f.clock); worker.onModuleInit();
}
async function buyerSetup() {
  await reset();f.discovery.datasets=[{id:"1234567890123",name:"Compras",accountId:"100"}];
  const begin=await connection.begin("store-a","owner-a");await connection.complete("store-a","owner-a",new URL(begin.authorizationUrl).searchParams.get("state")!,"controlled-code");await connection.select("store-a",{accountId:"100",pageId:"110",datasetId:"1234567890123"});
  const c=await campaigns.create("store-a",{name:"Origem de teste",destination:"store",priority:"paid_sales",variantIds:["variant-a"],budget:null,mediaIds:[],headline:"Bolsa Aurora",primaryText:"Conheça",country:"BR"},randomUUID());
  await f.repo.mutate("store-a",[],state=>{Object.assign(state.campaigns[c.id],{remoteCampaignId:"200",remoteAdSetId:"300",remoteAdIds:["500"],remoteAccountId:"100",status:"active_unconfirmed"});return{result:null};});
  buyerFact={merchantId:"store-a",orderId:"canonical-a",sessionId:"checkout-a",paid:false,paidAt:f.clock().toISOString(),currency:"BRL",paidCents:9900,refundedCents:0,costCents:null,costCoverage:"unavailable"};
  buyerCapability=capabilities.issue({purpose:"storefront-conversation",merchantId:"store-a",resourceId:"conversation-a",origin:front,aiUserId:"visitor:browser-a"}).token;
  return {trackingToken:attribution.trackingToken("store-a",c.id)};
}
app.use(async(req:Request,res:Response,next:NextFunction)=>{
  if (!req.path.startsWith("/__test/")) return next(); if (req.headers.origin && req.headers.origin!==front) return res.status(403).end();
  try {
    if(req.path==="/__test/health") return res.json({ready:true,scope:"dedicated-loopback-fixture"});
    if(req.path==="/__test/facts") {const receipt=await f.repo.getRecord<AttributionReceipt>("store-a","attribution-session:conversation-a");const revoked=await f.repo.getRecord("store-a","attribution-revoked:conversation-a");return res.json({images,writes,buyerSignals,buyerEventId,buyerCaptured:!!receipt,buyerRevoked:!!revoked});}
    if(req.method==="POST" && req.path==="/__test/reset") {await reset();return res.json({reset:true});}
    if(req.method==="POST" && req.path==="/__test/expire") {f.setPlan("starter");return res.json({expired:true});}
    if(req.method==="POST" && req.path==="/__test/buyer-setup") return res.json(await buyerSetup());
    if(req.path==="/__test/buyer-config") return res.json({capability:buyerCapability,pixelId:"1234567890123"});
    if(req.method==="POST" && req.path==="/__test/buyer-paid" && buyerFact) {buyerFact.paid=true;return res.json({paid:true});}
    return res.status(404).end();
  } catch(error) {return res.status(500).json({error:"local_fixture_failed",code:error instanceof MetaAdsError?error.code:error instanceof Error&&/^[a-z0-9_]{1,100}$/.test(error.message)?error.message:error instanceof Error?error.name:"unknown"});}
});
await reset(); await app.listen(3018,"127.0.0.1");
async function close() {await worker.onModuleDestroy();await app.close();await f.close();process.exit(0);}
process.once("SIGINT",()=>void close()); process.once("SIGTERM",()=>void close());
