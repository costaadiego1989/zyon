import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { ShopeeMarketplaceAdapter } from "./shopee-marketplace.adapter.js";
import { TikTokShopMarketplaceAdapter } from "./tiktokshop-marketplace.adapter.js";
import { MercadoLivreMarketplaceAdapter } from "./mercadolivre-marketplace.adapter.js";
import { shopeeSignedUrl, tiktokSignature } from "./marketplace-api.js";
import { exchangeMarketplaceToken, refreshMarketplaceToken } from "./marketplace-oauth.js";

function setup(t: any, handler: (url: URL, init?: RequestInit) => unknown | Promise<unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: RequestInit) => new Response(JSON.stringify(await handler(new URL(String(url)), init)))) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [key, value] of Object.entries({ SHOPEE_PARTNER_ID: "123", SHOPEE_PARTNER_KEY: "test-secret", TIKTOKSHOP_APP_KEY: "test-app", TIKTOKSHOP_APP_SECRET: "test-secret", MERCADOLIVRE_APP_ID: "123", MERCADOLIVRE_CLIENT_SECRET: "test-secret", MERCADOLIVRE_REDIRECT_URI: "https://api.example.com/callback" })) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
}

test("TikTok signature matches the official public authorization example", () => {
  assert.equal(tiktokSignature("/authorization/202309/shops", { app_key: "29a39d", timestamp: "1623812664" }, "e59af819cc"), "b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8");
});

test("Shopee shop signature includes the access token and the exact shop identity", (t) => {
  setup(t, () => ({}));
  const url = new URL(shopeeSignedUrl("/api/v2/product/get_item_list", "test-token", "456", {}, 123456));
  const expected = createHmac("sha256", "test-secret").update("123/api/v2/product/get_item_list123456test-token456").digest("hex");
  assert.equal(url.searchParams.get("sign"), expected);
  assert.equal(url.searchParams.get("shop_id"), "456");
  assert.throws(() => shopeeSignedUrl("/api/v2/product/get_item_list", "test-token"), /shop_id_missing/);
});

test("Shopee fetches base details and each model instead of treating item IDs as inventory", async (t) => {
  const calls: string[] = [];
  setup(t, (url) => {
    calls.push(url.pathname);
    assert.equal(url.searchParams.get("shop_id"), "456");
    if (url.pathname.endsWith("get_item_list")) return { error: "", response: { item: [{ item_id: 100 }], has_next_page: true, next_offset: 50 } };
    if (url.pathname.endsWith("get_item_base_info")) return { error: "", response: { item_list: [{ item_id: 100, item_name: "Camisa", has_model: true }] } };
    return { error: "", response: { model: [{ model_id: 200, model_sku: "CAMISA-P", stock_info_v2: { summary_info: { total_available_stock: 7 }, seller_stock: [{ stock: 7 }] }, price_info: [{ current_price: 19.9 }] }] } };
  });
  const result = await new ShopeeMarketplaceAdapter({ shopId: "456" }).listProducts("test-token");
  assert.equal(calls.length, 3);
  assert.deepEqual(result, { products: [{ id: "100:200", title: "Camisa", sku: "CAMISA-P", stock: 7, salePriceCents: 1990 }], hasMore: true, nextCursor: "50" });
});

test("Shopee sends seller_stock to the mapped model and rejects partial failures", async (t) => {
  let failure = false;
  setup(t, (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { item_id: 100, stock_list: [{ model_id: 200, seller_stock: [{ stock: 0 }] }] });
    return { error: "", response: { failure_list: failure ? [{ item_id: 100 }] : [] } };
  });
  const adapter = new ShopeeMarketplaceAdapter({ shopId: "456" });
  assert.equal(await adapter.updateStock("test-token", "100:200", 0), true);
  failure = true;
  await assert.rejects(() => adapter.updateStock("test-token", "100:200", 0), /stock_write_rejected/);
});

