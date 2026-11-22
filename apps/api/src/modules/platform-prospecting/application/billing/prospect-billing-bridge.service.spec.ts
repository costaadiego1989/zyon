import assert from "node:assert/strict";
import {test} from "node:test";
import {createProspectBillingFixture} from "../../../../../tests/prospect-billing-fixture.js";
import {quoteBilling} from "../../../payment/infrastructure/billing-offers.js";

test("PROS-22 AC1 cold proposal yields only opaque navigation and canonical plan; no checkout or invented account",async()=>{
 const f=await createProspectBillingFixture();try{
 const result=await f.propose();assert.equal(result.status,201);const proposal=await result.json(),url=new URL(proposal.url);
 assert.equal(url.origin,"https://dashboard.example.test");assert.equal(url.searchParams.get("plan"),"growth");assert.equal(url.searchParams.get("mode"),"signup");
 const nonce=url.searchParams.get("proposal")!;assert.match(nonce,/^[A-Za-z0-9_-]{43}$/);assert.ok(!proposal.url.includes(f.lead.id));assert.ok(!proposal.url.includes(f.lead.cnpj));
 assert.deepEqual(await(await f.propose()).json(),proposal);
 const stored=await f.prisma.prospectBillingProposal.findFirstOrThrow();assert.notEqual(stored.nonceHash,nonce);assert.equal(stored.boundMerchantId,null);assert.equal(stored.offerVersion,proposal.offerVersion);
 assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM merchants")).rows[0].n,2);assert.equal(await f.prisma.prospectConversion.count(),0);
 assert.equal((await f.propose("bad")).status,401);
 }finally{await f.close();}
});
test("PROS-22 AC1 sales chat resolves the requested website or opaque signup intent and fences ambiguous or expired links",async()=>{
 for(const mode of ["signup","site","ambiguous","expired"]){
  const f=await createProspectBillingFixture();try{
   const chat=await f.chatLink(mode==="site"?"site":"signup",mode==="ambiguous");
   if(mode==="ambiguous"){
    assert.equal(chat.result.messageId,null);assert.equal(await f.prisma.prospectBillingProposal.count(),0);
    assert.equal(await f.prisma.prospectMessage.count({where:{direction:"outbound",authorType:"ai"}}),0);continue;
   }
   const id=chat.result.messageId!;assert.ok(id);
   if(mode==="expired"){
    await f.prisma.prospectBillingProposal.updateMany({data:{expiresAt:new Date(0)}});
    assert.equal((await chat.conversation.dispatch(id)).state,"cancelled_before_submit");assert.deepEqual(chat.sent,[]);continue;
   }
   await chat.conversation.dispatch(id);assert.equal(chat.sent.length,1);
   const url=new URL(chat.sent[0]);
   if(mode==="site"){assert.equal(url.href,"https://website.example.test/");assert.equal(await f.prisma.prospectBillingProposal.count(),0);}
   else{
    assert.equal(url.origin,"https://dashboard.example.test");assert.equal(url.searchParams.get("plan"),"growth");assert.match(url.searchParams.get("proposal")!,/^[A-Za-z0-9_-]{43}$/);
    const proposal=await f.prisma.prospectBillingProposal.findFirstOrThrow();assert.equal(proposal.prospectId,f.lead.id);
    const e=await f.prisma.prospectOutbox.findUniqueOrThrow({where:{eventId:"chat."+id}});assert.ok(e.resourceIds.includes(proposal.id));
    assert.equal((await f.bind(url.searchParams.get("proposal")!)).status,200);
    assert.equal((await f.prisma.prospectBillingProposal.findUniqueOrThrow({where:{id:proposal.id}})).boundMerchantId,"merchant");
   }
  }finally{await f.close();}
 }
});
test("PROS-22 AC2 authenticated account authority binds the nonce once; foreign, expired and client-asserted identity fail",async()=>{
 const f=await createProspectBillingFixture();try{
 const p=await(await f.propose()).json(),token=new URL(p.url).searchParams.get("proposal")!;
 assert.equal((await f.bind(token,"")).status,401);assert.equal((await f.bind(token,f.owner,{merchantId:"other",name:"merchant"})).status,400);
 assert.equal((await f.bind(token,f.staff)).status,403);
 const bound=await f.bind(token);assert.equal(bound.status,200);assert.equal((await bound.json()).boundMerchantId,"merchant");
 assert.equal((await f.bind(token)).status,200);assert.equal((await f.bind(token,f.other)).status,409);
 assert.equal((await f.prisma.prospectBillingProposal.findFirstOrThrow()).boundUserId,"owner");
 assert.equal((await f.bind("x".repeat(43))).status,404);
 const second=await(await f.propose(undefined,"second")).json();await f.prisma.prospectBillingProposal.update({where:{id:second.id},data:{expiresAt:new Date(0)}});
 assert.equal((await f.bind(new URL(second.url).searchParams.get("proposal")!)).status,409);
 }finally{await f.close();}
});
test("PROS-22 AC3 signed raw Stripe invoice attributes one paid subscription; retries, foreign metadata and full refund retain financial history",async()=>{
 const f=await createProspectBillingFixture();try{
 await f.bindProposal();
 assert.equal((await f.stripe("invoice.paid","wrong-signature",{signature:"invalid"})).status,401);
 assert.equal((await f.stripe("invoice.paid","foreign",{foreign:true})).status,200);
 assert.equal(await f.prisma.prospectConversion.count({where:{state:"paid"}}),0);
 const ok=await f.stripe("invoice.paid","paid");assert.equal(ok.status,200);await f.stripe("invoice.paid","paid");await f.stripe("invoice.paid","same-invoice");
 const paid=await f.prisma.prospectConversion.findMany({where:{state:"paid"}});assert.equal(paid.length,1);assert.equal(paid[0].providerEventId,"paid");assert.equal(paid[0].merchantId,"merchant");assert.equal(paid[0].subscriptionId,"sub_merchant");
 assert.equal((await f.prisma.platformProspect.findUniqueOrThrow({where:{id:f.lead.id}})).stage,"converted");
 assert.equal((await f.stripe("charge.refunded","refunded",{partial:true})).status,200);assert.equal(await f.prisma.prospectConversion.count({where:{state:"refunded"}}),0);
 await f.stripe("charge.refunded","full");await f.stripe("charge.refunded","full");
 assert.deepEqual((await f.prisma.prospectConversion.findMany({where:{state:{in:["paid","refunded"]}},orderBy:{createdAt:"asc"}})).map(c=>[c.state,c.providerEventId]),[["paid","paid"],["refunded","full"]]);
 const billing=await f.prisma.merchantBillingSubscription.findUniqueOrThrow({where:{merchantId:"merchant"}});assert.equal(billing.status,"active");assert.equal(billing.planKey,"growth");assert.equal(billing.billingAmountCents,quoteBilling("growth").amountCents);
 }finally{await f.close();}
});
test("PROS-22 AC3 signed split and incomplete invoice allocations remain unattributed after one component is fully refunded",async()=>{
 const f=await createProspectBillingFixture();try{
  await f.bindProposal();
  for(const [id,opt] of [["split",{split:true}],["truncated",{truncated:true}]] as const){
   const response=await f.stripe("invoice.paid",id,opt);
   assert.equal(response.status,200);assert.equal((await response.json()).attribution,"allocation_coverage_unknown");
   assert.equal(await f.prisma.prospectBillingReceipt.count(),0);
  }
  const refund=await f.stripe("charge.refunded","partial-invoice-full-charge",{split:true});
  assert.equal(refund.status,200);assert.equal((await refund.json()).attribution,"allocation_coverage_unknown");
  assert.equal(await f.prisma.prospectConversion.count({where:{state:{in:["paid","refunded"]}}}),0);
  assert.equal(await f.prisma.prospectBillingReceipt.count(),0);
 }finally{await f.close();}
});
test("PROS-22 AC3 authenticated Asaas ingress requires canonical reconciliation, with refund adjustment and duplicate recovery",async()=>{
 const f=await createProspectBillingFixture("asaas");try{
 await f.bindProposal();assert.equal((await f.asaas("PAYMENT_CONFIRMED","bad-auth",{token:"no"})).status,401);
 await f.asaas("PAYMENT_CONFIRMED","underpaid",{value:1});assert.equal(await f.prisma.prospectConversion.count({where:{state:"paid"}}),0);
 await f.asaas("PAYMENT_CONFIRMED","asaas-paid");await f.asaas("PAYMENT_CONFIRMED","asaas-paid");await f.asaas("PAYMENT_RECEIVED","also-received");
 assert.equal(await f.prisma.prospectConversion.count({where:{state:"paid",provider:"asaas",providerEventId:"asaas-paid"}}),1);
 await f.asaas("PAYMENT_REFUNDED","wrong-ref",{paymentId:"other-charge"});assert.equal(await f.prisma.prospectConversion.count({where:{state:"refunded"}}),0);
 await f.asaas("PAYMENT_REFUNDED","asaas-refund");assert.equal(await f.prisma.prospectConversion.count({where:{state:"refunded",providerEventId:"asaas-refund"}}),1);
 }finally{await f.close();}
});
test("PROS-22 AC4 trial, pending, browser declaration and active-account management cannot create paid conversions or duplicate checkout",async()=>{
 const f=await createProspectBillingFixture();try{
 await f.bindProposal();assert.equal(await f.prisma.prospectConversion.count({where:{state:"trial"}}),1);
 await f.stripe("invoice.payment_failed","pending");assert.equal((await f.bind("x".repeat(43),f.owner,{paid:true})).status,400);
 assert.equal(await f.prisma.prospectConversion.count({where:{state:"paid"}}),0);
 const other=await(await f.propose(undefined,"other-proposal")).json();
 await f.prisma.merchantBillingSubscription.update({where:{merchantId:"other"},data:{status:"active",planKey:"growth"}});
 const response=await f.bind(new URL(other.url).searchParams.get("proposal")!,f.other);assert.equal((await response.json()).next,"manage_subscription");
 await f.stripe("invoice.paid","already-active",{foreign:true});assert.equal(await f.prisma.prospectConversion.count({where:{state:"paid"}}),0);
 }finally{await f.close();}
});
