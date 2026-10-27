import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { PrismaCheckoutRepository } from "../prisma/prisma-checkout.repository.js";

for(const source of ["checkout","storefront"] as const)
  test(`public completion cannot bypass normal admitted approval: ${source}`,async()=>{
    const tx={$queryRaw:async()=>[],checkoutSession:{findUnique:async()=>({cart:{source,items:[{crossSellIntent:{version:1}}]},globalUserId:"buyer"})},
      outboxMessage:{findFirst:async()=>({eventId:"actual-normal-acceptance"})}} as unknown as Prisma.TransactionClient;
    await assert.rejects(new PrismaCheckoutRepository(tx,true).assertPublicCompletionAllowed("merchant","checkout"),/payment_approval_required/);
  });
test("existing storefront V1 without normal acceptance keeps the preexisting coupon guard",async()=>{
  const tx={$queryRaw:async()=>[],checkoutSession:{findUnique:async()=>({cart:{source:"storefront",items:[{crossSellIntent:{version:1}}]},globalUserId:"buyer"})},
    outboxMessage:{findFirst:async()=>null}} as unknown as Prisma.TransactionClient;
  await new PrismaCheckoutRepository(tx,true).assertPublicCompletionAllowed("merchant","checkout");
});
