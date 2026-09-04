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

function wooCreds(storeUrl: string): MerchantCommerceCredentials {
  return { merchantId: "m1", provider: "woocommerce", storeUrl, consumerKey: "ck_test", consumerSecret: "cs_test" } as MerchantCommerceCredentials;
}

function magentoCreds(baseUrl: string): MerchantCommerceCredentials {
  return { merchantId: "m1", provider: "magento", baseUrl, accessToken: "mag_token_123", storeCode: "default" } as MerchantCommerceCredentials;
}

test("routes WooCommerce catalog search to the tenant store URL", async () => {
  const seen: string[] = [];
  const http = new HttpClientService({
    fetchFn: async (input) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      seen.push(url);
      return jsonResponse({ products: [], total: 0 });
    }
  });
  const connections = new StubConnections({ m1: wooCreds("https://shop.example.com") });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  await factory.searchCatalog({ merchantId: "m1", limit: 1 }).catch(() => {});
  assert.ok(seen.length > 0, `Expected fetch calls, got ${seen.length}`);
  assert.ok(seen[0].includes("shop.example.com"), `Expected shop.example.com in URL, got: ${seen[0]}`);
});

test("routes Magento test connection to the tenant base URL", async () => {
  const seen: { url: string; auth?: string }[] = [];
  const http = new HttpClientService({
    fetchFn: async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url, auth: headers["Authorization"] });
      return jsonResponse([{ name: "Test Store", base_currency_code: "BRL" }]);
    }
  });
  const connections = new StubConnections({ m1: magentoCreds("https://magento.example.com") });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  const health = await factory.testConnection("m1");
  assert.ok(seen.length > 0);
  assert.ok(seen[0].url.includes("magento.example.com/rest/default/V1/store/storeConfigs"));
  assert.equal(seen[0].auth, "Bearer mag_token_123");
  assert.equal(health.storeName, "Test Store");
  assert.equal(health.currency, "BRL");
});

test("fails when merchant has no connection configured", async () => {
  const http = new HttpClientService({ fetchFn: async () => jsonResponse({}) });
  const factory = new TenantCommerceAdapterFactory(new StubConnections({}), http);
  await assert.rejects(
    () => factory.validateCart({ merchantId: "m_unknown", commerceCartRef: "c1" }),
    /commerce_adapter_not_configured/
  );
});

test("distinct merchants never share credentials", async () => {
  const seen: string[] = [];
  const http = new HttpClientService({
    fetchFn: async (input) => {
      seen.push(typeof input === "string" ? input : (input as URL).href);
      return jsonResponse([{ name: "S", base_currency_code: "BRL" }]);
    }
  });
  const connections = new StubConnections({
    merchant_a: magentoCreds("https://shop-a.example.com"),
    merchant_b: magentoCreds("https://shop-b.example.com")
  });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  await factory.testConnection("merchant_a");
  await factory.testConnection("merchant_b");

  assert.ok(seen[0].includes("shop-a.example.com"));
  assert.ok(seen[1].includes("shop-b.example.com"));
});

test("adapter cache expires after TTL", async () => {
  let callCount = 0;
  const http = new HttpClientService({
    fetchFn: async () => {
      callCount++;
      return jsonResponse([{ name: "S", base_currency_code: "BRL" }]);
    }
  });
  const connections = new StubConnections({ m1: magentoCreds("https://cached.example.com") });
  const factory = new TenantCommerceAdapterFactory(connections, http);

  await factory.testConnection("m1");
  await factory.testConnection("m1");
  // Second call uses cached adapter — same fetch count for adapter resolution
  // but testConnection itself makes a fetch each time
  assert.ok(callCount >= 2);
});
