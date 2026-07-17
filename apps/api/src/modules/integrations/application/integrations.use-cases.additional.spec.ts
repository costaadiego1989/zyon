import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { UpdateOrderTrackingUseCase } from "../../checkout/application/use-cases/update-order-tracking.use-case.js";
import { InMemoryIntegrationsRepository } from "../infrastructure/in-memory-integrations.repository.js";
import {
  CreateMerchantApiKeyUseCase,
  GetTrackingTimelineUseCase,
  GetWebhookDeliveryUseCase,
  GetWebhookEndpointUseCase,
  ListMerchantApiKeysUseCase,
  ListTenantShipmentsUseCase,
  ListWebhookDeliveriesUseCase,
  ListWebhookEndpointsUseCase,
  RevokeMerchantApiKeyUseCase,
  TenantWebhookPublisher,
  TestWebhookEndpointUseCase,
  UpsertWebhookEndpointUseCase,
} from "./integrations.use-cases.js";
import { ApiKeyService } from "../domain/api-key.service.js";
import { ApiKeyAccessPolicy } from "../domain/api-key-access-policy.js";
import { WebhookSignatureService } from "../domain/webhook-signature.service.js";
import type { MerchantWebhookDelivery, TenantWebhookEventType } from "../domain/integrations.types.js";

// ============ API KEY USE CASES ============

test("ListMerchantApiKeysUseCase returns keys for merchant ordered by creation", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const apiKeys = new ApiKeyService();

  const key1 = await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "First",
    keyHash: apiKeys.hash("secret1"),
    keyPrefix: "aacp_test_abc",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const key2 = await repo.createApiKey({
    id: "mak_2",
    merchantId: "mrc_1",
    name: "Second",
    keyHash: apiKeys.hash("secret2"),
    keyPrefix: "aacp_test_def",
    scopes: ["tracking:write"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-02T00:00:00.000Z",
  });

  // Different merchant (should not appear)
  await repo.createApiKey({
    id: "mak_3",
    merchantId: "mrc_2",
    name: "Other",
    keyHash: apiKeys.hash("secret3"),
    keyPrefix: "aacp_test_ghi",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-03T00:00:00.000Z",
  });

  const useCase = new ListMerchantApiKeysUseCase(repo);
  const keys = await useCase.execute("mrc_1");

  assert.equal(keys.length, 2);
  assert.equal(keys[0]?.id, "mak_2"); // newest first
  assert.equal(keys[1]?.id, "mak_1");
  assert.equal(keys[0]?.name, "Second");
});

test("RevokeMerchantApiKeyUseCase marks key as revoked and returns updated record", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const apiKeys = new ApiKeyService();
  const now = "2026-01-01T00:00:00.000Z";

  const created = await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "ERP",
    keyHash: apiKeys.hash("secret"),
    keyPrefix: "aacp_test_abc",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: now,
  });

  const useCase = new RevokeMerchantApiKeyUseCase(repo);
  const revoked = await useCase.execute("mrc_1", "mak_1");

  assert.ok(revoked.revokedAt);
  assert.equal(revoked.id, "mak_1");

  const stored = await repo.getApiKey("mrc_1", "mak_1");
  assert.ok(stored?.revokedAt);
});

test("RevokeMerchantApiKeyUseCase throws 404 for nonexistent or wrong merchant", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new RevokeMerchantApiKeyUseCase(repo);

  await assert.rejects(
    () => useCase.execute("mrc_1", "mak_nonexistent"),
    NotFoundException
  );

  const apiKeys = new ApiKeyService();
  await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Key1",
    keyHash: apiKeys.hash("secret"),
    keyPrefix: "aacp_test_abc",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  await assert.rejects(
    () => useCase.execute("mrc_2", "mak_1"), // wrong merchant
    NotFoundException
  );
});

// ============ WEBHOOK ENDPOINT USE CASES ============

