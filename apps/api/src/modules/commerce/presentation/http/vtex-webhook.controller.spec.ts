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
import { VtexWebhookController } from "./vtex-webhook.controller.js";

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

function controller(connections: StubConnections, invalidated: string[] = []): VtexWebhookController {
  const factory = {
    invalidateAdapter: (merchantId: string) => invalidated.push(merchantId),
  } as unknown as TenantCommerceAdapterFactory;
  return new VtexWebhookController(
    connections,
    factory,
    new InMemoryCommercePaidWebhookDedup(),
  );
}

const vtexCreds: MerchantCommerceCredentials = {
  merchantId: "mrc_1",
  provider: "vtex",
  accountName: "mystore",
  appKey: "vtex_key_12345678",
  appToken: "vtex_token_abcdef12345",
};

test("VTEX webhook routes payment-approved and dispatches paid event", async () => {
  const invalidated: string[] = [];
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: (merchantId: string) => invalidated.push(merchantId) } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new VtexWebhookController(
    new StubConnections({ mrc_1: vtexCreds }),
    factory,
    dedup,
  );

  const result = await ctrl.handleWebhook("mrc_1", {
    orderId: "order-123",
    status: "payment-approved",
    accountName: "mystore",
  });

  assert.deepEqual(result, { outcome: "processed", event: "order.payment-approved" });
  assert.deepEqual(invalidated, ["mrc_1"]);
  assert.equal(await dedup.isProcessed("mrc_1", "vtex:order-123:payment-approved"), true);
});

test("VTEX webhook rejects unknown merchant", async () => {
  await assert.rejects(
    () => controller(new StubConnections({})).handleWebhook(
      "mrc_missing",
      { orderId: "order-1", status: "payment-approved" },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "vtex_webhook_merchant_not_found",
  );
});

test("VTEX webhook rejects mismatched accountName", async () => {
  await assert.rejects(
    () => controller(new StubConnections({ mrc_1: vtexCreds })).handleWebhook(
      "mrc_1",
      { orderId: "order-1", status: "payment-approved", accountName: "wrongstore" },
    ),
    (error: unknown) => error instanceof UnauthorizedException && error.message === "vtex_webhook_account_name_mismatch",
  );
});

test("VTEX webhook routes order-created and ignores unknown status", async () => {
  const invalidated: string[] = [];
  const ctrl = controller(new StubConnections({ mrc_1: vtexCreds }), invalidated);

  const created = await ctrl.handleWebhook("mrc_1", {
    orderId: "order-1",
    status: "order-created",
    accountName: "mystore",
  });
  const unknown = await ctrl.handleWebhook("mrc_1", {
    orderId: "order-2",
    status: "some-unknown-status",
    accountName: "mystore",
  });

  assert.deepEqual(created, { outcome: "processed", event: "order.order-created" });
  assert.deepEqual(unknown, { outcome: "ignored", reason: "unhandled_status:some-unknown-status" });
  assert.deepEqual(invalidated, ["mrc_1"]);
});

test("VTEX webhook deduplicates paid events", async () => {
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const factory = { invalidateAdapter: () => {} } as unknown as TenantCommerceAdapterFactory;
  const ctrl = new VtexWebhookController(
    new StubConnections({ mrc_1: vtexCreds }),
    factory,
    dedup,
  );

  await ctrl.handleWebhook("mrc_1", {
    orderId: "order-dup",
    status: "payment-approved",
    accountName: "mystore",
  });
  const second = await ctrl.handleWebhook("mrc_1", {
    orderId: "order-dup",
    status: "payment-approved",
    accountName: "mystore",
  });

  assert.deepEqual(second, { outcome: "processed", event: "order.payment-approved" });
  // Dedup ensures same payment ref is only processed once
  assert.equal(await dedup.isProcessed("mrc_1", "vtex:order-dup:payment-approved"), true);
});
