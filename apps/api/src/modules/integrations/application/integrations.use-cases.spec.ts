import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { UpdateOrderTrackingUseCase } from "../../checkout/application/use-cases/update-order-tracking.use-case.js";
import { InMemoryIntegrationsRepository } from "../infrastructure/in-memory-integrations.repository.js";
import {
  CreateMerchantApiKeyUseCase,
  ListWebhookDeliveriesUseCase,
  ReplayWebhookDeliveryUseCase,
  RotateWebhookSigningSecretUseCase,
  RotateMerchantApiKeyUseCase,
  TenantWebhookPublisher,
  UpdateTenantOrderTrackingUseCase,
  UpsertWebhookEndpointUseCase
} from "./integrations.use-cases.js";
import { ApiKeyService } from "../domain/api-key.service.js";
import { ApiKeyAccessPolicy } from "../domain/api-key-access-policy.js";
import { WebhookSignatureService } from "../domain/webhook-signature.service.js";
import { WebhookDeliveryDispatcher } from "./webhook-delivery-dispatcher.service.js";
import type { MerchantWebhookDelivery } from "../domain/integrations.types.js";
import { DnsWebhookTargetPolicy } from "../infrastructure/dns-webhook-target-policy.js";

test("CreateMerchantApiKeyUseCase returns the raw secret once and stores only hashed metadata", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new CreateMerchantApiKeyUseCase(
    repo,
    new ApiKeyService(),
    new ApiKeyAccessPolicy(),
  );

  const created = await useCase.execute({
    merchantId: "mrc_1",
    name: "ERP",
    scopes: ["tracking:write"],
    environment: "test",
    allowedCidrs: ["203.0.113.10"],
  });
  assert.match(created.secret_key, /^aacp_test_/);
  assert.equal(created.api_key.name, "ERP");
  assert.equal(created.api_key.scopes.includes("tracking:write"), true);
  assert.deepEqual(created.api_key.allowedCidrs, ["203.0.113.10/32"]);

  const stored = await repo.findActiveApiKeyByHash(new ApiKeyService().hash(created.secret_key));
  assert.equal(stored?.keyHash, new ApiKeyService().hash(created.secret_key));
  assert.equal((stored as any).secret_key, undefined);
});

test("RotateMerchantApiKeyUseCase overlaps the previous key and returns a new secret once", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const create = new CreateMerchantApiKeyUseCase(
    repo,
    new ApiKeyService(),
    new ApiKeyAccessPolicy(),
  );
  const original = await create.execute({
    merchantId: "mrc_1",
    name: "Production ERP",
    environment: "live",
    scopes: ["orders:read", "tracking:write"],
  });

  const rotated = await new RotateMerchantApiKeyUseCase(repo, create).execute({
    merchantId: "mrc_1",
    apiKeyId: original.api_key.id,
    overlapSeconds: 60,
  });

  assert.match(rotated.secret_key, /^aacp_live_/);
  assert.equal(rotated.api_key.rotatedFromId, original.api_key.id);
  assert.equal(rotated.previous_api_key_id, original.api_key.id);
  assert.ok(rotated.previous_key_expires_at);
  assert.equal((await repo.getApiKey("mrc_1", original.api_key.id))?.expiresAt, rotated.previous_key_expires_at);
});

test("UpdateTenantOrderTrackingUseCase updates completed order, persists shipment timeline and enqueues webhook", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const integrations = new InMemoryIntegrationsRepository();
  const publisher = new TenantWebhookPublisher(integrations);
  const now = new Date("2026-05-21T12:00:00.000Z").toISOString();

  checkout.saveSession({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    globalUserId: "usr_1",
    conversationId: "cnv_1",
    cart: {
      currency: "BRL",
      total: 219,
      currentDiscount: 10,
      items: [{ sku: "sku_1", name: "Premium Kit", price: 109.5, quantity: 2 }]
    },
    customer: { email: "ana@example.com", fullName: "Ana Cliente", phone: "+5511999999999" },
    shipping: { customerPrice: 19, carrier: "Correios", method: "PAC", deliveryDays: 5 },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: now,
    updatedAt: now
  });

  await new CompleteOrderUseCase(checkout, checkout, checkout).execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    external_order_id: "ord_900",
    order_total: 219,
    currency: "BRL"
  });

  await new UpsertWebhookEndpointUseCase(integrations).execute({
    merchantId: "mrc_1",
    url: "https://example.com/aacp/webhooks",
    events: ["order.tracking.updated"]
  });

  const useCase = new UpdateTenantOrderTrackingUseCase(
    integrations,
    checkout,
    checkout,
    new UpdateOrderTrackingUseCase(checkout, checkout, checkout),
    publisher
  );

  const result = await useCase.execute({
    merchantId: "mrc_1",
    externalOrderId: "ord_900",
    body: {
      tracking_code: " BR123456789AA ",
      carrier: "Correios",
      tracking_url: "https://rastreamento.correios.com.br/BR123456789AA",
      status: "in_transit",
      events: [
        {
          status: "in_transit",
          description: "Objeto em transferencia",
          location: "Sao Paulo, SP",
          occurred_at: "2026-05-21T13:00:00.000Z"
        }
      ]
    }
  });

  assert.equal(result.updated, true);
  assert.equal(result.changed, true);
  assert.equal(result.order.trackingCode, "BR123456789AA");
  assert.equal(result.shipment.trackingCode, "BR123456789AA");
  assert.equal(result.events_recorded, 1);

  const deliveries = await new ListWebhookDeliveriesUseCase(integrations).execute("mrc_1");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.eventType, "order.tracking.updated");
  assert.equal(deliveries[0]?.status, "pending");
});

