import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import type {
  MerchantApiKey,
  MerchantWebhookDelivery,
  MerchantWebhookEndpoint,
  ShipmentRecord,
  TenantWebhookEnvelope,
  TrackingEventRecord
} from "../domain/integrations.types.js";
import { PrismaIntegrationsRepository } from "./prisma-integrations.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaIntegrationsRepository persists API keys, webhooks, shipments, and tracking timelines",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaIntegrationsRepository(prisma);
    const merchantId = `mrc_int_${crypto.randomUUID()}`;
    const otherMerchantId = `mrc_int_${crypto.randomUUID()}`;
    const now = "2026-05-21T18:00:00.000Z";

    try {
      await prisma.merchant.createMany({
        data: [
          { id: merchantId, name: "Integration Tenant" },
          { id: otherMerchantId, name: "Other Tenant" }
        ]
      });

      const apiKey = await repository.createApiKey({
        id: `key_${crypto.randomUUID()}`,
        merchantId,
        name: "Tenant backend",
        keyHash: `hash_${crypto.randomUUID()}`,
        keyPrefix: "aacp_live_1234",
        scopes: ["embed:sessions:create", "orders:tracking:write"],
        createdAt: now
      });
      await repository.createApiKey({
        id: `key_${crypto.randomUUID()}`,
        merchantId: otherMerchantId,
        name: "Other backend",
        keyHash: `hash_${crypto.randomUUID()}`,
        keyPrefix: "aacp_live_other",
        scopes: ["embed:sessions:create"],
        createdAt: now
      });

      assert.equal((await repository.listApiKeys(merchantId)).length, 1);
      assert.equal((await repository.findActiveApiKeyByHash(apiKey.keyHash))?.id, apiKey.id);

      await repository.touchApiKeyLastUsed(apiKey.id, "2026-05-21T18:01:00.000Z");
      assert.equal((await repository.findActiveApiKeyByHash(apiKey.keyHash))?.lastUsedAt, "2026-05-21T18:01:00.000Z");
      assert.equal((await repository.revokeApiKey(merchantId, apiKey.id, "2026-05-21T18:02:00.000Z"))?.revokedAt, "2026-05-21T18:02:00.000Z");
      assert.equal(await repository.findActiveApiKeyByHash(apiKey.keyHash), undefined);

      const endpoint = await repository.upsertWebhookEndpoint(webhookEndpoint(merchantId, now));
      await repository.upsertWebhookEndpoint({ ...endpoint, url: "https://tenant.test/hooks/v2", updatedAt: "2026-05-21T18:03:00.000Z" });
      assert.equal((await repository.getWebhookEndpoint(merchantId, endpoint.id))?.url, "https://tenant.test/hooks/v2");
      assert.equal((await repository.listWebhookEndpoints(merchantId)).length, 1);
      assert.equal(await repository.getWebhookEndpoint(otherMerchantId, endpoint.id), undefined);

      const delivery = await repository.saveWebhookDelivery(
        webhookDelivery({
          merchantId,
          endpointId: endpoint.id,
          endpointUrl: "https://tenant.test/hooks/v2",
          eventId: `evt_${crypto.randomUUID()}`,
          now
        })
      );
      const duplicate = await repository.saveWebhookDelivery({
        ...delivery,
        id: `whd_${crypto.randomUUID()}`,
        attempts: 9,
        status: "failed"
      });
      assert.equal(duplicate.id, delivery.id);
      assert.equal(duplicate.status, "pending");

      const delivered = await repository.updateWebhookDelivery({
        ...delivery,
        status: "delivered",
        attempts: 1,
        responseStatus: 204,
        responseBody: "",
        deliveredAt: "2026-05-21T18:04:00.000Z",
        updatedAt: "2026-05-21T18:04:00.000Z"
      });
      assert.equal(delivered.responseStatus, 204);
      assert.equal((await repository.getWebhookDelivery(merchantId, delivery.id))?.status, "delivered");

      const dueDelivery = await repository.saveWebhookDelivery(
        webhookDelivery({
          merchantId,
          endpointId: endpoint.id,
          endpointUrl: "https://tenant.test/hooks/v2",
          eventId: `evt_${crypto.randomUUID()}`,
          now,
          nextAttemptAt: "2026-05-21T17:59:00.000Z"
        })
      );
      const futureDelivery = await repository.saveWebhookDelivery(
        webhookDelivery({
          merchantId,
          endpointId: endpoint.id,
          endpointUrl: "https://tenant.test/hooks/v2",
          eventId: `evt_${crypto.randomUUID()}`,
          now,
          nextAttemptAt: "2026-05-21T19:00:00.000Z"
        })
      );
      const due = await repository.listDueWebhookDeliveries(["pending"], now);
      assert.ok(due.some((item) => item.id === dueDelivery.id));
      assert.equal(due.some((item) => item.id === futureDelivery.id), false);

      const shipment = await repository.upsertShipment(shipmentRecord(merchantId, now));
      const updatedShipment = await repository.upsertShipment({
        ...shipment,
        status: "in_transit",
        trackingUrl: "https://rastreamento.test/BR123456789AA",
        updatedAt: "2026-05-21T18:05:00.000Z"
      });
      assert.equal(updatedShipment.id, shipment.id);
      assert.equal((await repository.getShipmentByExternalOrderId(merchantId, shipment.externalOrderId))?.status, "in_transit");
      assert.equal((await repository.getShipmentByTrackingCode(merchantId, shipment.trackingCode))?.trackingUrl, "https://rastreamento.test/BR123456789AA");
      assert.equal((await repository.listShipments(merchantId)).length, 1);
      assert.equal(await repository.getShipmentByExternalOrderId(otherMerchantId, shipment.externalOrderId), undefined);

      await repository.appendTrackingEvent(
        trackingEvent({
          merchantId,
          shipmentId: shipment.id,
          trackingCode: shipment.trackingCode,
          id: `trk_${crypto.randomUUID()}`,
          status: "label_generated",
          description: "Etiqueta criada",
          occurredAt: "2026-05-21T18:00:00.000Z"
        })
      );
      await repository.appendTrackingEvent(
        trackingEvent({
          merchantId,
          shipmentId: shipment.id,
          trackingCode: shipment.trackingCode,
          id: `trk_${crypto.randomUUID()}`,
          status: "in_transit",
          description: "Objeto em transferencia",
          occurredAt: "2026-05-21T18:10:00.000Z"
        })
      );

      const timeline = await repository.listTrackingEvents(merchantId, shipment.trackingCode);
      assert.deepEqual(
        timeline.map((event) => event.status),
        ["label_generated", "in_transit"]
      );
      assert.equal(timeline[1]?.carrierRaw.source, "prisma-int-spec");
    } finally {
      await prisma.merchant.deleteMany({ where: { id: { in: [merchantId, otherMerchantId] } } });
      await prisma.$disconnect();
    }
  }
);

