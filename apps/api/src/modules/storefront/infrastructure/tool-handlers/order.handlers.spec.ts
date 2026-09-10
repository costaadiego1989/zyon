import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createOrderHandlers } from "./order.handlers.js";

const buyerContext = {
  merchantId: "merchant_1",
  sessionId: "conversation_1",
  buyer: { globalUserId: "buyer_1" },
};

test("trackOrder returns the buyer-scoped persisted shipment instead of placeholder data", async () => {
  const completedOrderQueries: any[] = [];
  const shipmentQueries: any[] = [];
  const trackingQueries: any[] = [];
  const prisma = {
    completedOrder: {
      findFirst: async (query: unknown) => {
        completedOrderQueries.push(query);
        return {
          externalOrderId: "ORDER-123",
          status: "approved",
          completedAt: new Date("2026-09-09T12:00:00.000Z"),
        };
      },
    },
    shipment: {
      findFirst: async (query: unknown) => {
        shipmentQueries.push(query);
        return {
          id: "shipment_1",
          carrier: "correios",
          trackingCode: "BR998877665AA",
          trackingUrl: "https://tracking.example/BR998877665AA",
          status: "in_transit",
          estimatedEta: new Date("2026-09-15T12:00:00.000Z"),
          deliveredAt: null,
          updatedAt: new Date("2026-09-09T13:00:00.000Z"),
        };
      },
    },
    trackingEvent: {
      findFirst: async (query: unknown) => {
        trackingQueries.push(query);
        return {
          description: "Objeto encaminhado para a unidade de distribuição",
          occurredAt: new Date("2026-09-09T13:00:00.000Z"),
        };
      },
    },
  } as unknown as PrismaClient;

  const result = await createOrderHandlers({ prisma }, buyerContext).trackOrder({ orderId: " ORDER-123 " }) as any;

  assert.deepEqual(result, {
    orderId: "ORDER-123",
    found: true,
    status: "in_transit",
    statusLabel: "Em trânsito",
    trackingAvailable: true,
    trackingCode: "BR998877665AA",
    trackingUrl: "https://tracking.example/BR998877665AA",
    carrier: "correios",
    estimatedDelivery: "2026-09-15T12:00:00.000Z",
    deliveredAt: undefined,
    lastUpdate: "Objeto encaminhado para a unidade de distribuição",
    lastUpdatedAt: "2026-09-09T13:00:00.000Z",
  });
  assert.deepEqual(completedOrderQueries[0], {
    where: {
      merchantId: "merchant_1",
      externalOrderId: "ORDER-123",
      session: { globalUserId: "buyer_1" },
    },
    select: { externalOrderId: true, status: true, completedAt: true },
  });
  assert.deepEqual(shipmentQueries[0], {
    where: { merchantId: "merchant_1", externalOrderId: "ORDER-123" },
    select: {
      id: true,
      carrier: true,
      trackingCode: true,
      trackingUrl: true,
      status: true,
      estimatedEta: true,
      deliveredAt: true,
      updatedAt: true,
    },
  });
  assert.deepEqual(trackingQueries[0], {
    where: { merchantId: "merchant_1", shipmentId: "shipment_1" },
    orderBy: { occurredAt: "desc" },
    select: { description: true, occurredAt: true },
  });
});

test("trackOrder requires a verified buyer before it queries order data", async () => {
  let queried = false;
  const prisma = {
    completedOrder: { findFirst: async () => { queried = true; return null; } },
  } as unknown as PrismaClient;

  const result = await createOrderHandlers({ prisma }, {
    merchantId: "merchant_1",
    sessionId: "anonymous_session",
  }).trackOrder({ orderId: "ORDER-123" }) as any;

  assert.equal(queried, false);
  assert.deepEqual(result, {
    found: false,
    requiresIdentification: true,
    message: "Para proteger seus dados, entre na sua conta antes de consultar um pedido.",
  });
});

test("trackOrder does not disclose orders that do not belong to the buyer", async () => {
  const prisma = {
    completedOrder: { findFirst: async () => null },
  } as unknown as PrismaClient;

  const result = await createOrderHandlers({ prisma }, buyerContext).trackOrder({ orderId: "ORDER-OTHER" }) as any;

  assert.deepEqual(result, {
    orderId: "ORDER-OTHER",
    found: false,
    message: "Não encontrei esse pedido na sua conta.",
  });
});
test("getInvoice and cancelOrder expose unavailable post-sale capabilities without fabricating outcomes", async () => {
  const prisma = {} as PrismaClient;
  const handlers = createOrderHandlers({ prisma }, buyerContext);

  const invoice = await handlers.getInvoice({ orderId: " ORDER-123 " }) as any;
  const cancellation = await handlers.cancelOrder({ orderId: " ORDER-123 ", reason: "Não quero mais" }) as any;

  assert.deepEqual(invoice, {
    orderId: "ORDER-123",
    invoiceAvailable: false,
    message: "A nota fiscal não está disponível pelo assistente. Solicite-a ao atendimento da loja.",
  });
  assert.deepEqual(cancellation, {
    orderId: "ORDER-123",
    cancellationAvailable: false,
    status: "unavailable",
    message: "O cancelamento não está disponível pelo assistente. Fale com o atendimento da loja para uma solicitação autorizada.",
  });
  assert.equal("invoiceUrl" in invoice, false);
  assert.equal("number" in invoice, false);
  assert.equal("issuedAt" in invoice, false);
  assert.equal(cancellation.status === "cancellation_requested", false);
});
