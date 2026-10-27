import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  AcpWebhookDispatcherService,
  ACP_WEBHOOK_DISPATCHER_CONFIG,
  ACP_WEBHOOK_HTTP_FETCHER,
  signPayload,
  type AcpWebhookHttpFetcher,
} from "./acp-webhook-dispatcher.service.js";
import {
  ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type AcpWebhookSubscriptionRepository,
} from "../domain/acp-webhook-subscription.repository.port.js";
import { AcpWebhookSubscriptionEntity } from "../domain/acp-webhook-subscription.entity.js";
import type { AcpOrderEventData } from "../acp-webhook-event.types.js";

function createRepository(): AcpWebhookSubscriptionRepository {
  return {
    async save(entity) {
      return entity;
    },
    async listByMerchant() {
      return [];
    },
    async findById() {
      return undefined;
    },
    async delete() {
      return true;
    },
  };
}

function createSubscription(input: {
  id?: string;
  merchantId: string;
  url: string;
  events?: ("order.created" | "order.updated" | "order.fulfilled")[];
}): { entity: AcpWebhookSubscriptionEntity; plaintextSecret: string } {
  return AcpWebhookSubscriptionEntity.register({
    merchantId: input.merchantId,
    url: input.url,
    events: (input.events ?? ["order.created"]) as never,
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDispatcher(input: {
  fetcher: AcpWebhookHttpFetcher;
  config?: Partial<{
    timeoutMs: number;
    maxAttempts: number;
    backoffMs: readonly number[];
    retryQueueCapacity: number;
    enabled: boolean;
  }>;
  repository?: AcpWebhookSubscriptionRepository;
}): {
  dispatcher: AcpWebhookDispatcherService;
  repository: AcpWebhookSubscriptionRepository;
} {
  const repo = input.repository ?? createRepository();
  const dispatcher = new AcpWebhookDispatcherService(
    repo,
    input.fetcher,
    input.config,
  );
  return { dispatcher, repository: repo };
}

const sampleOrderData: AcpOrderEventData = {
  order_id: "ord_123",
  status: "created",
  amount_cents: 12999,
  currency: "BRL",
  line_items: [{ id: "li_1", quantity: 2 }],
  fulfillment_status: "pending",
};

test("dispatcher publishes signed POST with X-AACP-Signature and JSON body", async () => {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal } }[] = [];
  const fetcher: AcpWebhookHttpFetcher = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, ok: true, body: "ok" };
  };

  const { entity: subscription, plaintextSecret } = createSubscription({
    merchantId: "mrc_alice",
    url: "https://merchant.example.com/hook",
    events: ["order.created"],
  });
  const repository = createRepository();
  repository.listByMerchant = async (merchantId) =>
    merchantId === "mrc_alice" ? [subscription] : [];

  const { dispatcher } = buildDispatcher({
    fetcher,
    repository,
    config: { backoffMs: [1, 1, 1], timeoutMs: 1000, maxAttempts: 3 },
  });
  dispatcher.registerSubscriptionSecret(plaintextSecret);

  const result = await dispatcher.publish({
    merchantId: "mrc_alice",
    eventType: "order.created",
    data: sampleOrderData,
  });

  await waitFor(40);

  assert.equal(result.eventId.startsWith("evt_"), true);
  assert.equal(result.enqueuedDeliveries, 1);
  assert.equal(result.failedDeliveries, 0);
  assert.equal(calls.length, 1);

  const call = calls[0];
  assert.equal(call.url, "https://merchant.example.com/hook");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/json");

  const signature = call.init.headers["X-AACP-Signature"];
  assert.ok(signature, "expected X-AACP-Signature header");
  assert.ok(signature.startsWith("sha256="), `signature must be sha256=, got ${signature}`);

  const expected = createHmac("sha256", plaintextSecret).update(call.init.body).digest("hex");
  assert.equal(signature, `sha256=${expected}`);

  const parsed = JSON.parse(call.init.body);
  assert.equal(parsed.type, "order.created");
  assert.equal(parsed.merchant_id, "mrc_alice");
  assert.equal(parsed.data.order_id, "ord_123");
  assert.equal(parsed.data.amount_cents, 12999);

  const deliveries = dispatcher.listDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "delivered");
  assert.equal(deliveries[0].attempts, 1);
  assert.equal(deliveries[0].responseStatus, 200);
});

