import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryIntegrationsRepository } from "./in-memory-integrations.repository.js";
import type { MerchantApiKey, MerchantWebhookDelivery, MerchantWebhookEndpoint, ShipmentRecord, TrackingEventRecord } from "../domain/integrations.types.js";

test("InMemoryIntegrationsRepository isolates data by merchant", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const key1 = await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Key1",
    keyHash: "hash1",
    keyPrefix: "prefix1",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const key2 = await repo.createApiKey({
    id: "mak_2",
    merchantId: "mrc_2",
    name: "Key2",
    keyHash: "hash2",
    keyPrefix: "prefix2",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const keys1 = await repo.listApiKeys("mrc_1");
  const keys2 = await repo.listApiKeys("mrc_2");

  assert.equal(keys1.length, 1);
  assert.equal(keys2.length, 1);
  assert.equal(keys1[0]?.id, "mak_1");
  assert.equal(keys2[0]?.id, "mak_2");
});

test("InMemoryIntegrationsRepository returns undefined for non-matching merchant or API key", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Key1",
    keyHash: "hash1",
    keyPrefix: "prefix1",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const found = await repo.getApiKey("mrc_1", "mak_1");
  assert.ok(found);

  const notFound = await repo.getApiKey("mrc_2", "mak_1");
  assert.equal(notFound, undefined);

  const notExist = await repo.getApiKey("mrc_1", "mak_99");
  assert.equal(notExist, undefined);
});

test("InMemoryIntegrationsRepository findActiveApiKeyByHash filters by expiry and revocation", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const now = "2026-06-15T00:00:00.000Z";

  // Active key
  await repo.createApiKey({
    id: "mak_active",
    merchantId: "mrc_1",
    name: "Active",
    keyHash: "hash_active",
    keyPrefix: "prefix",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  // Expired key
  await repo.createApiKey({
    id: "mak_expired",
    merchantId: "mrc_1",
    name: "Expired",
    keyHash: "hash_expired",
    keyPrefix: "prefix",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-06-01T00:00:00.000Z",
  });

  // Revoked key
  await repo.createApiKey({
    id: "mak_revoked",
    merchantId: "mrc_1",
    name: "Revoked",
    keyHash: "hash_revoked",
    keyPrefix: "prefix",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: "2026-06-10T00:00:00.000Z",
  });

  const active = await repo.findActiveApiKeyByHash("hash_active", now);
  assert.ok(active);

  const expired = await repo.findActiveApiKeyByHash("hash_expired", now);
  assert.equal(expired, undefined);

  const revoked = await repo.findActiveApiKeyByHash("hash_revoked", now);
  assert.equal(revoked, undefined);
});

test("InMemoryIntegrationsRepository touchApiKeyLastUsed updates timestamp", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const created = await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Key",
    keyHash: "hash",
    keyPrefix: "prefix",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(created.lastUsedAt, undefined);

  await repo.touchApiKeyLastUsed("mak_1", "2026-06-15T12:30:00.000Z");

  const updated = await repo.getApiKey("mrc_1", "mak_1");
  assert.equal(updated?.lastUsedAt, "2026-06-15T12:30:00.000Z");
});

test("InMemoryIntegrationsRepository setApiKeyExpiry updates expiry or returns undefined", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const created = await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Key",
    keyHash: "hash",
    keyPrefix: "prefix",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const updated = await repo.setApiKeyExpiry("mrc_1", "mak_1", "2026-12-31T00:00:00.000Z");
  assert.ok(updated);
  assert.equal(updated?.expiresAt, "2026-12-31T00:00:00.000Z");

  // Wrong merchant
  const notFound = await repo.setApiKeyExpiry("mrc_2", "mak_1", "2026-12-31T00:00:00.000Z");
  assert.equal(notFound, undefined);

  // Wrong key
  const notExist = await repo.setApiKeyExpiry("mrc_1", "mak_99", "2026-12-31T00:00:00.000Z");
  assert.equal(notExist, undefined);
});

test("InMemoryIntegrationsRepository revokeApiKey marks key revoked or returns undefined", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Key",
    keyHash: "hash",
    keyPrefix: "prefix",
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const revoked = await repo.revokeApiKey("mrc_1", "mak_1", "2026-06-15T00:00:00.000Z");
  assert.ok(revoked?.revokedAt);

  // Wrong merchant
  const notFound = await repo.revokeApiKey("mrc_2", "mak_1", "2026-06-15T00:00:00.000Z");
  assert.equal(notFound, undefined);
});

