import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type {
  CommerceConnectionPort,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput,
} from "../../domain/ports/commerce-connection.port.js";
import { InMemoryCommercePaidWebhookDedup } from "../../infrastructure/in-memory-commerce-paid-webhook-dedup.js";
import type { TenantCommerceAdapterFactory } from "../../infrastructure/tenant-commerce-adapter.factory.js";
import { ShopifyWebhookController } from "./shopify-webhook.controller.js";

class StubConnections implements CommerceConnectionPort {
  public disconnected: string[] = [];
  constructor(private readonly byMerchant: Record<string, MerchantCommerceCredentials>) {}
  async getCredentials(merchantId: string): Promise<MerchantCommerceCredentials | undefined> {
    return this.byMerchant[merchantId.trim()];
  }
  async getConnection(): Promise<undefined> { return undefined; }
  async saveCredentials(_input: SaveMerchantCommerceCredentialsInput): Promise<void> {}
  async updateHealth(): Promise<void> {}
  async disconnect(merchantId: string): Promise<void> { this.disconnected.push(merchantId.trim()); }
}

function req(merchantId: string, rawBody: Buffer): RawBodyRequest<Request> {
  return { params: { merchantId }, rawBody } as unknown as RawBodyRequest<Request>;
}

function signature(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function controller(connections: StubConnections, invalidated: string[] = []): ShopifyWebhookController {
  const factory = {
    invalidateAdapter: (merchantId: string) => invalidated.push(merchantId),
  } as unknown as TenantCommerceAdapterFactory;
  return new ShopifyWebhookController(
    connections,
    factory,
    new InMemoryCommercePaidWebhookDedup(),
  );
}

const shopifyCreds: MerchantCommerceCredentials = {
  merchantId: "mrc_1",
  provider: "shopify",
  shopDomain: "merchant.myshopify.com",
  adminAccessToken: "shpat_admin_secret",
  webhookSecret: "shopify_client_secret",
};

test("Shopify webhook verifies valid HMAC and routes orders/create", async () => {
  const payload = Buffer.from(JSON.stringify({ id: 123 }));
  const invalidated: string[] = [];
  const result = await controller(new StubConnections({ mrc_1: shopifyCreds }), invalidated)
    .handleWebhook(
      req("mrc_1", payload),
      signature(payload, "shopify_client_secret"),
      "orders/create",
      "merchant.myshopify.com",
      "wh_1",
    );

  assert.deepEqual(result, { outcome: "processed", topic: "orders/create" });
  assert.deepEqual(invalidated, ["mrc_1"]);
});

test("Shopify webhook rejects missing HMAC", async () => {
  const payload = Buffer.from(JSON.stringify({ id: 123 }));
  await assert.rejects(
    () => controller(new StubConnections({ mrc_1: shopifyCreds })).handleWebhook(
      req("mrc_1", payload),
      undefined,
      "orders/create",
      "merchant.myshopify.com",
      "wh_1",
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "shopify_webhook_signature_missing",
  );
});

test("Shopify webhook rejects invalid HMAC", async () => {
  const payload = Buffer.from(JSON.stringify({ id: 123 }));
  await assert.rejects(
    () => controller(new StubConnections({ mrc_1: shopifyCreds })).handleWebhook(
      req("mrc_1", payload),
      signature(Buffer.from(JSON.stringify({ id: 456 })), "shopify_client_secret"),
      "orders/create",
      "merchant.myshopify.com",
      "wh_1",
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "shopify_webhook_signature_invalid",
  );
});

test("Shopify webhook routes products/update and ignores unknown topics", async () => {
  const payload = Buffer.from(JSON.stringify({ id: 123 }));
  const invalidated: string[] = [];
  const ctrl = controller(new StubConnections({ mrc_1: shopifyCreds }), invalidated);

  const updated = await ctrl.handleWebhook(
    req("mrc_1", payload),
    signature(payload, "shopify_client_secret"),
    "products/update",
    "merchant.myshopify.com",
    "wh_2",
  );
  const unknown = await ctrl.handleWebhook(
    req("mrc_1", payload),
    signature(payload, "shopify_client_secret"),
    "customers/create",
    "merchant.myshopify.com",
    "wh_3",
  );

  assert.deepEqual(updated, { outcome: "processed", topic: "products/update" });
  assert.deepEqual(unknown, { outcome: "ignored", reason: "unhandled_topic:customers/create" });
  assert.deepEqual(invalidated, ["mrc_1"]);
});

test("Shopify webhook rejects unknown merchant", async () => {
  const payload = Buffer.from(JSON.stringify({ id: 123 }));
  await assert.rejects(
    () => controller(new StubConnections({})).handleWebhook(
      req("mrc_missing", payload),
      signature(payload, "shopify_client_secret"),
      "orders/create",
      "merchant.myshopify.com",
      "wh_1",
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "shopify_webhook_merchant_not_found",
  );
});

test("Shopify orders/paid invalidates cache and records paid domain event", async () => {
  const payload = Buffer.from(JSON.stringify({ id: 9876 }));
  const invalidated: string[] = [];
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: (merchantId: string) => invalidated.push(merchantId) } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new ShopifyWebhookController(new StubConnections({ mrc_1: shopifyCreds }), factory, dedup);

  const result = await ctrl.handleWebhook(
    req("mrc_1", payload),
    signature(payload, "shopify_client_secret"),
    "orders/paid",
    "merchant.myshopify.com",
    "wh_paid_1",
  );

  assert.deepEqual(result, { outcome: "processed", topic: "orders/paid" });
  assert.deepEqual(invalidated, ["mrc_1"]);
  assert.equal(await dedup.isProcessed("mrc_1", "shopify:wh_paid_1"), true);
});
