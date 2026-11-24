import assert from "node:assert/strict";
import test from "node:test";
import {parseProspectingMaxPrice,prospectingMaxPriceInput,prospectingMaxPriceReservation,validateProspectingMaxPrice} from "@zyon/shared-types";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {PlatformTemplateService} from "./platform-template.service.js";
import {PrismaPlatformTemplateStore} from "../../infrastructure/campaigns/prisma-platform-template.store.js";
import {MetaPlatformTemplateAdapter} from "../../infrastructure/campaigns/meta-platform-template.adapter.js";
import {publicSender} from "../../infrastructure/campaigns/prisma-sender-binding.repository.js";
import {MetaSenderHealthReader} from "../../infrastructure/campaigns/meta-sender-health.reader.js";
import {campaignSelectionBlockers} from "./sender-readiness.service.js";
import {createCampaignFixture,fixtureOffer,fixtureTemplate,fixtureWindow} from "../../../../../tests/prospect-campaign-fixture.js";
import {CampaignDraftService} from "./campaign-drafts.js";
import {PrismaCampaignDrafts} from "../../infrastructure/campaigns/prisma-campaign-drafts.js";
import {PrismaCampaignPreparation} from "../../infrastructure/campaigns/prisma-campaign-preparation.js";
import {CampaignExecutionIdentity} from "./campaign-preparation.js";
import {PrismaAudienceRepository} from "../../infrastructure/campaigns/prisma-audience.repository.js";

const actor={operatorId:"operator",correlationId:"max-price-proof"};
const input={name:"zyon_varejo",language:"pt_BR",body:"Olá! Somos a Zyon. Podemos conversar sobre sua loja?",clientRequestId:"max-price-draft"};
const price={currency:"BRL" as const,amountPerThousandMinor:15000};

test("MAX-PRICE AC1 converts explicit BRL caps exactly and rejects ambiguous or invalid bids",()=>{
 assert.deepEqual(parseProspectingMaxPrice("0,15"),price);
 assert.deepEqual(parseProspectingMaxPrice("0.3217"),{currency:"BRL",amountPerThousandMinor:32170});
 assert.deepEqual(parseProspectingMaxPrice("0,00001"),{currency:"BRL",amountPerThousandMinor:1});
 assert.equal(prospectingMaxPriceInput(price),"0,15");assert.equal(prospectingMaxPriceReservation(price),15);
 assert.equal(prospectingMaxPriceReservation(parseProspectingMaxPrice("0.035")),4);
 assert.equal(validateProspectingMaxPrice(undefined),null);
 for(const invalid of ["","0","-0.1","1e-2","0.000001","21474.83648","1,000.00"])
  assert.throws(()=>parseProspectingMaxPrice(invalid),/invalid_command:maxPrice/);
 for(const invalid of [{currency:"USD",amountPerThousandMinor:15000},{currency:"BRL",amountPerThousandMinor:1.5},{currency:"BRL",amountPerThousandMinor:0},{currency:"BRL",amountPerThousandMinor:15,multiplier:2}])
  assert.throws(()=>validateProspectingMaxPrice(invalid),/invalid_command:maxPrice/);
});