test("InMemoryIntegrationsRepository upsertWebhookEndpoint creates and updates", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const created = await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example.com",
    enabled: true,
    events: ["order.created"],
    signingSecret: "whsec_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(created.url, "https://example.com");

  const updated = await repo.upsertWebhookEndpoint({
    ...created,
    url: "https://new.example.com",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  assert.equal(updated.url, "https://new.example.com");
  assert.equal(updated.createdAt, "2026-01-01T00:00:00.000Z"); // preserved
});

test("InMemoryIntegrationsRepository getWebhookEndpoint respects merchant boundary", async () => {
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

  const found = await repo.getWebhookEndpoint("mrc_1", "wh_1");
  assert.ok(found);

  const notFound = await repo.getWebhookEndpoint("mrc_2", "wh_1");
  assert.equal(notFound, undefined);
});

test("InMemoryIntegrationsRepository listWebhookEndpoints returns sorted by creation desc", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.upsertWebhookEndpoint({
    id: "wh_1",
    merchantId: "mrc_1",
    url: "https://example1.com",
    enabled: true,
    events: ["order.created"],
    signingSecret: "whsec_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  await repo.upsertWebhookEndpoint({
    id: "wh_2",
    merchantId: "mrc_1",
    url: "https://example2.com",
    enabled: true,
    events: ["order.approved"],
    signingSecret: "whsec_2",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  const endpoints = await repo.listWebhookEndpoints("mrc_1");
  assert.equal(endpoints[0]?.id, "wh_2"); // newest
  assert.equal(endpoints[1]?.id, "wh_1");
});

test("InMemoryIntegrationsRepository claimWebhookDelivery atomic pending→sending transition", async () => {
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

  const claimed = await repo.claimWebhookDelivery("whd_1", "2026-01-01T12:00:00.000Z");
  assert.ok(claimed);
  assert.equal(claimed?.status, "sending");
  assert.equal(claimed?.updatedAt, "2026-01-01T12:00:00.000Z");

  // Second claim should fail (already sending)
  const secondClaim = await repo.claimWebhookDelivery("whd_1", "2026-01-01T12:00:00.000Z");
  assert.equal(secondClaim, undefined);
});

test("InMemoryIntegrationsRepository listDueWebhookDeliveries filters by status and time", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const now = "2026-06-15T12:00:00.000Z";

  // Pending, due now
  await repo.saveWebhookDelivery({
    id: "whd_1",
    merchantId: "mrc_1",
    endpointId: "wh_1",
    endpointUrl: "https://example.com",
    eventId: "evt_1",
    eventType: "order.created",
    status: "pending",
    attempts: 0,
    envelope: { event_id: "evt_1", event_type: "order.created", merchant_id: "mrc_1", occurred_at: now, api_version: "2026-05-21", data: {} },
    nextAttemptAt: "2026-06-15T11:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  });

  // Pending, not due yet
  await repo.saveWebhookDelivery({
    id: "whd_2",
    merchantId: "mrc_1",
    endpointId: "wh_1",
    endpointUrl: "https://example.com",
    eventId: "evt_2",
    eventType: "order.approved",
    status: "pending",
    attempts: 0,
    envelope: { event_id: "evt_2", event_type: "order.approved", merchant_id: "mrc_1", occurred_at: now, api_version: "2026-05-21", data: {} },
    nextAttemptAt: "2026-06-16T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  });

  // Delivered (should not appear)
  await repo.saveWebhookDelivery({
    id: "whd_3",
    merchantId: "mrc_1",
    endpointId: "wh_1",
    endpointUrl: "https://example.com",
    eventId: "evt_3",
    eventType: "order.created",
    status: "delivered",
    attempts: 1,
    envelope: { event_id: "evt_3", event_type: "order.created", merchant_id: "mrc_1", occurred_at: now, api_version: "2026-05-21", data: {} },
    nextAttemptAt: "2026-06-15T11:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  });

  const due = await repo.listDueWebhookDeliveries(["pending"], now);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.id, "whd_1");
});

test("InMemoryIntegrationsRepository upsertShipment creates and merges by merchant+order", async () => {
  const repo = new InMemoryIntegrationsRepository();

  const first = await repo.upsertShipment({
    id: "shp_1",
    merchantId: "mrc_1",
    sessionId: "chk_1",
    externalOrderId: "ord_1",
    carrier: "Correios",
    trackingCode: "BR123",
    status: "dispatched",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const second = await repo.upsertShipment({
    id: "shp_new", // different ID but same merchant+order
    merchantId: "mrc_1",
    sessionId: "chk_1",
    externalOrderId: "ord_1",
    carrier: "UPS",
    trackingCode: "UP456",
    status: "in_transit",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  // Second upsert should merge with first, keeping original ID and createdAt
  assert.equal(second.id, "shp_1");
  assert.equal(second.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(second.carrier, "UPS"); // updated
  assert.equal(second.trackingCode, "UP456"); // updated
  assert.equal(second.updatedAt, "2026-01-02T00:00:00.000Z");
});

test("InMemoryIntegrationsRepository getShipmentByTrackingCode respects merchant boundary", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.upsertShipment({
    id: "shp_1",
    merchantId: "mrc_1",
    sessionId: "chk_1",
    externalOrderId: "ord_1",
    carrier: "Correios",
    trackingCode: "BR123",
    status: "in_transit",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const found = await repo.getShipmentByTrackingCode("mrc_1", "BR123");
  assert.ok(found);

  const notFound = await repo.getShipmentByTrackingCode("mrc_2", "BR123");
  assert.equal(notFound, undefined);
});

test("InMemoryIntegrationsRepository listTrackingEvents returns sorted by occurrence time", async () => {
  const repo = new InMemoryIntegrationsRepository();

  await repo.appendTrackingEvent({
    id: "evt_1",
    merchantId: "mrc_1",
    shipmentId: "shp_1",
    trackingCode: "BR123",
    status: "dispatched",
    description: "Dispatched",
    carrierRaw: {},
    occurredAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-02T00:00:00.000Z",
  });

  await repo.appendTrackingEvent({
    id: "evt_2",
    merchantId: "mrc_1",
    shipmentId: "shp_1",
    trackingCode: "BR123",
    status: "in_transit",
    description: "In transit",
    carrierRaw: {},
    occurredAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-02T00:00:00.000Z",
  });

  const events = await repo.listTrackingEvents("mrc_1", "BR123");
  assert.equal(events.length, 2);
  assert.equal(events[0]?.id, "evt_2"); // earliest occurrence first
  assert.equal(events[1]?.id, "evt_1");
});
