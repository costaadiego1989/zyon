import test from "node:test";
import assert from "node:assert/strict";
import { OnOrderDeliveredHandler } from "./on-order-delivered.handler.js";
test("delivery without contact payload resolves the tenant's order and buyer", async () => {
  let handle: (event: any) => Promise<void> = async () => {};
  const scheduled: any[] = [];
  const bus = { subscribe(_name: string, callback: typeof handle) { handle = callback; } } as any;
  const prisma = { completedOrder: { async findFirst({ where }: any) {
    assert.equal(where.merchantId, "merchant-a");
    return { status: "delivered", externalOrderId: "external-order", sessionId: "session", session: { globalUserId: "buyer" } };
  } }, buyerAccount: { async findUnique({ where }: any) { assert.equal(where.globalUserId, "buyer"); return { phone: "+5511999991111", email: "buyer@example.invalid", displayName: "Ana" }; } } } as any;
  const handler = new OnOrderDeliveredHandler(bus, prisma, { execute: async (input: any) => { scheduled.push(input); } } as any);
  handler.onModuleInit();
  await handle({ merchantId: "merchant-a", payload: { orderId: "internal-or-external-id", merchantId: "ignored-payload-tenant" } });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].merchantId, "merchant-a");
  assert.equal(scheduled[0].orderId, "external-order");
  assert.equal(scheduled[0].buyerId, "buyer");
  assert.equal(scheduled[0].buyerPhone, "+5511999991111");
});
test("missing or no longer delivered orders do not start a post-delivery campaign", async () => {
  for (const order of [null, { status: "refunded" }]) {
    let handle: (event: any) => Promise<void> = async () => {};
    let scheduled = 0;
    const handler = new OnOrderDeliveredHandler({ subscribe(_name: string, callback: typeof handle) { handle = callback; } } as any,
      { completedOrder: { findFirst: async () => order } } as any, { execute: async () => { scheduled++; } } as any);
    handler.onModuleInit();
    await handle({ merchantId: "merchant-a", payload: { orderId: "order" } });
    assert.equal(scheduled, 0);
  }
});