test("dispatcher retries on 500 with backoff and eventually fails", async () => {
  let attempts = 0;
  const fetcher: AcpWebhookHttpFetcher = async () => {
    attempts += 1;
    return { status: 503, ok: false, body: "down" };
  };

  const { entity: subscription, plaintextSecret } = createSubscription({
    merchantId: "mrc_bob",
    url: "https://bob.example.com/hook",
    events: ["order.updated"],
  });
  const repository = createRepository();
  repository.listByMerchant = async () => [subscription];

  const { dispatcher } = buildDispatcher({
    fetcher,
    repository,
    config: { backoffMs: [10, 10, 10], timeoutMs: 1000, maxAttempts: 3 },
  });
  dispatcher.registerSubscriptionSecret(plaintextSecret);

  await dispatcher.publish({
    merchantId: "mrc_bob",
    eventType: "order.updated",
    data: sampleOrderData,
  });
  await waitFor(120);

  assert.equal(attempts, 3);
  const deliveries = dispatcher.listDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "failed");
  assert.equal(deliveries[0].attempts, 3);
});

test("dispatcher does not retry on 4xx (non-retryable)", async () => {
  let attempts = 0;
  const fetcher: AcpWebhookHttpFetcher = async () => {
    attempts += 1;
    return { status: 400, ok: false, body: "bad request" };
  };

  const { entity: subscription, plaintextSecret } = createSubscription({
    merchantId: "mrc_carol",
    url: "https://carol.example.com/hook",
    events: ["order.created"],
  });
  const repository = createRepository();
  repository.listByMerchant = async () => [subscription];

  const { dispatcher } = buildDispatcher({
    fetcher,
    repository,
    config: { backoffMs: [10, 10, 10], timeoutMs: 1000, maxAttempts: 3 },
  });
  dispatcher.registerSubscriptionSecret(plaintextSecret);

  await dispatcher.publish({
    merchantId: "mrc_carol",
    eventType: "order.created",
    data: sampleOrderData,
  });
  await waitFor(40);

  assert.equal(attempts, 1);
  const deliveries = dispatcher.listDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "failed");
  assert.equal(deliveries[0].attempts, 1);
});

test("dispatcher retries on 429 (retryable)", async () => {
  let attempts = 0;
  const fetcher: AcpWebhookHttpFetcher = async () => {
    attempts += 1;
    if (attempts < 2) return { status: 429, ok: false, body: "slow down" };
    return { status: 200, ok: true, body: "ok" };
  };

  const { entity: subscription, plaintextSecret } = createSubscription({
    merchantId: "mrc_dave",
    url: "https://dave.example.com/hook",
    events: ["order.fulfilled"],
  });
  const repository = createRepository();
  repository.listByMerchant = async () => [subscription];

  const { dispatcher } = buildDispatcher({
    fetcher,
    repository,
    config: { backoffMs: [5, 5, 5], timeoutMs: 1000, maxAttempts: 3 },
  });
  dispatcher.registerSubscriptionSecret(plaintextSecret);

  await dispatcher.publish({
    merchantId: "mrc_dave",
    eventType: "order.fulfilled",
    data: sampleOrderData,
  });
  await waitFor(80);

  assert.equal(attempts, 2);
  const deliveries = dispatcher.listDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "delivered");
  assert.equal(deliveries[0].attempts, 2);
});

test("dispatcher filters subscriptions by event type", async () => {
  const fetcher: AcpWebhookHttpFetcher = async () => ({ status: 200, ok: true, body: "" });

  const { entity: onlyUpdates, plaintextSecret: secretA } = createSubscription({
    id: "sub_only_updates",
    merchantId: "mrc_eve",
    url: "https://eve.example.com/only-updates",
    events: ["order.updated"],
  });
  const { entity: both, plaintextSecret: secretB } = createSubscription({
    id: "sub_both",
    merchantId: "mrc_eve",
    url: "https://eve.example.com/both",
    events: ["order.created", "order.fulfilled"],
  });
  const repository = createRepository();
  repository.listByMerchant = async () => [onlyUpdates, both];

  const { dispatcher } = buildDispatcher({
    fetcher,
    repository,
    config: { backoffMs: [5, 5, 5], timeoutMs: 1000, maxAttempts: 3 },
  });
  dispatcher.registerSubscriptionSecret(secretA);
  dispatcher.registerSubscriptionSecret(secretB);

  const result = await dispatcher.publish({
    merchantId: "mrc_eve",
    eventType: "order.created",
    data: sampleOrderData,
  });
  await waitFor(30);

  assert.equal(result.enqueuedDeliveries, 1);
  const deliveries = dispatcher.listDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].subscriptionId, both.id);
  assert.notEqual(deliveries[0].subscriptionId, onlyUpdates.id);
});

