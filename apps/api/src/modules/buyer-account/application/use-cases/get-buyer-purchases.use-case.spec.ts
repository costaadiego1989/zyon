import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GetBuyerPurchasesUseCase } from "./get-buyer-purchases.use-case.js";
import { BuyerAccountController } from "../../presentation/http/buyer-account.controller.js";
import { classifyTrackingItems, trackingProjection } from "./purchase-tracking.js";

test("GetBuyerPurchasesUseCase includes completed order tracking codes", async () => {
  const completedAt = new Date("2026-05-20T12:00:00.000Z");
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async () => [
        {
          id: "purchase_1",
          merchantId: "mrc_1",
          orderId: "order_1",
          totalAmount: 199.9,
          discountAmount: 0,
          currency: "BRL",
          completedAt,
          items: [{ sku: "sku_1", productType: "physical" }],
        },
      ],
    },
    merchant: {
      findMany: async () => [{ id: "mrc_1", name: "Loja Teste" }],
    },
    completedOrder: {
      findMany: async () => [
        {
          merchantId: "mrc_1",
          externalOrderId: "order_1",
          trackingCode: "BR123456789AA",
        },
      ],
    },
    shipment: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  const page = await new GetBuyerPurchasesUseCase(prisma).execute({
    globalUserId: "guser_1",
  });

  assert.equal(page.records[0]?.merchantName, "Loja Teste");
  assert.equal(page.records[0]?.trackingCode, "BR123456789AA");
  assert.equal(page.records[0]?.trackingStatus, "label_generated");
});

test("GetBuyerPurchasesUseCase prefers durable shipment tracking timeline over completed order snapshot", async () => {
  const completedAt = new Date("2026-05-20T12:00:00.000Z");
  const eventAt = new Date("2026-05-21T09:30:00.000Z");
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async () => [
        {
          id: "purchase_1",
          merchantId: "mrc_1",
          orderId: "order_1",
          totalAmount: 199.9,
          discountAmount: 0,
          currency: "BRL",
          completedAt,
          items: [{ sku: "sku_1", productType: "physical" }],
        },
      ],
    },
    merchant: {
      findMany: async () => [{ id: "mrc_1", name: "Loja Teste" }],
    },
    completedOrder: {
      findMany: async () => [
        {
          merchantId: "mrc_1",
          externalOrderId: "order_1",
          trackingCode: "OLD123",
        },
      ],
    },
    shipment: {
      findMany: async () => [
        {
          merchantId: "mrc_1",
          externalOrderId: "order_1",
          trackingCode: "BR123456789AA",
          trackingUrl: "https://rastreamento.example/BR123456789AA",
          carrier: "correios",
          status: "in_transit",
          trackingEvents: [
            {
              status: "in_transit",
              description: "Objeto em transferencia",
              location: "Sao Paulo, SP",
              occurredAt: eventAt,
            },
          ],
        },
      ],
    },
  } as unknown as PrismaClient;

  const page = await new GetBuyerPurchasesUseCase(prisma).execute({
    globalUserId: "guser_1",
  });

  assert.equal(page.records[0]?.trackingCode, "BR123456789AA");
  assert.equal(page.records[0]?.trackingStatus, "in_transit");
  assert.equal(page.records[0]?.trackingUrl, "https://rastreamento.example/BR123456789AA");
  assert.equal(page.records[0]?.carrier, "correios");
  assert.equal(page.records[0]?.trackingEvents[0]?.description, "Objeto em transferencia");
});

test("GetBuyerPurchasesUseCase returns null tracking while order is pending carrier code", async () => {
  const completedAt = new Date("2026-05-20T12:00:00.000Z");
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async () => [
        {
          id: "purchase_1",
          merchantId: "mrc_1",
          orderId: "order_1",
          totalAmount: 199.9,
          discountAmount: 0,
          currency: "BRL",
          completedAt,
          items: [{ sku: "sku_1", productType: "physical" }],
        },
      ],
    },
    merchant: {
      findMany: async () => [{ id: "mrc_1", name: "Loja Teste" }],
    },
    completedOrder: {
      findMany: async () => [
        {
          merchantId: "mrc_1",
          externalOrderId: "order_1",
          trackingCode: null,
        },
      ],
    },
    shipment: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  const page = await new GetBuyerPurchasesUseCase(prisma).execute({
    globalUserId: "guser_1",
  });

  assert.equal(page.records[0]?.trackingCode, null);
});

