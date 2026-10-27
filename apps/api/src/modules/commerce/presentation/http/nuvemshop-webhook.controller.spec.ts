import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type {
  CommerceConnectionPort,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput,
} from "../../domain/ports/commerce-connection.port.js";
import { InMemoryCommercePaidWebhookDedup } from "../../infrastructure/in-memory-commerce-paid-webhook-dedup.js";
import type { TenantCommerceAdapterFactory } from "../../infrastructure/tenant-commerce-adapter.factory.js";
import { NuvemshopWebhookController } from "./nuvemshop-webhook.controller.js";

class StubConnections implements CommerceConnectionPort {
  constructor(private readonly byMerchant: Record<string, MerchantCommerceCredentials>) {}
  async getCredentials(merchantId: string): Promise<MerchantCommerceCredentials | undefined> {
    return this.byMerchant[merchantId.trim()];
  }
  async getConnection(): Promise<undefined> { return undefined; }
  async saveCredentials(_input: SaveMerchantCommerceCredentialsInput): Promise<void> {}
  async updateHealth(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

function controller(connections: StubConnections, invalidated: string[] = []): NuvemshopWebhookController {
  const factory = {
    invalidateAdapter: (merchantId: string) => invalidated.push(merchantId),
  } as unknown as TenantCommerceAdapterFactory;
  return new NuvemshopWebhookController(
    connections,
    factory,
    new InMemoryCommercePaidWebhookDedup(),
  );
}

const nuvemshopCreds: MerchantCommerceCredentials = {
  merchantId: "mrc_1",
  provider: "nuvemshop",
  storeId: "1234567",
  accessToken: "nuvemshop_access_token_1234567890",
};

test("Nuvemshop webhook validates store_id and routes order/created", async () => {
  const invalidated: string[] = [];
  const result = await controller(new StubConnections({ mrc_1: nuvemshopCreds }), invalidated)
    .handleWebhook("mrc_1", undefined, { store_id: "1234567", event: "order/created", id: 10 });

  assert.deepEqual(result, { outcome: "processed", event: "order/created" });
  assert.deepEqual(invalidated, ["mrc_1"]);
});

test("Nuvemshop webhook rejects unknown merchant", async () => {
  await assert.rejects(
    () => controller(new StubConnections({})).handleWebhook(
      "mrc_missing",
      undefined,
      { store_id: "1234567", event: "order/created", id: 10 },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "nuvemshop_webhook_merchant_not_found",
  );
});

test("Nuvemshop webhook rejects mismatched store_id", async () => {
  await assert.rejects(
    () => controller(new StubConnections({ mrc_1: nuvemshopCreds })).handleWebhook(
      "mrc_1",
      undefined,
      { store_id: "9999999", event: "order/created", id: 10 },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "nuvemshop_webhook_store_id_mismatch",
  );
});

test("Nuvemshop webhook routes product/updated and ignores unknown event", async () => {
  const invalidated: string[] = [];
  const ctrl = controller(new StubConnections({ mrc_1: nuvemshopCreds }), invalidated);

  const updated = await ctrl.handleWebhook("mrc_1", undefined, {
    store_id: 1234567,
    event: "product/updated",
    id: 77,
  });
  const unknown = await ctrl.handleWebhook("mrc_1", undefined, {
    store_id: "1234567",
    event: "customer/created",
    id: 88,
  });

  assert.deepEqual(updated, { outcome: "processed", event: "product/updated" });
  assert.deepEqual(unknown, { outcome: "ignored", reason: "unhandled_event:customer/created" });
  assert.deepEqual(invalidated, ["mrc_1"]);
});

test("Nuvemshop order/paid invalidates cache and records paid domain event", async () => {
  const invalidated: string[] = [];
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: (merchantId: string) => invalidated.push(merchantId) } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new NuvemshopWebhookController(
    new StubConnections({ mrc_1: nuvemshopCreds }),
    factory,
    dedup,
  );

  const result = await ctrl.handleWebhook("mrc_1", undefined, {
    store_id: "1234567",
    event: "order/paid",
    id: 55,
  });

  assert.deepEqual(result, { outcome: "processed", event: "order/paid" });
  assert.deepEqual(invalidated, ["mrc_1"]);
  assert.equal(await dedup.isProcessed("mrc_1", "nuvemshop:55:order/paid"), true);
});

const nuvemshopCredsWithSecret: MerchantCommerceCredentials = {
  merchantId: "mrc_2",
  provider: "nuvemshop",
  storeId: "1234567",
  accessToken: "nuvemshop_access_token_1234567890",
  webhookSecret: "whsec_test_secret",
};

test("Nuvemshop webhook rejects missing HMAC when secret configured", async () => {
  await assert.rejects(
    () => controller(new StubConnections({ mrc_2: nuvemshopCredsWithSecret })).handleWebhook(
      "mrc_2",
      undefined,
      { store_id: "1234567", event: "order/created", id: 10 },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "nuvemshop_webhook_hmac_missing",
  );
});

test("Nuvemshop webhook rejects invalid HMAC when secret configured", async () => {
  await assert.rejects(
    () => controller(new StubConnections({ mrc_2: nuvemshopCredsWithSecret })).handleWebhook(
      "mrc_2",
      "deadbeef",
      { store_id: "1234567", event: "order/created", id: 10 },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "nuvemshop_webhook_hmac_invalid",
  );
});

test("Nuvemshop webhook accepts valid HMAC when secret configured", async () => {
  const { createHmac } = await import("node:crypto");
  const body = { store_id: "1234567", event: "order/created", id: 10 };
  const validHmac = createHmac("sha256", "whsec_test_secret")
    .update(JSON.stringify(body), "utf8")
    .digest("hex");

  const result = await controller(new StubConnections({ mrc_2: nuvemshopCredsWithSecret }))
    .handleWebhook("mrc_2", validHmac, body);

  assert.deepEqual(result, { outcome: "processed", event: "order/created" });
});