test("UpsertWebhookEndpointUseCase creates new endpoint with generated signing secret", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new UpsertWebhookEndpointUseCase(repo);

  const result = await useCase.execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["order.created", "order.approved"],
    enabled: true,
  });

  assert.ok(result.id);
  assert.match(result.id, /^wh_/);
  assert.ok(result.signingSecret);
  assert.match(result.signingSecret, /^whsec_/);
  assert.equal(result.url, "https://example.com/webhooks");
  assert.deepEqual(result.events, ["order.created", "order.approved"]);
  assert.equal(result.enabled, true);
});

test("UpsertWebhookEndpointUseCase updates existing endpoint preserving secret", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new UpsertWebhookEndpointUseCase(repo);

  const created = await useCase.execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["order.created"],
  });

  const originalSecret = created.signingSecret;

  const updated = await useCase.execute({
    merchantId: "mrc_1",
    endpointId: created.id,
    url: "https://new.example.com/webhooks",
    events: ["order.approved", "payment.approved"],
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.signingSecret, originalSecret);
  assert.equal(updated.url, "https://new.example.com/webhooks");
  assert.deepEqual(updated.events, ["order.approved", "payment.approved"]);
});

test("UpsertWebhookEndpointUseCase throws 404 for nonexistent endpoint update", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new UpsertWebhookEndpointUseCase(repo);

  await assert.rejects(
    () =>
      useCase.execute({
        merchantId: "mrc_1",
        endpointId: "wh_nonexistent",
        url: "https://example.com/webhooks",
      }),
    NotFoundException
  );
});

test("UpsertWebhookEndpointUseCase sanitizes webhook events", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new UpsertWebhookEndpointUseCase(repo);

  const result = await useCase.execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["order.created", "order.created", "invalid_event"] as any, // duplicates and invalid
  });

  // Should keep only unique valid events
  assert.equal(result.events.includes("order.created"), true);
  assert.equal(result.events.length, 1);
});

test("UpsertWebhookEndpointUseCase rejects invalid URLs", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new UpsertWebhookEndpointUseCase(repo);

  await assert.rejects(
    () =>
      useCase.execute({
        merchantId: "mrc_1",
        url: "not-a-url",
      }),
    BadRequestException
  );

  await assert.rejects(
    () =>
      useCase.execute({
        merchantId: "mrc_1",
        url: "http://example.com", // http not allowed (non-localhost)
      }),
    BadRequestException
  );
});

test("GetWebhookEndpointUseCase retrieves endpoint or throws 404", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const endpoint = await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    enabled: true,
    events: ["order.created"],
    signingSecret: "whsec_test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const useCase = new GetWebhookEndpointUseCase(repo);
  const retrieved = await useCase.execute("mrc_1", "wh_1");

  assert.equal(retrieved.id, "wh_1");
  assert.equal(retrieved.url, "https://example.com/webhooks");

  await assert.rejects(
    () => useCase.execute("mrc_1", "wh_nonexistent"),
    NotFoundException
  );

  await assert.rejects(
    () => useCase.execute("mrc_2", "wh_1"), // wrong merchant
    NotFoundException
  );
});

test("ListWebhookEndpointsUseCase returns merchant endpoints ordered by creation", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    enabled: true,
    events: ["order.created"],
    signingSecret: "whsec_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  await repo.upsertWebhookEndpoint({
    id: "wh_2",
    merchantId: "mrc_1",
    url: "https://example.com/webhooks2",
    enabled: true,
    events: ["payment.pending"],
    signingSecret: "whsec_2",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  await repo.upsertWebhookEndpoint({
    id: "wh_3",
    merchantId: "mrc_2",
    url: "https://example.com/webhooks3",
    enabled: true,
    events: ["order.approved"],
    signingSecret: "whsec_3",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });

  const useCase = new ListWebhookEndpointsUseCase(repo);
  const endpoints = await useCase.execute("mrc_1");

  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0]?.id, "wh_2"); // newest first
  assert.equal(endpoints[1]?.id, "wh_1");
});

// ============ WEBHOOK DELIVERY USE CASES ============