test("ReplayWebhookDeliveryUseCase resets failed delivery for immediate retry", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const failed = await repo.saveWebhookDelivery({
    ...webhookDeliveryFixture(),
    status: "failed",
    attempts: 5,
    responseStatus: 500,
    responseBody: "downstream down",
    error: "http_500",
    deliveredAt: "2026-05-21T12:04:00.000Z"
  });

  const replayed = await new ReplayWebhookDeliveryUseCase(repo).execute(failed.merchantId, failed.id);
  const stored = await repo.getWebhookDelivery(failed.merchantId, failed.id);

  assert.equal(replayed.status, "pending");
  assert.equal(replayed.attempts, 0);
  assert.equal(replayed.responseStatus, undefined);
  assert.equal(replayed.error, undefined);
  assert.equal(stored?.status, "pending");
  assert.equal(stored?.attempts, 0);
  assert.ok(stored?.nextAttemptAt);
  assert.equal(stored?.deliveredAt, undefined);
});

test("RotateWebhookSigningSecretUseCase exposes the new secret once", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const endpoint = await new UpsertWebhookEndpointUseCase(repo).execute({
    merchantId: "mrc_1",
    url: "https://example.com/aacp/webhooks",
    events: ["order.created"],
  });

  const rotated = await new RotateWebhookSigningSecretUseCase(repo).execute(
    "mrc_1",
    endpoint.id,
  );

  assert.match(rotated.signingSecret ?? "", /^whsec_/);
  assert.notEqual(rotated.signingSecret, endpoint.signingSecret);
});

test("WebhookDeliveryDispatcher signs and marks successful deliveries", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const signatures = new WebhookSignatureService();
  const delivery = await repo.saveWebhookDelivery(webhookDeliveryFixture());
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  let capturedHeaders: Headers | undefined;

  globalThis.fetch = (async (_url, init) => {
    capturedBody = String(init?.body ?? "");
    capturedHeaders = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await new WebhookDeliveryDispatcher(repo, signatures).dispatchOnce();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const stored = await repo.getWebhookDelivery(delivery.merchantId, delivery.id);
  assert.equal(stored?.status, "delivered");
  assert.equal(stored?.attempts, 1);
  assert.equal(stored?.responseStatus, 204);
  assert.equal(stored?.nextAttemptAt, undefined);
  assert.equal(capturedHeaders?.get("X-AACP-Event-Id"), delivery.eventId);
  assert.equal(capturedHeaders?.get("X-AACP-Event-Type"), "order.approved");
  assert.equal(
    signatures.verify({
      secret: delivery.signingSecret!,
      timestamp: capturedHeaders?.get("X-AACP-Timestamp") ?? "",
      body: capturedBody,
      signature: capturedHeaders?.get("X-AACP-Signature") ?? ""
    }),
    true
  );
});

test("WebhookDeliveryDispatcher schedules retry on HTTP failure and fails after max attempts", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const retryDelivery = await repo.saveWebhookDelivery(webhookDeliveryFixture({ id: "whd_retry", eventId: "evt_retry" }));
  const finalDelivery = await repo.saveWebhookDelivery(
    webhookDeliveryFixture({ id: "whd_final", eventId: "evt_final", attempts: 4 })
  );
  const originalFetch = globalThis.fetch;
  const statuses = new Map([
    [retryDelivery.eventId, 500],
    [finalDelivery.eventId, 503]
  ]);

  globalThis.fetch = (async (_url, init) => {
    const eventId = new Headers(init?.headers).get("X-AACP-Event-Id") ?? "";
    return new Response("downstream unavailable", { status: statuses.get(eventId) ?? 500 });
  }) as typeof fetch;

  try {
    await new WebhookDeliveryDispatcher(repo, new WebhookSignatureService()).dispatchOnce();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const retryStored = await repo.getWebhookDelivery(retryDelivery.merchantId, retryDelivery.id);
  assert.equal(retryStored?.status, "pending");
  assert.equal(retryStored?.attempts, 1);
  assert.equal(retryStored?.responseStatus, 500);
  assert.equal(retryStored?.error, "http_500");
  assert.ok(retryStored?.nextAttemptAt);

  const finalStored = await repo.getWebhookDelivery(finalDelivery.merchantId, finalDelivery.id);
  assert.equal(finalStored?.status, "failed");
  assert.equal(finalStored?.attempts, 5);
  assert.equal(finalStored?.responseStatus, 503);
  assert.equal(finalStored?.error, "http_503");
  assert.equal(finalStored?.nextAttemptAt, undefined);
});

test("WebhookDeliveryDispatcher blocks private targets before fetch", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const delivery = await repo.saveWebhookDelivery(
    webhookDeliveryFixture({
      endpointUrl: "https://127.0.0.1/webhooks",
    }),
  );

  await new WebhookDeliveryDispatcher(
    repo,
    new WebhookSignatureService(),
    new DnsWebhookTargetPolicy(),
  ).dispatchOnce();

  const stored = await repo.getWebhookDelivery(
    delivery.merchantId,
    delivery.id,
  );
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.error, "webhook_target_blocked");
  assert.equal(stored?.nextAttemptAt, undefined);
});