test("MAX-PRICE AC2 observes price in provider revisions and rejects drift, overrides and lost enrollment",async()=>{
 const binding={id:"sender",version:1,appId:"11",wabaId:"12",phoneNumberId:"13"} as any;
 const c={binding,businessId:"14",accessToken:"controlled"};let bid=15000,agreement="accepted",overrides:any=[];
 const normal={id:"standard",name:"standard",language:"pt_BR",status:"APPROVED",category:"MARKETING",components:[{type:"BODY",text:input.body}]};
 const provider=()=>({...normal,id:"priced",name:"priced",optimization_spec:{bid_amount:bid,bid_strategy:"LOWEST_COST_WITH_BID_CAP",bid_country_multiplier_overrides:overrides}});
 const transport:typeof fetch=async(url)=>{
  const path=new URL(String(url)).pathname.replace(/^\/v27\.0\//,"");
  if(path==="debug_token")return Response.json({data:{is_valid:true,app_id:"11",granular_scopes:["whatsapp_business_management","whatsapp_business_messaging"].map(scope=>({scope,target_ids:["12"]}))}});
  if(path==="13")return Response.json({id:"13",status:"CONNECTED",platform_type:"CLOUD_API",quality_rating:"GREEN",whatsapp_business_manager_messaging_limit:"TIER_250",health_status:{can_send_message:"AVAILABLE",entities:[['PHONE_NUMBER','13'],['WABA','12'],['BUSINESS','14'],['APP','11']].map(([entity_type,id])=>({entity_type,id,can_send_message:"AVAILABLE"}))}});
  if(path==="14/max_price_agreements")return Response.json({status:agreement});
  if(path==="12")return Response.json({id:"12",currency:"BRL",marketing_messages_onboarding_status:"ONBOARDED",owner_business_info:{id:"14"}});
  assert.equal(path,"12/message_templates");return Response.json({data:[provider(),normal]});
 };
 const reader=new MetaSenderHealthReader({appId:"11",appSecret:"controlled"},transport);
 const first=await reader.read(c),selected=first.templates.find(t=>t.id==="priced")!;
 assert.deepEqual(selected.maxPrice,price);assert.deepEqual(first.blockers,[]);
 const d={...input,id:"registry",name:"priced",maxPrice:price} as any;
 const gateway=new MetaPlatformTemplateAdapter(transport);const observation=await gateway.sync(d,c);
 assert.equal(observation?.providerRevision,selected.revision);
 bid=16000;const changed=await reader.read(c);
 assert.notEqual(changed.templates.find(t=>t.id==="priced")?.revision,selected.revision);
 const health={...changed,binding,status:"ready",portfolioUsed:null,updatedAt:new Date().toISOString()} as any;
 assert.ok(campaignSelectionBlockers(health,"sender",1,selected,input.body).includes("template_binding_mismatch"));
 const mismatch=await gateway.sync(d,c);assert.equal(mismatch?.reason,"template_pricing_mismatch");assert.equal(mismatch?.providerRevision,null);
 bid=15000;overrides=[{key:"BR",value:2}];assert.deepEqual((await reader.read(c)).templates.map(t=>t.id),["standard"]);
 overrides=[];agreement="pending";assert.deepEqual((await reader.read(c)).templates.map(t=>t.id),["standard"]);
 await assert.rejects(gateway.sync(d,c),/max_price_agreement_required/);
});

test("MAX-PRICE AC2 pins the selected priced registry entry when identical message bodies exist",async()=>{
 const f=await createCampaignFixture();try{
  const binding=publicSender(await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:"sender"}}));
  const store=new PrismaPlatformTemplateStore(f.prisma);const rows:any[]=[];
  for(const [i,maxPrice]of [null,price].entries()){
   const d=await new PlatformTemplateService(store,{} as any,{} as any,{} as any).create({...input,body:fixtureTemplate.previewText!,maxPrice,clientRequestId:"variant-"+i},actor);
   await f.prisma.platformProspectTemplate.update({where:{id:d.id},data:{state:"APPROVED",bindingId:binding.id,bindingVersion:binding.version,wabaId:binding.wabaId,providerId:"provider-variant-"+i,providerRevision:"verified-revision-"+i}});
   rows.push(await store.find(d.id));
  }
  const templates=rows.map(d=>({id:d.providerId,wabaId:binding.wabaId,name:d.name,language:d.language,revision:d.providerRevision,category:"MARKETING",status:"APPROVED",previewText:d.body,requiresParameters:false,...(d.maxPrice?{maxPrice:d.maxPrice}:{})}));
  const service=new PlatformTemplateService(store,{} as any,{} as any,{readiness:async()=>({binding,templates}) as any});
  const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));
  const draft=await drafts.create({name:"Capped review",companies:{snapshotId:"search-old",cnpjs:[f.lead.cnpj]},clientRequestId:"selected-cap"},actor);
  const saved=await drafts.edit(draft.id,{expectedRevision:1,message:rows[1].body,templateRegistryId:rows[1].id,senderBindingId:binding.id,senderVersion:binding.version,limits:{dailyRecipients:2,budget:{amountCents:100,currency:"BRL"}},sendWindow:fixtureWindow,clientRequestId:"select-priced"},actor);
  assert.equal(saved.templateRegistryId,rows[1].id);assert.equal((await drafts.find(draft.id)).templateRegistryId,rows[1].id);
  const identity=new CampaignExecutionIdentity({current:async()=>fixtureOffer,catalog:async()=>[fixtureOffer],allowedUrl:()=>true},async()=>({source:"controlled"}));
  const preparation=new PrismaCampaignPreparation(f.prisma,service,identity,new PrismaAudienceRepository(f.prisma,f.keys));
  await assert.rejects(preparation.prepare(draft.id,{expectedRevision:saved.revision,templateRegistryId:rows[0].id,clientRequestId:"silent-price-change"},actor),/template_binding_mismatch/);
  assert.equal((await drafts.find(draft.id)).revision,saved.revision);
  await preparation.prepare(draft.id,{expectedRevision:saved.revision,clientRequestId:"correct-price"},actor);
  const prepared=await drafts.find(draft.id);assert.equal(prepared.template?.id,rows[1].providerId);assert.deepEqual(prepared.template?.maxPrice,price);assert.equal(prepared.approvedRevision,null);
  templates[1].maxPrice={...price,amountPerThousandMinor:16000};
  assert.equal(await service.compatible(binding.id,binding.version,rows[1].id,rows[1].body),null);
 }finally{await f.close();}
});

