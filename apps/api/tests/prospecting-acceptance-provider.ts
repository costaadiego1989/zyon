import "./test-network-guard.mjs";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {createHmac} from "node:crypto";
import Stripe from "stripe";
import { localDir } from "./prospecting-browser-data.js";
import { readProspectingTestConfig,validateProspectingTestConfig } from "./prospecting-fixture.js";
import { quoteBilling } from "../src/modules/payment/infrastructure/billing-offers.js";
const g=readProspectingTestConfig();validateProspectingTestConfig(g);
const receipt=JSON.parse(readFileSync(localDir+"/listeners.json","utf8"));
assert.equal(receipt.mode,"disposable");assert.match(receipt.database,/^prospecting_test_[a-f0-9]{32}$/);
if(existsSync(localDir+"/preview-db.json"))assert.notEqual(receipt.database,JSON.parse(readFileSync(localDir+"/preview-db.json","utf8")).name);
const url=new URL(g.databaseUrl);assert.equal(url.port,"15438");url.pathname="/"+receipt.database;url.search="";
const db=new PrismaClient({datasources:{db:{url:url.href}}});
try{
  const own=await db.$queryRaw<{owner:string}[]>`SELECT owner FROM browser_runtime_owner`;
  assert.equal(own.length,1);assert.equal(own[0].owner,receipt.owner);
  let result;
  if(process.argv[2]==="campaign"){
    const campaigns=await db.prospectCampaign.findMany({where:{name:"Piloto da jornada local"},select:{id:true}});
    const attempts=await db.outreachAttempt.findMany({where:{recipient:{campaignId:{in:campaigns.map(c=>c.id)}}},select:{id:true,submittedAt:true}});
    const rows=await db.$queryRaw<{id:string}[]>`SELECT effect_id as id FROM browser_provider_requests`;
    result={segments:await db.savedProspectSegment.count({where:{name:"Piloto local controlado"}}),submitted:attempts.filter(a=>a.submittedAt).length,physical:rows.filter(r=>attempts.some(a=>a.id===r.id)).length};
  }else if(process.argv[2]==="incoming"){
    const value={metadata:{phone_number_id:"100004"},messages:[{id:"browser.customer.site",from:"15550100002",timestamp:String(Math.floor(Date.now()/1000)),type:"text",text:{body:"Como funciona o site do Growth?"}}]};
    const body=JSON.stringify({entry:[{id:"100005",changes:[{field:"messages",value}]}]});
    const signature="sha256="+createHmac("sha256","local-app").update(body).digest("hex");
    const post=async(sig:string)=>(await fetch("http://127.0.0.1:3019/v1/webhooks/whatsapp/meta-platform",{method:"POST",headers:{"Content-Type":"application/json","x-hub-signature-256":sig},body})).status;
    result={invalid:await post("invalid"),accepted:await post(signature),replay:await post(signature)};
  }else if(process.argv[2]==="site"){
    const inbound=await db.prospectMessage.findFirstOrThrow({where:{providerId:"browser.customer.site"}});
    const replies=await db.prospectMessage.findMany({where:{clientRequestId:"sales."+inbound.id,authorType:"ai",state:"provider_accepted"},select:{id:true}});
    const physical=await db.$queryRaw<{id:string}[]>`SELECT effect_id AS id FROM browser_provider_requests`;
    result={ai:replies.length,physical:physical.filter(p=>replies.some(r=>r.id===p.id)).length};
  }else if(process.argv[2]==="manual"){
    const rows=await db.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM browser_provider_requests b JOIN prospect_messages m ON m.id=b.effect_id WHERE m.content='Mensagem manual da equipe local'`;
    result={physical:rows[0].count};
  }else if(process.argv[2]==="financial"){
    const customer="cus_phase9", subscription="sub_phase9", eventId="evt_phase9_signed", amount=quoteBilling("growth").amountCents;
    const proposal=await db.prospectBillingProposal.findFirstOrThrow({where:{boundMerchantId:"local-buyer",conversionEligible:true}});
    const scope={provider:"stripe",providerEventId:eventId,proposalId:proposal.id,state:"paid"};
    const before=await db.prospectConversion.count({where:scope});
    await db.merchantBillingSubscription.update({where:{merchantId:"local-buyer"},data:{provider:"stripe",planKey:"growth",billingAmountCents:amount,stripeCustomerId:customer,stripeSubscriptionId:subscription}});
    const invoice="in_phase9",event={type:"invoice.paid",id:eventId,livemode:false,created:Math.floor(Date.now()/1000)+1,data:{object:{id:invoice,customer,status:"paid",billing_reason:"subscription_create",amount_paid:amount,currency:"brl",metadata:{},parent:{subscription_details:{subscription,metadata:{}}},payments:{data:[{status:"paid",invoice,currency:"brl",payment:{type:"payment_intent",payment_intent:"pi_phase9"},amount_paid:amount}]}}}};
    const body=JSON.stringify(event),stripe=new Stripe("sk_test_browser_local");
    const post=async(signature:string)=>(await fetch("http://127.0.0.1:3019/v1/webhooks/stripe",{method:"POST",headers:{"Content-Type":"application/json","stripe-signature":signature},body})).status;
    const signature=stripe.webhooks.generateTestHeaderString({payload:body,secret:"whsec_browser_local"});
    result={before,invalid:await post("invalid"),accepted:await post(signature),replay:await post(signature),paid:await db.prospectConversion.count({where:scope})};
  }else throw Error("unknown_fixture_operation");
  process.stdout.write(JSON.stringify(result));
}finally{await db.$disconnect();}