test("ListWebhookDeliveriesUseCase returns deliveries for merchant with limit", async () => {
  const repo = new InMemoryIntegrationsRepository();

  for (let i = 0; i < 5; i++) {
    await repo.saveWebhookDelivery({
      id: `whd_${i}`,
      merchantId: "mrc_1",
      endpointId: "wh_1",
      endpointUrl: "https://example.com",
      eventId: `evt_${i}`,
      eventType: "order.created" as TenantWebhookEventType,
      status: "pending",
      attempts: 0,
      envelope: {
        event_id: `evt_${i}`,
        event_type: "order.created",
        merchant_id: "mrc_1",
        occurred_at: "2026-01-01T00:00:00.000Z",
        api_version: "2026-05-21",
        data: {},
      },
      createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
    });
  }

  const useCase = new ListWebhookDeliveriesUseCase(repo);
  const all = await useCase.execute("mrc_1");
  const limited = await useCase.execute("mrc_1", 2);

  assert.equal(all.length, 5);
  assert.equal(limited.length, 2);
  assert.equal(limited[0]?.id, "whd_4"); // newest first
});

test("GetWebhookDeliveryUseCase retrieves delivery or throws 404", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const delivery = await repo.saveWebhookDelivery({
    id: "whd_1",
    merchantId: "mrc_1",
    endpointId: "wh_1",
    endpointUrl: "https://example.com",
    eventId: "evt_1",
    eventType: "order.created",
    status: "pending",
    attempts: 0,
    envelope: {
      event_id: "evt_1",
      event_type: "order.created",
      merchant_id: "mrc_1",
      occurred_at: "2026-01-01T00:00:00.000Z",
      api_version: "2026-05-21",
      data: {},
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const useCase = new GetWebhookDeliveryUseCase(repo);
  const retrieved = await useCase.execute("mrc_1", "whd_1");

  assert.equal(retrieved.id, "whd_1");
  assert.equal(retrieved.status, "pending");

  await assert.rejects(
    () => useCase.execute("mrc_1", "whd_nonexistent"),
    NotFoundException
  );

  await assert.rejects(
    () => useCase.execute("mrc_2", "whd_1"), // wrong merchant
    NotFoundException
  );
});

test("TestWebhookEndpointUseCase publishes test event and returns delivery", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const publisher = new TenantWebhookPublisher(repo);

  const endpoint = await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    enabled: true,
    events: ["order.approved"],
    signingSecret: "whsec_test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const useCase = new TestWebhookEndpointUseCase(repo, publisher);
  const delivery = await useCase.execute("mrc_1", "wh_1");

  assert.equal(delivery.eventType, "order.approved");
  assert.equal(delivery.status, "pending");
  assert.equal(delivery.endpointId, "wh_1");

  const stored = await repo.getWebhookDelivery("mrc_1", delivery.id);
  assert.ok(stored);
});

test("TestWebhookEndpointUseCase rejects if endpoint doesn't exist", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const publisher = new TenantWebhookPublisher(repo);
  const useCase = new TestWebhookEndpointUseCase(repo, publisher);

  await assert.rejects(
    () => useCase.execute("mrc_1", "wh_nonexistent"),
    NotFoundException
  );
});

test("TestWebhookEndpointUseCase rejects if event type not enabled on endpoint", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const publisher = new TenantWebhookPublisher(repo);

  await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    enabled: true,
    events: ["order.created"], // doesn't include order.approved
    signingSecret: "whsec_test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const useCase = new TestWebhookEndpointUseCase(repo, publisher);

  // TestWebhookEndpointUseCase publishes order.approved test event
  // If endpoint doesn't subscribe to it, no delivery is created
  await assert.rejects(
    () => useCase.execute("mrc_1", "wh_1"),
    BadRequestException
  );
});

// ============ SHIPMENT & TRACKING USE CASES ============

test("ListTenantShipmentsUseCase returns merchant shipments with limit", async () => {
  const repo = new InMemoryIntegrationsRepository();

  for (let i = 0; i < 3; i++) {
    await repo.upsertShipment({
      id: `shp_${i}`,
      merchantId: "mrc_1",
      sessionId: `chk_${i}`,
      externalOrderId: `ord_${i}`,
      carrier: "Correios",
      trackingCode: `BR${i}00000000`,
      status: "in_transit",
      createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
    });
  }

  const useCase = new ListTenantShipmentsUseCase(repo);
  const all = await useCase.execute("mrc_1");
  const limited = await useCase.execute("mrc_1", 2);

  assert.equal(all.length, 3);
  assert.equal(limited.length, 2);
});

