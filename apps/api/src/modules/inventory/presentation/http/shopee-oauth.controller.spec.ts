import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ErpOAuthController } from "./erp-oauth.controller.js";
import { decryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";
import { TriggerErpSyncUseCase } from "../../application/use-cases/trigger-erp-sync.use-case.js";
function configure(t: TestContext) {
  const values = { SHOPEE_PARTNER_ID: "123", SHOPEE_PARTNER_KEY: "secret", SHOPEE_REDIRECT_URI: "https://api.example.com/v1/inventory/erp/oauth/callback", OAUTH_STATE_SECRET: "state-secret", AACP_ERP_ENC_KEY: "encryption-secret", DASHBOARD_URL: "https://app.example.com" };
  const previous = Object.keys(values).map(key => [key, process.env[key]] as const), fetch = globalThis.fetch;
  Object.assign(process.env, values);
  t.after(() => { globalThis.fetch = fetch; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
test("Shopee callback encrypts tenant tokens and persists the authorized shop for initial synchronization", async t => {
  configure(t); let saved: any, synchronized: any;
  globalThis.fetch = async input => new URL(String(input)).pathname.endsWith("token/get")
    ? Response.json({ error: "", access_token: "shop-access", refresh_token: "shop-refresh", expire_in: 14400, shop_id: 321 })
    : Response.json({ error: "", shop_name: "Shop Example" });
  const controller = new ErpOAuthController({ erpConnection: { upsert: async (value: any) => { saved = value; return { id: "connection" }; } } } as never,
    { execute: async (value: any) => { synchronized = value; return { productsImported: 1 }; } } as never, {} as never, {} as never);
  const { url } = await controller.authorize({ user: { merchantId: "merchant" } }, "shopee");
  const redirects: string[] = [];
  await controller.callback("code", new URL(url).searchParams.get("state")!, { redirect: (_status: number, url: string) => redirects.push(url) }, "321");
  assert.equal(saved.create.merchantId, "merchant"); assert.equal(saved.create.config.shopeeShopId, "321");
  assert.equal(saved.update.config.shopeeShopId, "321"); assert.equal(decryptErpSecret(saved.create.accessTokenCipher), "shop-access");
  assert.equal(decryptErpSecret(saved.create.refreshTokenCipher), "shop-refresh");
  assert.equal(synchronized.connectionId, "connection"); assert.equal(synchronized.merchantId, "merchant");
  assert.deepEqual(redirects, ["https://app.example.com/?erp_connected=shopee#inventory"]);
});
test("Shopee denial and missing shop callback cannot save a connection", async t => {
  configure(t); globalThis.fetch = async () => assert.fail("must not contact provider without a shop");
  const controller = new ErpOAuthController({ erpConnection: { upsert: async () => assert.fail("must not persist") } } as never, {} as never, {} as never, {} as never);
  const { url } = await controller.authorize({ user: { merchantId: "merchant" } }, "shopee");
  const redirects: string[] = [];
  await controller.callback("code", new URL(url).searchParams.get("state")!, { redirect: (_status: number, url: string) => redirects.push(url) });
  assert.deepEqual(redirects, ["https://app.example.com/?error=erp_callback_error#inventory"]);
});
test("Shopee manual synchronization uses the tenant connection and marketplace flow rather than the ERP-only queue", async () => {
  let input: any;
  const useCase = new TriggerErpSyncUseCase({ enqueueFull: async () => assert.fail("wrong ERP queue") } as never,
    { findByProvider: async (merchantId: string, provider: string) => { assert.equal(merchantId, "merchant"); return provider === "shopee" ? { id: "connection", status: "connected", accessTokenCipher: "encrypted" } : null; } } as never,
    { execute: async (value: any) => { input = value; return { synced: true, productsImported: 1 }; } } as never);
  const result = await useCase.execute("merchant", "connection");
  assert.deepEqual(input, { merchantId: "merchant", connectionId: "connection", provider: "shopee", accessToken: "" });
  assert.equal(result.status, "completed");
});
