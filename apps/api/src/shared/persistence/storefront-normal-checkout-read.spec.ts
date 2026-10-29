import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { readNormalCheckoutSourceProjection } from "./storefront-normal-checkout-read.js";

const scope={merchantId:"merchant",cartId:"cart"};
function fixture(candidates:unknown[],raw?:unknown){
  const calls:Array<{sql:string;values:unknown[]}>=[];
  const tx={$executeRaw:async(sql:TemplateStringsArray,...values:unknown[])=>{calls.push({sql:sql.join("?"),values});return 1;},
    $queryRaw:async(sql:TemplateStringsArray,...values:unknown[])=>{
    calls.push({sql:sql.join("?"),values});return raw??[{isolation:"read committed",candidates}];
  }} as unknown as Prisma.TransactionClient;
  return {tx,calls};
}
test("normal source dispatch proves absence under the merchant fence with exact scoped reference",async()=>{
  const f=fixture([]);assert.equal(await readNormalCheckoutSourceProjection(f.tx,scope),undefined);
  assert.equal(f.calls.length,2);assert.match(f.calls[0]!.sql,/merchants[\s\S]*FOR UPDATE/);
  assert.deepEqual(f.calls[0]!.values,["merchant"]);const query=f.calls[1]!;assert.match(query.sql,/s\.merchant_id=/);
  assert.match(query.sql,/s\.cart->>'cart_ref'=/);assert.deepEqual(query.values,["merchant","cart"]);
  assert.match(query.sql,/cross_sell_suggestions[\s\S]*status='accepted'/);
  assert.match(query.sql,/line->'crossSellIntent'->>'promotionId'=a\.promo_id/);
  assert.match(query.sql,/line->>'sku'=ANY\(a\.ranked_items\)/);
  assert.match(query.sql,/checkout_events/);assert.match(query.sql,/outbox_messages/);
  assert.match(query.sql,/strpos\(e\.metadata->>'acceptance_event_id','normal_cross_sell_'\)=1/);
  assert.doesNotMatch(query.sql,/LIKE 'normal_cross_sell_%'/);
});
for(const [name,candidates,raw]of [
  ["ambiguous owners",[{merchantId:"merchant",sessionId:"a",cartRef:"cart"},{merchantId:"merchant",sessionId:"b",cartRef:"cart"}],undefined],
  ["foreign merchant",[{merchantId:"other",sessionId:"a",cartRef:"cart"}],undefined],
  ["foreign reference",[{merchantId:"merchant",sessionId:"a",cartRef:"other"}],undefined],
  ["malformed projection",[],[{isolation:"read committed"}]],
  ["missing merchant",[],[]],
  ["wrong isolation",[],[{isolation:"repeatable read",candidates:[]}]],
] as const)test(`normal source dispatch refuses ${name} without a legacy fallback`,async()=>{
  const f=fixture([...candidates],raw);await assert.rejects(readNormalCheckoutSourceProjection(f.tx,scope),{code:"cross_sell_quote_review_required"});
  assert.equal(f.calls.length,2);
});
test("discovery starts only AFTER merchant wait, observing ownership committed while the fence was held",async()=>{
  let release!:()=>void,entered!:()=>void,waited=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  let candidates:unknown[]=[];const calls:string[]=[];
  const tx={$executeRaw:async()=>{calls.push("merchant-wait");entered();await gate;waited=true;return 1;},
    $queryRaw:async()=>{assert.equal(waited,true);calls.push("fresh-discovery");return [{isolation:"read committed",candidates}];}} as unknown as Prisma.TransactionClient;
  const pending=readNormalCheckoutSourceProjection(tx,scope);await started;
  assert.deepEqual(calls,["merchant-wait"]);
  candidates=[{merchantId:"merchant",sessionId:"a",cartRef:"cart"},{merchantId:"merchant",sessionId:"b",cartRef:"cart"}];
  release();await assert.rejects(pending,{code:"cross_sell_quote_review_required",reason:"source_owner_ambiguous"});
  assert.deepEqual(calls,["merchant-wait","fresh-discovery"]);
});
test("missing merchant row is rejected before discovery",async()=>{
  const tx={$executeRaw:async()=>0,$queryRaw:async()=>assert.fail("discovery_without_merchant_fence")}as unknown as Prisma.TransactionClient;
  await assert.rejects(readNormalCheckoutSourceProjection(tx,scope),{code:"cross_sell_quote_review_required",reason:"source_owner_invalid"});
});
for(const failure of [new Error("synthetic_transport_or_ack_unknown"),undefined,null,false])
  test(`unknown/falsy dispatch failure is preserved without a second attempt (${String(failure)})`,async()=>{
    let attempts=0;const tx={$executeRaw:async()=>{attempts++;throw failure;}}as unknown as Prisma.TransactionClient;
    await assert.rejects(readNormalCheckoutSourceProjection(tx,scope),error=>error===failure);assert.equal(attempts,1);
  });
