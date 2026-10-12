import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHmac } from "node:crypto";
import { ShopeeMarketplaceAdapter } from "./shopee-marketplace.adapter.js";
import { exchangeShopeeCode, shopeeAuthorizationUrl } from "./shopee-api.js";
import { ShopeeTokenAdapter } from "./shopee-token.adapter.js";
import { decryptErpSecret, encryptErpSecret } from "./erp-secret-cipher.js";
function configure(t: TestContext) {
  const keys = { SHOPEE_PARTNER_ID: "123", SHOPEE_PARTNER_KEY: "test-partner-secret", AACP_ERP_ENC_KEY: "test-encryption-secret", SHOPEE_API_BASE_URL: "https://openplatform.sandbox.test-stable.shopee.sg",
    SHOPEE_AUTH_BASE_URL: "https://open.sandbox.test-stable.shopee.com.br", SHOPEE_AUTH_MODE: "canonical", SHOPEE_REDIRECT_URI: "https://sandbox.example.com/v1/inventory/erp/oauth/callback" };
  const previous = Object.keys(keys).map(key => [key, process.env[key]] as const), fetch = globalThis.fetch;
  Object.assign(process.env, keys);
  t.after(() => { globalThis.fetch = fetch; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
const info = { summary_info: { total_available_stock: 9, total_reserved_stock: 2 }, seller_stock: [{ stock: 11 }], shopee_stock: [] };
function catalogue(url: URL): Response {
  if (url.pathname.endsWith("get_item_list")) return Response.json({ error: "", response: { item: [{ item_id: 42 }], has_next_page: false } });
  if (url.pathname.endsWith("get_item_base_info")) return Response.json({ error: "", response: { item_list: [{ item_id: 42, item_name: "Shirt", item_sku: "PARENT", has_model: true }] } });
  if (url.pathname.endsWith("get_model_list")) return Response.json({ error: "", response: { model: [{ model_id: 8, model_sku: "BLUE-M", stock_info_v2: info }] } });
  throw Error("unexpected_test_api");
}
test("Shopee sandbox shop signing and variant import use shop-specific identity and detail APIs", async t => {
  configure(t);
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.host, "openplatform.sandbox.test-stable.shopee.sg");
    assert.equal(url.searchParams.get("shop_id"), "321");
    const expected = createHmac("sha256", "test-partner-secret").update(`123${url.pathname}${url.searchParams.get("timestamp")}access321`).digest("hex");
    assert.equal(url.searchParams.get("sign"), expected);
    return catalogue(url);
  };
  const result = await new ShopeeMarketplaceAdapter({ shopeeShopId: "321" }).listProducts("access");
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.products.map(p => [p.id, p.title, p.sku, p.stock]), [["42:8", "Shirt", "BLUE-M", 9]]);
  assert.throws(() => new ShopeeMarketplaceAdapter(), /shop_id_missing/);
});
test("Shopee seller SKU stock updates resolve model ID and preserve Shopee reservations", async t => {
  configure(t); let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("update_stock")) return catalogue(url);
    writes++;
    assert.deepEqual(JSON.parse(String(init?.body)), { item_id: 42, stock_list: [{ model_id: 8, seller_stock: [{ stock: 7 }] }] });
    return Response.json({ error: "", response: { failure_list: [], success_list: [{ model_id: 8, stock: 7 }] } });
  };
  assert.equal(await new ShopeeMarketplaceAdapter({ shopeeShopId: "321" }).updateStock("access", "BLUE-M", 5), true);
  assert.equal(writes, 1);
});
test("Shopee provider and partial stock failures never become empty successful imports or confirmed writes", async t => {
  configure(t);
  globalThis.fetch = async () => Response.json({ error: "error_auth", message: "secret provider message" });
  await assert.rejects(new ShopeeMarketplaceAdapter({ shopeeShopId: "321" }).listProducts("access"), /^Error: shopee_api_error:error_auth$/);
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    return url.pathname.endsWith("update_stock") ? Response.json({ error: "", response: { failure_list: [{ model_id: 8 }], success_list: [] } }) : catalogue(url);
  };
  await assert.rejects(new ShopeeMarketplaceAdapter({ shopeeShopId: "321" }).updateStock("access", "BLUE-M", 5), /stock_update_rejected/);
});
test("Shopee pagination follows provider offsets and rejects duplicate seller SKUs before a stock write", async t => {
  configure(t); const offsets: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("update_stock")) assert.fail("must not write ambiguous SKU");
    if (!url.pathname.endsWith("get_item_list")) return catalogue(url);
    offsets.push(url.searchParams.get("offset")!);
    return Response.json({ error: "", response: { item: [{ item_id: 42 }], has_next_page: offsets.length === 1, next_offset: 17 } });
  };
  await assert.rejects(new ShopeeMarketplaceAdapter({ shopeeShopId: "321" }).updateStock("access", "BLUE-M", 5), /sku_ambiguous/);
  assert.deepEqual(offsets, ["0", "17"]);
});
test("Shopee authorization preserves state, and token exchange rejects a grant for a different shop", async t => {
  configure(t);
  const url = new URL(shopeeAuthorizationUrl("signed-state"));
  assert.equal(url.origin, "https://open.sandbox.test-stable.shopee.com.br");
  assert.equal(url.pathname, "/auth"); assert.equal(url.searchParams.get("state"), "signed-state"); assert.equal(url.searchParams.get("auth_type"), "seller");
  globalThis.fetch = async (input, init) => {
    const tokenUrl = new URL(String(input));
    assert.equal(tokenUrl.searchParams.has("access_token"), false);
    assert.deepEqual(JSON.parse(String(init?.body)), { code: "code", shop_id: 321, partner_id: 123 });
    return Response.json({ error: "", access_token: "access", refresh_token: "refresh", expire_in: 14400, shop_id: 999 });
  };
  await assert.rejects(exchangeShopeeCode("code", "321"), /token_shop_mismatch/);
});
test("Concurrent Shopee renewals lock and reread the tenant connection and persist the single-use rotated refresh token", async t => {
  configure(t);
  let row = { id: "connection", accessTokenCipher: encryptErpSecret("old-access"), refreshTokenCipher: encryptErpSecret("old-refresh"), tokenExpiresAt: new Date(0), config: { shopeeShopId: "321", inventoryLocationId: "location" } };
  let calls = 0, queue = Promise.resolve();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.pathname, "/api/v2/auth/access_token/get");
    assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: "old-refresh", shop_id: 321, partner_id: 123 });
    calls++; return Response.json({ error: "", access_token: "new-access", refresh_token: "new-refresh", expire_in: 14400, shop_id: 321 });
  };
  const findFirst = async ({ where }: any) => { assert.deepEqual(where, { id: "connection", merchantId: "merchant", provider: "shopee", status: "connected" }); return row; };
  const tx = { $queryRaw: async (sql: TemplateStringsArray, ...args: unknown[]) => { assert.match(sql.join("?"), /FOR UPDATE/); assert.deepEqual(args, ["connection", "merchant"]); }, erpConnection: { findFirst, update: async ({ data }: any) => { row = { ...row, ...data }; } } };
  const adapter = new ShopeeTokenAdapter({ erpConnection: { findFirst }, $transaction: (run: (tx: any) => Promise<string>) => { const result = queue.then(() => run(tx)); queue = result.then(() => undefined); return result; } } as never);
  assert.deepEqual(await Promise.all([adapter.getValidAccessToken("merchant", "connection"), adapter.getValidAccessToken("merchant", "connection")]), ["new-access", "new-access"]);
  assert.equal(calls, 1); assert.equal(decryptErpSecret(row.refreshTokenCipher), "new-refresh"); assert.equal(row.config.inventoryLocationId, "location");
});
test("Shopee refuses a missing tenant connection without contacting the provider", async t => {
  configure(t); globalThis.fetch = async () => assert.fail("must not call provider");
  const adapter = new ShopeeTokenAdapter({ erpConnection: { findFirst: async ({ where }: any) => { assert.equal(where.merchantId, "other"); return null; } } } as never);
  await assert.rejects(adapter.getValidAccessToken("other", "connection"), /connection_missing/);
});
test("Shopee's official legacy sandbox flow signs public authorization and carries state inside the redirect URI", t => {
  configure(t); process.env.SHOPEE_AUTH_MODE = "legacy";
  const url = new URL(shopeeAuthorizationUrl("signed-state"));
  assert.equal(url.host, "openplatform.sandbox.test-stable.shopee.sg"); assert.equal(url.pathname, "/api/v2/shop/auth_partner");
  const redirect = new URL(url.searchParams.get("redirect")!);
  assert.equal(redirect.searchParams.get("state"), "signed-state"); assert.equal(redirect.host, "sandbox.example.com");
  const expected = createHmac("sha256", "test-partner-secret").update(`123${url.pathname}${url.searchParams.get("timestamp")}`).digest("hex");
  assert.equal(url.searchParams.get("sign"), expected);
});
