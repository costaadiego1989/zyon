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
      return jsonResponse({
        data: {
          draftOrderCreate: {
            draftOrder: { id: "gid://shopify/DraftOrder/555", legacyResourceId: "555" },
            userErrors: [],
          },
        },
      });
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
      return jsonResponse({
        data: {
          draftOrderCreate: {
            draftOrder: { id: "gid://shopify/DraftOrder/1", legacyResourceId: "1" },
            userErrors: [],
          },
        },
      });
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

// P2 regression: global-env fallback must be scoped to the explicit demo
// merchant and must never serve other merchants.
test("P2 — global-env fallback only serves the declared demo merchant", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const prevToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const prevDemo = process.env.SHOPIFY_DEMO_MERCHANT_ID;

  process.env.NODE_ENV = "development";
  process.env.SHOPIFY_SHOP_DOMAIN = "demo-shop.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_demo";
  process.env.SHOPIFY_DEMO_MERCHANT_ID = "demo_merchant";

  try {
    const seen: string[] = [];
    const http = new HttpClientService({
      fetchFn: async (input) => {
        seen.push(typeof input === "string" ? input : (input as URL).href);
        return jsonResponse({
          data: {
            draftOrderCreate: {
              draftOrder: { id: "gid://shopify/DraftOrder/1", legacyResourceId: "1" },
              userErrors: [],
            },
          },
        });
      }
    });
    const factory = new TenantCommerceAdapterFactory(new StubConnections({}), http);

    // Demo merchant → fallback resolves
    await factory.createPendingOrder({
      merchantId: "demo_merchant",
      sessionId: "s",
      cart: { currency: "BRL", totalCents: 1, lines: [], commerceCartRef: "c" }
    });
    assert.ok(seen.length === 1 && seen[0].includes("demo-shop.myshopify.com"),
      "demo merchant should use the demo-shop domain");

    // Non-demo merchant → must fail even though env vars are set
    await assert.rejects(
      () => factory.createPendingOrder({
        merchantId: "other_merchant",
        sessionId: "s",
        cart: { currency: "BRL", totalCents: 1, lines: [], commerceCartRef: "c" }
      }),
      /commerce_adapter_not_configured/,
      "non-demo merchant must not receive the global-env credentials"
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevDomain === undefined) delete process.env.SHOPIFY_SHOP_DOMAIN;
    else process.env.SHOPIFY_SHOP_DOMAIN = prevDomain;
    if (prevToken === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = prevToken;
    if (prevDemo === undefined) delete process.env.SHOPIFY_DEMO_MERCHANT_ID;
    else process.env.SHOPIFY_DEMO_MERCHANT_ID = prevDemo;
  }
});

test("routes Tray orders to the merchant's api_address with access_token query param", async () => {
  const seen: { url: string; accessTokenInUrl?: boolean }[] = [];
  const http = new HttpClientService({
    fetchFn: async (input) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      seen.push({
        url,
        accessTokenInUrl: url.includes("access_token="),
      });
      return new Response(
        JSON.stringify({
          result: [
            {
              id: 1,
              name: "Test Product",
              price: "99.90",
              cost: "50.00",
              quantity: 10,
              image: "",
              url: "",
            },
          ],
          paging: { current: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  // Tray adapter is not yet implemented — test is a placeholder for future work.
  const credentials = {
    merchantId: "m_tray_1",
    provider: "tray",
    apiAddress: "https://store.com.br/web_api",
    accessToken: "tray_token_secret",
    refreshToken: "tray_refresh_secret",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    consumerKey: "tray_ck",
    consumerSecret: "tray_cs",
  } as unknown as MerchantCommerceCredentials;
  const connections = new StubConnections({ m_tray_1: credentials });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  const catalog = await factory.searchCatalog({
    merchantId: "m_tray_1",
    limit: 1,
  });

  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.products[0]?.title, "Test Product");
  assert.ok(seen.length > 0);
  assert.ok(seen[0]?.url.includes("https://store.com.br/web_api"));
  assert.equal(seen[0]?.accessTokenInUrl, true);
});

// P2 regression: global-env fallback must be disabled when SHOPIFY_DEMO_MERCHANT_ID
// is not set, even in development.
test("P2 — global-env fallback disabled when no demo merchant opt-in configured", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const prevToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const prevDemo = process.env.SHOPIFY_DEMO_MERCHANT_ID;

  process.env.NODE_ENV = "development";
  process.env.SHOPIFY_SHOP_DOMAIN = "some-shop.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_some";
  delete process.env.SHOPIFY_DEMO_MERCHANT_ID;

  try {
    const http = new HttpClientService({ fetchFn: async () => jsonResponse({}) });
    const factory = new TenantCommerceAdapterFactory(new StubConnections({}), http);

    await assert.rejects(
      () => factory.validateCart({ merchantId: "any_merchant", commerceCartRef: "c" }),
      /commerce_adapter_not_configured/,
      "fallback must be fail-closed when no demo merchant opt-in is set"
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevDomain === undefined) delete process.env.SHOPIFY_SHOP_DOMAIN;
    else process.env.SHOPIFY_SHOP_DOMAIN = prevDomain;
    if (prevToken === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = prevToken;
    if (prevDemo === undefined) delete process.env.SHOPIFY_DEMO_MERCHANT_ID;
    else process.env.SHOPIFY_DEMO_MERCHANT_ID = prevDemo;
  }
});