test("MAX-PRICE AC1 persists capped messages distinctly and submits only under accepted owner enrollment",async()=>{
 const f=await createProspectCrmFixture();try{
  const binding=publicSender(await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:"sender"}}));
  const credentials={binding,accessToken:"controlled-platform-token",businessId:"own"};
  let agreement="pending",owner="own",currency="BRL",onboarding="ONBOARDED";
  const posts:any[]=[];
  const gateway=new MetaPlatformTemplateAdapter(async(url,init)=>{
   assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer controlled-platform-token");
   const path=new URL(String(url)).pathname;
   if(path.endsWith("/max_price_agreements"))return Response.json({status:agreement});
   if(path.endsWith("/waba"))return Response.json({id:"waba",currency,marketing_messages_onboarding_status:onboarding,owner_business_info:{id:owner}});
   if(init?.method==="POST"){posts.push(JSON.parse(String(init.body)));return Response.json({id:"provider-priced",status:"PENDING"});}
   return Response.json({data:[]});
  });
  const store=new PrismaPlatformTemplateStore(f.prisma);
  const service=new PlatformTemplateService(store,{credential:async()=>credentials},gateway,{readiness:async()=>{throw Error("not_used");}});
  const normal=await service.create(input,actor),capped=await service.create({...input,maxPrice:price,clientRequestId:"priced"},actor);
  assert.equal(normal.maxPrice,null);assert.deepEqual(capped.maxPrice,price);assert.notEqual(capped.contentHash,normal.contentHash);assert.notEqual(capped.name,normal.name);
  assert.deepEqual((await store.find(capped.id)).maxPrice,price);
  const cmd=(key:string)=>({expectedRevision:1,clientRequestId:key});
  let result=await service.submit(capped.id,cmd("agreement-pending"),actor);assert.equal(result.state,"draft");assert.equal(result.reason,"max_price_agreement_required");assert.equal(posts.length,0);
  agreement="accepted";
  for(const [key,change,restore] of [
   ["foreign",()=>{owner="foreign";},()=>{owner="own";}],
   ["wrong-currency",()=>{currency="USD";},()=>{currency="BRL";}],
   ["not-onboarded",()=>{onboarding="NOT_ONBOARDED";},()=>{onboarding="ONBOARDED";}],
  ] as const){change();result=await service.submit(capped.id,cmd(key),actor);assert.equal(result.reason,"max_price_unavailable");assert.equal(posts.length,0);restore();}
  result=await service.submit(capped.id,cmd("accepted"),actor);
  assert.equal(result.state,"PENDING");assert.equal(result.providerId,"provider-priced");assert.deepEqual(result.maxPrice,price);
  assert.deepEqual(posts,[{name:capped.name,language:"pt_BR",category:"MARKETING",components:[{type:"BODY",text:input.body}],optimization_spec:{bid_amount:15000,bid_strategy:"LOWEST_COST_WITH_BID_CAP"}}]);
  await service.submit(capped.id,cmd("accepted"),actor);assert.equal(posts.length,1);
 }finally{await f.close();}
});