test("WebhookDeliveryDispatcher logs repository failures without crashing the API", async () => {
  const repo = new FailingDueDeliveriesRepository();

  await assert.doesNotReject(() => new WebhookDeliveryDispatcher(repo, new WebhookSignatureService()).dispatchOnce());
});

test("WebhookDeliveryDispatcher does not start background interval in development by default", (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnabled = process.env.WEBHOOK_DISPATCHER_ENABLED;
  const originalSetInterval = globalThis.setInterval;
  let scheduled = false;

  t.after(() => {
    globalThis.setInterval = originalSetInterval;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnabled === undefined) delete process.env.WEBHOOK_DISPATCHER_ENABLED;
    else process.env.WEBHOOK_DISPATCHER_ENABLED = previousEnabled;
  });

  process.env.NODE_ENV = "development";
  delete process.env.WEBHOOK_DISPATCHER_ENABLED;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    scheduled = true;
    return originalSetInterval(...args);
  }) as typeof setInterval;

  const dispatcher = new WebhookDeliveryDispatcher(new InMemoryIntegrationsRepository(), new WebhookSignatureService());
  dispatcher.onModuleInit();
  dispatcher.onModuleDestroy();

  assert.equal(scheduled, false);
});

test("WebhookDeliveryDispatcher does not dispatch twice when inline and poller race — atomic claim", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const delivery = await repo.saveWebhookDelivery(webhookDeliveryFixture());
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    // Simulate two concurrent dispatches for the same delivery.
    // The first claim will succeed; the second must be skipped.
    const dispatcher = new WebhookDeliveryDispatcher(repo, new WebhookSignatureService());
    await Promise.all([
      dispatcher.dispatchDelivery(delivery),
      dispatcher.dispatchDelivery(delivery),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Only one fetch should have reached the endpoint.
  assert.equal(fetchCount, 1);
  const stored = await repo.getWebhookDelivery(delivery.merchantId, delivery.id);
  assert.equal(stored?.status, "delivered");
});

test("WebhookDeliveryDispatcher marks delivery as 'sending' before HTTP call and finalizes on success", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const delivery = await repo.saveWebhookDelivery(webhookDeliveryFixture({ id: "whd_claim_test", eventId: "evt_claim_test" }));
  let statusDuringFetch: string | undefined;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    const mid = await repo.getWebhookDelivery(delivery.merchantId, delivery.id);
    statusDuringFetch = mid?.status;
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    await new WebhookDeliveryDispatcher(repo, new WebhookSignatureService()).dispatchDelivery(delivery);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(statusDuringFetch, "sending");
  const after = await repo.getWebhookDelivery(delivery.merchantId, delivery.id);
  assert.equal(after?.status, "delivered");
});


function webhookDeliveryFixture(overrides: Partial<MerchantWebhookDelivery> = {}): MerchantWebhookDelivery {
  const now = "2026-05-21T12:00:00.000Z";
  const eventId = overrides.eventId ?? "evt_delivery";
  return {
    id: "whd_delivery",
    merchantId: "mrc_1",
    endpointId: "wh_1",
    endpointUrl: "https://tenant.example/aacp/webhooks",
    eventId,
    eventType: "order.approved",
    status: "pending",
    attempts: 0,
    envelope: {
      event_id: eventId,
      event_type: "order.approved",
      merchant_id: "mrc_1",
      occurred_at: now,
      api_version: "2026-05-21",
      data: {
        order: { external_order_id: "ord_1", status: "approved" },
        customer: { email: "ana@example.com" }
      }
    },
    signingSecret: "whsec_test_secret",
    nextAttemptAt: "2000-01-01T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

class FailingDueDeliveriesRepository extends InMemoryIntegrationsRepository {
  override async listDueWebhookDeliveries(): Promise<MerchantWebhookDelivery[]> {
    throw new Error("database unavailable");
  }
}