function webhookEndpoint(merchantId: string, now: string): MerchantWebhookEndpoint {
  return {
    id: `wh_${crypto.randomUUID()}`,
    merchantId,
    url: "https://tenant.test/hooks",
    enabled: true,
    events: ["order.approved", "customer.upserted", "order.tracking.updated"],
    signingSecret: `sec_${crypto.randomUUID()}`,
    description: "Prisma integration spec",
    createdAt: now,
    updatedAt: now
  };
}

function webhookDelivery(input: {
  merchantId: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  now: string;
  nextAttemptAt?: string;
}): MerchantWebhookDelivery {
  const envelope: TenantWebhookEnvelope = {
    event_id: input.eventId,
    event_type: "order.approved",
    merchant_id: input.merchantId,
    occurred_at: input.now,
    api_version: "2026-05-21",
    data: {
      order: { external_order_id: "ord_prisma_1", total: 219.9 },
      customer: { email: "buyer@example.test" }
    }
  };
  return {
    id: `whd_${crypto.randomUUID()}`,
    merchantId: input.merchantId,
    endpointId: input.endpointId,
    endpointUrl: input.endpointUrl,
    eventId: input.eventId,
    eventType: "order.approved",
    status: "pending",
    attempts: 0,
    envelope,
    signingSecret: "sec_test",
    nextAttemptAt: input.nextAttemptAt,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function shipmentRecord(merchantId: string, now: string): ShipmentRecord {
  return {
    id: `shp_${crypto.randomUUID()}`,
    merchantId,
    sessionId: `chk_${crypto.randomUUID()}`,
    externalOrderId: `ord_${crypto.randomUUID()}`,
    carrier: "Correios",
    trackingCode: "BR123456789AA",
    status: "label_generated",
    createdAt: now,
    updatedAt: now
  };
}

function trackingEvent(input: {
  merchantId: string;
  shipmentId: string;
  trackingCode: string;
  id: string;
  status: TrackingEventRecord["status"];
  description: string;
  occurredAt: string;
}): TrackingEventRecord {
  return {
    id: input.id,
    merchantId: input.merchantId,
    shipmentId: input.shipmentId,
    trackingCode: input.trackingCode,
    status: input.status,
    description: input.description,
    location: "Sao Paulo, SP",
    carrierRaw: { source: "prisma-int-spec" },
    occurredAt: input.occurredAt,
    createdAt: "2026-05-21T18:11:00.000Z"
  };
}
