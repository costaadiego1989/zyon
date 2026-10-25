import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AcpWebhooksController } from "./acp-webhooks.controller.js";
import {
  DeleteAcpWebhookSubscriptionUseCase,
  ListAcpWebhookSubscriptionsUseCase,
  RegisterAcpWebhookSubscriptionUseCase,
} from "../application/acp-webhook-subscription.use-cases.js";
import type {
  AcpWebhookSubscriptionCreated,
  AcpWebhookSubscriptionPublic,
} from "../acp-webhook-event.types.js";

function makeStubs(): {
  register: RegisterAcpWebhookSubscriptionUseCase;
  list: ListAcpWebhookSubscriptionsUseCase;
  del: DeleteAcpWebhookSubscriptionUseCase;
} {
  const registerStub: Pick<RegisterAcpWebhookSubscriptionUseCase, "execute"> = {
    async execute(input): Promise<AcpWebhookSubscriptionCreated> {
      return {
        subscription_id: `sub_${input.merchantId}_${input.url.length}`,
        url: input.url,
        events: input.events,
        created_at: "2026-09-03T00:00:00.000Z",
        secret: "whsec_stub_secret",
      };
    },
  };

  const listStub: Pick<ListAcpWebhookSubscriptionsUseCase, "execute"> = {
    async execute(merchantId): Promise<AcpWebhookSubscriptionPublic[]> {
      if (merchantId === "mrc_empty") return [];
      if (merchantId === "mrc_error") {
        throw new BadRequestException("merchant_id_required");
      }
      return [
        {
          subscription_id: "sub_a",
          url: "https://a.example.com/h",
          events: ["order.created"],
          created_at: "2026-09-03T00:00:00.000Z",
        },
        {
          subscription_id: "sub_b",
          url: "https://a.example.com/h2",
          events: ["order.updated", "order.fulfilled"],
          created_at: "2026-09-03T00:00:01.000Z",
        },
      ];
    },
  };

  const deleteStub: Pick<DeleteAcpWebhookSubscriptionUseCase, "execute"> = {
    async execute({ merchantId, id }) {
      if (id === "sub_missing") throw new NotFoundException("acp_webhook_subscription_not_found");
      if (!merchantId) throw new BadRequestException("merchant_id_required");
    },
  };

  return {
    register: registerStub as unknown as RegisterAcpWebhookSubscriptionUseCase,
    list: listStub as unknown as ListAcpWebhookSubscriptionsUseCase,
    del: deleteStub as unknown as DeleteAcpWebhookSubscriptionUseCase,
  };
}

function buildController(): AcpWebhooksController {
  const stubs = makeStubs();
  return new AcpWebhooksController(stubs.register, stubs.list, stubs.del);
}

test("controller.register delegates to registerUseCase and returns DTO with secret", async () => {
  const controller = buildController();
  const result = await controller.register(
    {
      url: "https://example.com/hook",
      events: ["order.created"],
      merchant_id: "mrc_alice",
    },
    undefined,
  );

  assert.ok(result.subscription_id.startsWith("sub_mrc_alice_"));
  assert.ok(result.subscription_id.endsWith("_24"));
  assert.equal(result.url, "https://example.com/hook");
  assert.deepEqual(result.events, ["order.created"]);
  assert.equal(result.secret, "whsec_stub_secret");
  assert.equal(result.created_at, "2026-09-03T00:00:00.000Z");
});

test("controller.register falls back to x-aacp-merchant-id header when body omits it", async () => {
  const controller = buildController();
  const result = await controller.register(
    {
      url: "https://h.example.com",
      events: ["order.fulfilled"],
      merchant_id: undefined,
    },
    "mrc_header_only",
  );

  assert.ok(result.subscription_id.startsWith("sub_mrc_header_only_"));
  assert.equal(result.url, "https://h.example.com");
});

test("controller.register rejects when no merchant id is supplied", async () => {
  const controller = buildController();

  await assert.rejects(
    () =>
      controller.register(
        {
          url: "https://h.example.com",
          events: ["order.created"],
          merchant_id: undefined,
        },
        undefined,
      ),
    BadRequestException,
  );
});

test("controller.list maps records to view DTOs", async () => {
  const controller = buildController();
  const result = await controller.list("mrc_alice");

  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].subscription_id, "sub_a");
  assert.deepEqual(result.data[0].events, ["order.created"]);
  assert.equal(result.data[1].subscription_id, "sub_b");
  assert.deepEqual(result.data[1].events, ["order.updated", "order.fulfilled"]);
  assert.equal((result.data[0] as { secret?: string }).secret, undefined);
});

test("controller.list returns empty array for merchant with no subscriptions", async () => {
  const controller = buildController();
  const result = await controller.list("mrc_empty");
  assert.deepEqual(result.data, []);
});

test("controller.list rejects missing merchant id", async () => {
  const controller = buildController();
  await assert.rejects(() => controller.list(undefined), BadRequestException);
});

test("controller.delete delegates and returns deleted response", async () => {
  const controller = buildController();
  const result = await controller.delete("sub_a", "mrc_alice");
  assert.deepEqual(result, { deleted: true, subscription_id: "sub_a" });
});

test("controller.delete propagates NotFound from use case", async () => {
  const controller = buildController();
  await assert.rejects(
    () => controller.delete("sub_missing", "mrc_alice"),
    NotFoundException,
  );
});