test("TikTok search uses POST, exact-body signature, shop cipher, variants and page token", async (t) => {
  setup(t, (url, init) => {
    assert.equal(url.pathname, "/product/202309/products/search");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-tts-access-token"), "test-token");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(url.searchParams.get("shop_cipher"), "cipher-456");
    assert.equal(url.searchParams.get("page_token"), "page-2");
    const query = Object.fromEntries(url.searchParams);
    assert.equal(query.sign, tiktokSignature(url.pathname, query, "test-secret", String(init?.body)));
    return { code: 0, data: { next_page_token: "page-3", products: [{ id: "100", title: "Camisa", skus: [{ id: "200", seller_sku: "CAMISA-P", price: { currency: "BRL", sale_price: "19.90" }, inventory: [{ warehouse_id: "300", quantity: 7 }] }] }] } };
  });
  assert.deepEqual(await new TikTokShopMarketplaceAdapter({ shopCipher: "cipher-456" }).listProducts("test-token", 1, "page-2"), {
    products: [{ id: "100:200:300", title: "Camisa", sku: "CAMISA-P", stock: 7, salePriceCents: 1990 }], hasMore: true, nextCursor: "page-3",
  });
});

test("TikTok writes the exact product, SKU and warehouse and rejects partial errors", async (t) => {
  setup(t, (url, init) => {
    assert.equal(url.pathname, "/product/202309/products/100/inventory/update");
    assert.deepEqual(JSON.parse(String(init?.body)), { skus: [{ id: "200", inventory: [{ warehouse_id: "300", quantity: 6 }] }] });
    return { code: 0, data: { errors: [{ code: 123, message: "private provider detail" }] } };
  });
  await assert.rejects(() => new TikTokShopMarketplaceAdapter({ shopCipher: "cipher-456" }).updateStock("test-token", "100:200:300", 6), /erp_tiktokshop_stock_write_rejected/);
});

test("TikTok refuses to pick an arbitrary shop from a multi-shop authorization", async (t) => {
  setup(t, () => ({ code: 0, data: { shops: [{ id: "1", name: "One", cipher: "one" }, { id: "2", name: "Two", cipher: "two" }] } }));
  await assert.rejects(() => new TikTokShopMarketplaceAdapter().getSellerInfo("test-token"), /erp_shop_selection_required/);
  assert.deepEqual(await new TikTokShopMarketplaceAdapter({ shopId: "2" }).getSellerInfo("test-token"), { sellerId: "2", name: "Two", shopCipher: "two" });
});

test("Mercado Livre uses bearer header, scan cursor and variant identities", async (t) => {
  setup(t, (url, init) => {
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    if (url.pathname.endsWith("search")) {
      assert.equal(url.searchParams.get("search_type"), "scan");
      assert.equal(url.searchParams.get("scroll_id"), "cursor-1");
      return { results: ["MLB123"], scroll_id: "cursor-1" };
    }
    return [{ code: 200, body: { id: "MLB123", seller_id: 456, title: "Camisa", currency_id: "BRL", price: 19.9, variations: [
      { id: 200, available_quantity: 7, attributes: [{ id: "SELLER_SKU", value_name: "CAMISA-P" }] },
      { id: 201, available_quantity: 0, seller_custom_field: "CAMISA-M" },
    ] } }];
  });
  const result = await new MercadoLivreMarketplaceAdapter({ sellerId: "456" }).listProducts("test-token", 1, "cursor-1");
  assert.deepEqual(result.products.map(product => [product.id, product.sku, product.stock]), [["MLB123:200", "CAMISA-P", 7], ["MLB123:201", "CAMISA-M", 0]]);
  assert.equal(result.nextCursor, "cursor-1");
});

test("Mercado Livre updates one variation without replacing other variations", async (t) => {
  setup(t, (url, init) => {
    assert.equal(url.pathname, "/items/MLB123/variations/200");
    assert.equal(init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(init?.body)), { available_quantity: 6 });
    return { id: 200, available_quantity: 6 };
  });
  assert.equal(await new MercadoLivreMarketplaceAdapter({ sellerId: "456" }).updateStock("test-token", "MLB123:200", 6), true);
});

for (const provider of ["shopee", "tiktokshop", "mercadolivre"]) {
  test(`${provider} API errors are not interpreted as empty inventory or zero stock`, async (t) => {
    setup(t, () => provider === "shopee" ? { error: "error_auth", message: "private-secret" } : provider === "tiktokshop" ? { code: 123, message: "private-secret" } : { error: "private-secret" });
    const adapter = provider === "shopee" ? new ShopeeMarketplaceAdapter({ shopId: "456" }) : provider === "tiktokshop" ? new TikTokShopMarketplaceAdapter({ shopCipher: "cipher" }) : new MercadoLivreMarketplaceAdapter({ sellerId: "456" });
    await assert.rejects(() => adapter.listProducts("test-token"), error => error instanceof Error && error.message.startsWith("erp_") && !error.message.includes("private-secret"));
  });
}

