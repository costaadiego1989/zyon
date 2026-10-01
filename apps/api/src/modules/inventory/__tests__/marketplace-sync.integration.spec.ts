import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ErpOAuthController } from "../presentation/http/erp-oauth.controller.js";
import { ErpSyncService } from "../application/services/erp-sync.service.js";
import { PrismaInventorySaleRepository } from "../infrastructure/repositories/prisma-inventory-sale.repository.js";
import { encryptErpSecret, decryptErpSecret } from "../infrastructure/adapters/erp-secret-cipher.js";

const databaseUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
describe("marketplace durable sync and isolation (disposable PostgreSQL, provider contracts mocked)", { skip: !databaseUrl }, () => {
  let prisma: PrismaClient;
  const merchants: string[] = [];
  const fetchOriginal = globalThis.fetch;
  const priorEnv = new Map<string, string | undefined>();
  before(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/zyon_marketplace_validation") throw new Error("disposable_marketplace_database_required");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    for (const [key, value] of Object.entries({ MERCADOLIVRE_APP_ID: "test-app", MERCADOLIVRE_CLIENT_SECRET: "test-secret", MERCADOLIVRE_REDIRECT_URI: "https://api.example.com/callback", SHOPEE_PARTNER_ID: "123", SHOPEE_PARTNER_KEY: "test-secret", SHOPEE_REDIRECT_URI: "https://api.example.com/callback", TIKTOKSHOP_APP_KEY: "test-app", TIKTOKSHOP_APP_SECRET: "test-secret", TIKTOKSHOP_SERVICE_ID: "test-service", TIKTOKSHOP_REDIRECT_URI: "https://api.example.com/callback" })) {
      priorEnv.set(key, process.env[key]); process.env[key] = value;
    }
  });
  after(async () => {
    globalThis.fetch = fetchOriginal;
    for (const [key, value] of priorEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (!prisma) return;
    await prisma.outboxMessage.deleteMany({ where: { merchantId: { in: merchants } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchants } } });
    await prisma.$disconnect();
  });
  async function merchant() {
    const id = `marketplace_test_${randomUUID()}`;
    merchants.push(id);
    await prisma.merchant.create({ data: { id, name: "Marketplace fixture" } });
    return id;
  }
  function mockProvider(provider: string, quantity = 7) {
    let listing = 0;
    const writes: any[] = [];
    globalThis.fetch = (async (urlInput: any, init?: RequestInit) => {
      const url = new URL(String(urlInput));
      let body: unknown;
      if (init?.method === "PUT" || url.pathname.endsWith("update_stock") || url.pathname.endsWith("inventory/update")) {
        writes.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
        body = provider === "mercadolivre" ? { available_quantity: 5 } : provider === "shopee" ? { error: "", response: { failure_list: [] } } : { code: 0, data: {} };
      } else if (url.pathname === "/oauth/token") body = { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, user_id: 456 };
      else if (url.pathname === "/users/me") body = { id: 456, nickname: "Seller" };
      else if (url.pathname === "/api/v2/auth/token/get") body = { error: "", access_token: "test-access", refresh_token: "test-refresh", expire_in: 3600, shop_id_list: [456] };
      else if (url.pathname.endsWith("get_shop_info")) body = { error: "", shop_id: 456, shop_name: "Seller" };
      else if (url.pathname === "/api/v2/token/get") body = { code: 0, data: { user_type: 0, access_token: "test-access", refresh_token: "test-refresh", access_token_expire_in: Math.floor(Date.now() / 1000) + 3600 } };
      else if (url.pathname.endsWith("shops")) body = { code: 0, data: { shops: [{ id: "456", name: "Seller", cipher: "cipher" }] } };
      else if (url.pathname.endsWith("get_item_list")) body = { error: "", response: { item: [{ item_id: 100 }], has_next_page: false } };
      else if (url.pathname.endsWith("get_item_base_info")) body = { error: "", response: { item_list: [{ item_id: 100, item_name: "Fixture", has_model: false, item_sku: "SKU", stock_info_v2: { summary_info: { total_available_stock: quantity }, seller_stock: [{ stock: quantity }] }, price_info: [{ current_price: 10 }] }] } };
      else if (provider === "tiktokshop") body = { code: 0, data: { products: [{ id: "100", title: "Fixture", skus: [{ id: "200", seller_sku: "SKU", price: { currency: "BRL", sale_price: "10" }, inventory: [{ warehouse_id: "300", quantity }] }] }] } };
      else if (url.pathname.endsWith("search")) body = { results: listing++ === 0 ? ["MLB100"] : [], scroll_id: "cursor" };
      else body = [{ code: 200, body: { id: "MLB100", seller_id: 456, title: "Fixture", seller_custom_field: "SKU", available_quantity: quantity, price: 10, currency_id: "BRL" } }];
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    return writes;
  }
  for (const provider of ["mercadolivre", "shopee", "tiktokshop"]) {
    it(`${provider}: real OAuth persistence, repeatable catalog import, isolation and mapped post-sale stock`, async () => {
      const merchantId = await merchant();
      const otherMerchant = await merchant();
      mockProvider(provider);
      const initial: any[] = [];
      const controller = new ErpOAuthController(prisma, { execute: async (input: any) => { initial.push(input); } } as never, {} as never);
      const state = new URL((await controller.authorize({ user: { merchantId } }, provider)).url).searchParams.get("state")!;
      const redirects: string[] = [];
      await controller.callback("test-code", state, { redirect: (_: number, url: string) => redirects.push(url) }, provider === "shopee" ? "456" : undefined);
      assert.equal(new URL(redirects[0]).searchParams.get("erp_connected"), provider);
      const connection = await prisma.erpConnection.findUniqueOrThrow({ where: { merchantId_provider: { merchantId, provider } } });
      assert.equal(decryptErpSecret(connection.accessTokenCipher!), "test-access");
      assert.equal(initial[0].connectionId, connection.id);
      const conflictState = new URL((await controller.authorize({ user: { merchantId: otherMerchant } }, provider)).url).searchParams.get("state")!;
      await controller.callback("test-code", conflictState, { redirect: (_: number, url: string) => redirects.push(url) }, provider === "shopee" ? "456" : undefined);
      assert.equal(new URL(redirects[1]).searchParams.get("error"), "erp_marketplace_account_already_connected");
      assert.equal(await prisma.erpConnection.count({ where: { merchantId: otherMerchant } }), 0);

      const sync = new ErpSyncService(prisma);
      // Tests drive the durable worker explicitly instead of racing the kick.
      (sync as any).kick = () => {};
      await assert.rejects(() => sync.enqueueFull(otherMerchant, connection.id), /connection_not_found/);
      const firstJob = await sync.enqueueFull(merchantId, connection.id, "initial");
      await sync.drain();
      assert.equal((await prisma.erpSyncJob.findUniqueOrThrow({ where: { id: firstJob.id } })).status, "completed");
      const mapping = await prisma.erpProductMapping.findFirstOrThrow({ where: { merchantId, connectionId: connection.id } });
      const imported = await prisma.productVariant.findUniqueOrThrow({ where: { id: mapping.variantId! }, include: { product: true, stock: true, price: true } });
      assert.equal(imported.product.isActive, false);
      assert.equal(imported.stock[0].quantity, 7);
      assert.equal(imported.price?.basePriceInCents, 1000);
      const movements = await prisma.inventoryMovement.count({ where: { merchantId } });
      mockProvider(provider);
      await sync.enqueueFull(merchantId, connection.id);
      await sync.drain();
      assert.equal(await prisma.product.count({ where: { merchantId } }), 1);
      assert.equal(await prisma.erpProductMapping.count({ where: { merchantId } }), 1);
      assert.equal(await prisma.inventoryMovement.count({ where: { merchantId } }), movements);
      const sale = await new PrismaInventorySaleRepository(prisma).apply({ merchantId, orderId: `sale_${randomUUID()}`, items: [{ sku: "SKU", quantity: 2 }], totalCents: 2000, timestamp: new Date().toISOString() });
      // Before an older delivery is retried, another order and reservation can
      // change availability. The external writer must use today's balance.
      await new PrismaInventorySaleRepository(prisma).apply({ merchantId, orderId: `later_${randomUUID()}`, items: [{ sku: "SKU", quantity: 1 }], totalCents: 1000, timestamp: new Date().toISOString() });
      await prisma.inventoryItem.updateMany({ where: { merchantId, sku: "SKU" }, data: { reserved: 1 } });
      const writes = mockProvider(provider);
      await sync.enqueueSale(sale);
      await sync.enqueueSale(sale);
      await sync.drain();
      assert.equal(await prisma.erpSyncJob.count({ where: { merchantId, kind: "sale" } }), 1);
      assert.equal(writes.length, 1);
      const quantity = provider === "mercadolivre" ? writes[0].body.available_quantity : provider === "shopee" ? writes[0].body.stock_list[0].seller_stock[0].stock : writes[0].body.skus[0].inventory[0].quantity;
      assert.equal(quantity, 3);
      assert.equal(await prisma.inventoryItem.count({ where: { merchantId: otherMerchant } }), 0);
      // Release the provider identity to keep independent test cases isolated.
      await prisma.erpConnection.delete({ where: { id: connection.id } });
    });
  }

  it("simultaneous refreshes through two workers rotate the token exactly once", async () => {
    const merchantId = await merchant();
    const connection = await prisma.erpConnection.create({ data: { merchantId, provider: "mercadolivre", status: "connected", config: { sellerId: "456" }, accessTokenCipher: encryptErpSecret("expired"), refreshTokenCipher: encryptErpSecret("old-refresh"), tokenExpiresAt: new Date(0) } });
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, user_id: 456 })); }) as typeof fetch;
    const one = new ErpSyncService(prisma), two = new ErpSyncService(prisma);
    const result = await Promise.all([(one as any).marketplaceToken(connection), (two as any).marketplaceToken(connection)]);
    assert.deepEqual(result, ["new-access", "new-access"]);
    assert.equal(calls, 1);
    const updated = await prisma.erpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    assert.equal(decryptErpSecret(updated.refreshTokenCipher!), "new-refresh");
  });

  it("two workers cannot run two stock jobs for the same connection simultaneously", async () => {
    const merchantId = await merchant();
    const connection = await prisma.erpConnection.create({ data: { merchantId, provider: "shopee", status: "connected", directionMode: "erp_source_of_truth" } });
    const jobs = await Promise.all(["one", "two"].map(key => prisma.erpSyncJob.create({ data: { merchantId, connectionId: connection.id, kind: "full", status: "queued", dedupeKey: `${merchantId}:${key}` } })));
    const one = new ErpSyncService(prisma), two = new ErpSyncService(prisma);
    let active = 0, maximum = 0, calls = 0;
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pull = async () => { calls++; active++; maximum = Math.max(maximum, active); started(); if (calls === 1) await gate; active--; return []; };
    (one as any).pullSnapshots = pull;
    (two as any).pullSnapshots = pull;
    const first = (one as any).process(jobs[0].id);
    await entered;
    await (two as any).process(jobs[1].id);
    assert.equal(calls, 1);
    assert.equal((await prisma.erpSyncJob.findUniqueOrThrow({ where: { id: jobs[1].id } })).status, "queued");
    release(); await first;
    await (two as any).process(jobs[1].id);
    assert.equal(calls, 2);
    assert.equal(maximum, 1);
  });
});
