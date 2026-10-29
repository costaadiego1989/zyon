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
import { TrayWebhookController } from "./tray-webhook.controller.js";

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

function controller(connections: StubConnections, invalidated: string[] = []): TrayWebhookController {
  const factory = {
    invalidateAdapter: (merchantId: string) => invalidated.push(merchantId),
  } as unknown as TenantCommerceAdapterFactory;
  return new TrayWebhookController(
    connections,
    factory,
    new InMemoryCommercePaidWebhookDedup(),
  );
}

const trayCreds: MerchantCommerceCredentials = {
  merchantId: "mrc_tray_1",
  provider: "tray",
  apiAddress: "https://store.com.br/web_api",
  accessToken: "tray_access_token_abc123",
  refreshToken: "tray_refresh_token_xyz",
  accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
  consumerKey: "tray_ck",
  consumerSecret: "tray_cs",
};

test("Tray webhook routes order update event", async () => {
  const invalidated: string[] = [];
  const result = await controller(new StubConnections({ mrc_tray_1: trayCreds }), invalidated)
    .handleWebhook("mrc_tray_1", {
      scope_name: "order",
      act: "update",
      scope_id: 123,
      seller_id: 999,
    });

  assert.deepEqual(result, { outcome: "processed", scope: "order", action: "update" });
  assert.deepEqual(invalidated, ["mrc_tray_1"]);
});

test("Tray webhook rejects unknown merchant", async () => {
  await assert.rejects(
    () => controller(new StubConnections({})).handleWebhook(
      "mrc_missing",
      { scope_name: "order", act: "update", scope_id: 123 },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "tray_webhook_merchant_not_found",
  );
});

test("Tray webhook rejects non-tray provider", async () => {
  const nonTrayCreds: MerchantCommerceCredentials = {
    merchantId: "mrc_shopify",
    provider: "shopify",
    shopDomain: "store.myshopify.com",
    adminAccessToken: "token",
  };
  await assert.rejects(
    () => controller(new StubConnections({ mrc_shopify: nonTrayCreds })).handleWebhook(
      "mrc_shopify",
      { scope_name: "order", act: "update", scope_id: 123 },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "tray_webhook_merchant_not_found",
  );
});

test("Tray webhook routes product events", async () => {
  const invalidated: string[] = [];
  const ctrl = controller(new StubConnections({ mrc_tray_1: trayCreds }), invalidated);

  const created = await ctrl.handleWebhook("mrc_tray_1", {
    scope_name: "product",
    act: "insert",
    scope_id: 456,
  });
  const updated = await ctrl.handleWebhook("mrc_tray_1", {
    scope_name: "product_stock",
    act: "update",
    scope_id: 789,
  });

  assert.deepEqual(created, { outcome: "processed", scope: "product", action: "insert" });
  assert.deepEqual(updated, { outcome: "processed", scope: "product_stock", action: "update" });
  assert.deepEqual(invalidated, ["mrc_tray_1", "mrc_tray_1"]);
});

test("Tray webhook ignores unknown scope", async () => {
  const result = await controller(new StubConnections({ mrc_tray_1: trayCreds })).handleWebhook(
    "mrc_tray_1",
    { scope_name: "unknown_scope", act: "insert", scope_id: 999 },
  );

  assert.deepEqual(result, { outcome: "ignored", reason: "unhandled_scope:unknown_scope:insert" });
});

test("Tray order update with status 'invoiced' dispatches paid event", async () => {
  const invalidated: string[] = [];
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: (merchantId: string) => invalidated.push(merchantId) } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new TrayWebhookController(
    new StubConnections({ mrc_tray_1: trayCreds }),
    factory,
    dedup,
  );

  const result = await ctrl.handleWebhook("mrc_tray_1", {
    scope_name: "order",
    act: "update",
    scope_id: 555,
    status: "invoiced",
  });

  assert.deepEqual(result, { outcome: "processed", scope: "order", action: "update" });
  assert.deepEqual(invalidated, ["mrc_tray_1"]);
  assert.equal(await dedup.isProcessed("mrc_tray_1", "tray:555:order.update"), true);
});

test("Tray order update with status 'paid' dispatches paid event", async () => {
  const invalidated: string[] = [];
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: (merchantId: string) => invalidated.push(merchantId) } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new TrayWebhookController(
    new StubConnections({ mrc_tray_1: trayCreds }),
    factory,
    dedup,
  );

  const result = await ctrl.handleWebhook("mrc_tray_1", {
    scope_name: "order",
    act: "update",
    scope_id: 666,
    status: "paid",
  });

  assert.deepEqual(result, { outcome: "processed", scope: "order", action: "update" });
  assert.equal(await dedup.isProcessed("mrc_tray_1", "tray:666:order.update"), true);
});

test("Tray order update with non-payment status does not dispatch paid event", async () => {
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: () => {} } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new TrayWebhookController(
    new StubConnections({ mrc_tray_1: trayCreds }),
    factory,
    dedup,
  );

  await ctrl.handleWebhook("mrc_tray_1", {
    scope_name: "order",
    act: "update",
    scope_id: 777,
    status: "open",
  });

  assert.equal(await dedup.isProcessed("mrc_tray_1", "tray:777:order.update"), false);
});
