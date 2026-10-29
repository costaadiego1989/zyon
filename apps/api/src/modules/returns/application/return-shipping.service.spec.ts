import { test } from "node:test";
import assert from "node:assert/strict";
import { ReturnShippingService } from "./return-shipping.service.js";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";

function ordinary(receipt = true) {
  const events = new Map<string, any>(); const requests: any[] = [];
  const identity = { version: 1, provider: "melhor-envio", environment: "test", originMerchantId: "host", providerUserId: "original-user" };
  const prisma: any = { return: { findFirst: async () => ({ status: "REFUND_PROCESSING", orderId: "order", refund: { status: "PENDING" }, items: [{ variantId: "v", quantity: 1 }] }) },
    completedOrder: { findMany: async () => [{ externalOrderId: "order", lineItemsJson: [{ variantId: "v", quantity: 1 }] }] },
    shipment: { findFirst: async () => ({ id: "shipment", trackingCode: "tracking" }) },
    trackingEvent: {
      findMany: async (input: any) => input.where.id.startsWith === "shipping_label_purchase_" ? receipt ? [{ id: "shipping_label_purchase_native", carrierRaw: {
        kind: "zyon_native_label_purchase", carrier_order_id: "label-id", account_identity: identity, external_order_id: "order" } }] : [] : [...events.values()],
      findUnique: async ({ where }: any) => events.get(where.id),
      create: async ({ data }: any) => { if (events.has(data.id)) throw { code: "P2002" }; events.set(data.id, { ...data, createdAt: new Date(0) }); return data; },
      upsert: async ({ create }: any) => { events.set(create.id, create); return create; },
      updateMany: async ({ where, data }: any) => { const row = events.get(where.id); if (row.status === where.status) events.set(where.id, { ...row, ...data }); },
    } };
  const carrier = { cancelLabel: async (input: any) => { requests.push(input); assert.equal(events.size, 1);
    return { status: "unknown", reason: "carrier_cancellation_unproven", walletRefundStatus: "unproven" }; } };
  return { service: new ReturnShippingService(prisma, carrier as any, {} as any), events, requests };
}

test("partial ordinary refunds keep the outbound label for remaining goods", async () => {
  const { service, events, requests } = ordinary(); await service.cancelOrdinary("host", "return", false);
  assert.equal(events.size, 0); assert.equal(requests.length, 0);
});
test("ordinary cancellation is claimed before the provider and uncertain retries only observe", async () => {
  const { service, requests } = ordinary();
  await service.cancelOrdinary("host", "return", true); await service.cancelOrdinary("host", "return", true); await service.reconcile();
  assert.deepEqual(requests.map(row => row.submit), [true, false, false]);
  assert.equal(requests[0].accountIdentity.providerUserId, "original-user");
});
test("legacy or injected generic tracking metadata cannot authorize a native label cancellation", async () => {
  const { service, requests, events } = ordinary(false); await service.cancelOrdinary("host", "return", true);
  assert.equal(requests.length, 0); assert.equal([...events.values()][0].status, "cancellation_review_required");
  assert.equal([...events.values()][0].carrierRaw.wallet_refund_status, "unproven");
});
test("marketplace cancels only the fully returned original seller's labels", async () => {
  const calls: any[] = [];
  const instructions = { lines: [{ lineItemId: "a", sellerMerchantId: "seller-a" }, { lineItemId: "b", sellerMerchantId: "seller-b" }] };
  const allocation = { lines: [{ lineItemId: "a", sellerMerchantId: "seller-a", cumulativeQuantity: 3, purchasedQuantity: 3 },
    { lineItemId: "b", sellerMerchantId: "seller-b", cumulativeQuantity: 1, purchasedQuantity: 2 }] };
  const plan = { id: "plan", fundingPlanId: "funding", allocation, allocationHash: fundingHash(allocation),
    fundingPlan: { instructions, instructionsHash: fundingHash(instructions) } };
  const service = new ReturnShippingService({ marketplaceRefundPlan: { findFirst: async () => plan, findMany: async () => [plan] },
    marketplaceShipmentJournal: { findMany: async ({ where }: any) => { assert.deepEqual(where.originMerchantId.in, ["seller-a"]); return [{ id: "original-label" }]; } },
  } as any, {} as any, { cancel: async (...args: any[]) => { calls.push(args); } } as any);
  await service.cancelMarketplace("host", "return"); assert.deepEqual(calls, [["host", "original-label", "return"]]);
});