test("unmapped multiple TikTok warehouses and missing stock are rejected", async (t) => {
  let inventory: any[] = [{ warehouse_id: "1", quantity: 3 }, { warehouse_id: "2", quantity: 4 }];
  setup(t, () => ({ code: 0, data: { products: [{ id: "100", title: "Item", skus: [{ id: "200", inventory }] }] } }));
  const adapter = new TikTokShopMarketplaceAdapter({ shopCipher: "cipher" });
  await assert.rejects(() => adapter.listProducts("test-token"), /multi_location_requires_mapping/);
  inventory = [{ warehouse_id: "1" }];
  await assert.rejects(() => adapter.listProducts("test-token"), /stock_missing/);
});

test("Mercado Livre exchanges a code using the documented form body and bound seller ID", async (t) => {
  setup(t, (_url, init) => {
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), "https://api.example.com/callback");
    return { access_token: "test-access", refresh_token: "test-refresh", expires_in: 21600, user_id: 456 };
  });
  const result = await exchangeMarketplaceToken("mercadolivre", "test-code");
  assert.equal(result.context.sellerId, "456");
  assert.equal(result.refreshToken, "test-refresh");
});

test("Shopee code exchange signs a public request but persists the shop from callback", async (t) => {
  setup(t, (url, init) => {
    assert.equal(url.pathname, "/api/v2/auth/token/get");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.deepEqual(JSON.parse(String(init?.body)), { partner_id: 123, code: "test-code", shop_id: 456 });
    return { error: "", access_token: "test-access", refresh_token: "test-refresh", expire_in: 14400, shop_id_list: [456] };
  });
  assert.equal((await exchangeMarketplaceToken("shopee", "test-code", "456")).context.shopId, "456");
});

test("TikTok token exchange uses GET and absolute Unix expiry, not a seconds duration", async (t) => {
  const expiry = Math.floor(Date.now() / 1000) + 604800;
  setup(t, (url, init) => {
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(url.searchParams.get("grant_type"), "authorized_code");
    assert.equal(url.searchParams.get("auth_code"), "test-code");
    return { code: 0, data: { user_type: 0, access_token: "test-access", refresh_token: "test-refresh", access_token_expire_in: expiry } };
  });
  assert.equal((await exchangeMarketplaceToken("tiktokshop", "test-code")).expiresAt.getTime(), expiry * 1000);
});

for (const provider of ["mercadolivre", "shopee", "tiktokshop"]) {
  test(`${provider} refresh rotates credentials and preserves the external account binding`, async (t) => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    setup(t, (url, init) => {
      if (provider === "tiktokshop") {
        assert.equal(url.pathname, "/api/v2/token/refresh");
        assert.equal(url.searchParams.get("refresh_token"), "old-refresh");
        return { code: 0, data: { access_token: "new-access", refresh_token: "new-refresh", access_token_expire_in: expiry } };
      }
      if (provider === "shopee") {
        assert.equal(url.pathname, "/api/v2/auth/access_token/get");
        assert.equal(JSON.parse(String(init?.body)).shop_id, 456);
        return { error: "", access_token: "new-access", refresh_token: "new-refresh", expire_in: 3600, shop_id: 456 };
      }
      assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "refresh_token");
      return { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, user_id: 456 };
    });
    const context = { sellerId: "456", shopId: "456", shopCipher: "cipher" };
    const result = await refreshMarketplaceToken(provider, "old-refresh", context);
    assert.equal(result.accessToken, "new-access");
    assert.equal(result.refreshToken, "new-refresh");
    assert.deepEqual(result.context, context);
  });
}

test("missing/expired tokens, Shopee API errors and creator grants never become a connection", async (t) => {
  let body: any = { code: 0, data: { user_type: 0 } };
  setup(t, () => body);
  await assert.rejects(() => exchangeMarketplaceToken("tiktokshop", "test-code"), /erp_token_failed/);
  body = { code: 0, data: { user_type: 1 } };
  await assert.rejects(() => exchangeMarketplaceToken("tiktokshop", "test-code"), /seller_required/);
  body = { error: "error_auth", access_token: "test-access", refresh_token: "test-refresh", expire_in: 14400 };
  await assert.rejects(() => exchangeMarketplaceToken("shopee", "test-code", "456"), /erp_shopee_api_error/);
});