test("GetTrackingTimelineUseCase returns shipment and its events", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const shipment = await repo.upsertShipment({
    id: "shp_1",
    merchantId: "mrc_1",
    sessionId: "chk_1",
    externalOrderId: "ord_1",
    carrier: "Correios",
    trackingCode: "BR123456789",
    status: "in_transit",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  await repo.appendTrackingEvent({
    id: "evt_1",
    merchantId: "mrc_1",
    shipmentId: "shp_1",
    trackingCode: "BR123456789",
    status: "dispatched",
    description: "Package dispatched",
    location: "Sao Paulo",
    carrierRaw: {},
    occurredAt: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T10:00:00.000Z",
  });

  await repo.appendTrackingEvent({
    id: "evt_2",
    merchantId: "mrc_1",
    shipmentId: "shp_1",
    trackingCode: "BR123456789",
    status: "in_transit",
    description: "In transit",
    location: "Rio de Janeiro",
    carrierRaw: {},
    occurredAt: "2026-01-02T10:00:00.000Z",
    createdAt: "2026-01-02T10:00:00.000Z",
  });

  const useCase = new GetTrackingTimelineUseCase(repo);
  const timeline = await useCase.execute({
    merchantId: "mrc_1",
    trackingCode: "BR123456789",
  });

  assert.equal(timeline.shipment.id, "shp_1");
  assert.equal(timeline.events.length, 2);
  assert.equal(timeline.events[0]?.status, "dispatched");
  assert.equal(timeline.events[1]?.status, "in_transit");
});

test("GetTrackingTimelineUseCase throws 404 for nonexistent tracking code", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new GetTrackingTimelineUseCase(repo);

  await assert.rejects(
    () =>
      useCase.execute({
        merchantId: "mrc_1",
        trackingCode: "NONEXISTENT",
      }),
    NotFoundException
  );
});

// ============ TENANT WEBHOOK PUBLISHER ============

test("TenantWebhookPublisher publishes event to enabled endpoints subscribed to event", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://endpoint1.example.com",
    enabled: true,
    events: ["order.created"],
    signingSecret: "whsec_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  await repo.upsertWebhookEndpoint({
    id: "wh_2",
    merchantId: "mrc_1",
    url: "https://endpoint2.example.com",
    enabled: true,
    events: ["order.approved"], // different event
    signingSecret: "whsec_2",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  await repo.upsertWebhookEndpoint({
    id: "wh_3",
    merchantId: "mrc_1",
    url: "https://endpoint3.example.com",
    enabled: false, // disabled
    events: ["order.created"],
    signingSecret: "whsec_3",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const publisher = new TenantWebhookPublisher(repo);
  const deliveries = await publisher.publish({
    merchantId: "mrc_1",
    eventType: "order.created",
    data: { order: { external_order_id: "ord_1" } },
  });

  // Only wh_1 should receive delivery (enabled + subscribed to order.created)
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.endpointId, "wh_1");
  assert.equal(deliveries[0]?.status, "pending");
});

test("TenantWebhookPublisher sets correct envelope metadata", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example.com",
    enabled: true,
    events: ["order.created"],
    signingSecret: "whsec_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const publisher = new TenantWebhookPublisher(repo);
  const deliveries = await publisher.publish({
    merchantId: "mrc_1",
    eventType: "order.created",
    data: { test: true },
    occurredAt: "2026-01-01T12:00:00.000Z",
  });

  assert.equal(deliveries.length, 1);
  const envelope = deliveries[0]?.envelope;
  assert.ok(envelope?.event_id);
  assert.match(envelope?.event_id, /^evt_/);
  assert.equal(envelope?.event_type, "order.created");
  assert.equal(envelope?.merchant_id, "mrc_1");
  assert.equal(envelope?.occurred_at, "2026-01-01T12:00:00.000Z");
  assert.equal(envelope?.api_version, "2026-05-21");
  assert.equal(envelope?.data.test, true);
});