test("dispatcher publish returns zero deliveries when no subscriptions match", async () => {
  const fetcher: AcpWebhookHttpFetcher = async () => ({ status: 200, ok: true, body: "" });
  const repository = createRepository();
  repository.listByMerchant = async () => [];

  const { dispatcher } = buildDispatcher({
    fetcher,
    repository,
    config: { backoffMs: [5, 5, 5], timeoutMs: 1000, maxAttempts: 3 },
  });

  const result = await dispatcher.publish({
    merchantId: "mrc_empty",
    eventType: "order.created",
    data: sampleOrderData,
  });
  await waitFor(10);

  assert.equal(result.enqueuedDeliveries, 0);
  assert.equal(dispatcher.listDeliveries().length, 0);
});

test("dispatcher skipsHttp records delivered without HTTP call", async () => {
  let called = 0;
  const fetcher: AcpWebhookHttpFetcher = async () => {
    called += 1;
    return { status: 200, ok: true, body: "" };
  };

  const { entity: subscription, plaintextSecret } = createSubscription({
    merchantId: "mrc_skip",
    url: "https://skip.example.com",
    events: ["order.created"],
  });
  const repository = createRepository();
  repository.listByMerchant = async () => [subscription];

  const { dispatcher } = buildDispatcher({ fetcher, repository });
  dispatcher.registerSubscriptionSecret(plaintextSecret);

  const result = await dispatcher.publish(
    { merchantId: "mrc_skip", eventType: "order.created", data: sampleOrderData },
    { skipHttp: true },
  );

  assert.equal(result.enqueuedDeliveries, 1);
  assert.equal(called, 0);
  const deliveries = dispatcher.listDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "delivered");
});

test("dispatcher signPayload returns sha256 HMAC of body", () => {
  const sig = signPayload({
    secret: "whsec_unit",
    timestamp: "1700000000",
    body: '{"a":1}',
  });
  const expected = createHmac("sha256", "whsec_unit").update('{"a":1}').digest("hex");
  assert.equal(sig, expected);
  assert.equal(sig.length, 64);
});

test("dispatcher buildRequest sets Content-Type, signature, event headers", () => {
  const fetcher: AcpWebhookHttpFetcher = async () => ({ status: 200, ok: true, body: "" });
  const { dispatcher } = buildDispatcher({ fetcher });
  const envelope = {
    id: "evt_unit",
    type: "order.created" as const,
    created_at: "2026-01-01T00:00:00.000Z",
    merchant_id: "mrc_unit",
    data: sampleOrderData,
  };
  const req = dispatcher.buildRequest({ secret: "whsec_x", envelope });
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.match(req.headers["X-AACP-Signature"], /^sha256=[0-9a-f]{64}$/);
  assert.equal(req.headers["X-AACP-Event-Id"], "evt_unit");
  assert.equal(req.headers["X-AACP-Event-Type"], "order.created");
  assert.equal(req.timestamp.length > 0, true);
});

test("dispatcher returns zero enqueued when disabled", async () => {
  const fetcher: AcpWebhookHttpFetcher = async () => ({ status: 200, ok: true, body: "" });
  const { dispatcher } = buildDispatcher({ fetcher, config: { enabled: false } });
  const result = await dispatcher.publish({
    merchantId: "mrc_disabled",
    eventType: "order.created",
    data: sampleOrderData,
  });
  assert.equal(result.enqueuedDeliveries, 0);
  assert.equal(result.eventId, "");
});

test("dispatcher exposes DI tokens", () => {
  assert.equal(typeof ACP_WEBHOOK_HTTP_FETCHER, "symbol");
  assert.equal(typeof ACP_WEBHOOK_DISPATCHER_CONFIG, "symbol");
  assert.equal(typeof ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY, "symbol");
});
