import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";
const db=createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async()=>db.$disconnect());
async function fixture(t:TestContext) {
  t.mock.method(Math,"random",()=>0);
  const merchantId="qa_supersession_"+randomUUID(),otherMerchantId="qa_supersession_"+randomUUID(),cartId="conv_"+randomUUID();
  const old=new Date(Date.now()-600000),sent:string[]=[];
  await db.merchant.createMany({data:[{id:merchantId,name:"Owned cart QA"},{id:otherMerchantId,name:"Owned boundary QA"}]});
  t.after(async()=>{for(const id of [merchantId,otherMerchantId]){assert.ok(id.startsWith("qa_supersession_"));await db.checkoutSession.deleteMany({where:{merchantId:id}});await db.merchant.delete({where:{id}});}});
  async function add(sessionId:string,ref?:string,tenant=merchantId,createdAt=old) {
    return db.checkoutSession.create({data:{merchantId:tenant,sessionId,conversationId:ref?"checkout_conversation_"+sessionId:sessionId,globalUserId:"owned-buyer",cart:{items:[{productId:"qa",variantId:"qa",quantity:1,unitPriceCents:1000}],...(ref?{cart_ref:ref}:{})},customer:{email:"owned@example.test"},abandonmentScore:0.9,triggerAgent:true,createdAt,updatedAt:old,events:{create:{eventName:"cart_viewed",occurredAt:old}}}});
  }
  await add(cartId);
  const repository=new PrismaCheckoutRepository(db);
  const scoped={getSession:repository.getSession.bind(repository),findSessionsWithTrigger:async()=>{const rows=await repository.findSessionsWithTrigger();return rows.filter(x=>x.merchantId===merchantId);}};
  const scanner=new RecoveryScannerJob(scoped as any,new InMemoryRecoveryAttemptRepository(),{getRules:async()=>merchantRules(),updateRules:async()=>merchantRules()},{getConfig:async()=>({active_strategy:"offer_coupon",coupon_code:"OWNED"})} as any,new InMemoryBuyerPurchaseHistoryRepository(),db,{execute:async input=>{sent.push(input.sessionId);return {created:false};}});
  return {merchantId,otherMerchantId,cartId,old,add,sent,scanner};
}
test("checkout handoff suppresses an idle storefront projection and preserves its current checkout",async t=>{
  const f=await fixture(t);await f.scanner.scan();assert.deepEqual(f.sent,[f.cartId]);f.sent.length=0;
  const child="checkout_"+randomUUID();await f.add(child,f.cartId);
  await f.scanner.scan();assert.deepEqual(f.sent,[child]);
});
test("only the latest bound checkout owns recovery for a shared cart",async t=>{
  const f=await fixture(t),first="checkout_a_"+randomUUID(),latest="checkout_b_"+randomUUID();
  await f.add(first,f.cartId,f.merchantId,new Date(f.old.getTime()+1));
  await f.add(latest,f.cartId,f.merchantId,new Date(f.old.getTime()+2));
  await f.scanner.scan();assert.deepEqual(f.sent,[latest]);
});
test("another cart or tenant does not steal the current cart's recovery",async t=>{
  const f=await fixture(t);await f.add("other_cart_"+randomUUID(),"other-ref");await f.add("other_tenant_"+randomUUID(),f.cartId,f.otherMerchantId);
  await f.scanner.scan();assert.ok(f.sent.includes(f.cartId));assert.equal(f.sent.length,2);
});
test("unavailable durable owner lookup cannot authorize a recovery",async t=>{
  const f=await fixture(t);await f.scanner.scan();assert.deepEqual(f.sent,[f.cartId]);f.sent.length=0;
  (f.scanner as any).prisma = { checkoutSession: { findFirst: async()=>{throw Error("owned lookup unavailable");} }, checkoutEvent: db.checkoutEvent, merchant: db.merchant };
  await f.scanner.scan();assert.deepEqual(f.sent,[]);
});
