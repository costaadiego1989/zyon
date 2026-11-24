import assert from "node:assert/strict";
import test from "node:test";
import {parseProspectingMaxPrice,prospectingMaxPriceInput,prospectingMaxPriceReservation,validateProspectingMaxPrice} from "@zyon/shared-types";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {PlatformTemplateService} from "./platform-template.service.js";
import {PrismaPlatformTemplateStore} from "../../infrastructure/campaigns/prisma-platform-template.store.js";
import {MetaPlatformTemplateAdapter} from "../../infrastructure/campaigns/meta-platform-template.adapter.js";
import {publicSender} from "../../infrastructure/campaigns/prisma-sender-binding.repository.js";

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
