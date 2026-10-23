import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { normalPaymentAuthorityFixture } from "../../../payment/domain/normal-checkout-payment.fixture.js";
import { PrismaPaymentApprovalReader } from "./prisma-payment-approval.reader.js";

function fixture(){
  const f=normalPaymentAuthorityFixture(),row={...f.scope,status:"approved",approvedAmountCents:12849,providerPaymentId:"provider",acceptedOfferId:null};
  const prisma={paymentIntent:{findFirst:async()=>row}} as unknown as PrismaClient;
  return {...f,row,reader:new PrismaPaymentApprovalReader(prisma)};
}
test("approval reader projects detached normal sibling but never provider input/raw creation",async()=>{
  const f=fixture(),approval=await f.reader.find("merchant","checkout","payment");
  assert.deepEqual(approval!.normalCrossSellAuthority,f.authority);assert.equal("creation"in approval!,false);
  f.row.creation.normalCrossSellAuthority.frozenProjection.cart.items[1]!.price=999;
  assert.equal(approval!.normalCrossSellAuthority!.frozenProjection.cart.items[1]!.price,18);
});
for(const fault of ["null","undefined","scope","input","buyer","mixed-widget"])
  test(`approval cannot silently downgrade invalid normal ${fault}`,async()=>{
    const f=fixture();
    if(fault==="null"||fault==="undefined")Reflect.set(f.row.creation,"normalCrossSellAuthority",fault==="null"?null:undefined);
    if(fault==="scope")f.row.merchantId="foreign";
    if(fault==="input")Reflect.set(f.row.creation.input,"normalCrossSellAuthority",{});
    if(fault==="buyer")f.row.creation.normalCrossSellAuthority.buyerId="foreign";
    if(fault==="mixed-widget")Reflect.set(f.row.creation,"widgetCheckoutAuthority",{});
    await assert.rejects(f.reader.find("merchant","checkout","payment"));
  });
