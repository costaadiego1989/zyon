import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  DeleteAcpWebhookSubscriptionUseCase,
  ListAcpWebhookSubscriptionsUseCase,
  PublishAcpOrderEventUseCase,
  RegisterAcpWebhookSubscriptionUseCase,
} from "./acp-webhook-subscription.use-cases.js";
import {
  ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type AcpWebhookSubscriptionRepository,
} from "../domain/acp-webhook-subscription.repository.port.js";
import { AcpWebhookSubscriptionEntity } from "../domain/acp-webhook-subscription.entity.js";
import {
  AcpWebhookDispatcherService,
  type AcpPublishResult,
} from "./acp-webhook-dispatcher.service.js";

function createRepository(): AcpWebhookSubscriptionRepository & {
  store: Map<string, AcpWebhookSubscriptionEntity>;
} {
  const store = new Map<string, AcpWebhookSubscriptionEntity>();
  return {
    store,
    async save(entity) {
      store.set(`${entity.merchantId}:${entity.id}`, entity);
      return entity;
    },
    async listByMerchant(merchantId) {
      return Array.from(store.entries())
        .filter(([key]) => key.startsWith(`${merchantId}:`))
        .map(([, entity]) => entity);
    },
    async findById(merchantId, id) {
      return store.get(`${merchantId}:${id}`);
    },
    async delete(merchantId, id) {
      return store.delete(`${merchantId}:${id}`);
    },
  };
}

function createUseCases(repo: AcpWebhookSubscriptionRepository): {
  register: RegisterAcpWebhookSubscriptionUseCase;
  list: ListAcpWebhookSubscriptionsUseCase;
  del: DeleteAcpWebhookSubscriptionUseCase;
  publish: PublishAcpOrderEventUseCase;
  dispatcher: AcpWebhookDispatcherService;
} {
  const dispatcher = new AcpWebhookDispatcherService(
    repo,
    async () => ({ status: 200, ok: true, body: "" }),
    { backoffMs: [10, 10, 10], maxAttempts: 3 },
  );
  return {
    register: new RegisterAcpWebhookSubscriptionUseCase(repo, dispatcher),
    list: new ListAcpWebhookSubscriptionsUseCase(repo),
    del: new DeleteAcpWebhookSubscriptionUseCase(repo),
    publish: new PublishAcpOrderEventUseCase(dispatcher),
    dispatcher,
  };
}

test("register creates a subscription and returns plaintext secret exactly once", async () => {
  const repo = createRepository();
  const { register } = createUseCases(repo);

  const result = await register.execute({
    merchantId: "mrc_alice",
    url: "https://alice.example.com/hook",
    events: ["order.created", "order.fulfilled"],
  });

  assert.ok(result.secret, "expected secret to be returned on create");
  assert.match(result.secret, /^whsec_/);
  assert.match(result.subscription_id, /^sub_/);
  assert.equal(result.url, "https://alice.example.com/hook");
  assert.deepEqual(result.events, ["order.created", "order.fulfilled"]);

  const stored = repo.store.get(`mrc_alice:${result.subscription_id}`);
  assert.ok(stored, "expected subscription to be persisted");
  assert.notEqual(stored.secretHash, result.secret);
  assert.equal(stored.matchesSecretHash(result.secret), true);
  assert.equal(stored.matchesSecretHash("whsec_wrong"), false);
});

test("register deduplicates repeated events", async () => {
  const repo = createRepository();
  const { register } = createUseCases(repo);

  const result = await register.execute({
    merchantId: "mrc_dedupe",
    url: "https://dedupe.example.com/hook",
    events: ["order.created", "order.created", "order.updated"],
  });

  assert.deepEqual(result.events, ["order.created", "order.updated"]);
});

test("register rejects empty events", async () => {
  const repo = createRepository();
  const { register } = createUseCases(repo);

  await assert.rejects(
    () =>
      register.execute({
        merchantId: "mrc_alice",
        url: "https://alice.example.com/hook",
        events: [] as never,
      }),
    BadRequestException,
  );
});

test("register rejects unknown event types", async () => {
  const repo = createRepository();
  const { register } = createUseCases(repo);

  await assert.rejects(
    () =>
      register.execute({
        merchantId: "mrc_alice",
        url: "https://alice.example.com/hook",
        events: ["order.exploded" as never],
      }),
    BadRequestException,
  );
});

test("register rejects empty merchant id", async () => {
  const repo = createRepository();
  const { register } = createUseCases(repo);

  await assert.rejects(
    () =>
      register.execute({
        merchantId: "  ",
        url: "https://x.example.com/hook",
        events: ["order.created"],
      }),
    BadRequestException,
  );
});