test("tracking projection keeps mixed purchases complete and exposes only delivered physical items", async () => {
  const items = [
    { sku: "physical", title: "Livro impresso", productType: "physical", quantity: 1, unitPrice: 50 },
    { sku: "digital", title: "Livro digital", productType: "digital", quantity: 1, unitPrice: 20 },
    { sku: "service", title: "Consultoria", productType: "service", quantity: 1, unitPrice: 30 },
  ];
  const scoped: any[] = [];
  const prisma = {
    buyerPurchaseRecord: { findMany: async ({ where }: any) => { scoped.push(where); return [{ id: "owned", merchantId: "m1", orderId: "order", items, completedAt: new Date(), totalAmount: 100, discountAmount: 0, currency: "BRL" }]; } },
    merchant: { findMany: async () => [{ id: "m1", name: "Loja" }] },
    completedOrder: { findMany: async ({ where }: any) => { assert.equal(where.session.globalUserId, "buyer"); return []; } },
    shipment: { findMany: async ({ where }: any) => {
      assert.deepEqual(where.OR, [{ merchantId: "m1", externalOrderId: "order" }]);
      return [{ merchantId: "m1", externalOrderId: "order", trackingCode: "BR123", carrier: "correios", status: "delivered", trackingEvents: [{ status: "delivered", description: "Entregue", occurredAt: new Date() }] }];
    } },
  } as unknown as PrismaClient;
  const uc = new GetBuyerPurchasesUseCase(prisma);
  const args = Array(16).fill(undefined); args[6] = uc;
  const controller = new BuyerAccountController(...args as ConstructorParameters<typeof BuyerAccountController>);
  const result = await controller.getPurchaseHistory({ user: { globalUserId: "buyer", merchantId: "m1" } });
  assert.equal(result.items[0].items.length, 3);
  assert.deepEqual(result.items[0].tracking_items.map((item) => item.sku), ["physical"]);
  assert.equal(result.items[0].has_tracking, true);
  assert.equal(result.items[0].tracking_status, "delivered");
  assert.equal(result.items[0].tracking_events.length, 1);
  assert.equal(scoped[0].merchantId, "m1");
  assert.equal(scoped[0].globalUserId, "buyer");
});

test("digital, service, pickup, unclassified and pending shipments never claim real tracking", () => {
  for (const items of [
    [{ productType: "digital" }], [{ productType: "service" }], [{ sku: "unknown" }],
    [{ productType: "physical", fulfillmentType: "pickup" }],
  ]) {
    const physical = classifyTrackingItems(items, "m1", []);
    assert.deepEqual(trackingProjection(physical, { trackingCode: "BR123", status: "in_transit", carrier: "correios", trackingUrl: "https://example.com/track" }), {
      hasTracking: false, trackingItems: [], trackingCode: null, trackingStatus: null, trackingUrl: null, carrier: null,
    });
  }
  const physical = [{ productType: "physical" }];
  assert.deepEqual(classifyTrackingItems(physical, "m1", [], undefined, undefined, { method: "Retirada na loja" }), []);
  for (const code of ["pending:123", " Pending:123 ", "", " ", "a1b3cfea-04d0-4969-a287-8035f0ec0716", "undefined", "null", "none", "pending"]) {
    const result = trackingProjection(physical, { trackingCode: code, status: "created", carrier: "flat-rate", trackingUrl: "https://example.com/track" });
    assert.equal(result.hasTracking, false); assert.equal(result.trackingCode, null); assert.equal(result.carrier, null);
  }
  assert.equal(trackingProjection(physical, { trackingCode: "BR123", status: "cancelled" }).hasTracking, false);
  assert.equal(trackingProjection(physical, { trackingCode: "BR123", status: "in_transit" }, undefined, "cancelado").hasTracking, false);
  const flatRate = trackingProjection(physical, { trackingCode: "BR123", status: "in_transit", carrier: "flat-rate" });
  assert.equal(flatRate.hasTracking, true); assert.equal(flatRate.carrier, null);
});

test("tracking uses historical product types and catalog identities within the merchant, failing closed on ambiguous SKUs", () => {
  const variants = [
    { id: "v1", sku: "shared", productId: "p1", product: { merchantId: "m1", type: "physical" } },
    { id: "v2", sku: "shared", productId: "p2", product: { merchantId: "m1", type: "digital" } },
    { id: "foreign", sku: "only-other-store", productId: "p3", product: { merchantId: "m2", type: "physical" } },
  ];
  assert.deepEqual(classifyTrackingItems([{ sku: "only-other-store" }, { sku: "shared" }], "m1", variants), []);
  assert.deepEqual(classifyTrackingItems([{ sku: "shared", variantId: "v1" }], "m1", variants), [{ sku: "shared", variantId: "v1" }]);
  assert.deepEqual(classifyTrackingItems([{ sku: "shared" }], "m1", variants, [{ sku: "shared", variantId: "v1", productType: "digital" }]), []);
  assert.deepEqual(classifyTrackingItems([{ sku: "shared" }], "m1", variants, [{ sku: "shared", variantId: "v1" }]), [{ sku: "shared" }]);
});

