import assert from "node:assert/strict";
import test from "node:test";
import { ErpOAuthController } from "./erp-oauth.controller.js";
import { decryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

function setup(t: any, provider: string, conflict = false) {
  for (const key of ["MERCADOLIVRE_APP_ID", "MERCADOLIVRE_CLIENT_SECRET", "SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "TIKTOKSHOP_SERVICE_ID", "TIKTOKSHOP_APP_KEY", "TIKTOKSHOP_APP_SECRET", "OAUTH_STATE_SECRET"]) {
    const prior = process.env[key]; process.env[key] = "123";
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  for (const key of ["MERCADOLIVRE_REDIRECT_URI", "SHOPEE_REDIRECT_URI", "TIKTOKSHOP_REDIRECT_URI"]) {
    const prior = process.env[key]; process.env[key] = "https://api.example.com/v1/inventory/erp/oauth/callback";
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const original = globalThis.fetch;
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  globalThis.fetch = (async (url: any) => {
    const path = new URL(String(url)).pathname;
    const data = path === "/oauth/token" ? { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, user_id: 456 }
      : path === "/users/me" ? { id: 456, nickname: "Seller" }
      : path === "/api/v2/auth/token/get" ? { error: "", access_token: "test-access", refresh_token: "test-refresh", expire_in: 3600, shop_id_list: [456] }
      : path === "/api/v2/shop/get_shop_info" ? { error: "", shop_id: 456, shop_name: "Seller" }
      : path === "/api/v2/token/get" ? { code: 0, data: { user_type: 0, access_token: "test-access", refresh_token: "test-refresh", access_token_expire_in: expiry } }
      : { code: 0, data: { shops: [{ id: "456", name: "Seller", cipher: "shop-cipher" }] } };
    return new Response(JSON.stringify(data));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const writes: any[] = [], routes: any[] = [], queued: any[] = [];
  const tx = {
    $queryRaw: async () => [],
    erpWebhookRoute: { findUnique: async () => conflict ? { merchantId: "other-store" } : null, deleteMany: async () => ({ count: 0 }), upsert: async ({ create }: any) => { routes.push(create); return create; } },
    erpConnection: { findUnique: async () => null, upsert: async ({ create }: any) => { writes.push(create); return { id: "test-connection", ...create }; } },
  };
  const prisma = { $transaction: async (fn: any) => fn(tx) };
  const controller = new ErpOAuthController(prisma as never, { execute: async (input: any) => { queued.push(input); } } as never, {} as never);
  const redirects: string[] = [];
  return { controller, writes, routes, queued, response: { redirect: (_status: number, url: string) => redirects.push(url) }, redirects, provider };
}

for (const provider of ["mercadolivre", "shopee", "tiktokshop"]) {
  test(`${provider} connects only the store signed in state, encrypts tokens and awaits durable initial enqueue`, async (t) => {
    const f = setup(t, provider);
    const authorize = await f.controller.authorize({ user: { merchantId: "child-store" } }, provider);
    const url = new URL(authorize.url);
    assert.equal(url.searchParams.has("client_secret"), false);
    if (provider === "shopee") { assert.equal(url.pathname, "/auth"); assert.equal(url.searchParams.get("auth_type"), "seller"); assert.equal(url.searchParams.get("response_type"), "code"); }
    if (provider === "tiktokshop") { assert.equal(url.searchParams.get("service_id"), "123"); assert.equal(url.searchParams.has("app_key"), false); }
    await f.controller.callback("test-code", url.searchParams.get("state")!, f.response, provider === "shopee" ? "456" : undefined);
    assert.equal(f.writes.length, 1);
    const stored = f.writes[0];
    assert.equal(stored.merchantId, "child-store");
    assert.equal(stored.config.sellerId, "456");
    if (provider === "tiktokshop") assert.equal(stored.config.shopCipher, "shop-cipher");
    assert.equal(decryptErpSecret(stored.accessTokenCipher), "test-access");
    assert.equal(decryptErpSecret(stored.refreshTokenCipher), "test-refresh");
    assert.deepEqual(f.queued, [{ merchantId: "child-store", provider, connectionId: "test-connection" }]);
    assert.equal(f.routes[0].merchantId, "child-store");
    assert.equal(new URL(f.redirects[0]).searchParams.get("erp_merchant"), "child-store");
    assert.equal(new URL(f.redirects[0]).hash, "#inventory");
  });

  test(`${provider} cannot steal a seller account already linked to another store`, async (t) => {
    const f = setup(t, provider, true);
    const authorize = await f.controller.authorize({ user: { merchantId: "child-store" } }, provider);
    await f.controller.callback("test-code", new URL(authorize.url).searchParams.get("state")!, f.response, provider === "shopee" ? "456" : undefined);
    assert.equal(f.writes.length, 0);
    assert.equal(f.routes.length, 0);
    assert.equal(f.queued.length, 0);
    assert.equal(new URL(f.redirects[0]).searchParams.get("error"), "erp_marketplace_account_already_connected");
  });
}

test("marketplace authorization returns explicit configuration error instead of a broken URL", async (t) => {
  const f = setup(t, "tiktokshop");
  delete process.env.TIKTOKSHOP_SERVICE_ID;
  await assert.rejects(() => f.controller.authorize({ user: { merchantId: "child-store" } }, "tiktokshop"), (error: any) => error.getStatus() === 503 && error.getResponse().code === "erp_provider_not_configured");
});

test("expired, future and tenant-tampered OAuth states never call a provider or write credentials", async (t) => {
  const f = setup(t, "mercadolivre");
  const state = new URL((await f.controller.authorize({ user: { merchantId: "child-store" } }, "mercadolivre")).url).searchParams.get("state")!;
  const prior = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("provider_must_not_be_called"); };
  t.after(() => { globalThis.fetch = prior; });
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 31 * 60_000 });
  await f.controller.callback("test-code", state, f.response);
  assert.equal(new URL(f.redirects[0]).searchParams.get("error"), "erp_csrf");
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() - 60_000 });
  await f.controller.callback("test-code", state, f.response);
  assert.equal(new URL(f.redirects[1]).searchParams.get("error"), "erp_csrf");
  t.mock.timers.reset();
  await f.controller.callback("test-code", state.replace("child-store", "parent-store"), f.response);
  assert.equal(new URL(f.redirects[2]).searchParams.get("error"), "erp_csrf");
  assert.equal(f.writes.length, 0);
});