test("register rejects invalid URL", async () => {
  const repo = createRepository();
  const { register } = createUseCases(repo);

  await assert.rejects(
    () =>
      register.execute({
        merchantId: "mrc_alice",
        url: "not-a-url",
        events: ["order.created"],
      }),
    BadRequestException,
  );
});

test("list filters subscriptions by merchantId (tenant boundary)", async () => {
  const repo = createRepository();
  const { register, list } = createUseCases(repo);

  await register.execute({
    merchantId: "mrc_alice",
    url: "https://alice.example.com/hook",
    events: ["order.created"],
  });
  await register.execute({
    merchantId: "mrc_bob",
    url: "https://bob.example.com/hook",
    events: ["order.fulfilled"],
  });
  await register.execute({
    merchantId: "mrc_alice",
    url: "https://alice.example.com/hook-2",
    events: ["order.updated"],
  });

  const aliceList = await list.execute("mrc_alice");
  const bobList = await list.execute("mrc_bob");

  assert.equal(aliceList.length, 2);
  assert.equal(bobList.length, 1);
  for (const record of aliceList) {
    assert.ok(record.subscription_id.startsWith("sub_"));
    assert.ok(!("secret" in record));
  }
  for (const record of bobList) {
    assert.ok(record.subscription_id.startsWith("sub_"));
  }

  const cross = await list.execute("mrc_other");
  assert.equal(cross.length, 0);
});

test("list rejects empty merchant id", async () => {
  const repo = createRepository();
  const { list } = createUseCases(repo);

  await assert.rejects(() => list.execute(""), BadRequestException);
  await assert.rejects(() => list.execute("   "), BadRequestException);
});

test("delete removes a subscription scoped by merchantId", async () => {
  const repo = createRepository();
  const { register, del } = createUseCases(repo);

  const created = await register.execute({
    merchantId: "mrc_alice",
    url: "https://alice.example.com/hook",
    events: ["order.created"],
  });

  await del.execute({ merchantId: "mrc_alice", id: created.subscription_id });
  const remaining = await repo.listByMerchant("mrc_alice");
  assert.equal(remaining.length, 0);
});

test("delete blocks cross-tenant deletion", async () => {
  const repo = createRepository();
  const { register, del } = createUseCases(repo);

  const created = await register.execute({
    merchantId: "mrc_alice",
    url: "https://alice.example.com/hook",
    events: ["order.created"],
  });

  await assert.rejects(
    () => del.execute({ merchantId: "mrc_bob", id: created.subscription_id }),
    NotFoundException,
  );

  const stillThere = await repo.listByMerchant("mrc_alice");
  assert.equal(stillThere.length, 1);
});

test("delete throws NotFound when subscription missing", async () => {
  const repo = createRepository();
  const { del } = createUseCases(repo);

  await assert.rejects(
    () => del.execute({ merchantId: "mrc_alice", id: "sub_does_not_exist" }),
    NotFoundException,
  );
});

test("delete rejects empty id", async () => {
  const repo = createRepository();
  const { del } = createUseCases(repo);

  await assert.rejects(
    () => del.execute({ merchantId: "mrc_alice", id: "  " }),
    BadRequestException,
  );
});

test("publish requires merchantId and forwards event to dispatcher", async () => {
  const repo = createRepository();
  const { register, publish, dispatcher } = createUseCases(repo);

  await register.execute({
    merchantId: "mrc_alice",
    url: "https://alice.example.com/hook",
    events: ["order.fulfilled"],
  });

  const result = (await publish.execute({
    merchantId: "mrc_alice",
    eventType: "order.fulfilled",
    data: {
      order_id: "ord_pub",
      status: "shipped",
      amount_cents: 5000,
      currency: "BRL",
      line_items: [{ id: "li_1", quantity: 1 }],
      fulfillment_status: "shipped",
    },
  })) as AcpPublishResult;

  assert.equal(result.enqueuedDeliveries, 1);
  assert.equal(typeof result.eventId, "string");
  assert.ok(result.eventId.startsWith("evt_"));
});

test("publish rejects empty merchantId", async () => {
  const repo = createRepository();
  const { publish } = createUseCases(repo);

  await assert.rejects(
    () =>
      publish.execute({
        merchantId: "",
        eventType: "order.created",
        data: {
          order_id: "ord_x",
          status: "created",
          amount_cents: 0,
          currency: "BRL",
          line_items: [],
          fulfillment_status: "pending",
        },
      }),
    BadRequestException,
  );
});