test("tracking suppresses unsafe links and does not attach pending shipment status to a valid legacy code", () => {
  const items = [{ productType: "physical" }];
  for (const trackingUrl of ["javascript:alert(1)", "https://buyer:secret@example.com/a", "http://localhost/a", "http://127.0.0.1/a", "example.com/a"]) {
    assert.equal(trackingProjection(items, { trackingCode: "BR123", status: "in_transit", trackingUrl }).trackingUrl, null);
  }
  const fallback = trackingProjection(items, { trackingCode: "pending:internal", status: "created", carrier: "flat-rate" }, "BR123");
  assert.equal(fallback.hasTracking, true); assert.equal(fallback.trackingStatus, "label_generated"); assert.equal(fallback.carrier, null);
});

test("purchase endpoint binds session tokens to their tenant and preserves global buyer aggregate history", async () => {
  const calls: any[] = [];
  const args = Array(16).fill(undefined); args[6] = { execute: async (input: any) => { calls.push(input); return { records: [], nextCursor: null }; } };
  const controller = new BuyerAccountController(...args as ConstructorParameters<typeof BuyerAccountController>);
  await controller.getPurchaseHistory({ user: { globalUserId: "buyer" } });
  await controller.getPurchaseHistory({ user: { globalUserId: "buyer" } }, " store ");
  await controller.getPurchaseHistory({ user: { globalUserId: "buyer", merchantId: "store" } });
  assert.deepEqual(calls.map((input) => input.merchantId), [undefined, "store", "store"]);
  await assert.rejects(controller.getPurchaseHistory({ user: { globalUserId: "buyer", merchantId: "store" } }, "other"), (e: any) => e.getStatus() === 403);
  for (const value of ["", ["store", "other"], {}]) await assert.rejects(controller.getPurchaseHistory({ user: { globalUserId: "buyer" } }, value), (e: any) => e.getStatus() === 400);
  assert.equal(calls.length, 3);
});

test("purchase pagination preserves ISO timestamps and complete tie-break IDs across pages", async () => {
  const completedAt = new Date("2026-10-05T22:33:44.123Z");
  const rows = ["m1:order:b", "m1:order:a"].map((id) => ({ id, merchantId: "m1", orderId: id, completedAt,
    items: [], totalAmount: 100, discountAmount: 0, currency: "BRL" }));
  const queries: any[] = [];
  const prisma = { buyerPurchaseRecord: { findMany: async (query: any) => {
    queries.push(query);
    if (queries.length === 1) return rows;
    assert.deepEqual(query.where.OR, [{ completedAt: { lt: completedAt } }, { completedAt, id: { lt: "m1:order:b" } }]);
    assert.equal(query.where.merchantId, "m1"); assert.equal(query.where.globalUserId, "buyer");
    return [rows[1]];
  } }, merchant: { findMany: async () => [] }, completedOrder: { findMany: async () => [] } } as unknown as PrismaClient;
  const uc = new GetBuyerPurchasesUseCase(prisma);
  const first = await uc.execute({ globalUserId: "buyer", merchantId: "m1", limit: 1 });
  assert.ok(first.nextCursor);
  const second = await uc.execute({ globalUserId: "buyer", merchantId: "m1", limit: 1, cursor: first.nextCursor! });
  assert.equal(second.records[0].id, "m1:order:a");
  assert.equal(second.records[0].completedAt.toISOString(), completedAt.toISOString());
  assert.equal(second.nextCursor, null);
});

test("malformed purchase cursors return 400 before any database read", async () => {
  const uc = new GetBuyerPurchasesUseCase({ buyerPurchaseRecord: { findMany: async () => { assert.fail("must not query invalid cursor"); } } } as unknown as PrismaClient);
  for (const cursor of ["not:a:cursor", "YQ", Buffer.from("2026-99-05T22:33:44.123Z:order").toString("base64url"), Buffer.from("2026-10-05T22:33:44.123Z:").toString("base64url")]) {
    await assert.rejects(uc.execute({ globalUserId: "buyer", cursor }), (error: any) => error.getStatus() === 400 && error.message === "invalid_purchase_cursor");
  }
});
