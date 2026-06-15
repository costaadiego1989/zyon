import test from "node:test";
import assert from "node:assert/strict";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import type {
  CommerceConnectionPort,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput
} from "../domain/ports/commerce-connection.port.js";
import { TenantCommerceAdapterFactory } from "./tenant-commerce-adapter.factory.js";

class StubConnections implements CommerceConnectionPort {
  constructor(private readonly byMerchant: Record<string, MerchantCommerceCredentials>) {}
  async getCredentials(merchantId: string): Promise<MerchantCommerceCredentials | undefined> {
    return this.byMerchant[merchantId.trim()];
  }
  async getConnection(): Promise<undefined> {
    return undefined;
  }
  async saveCredentials(_input: SaveMerchantCommerceCredentialsInput): Promise<void> {}
  async updateHealth(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tenantCreds(shopDomain: string, token: string): MerchantCommerceCredentials {
  return { merchantId: "m1", provider: "shopify", shopDomain, adminAccessToken: token };
}

test("routes order creation to the tenant's own shop domain and token", async () => {
  const seen: { url: string; token?: string }[] = [];
  const http = new HttpClientService({
    fetchFn: async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url, token: headers["X-Shopify-Access-Token"] });
      return jsonResponse({ draft_order: { id: 555 } });
    }
  });
  const connections = new StubConnections({ m1: tenantCreds("tenant-one.myshopify.com", "shpat_one") });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  const result = await factory.createPendingOrder({
    merchantId: "m1",
    sessionId: "s1",
    cart: { currency: "BRL", totalCents: 9900, lines: [], commerceCartRef: "c1" }
  });

  assert.equal(result.commerceOrderId, "555");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith("https://tenant-one.myshopify.com/admin/api/"));
  assert.equal(seen[0].token, "shpat_one");
});

test("fails safe in production when merchant has no connection", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const prevToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  process.env.NODE_ENV = "production";
  process.env.SHOPIFY_SHOP_DOMAIN = "global.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_global";
  try {
    const http = new HttpClientService({ fetchFn: async () => jsonResponse({}) });
    const factory = new TenantCommerceAdapterFactory(new StubConnections({}), http);
    await assert.rejects(
      () => factory.validateCart({ merchantId: "m_unknown", commerceCartRef: "c1" }),
      /commerce_connection_not_configured_for_merchant/
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevDomain === undefined) delete process.env.SHOPIFY_SHOP_DOMAIN;
    else process.env.SHOPIFY_SHOP_DOMAIN = prevDomain;
    if (prevToken === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = prevToken;
  }
});

test("distinct merchants never share credentials", async () => {
  const seen: string[] = [];
  const http = new HttpClientService({
    fetchFn: async (input) => {
      seen.push(typeof input === "string" ? input : (input as URL).href);
      return jsonResponse({ draft_order: { id: 1 } });
    }
  });
  const connections = new StubConnections({
    merchant_a: tenantCreds("shop-a.myshopify.com", "tok_a"),
    merchant_b: tenantCreds("shop-b.myshopify.com", "tok_b")
  });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  await factory.createPendingOrder({
    merchantId: "merchant_a",
    sessionId: "s",
    cart: { currency: "BRL", totalCents: 1, lines: [], commerceCartRef: "c" }
  });
  await factory.createPendingOrder({
    merchantId: "merchant_b",
    sessionId: "s",
    cart: { currency: "BRL", totalCents: 1, lines: [], commerceCartRef: "c" }
  });

  assert.ok(seen[0].includes("shop-a.myshopify.com"));
  assert.ok(seen[1].includes("shop-b.myshopify.com"));
});
