import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ErpOAuthController } from "./erp-oauth.controller.js";
import { decryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";
import { TikTokShopOAuthAdapter } from "../../infrastructure/adapters/tiktokshop-oauth.adapter.js";

test("Bling OAuth stores separate encrypted authorizations for each merchant and rejects cross-company replacement", async t => {
  const values = { BLING_CLIENT_ID: "a".repeat(40), BLING_CLIENT_SECRET: "app-secret", BLING_REDIRECT_URI: "https://api.example.com/inventory/erp/oauth/callback", DASHBOARD_URL: "https://dashboard.example.com", OAUTH_STATE_SECRET: "state-secret", AACP_ERP_ENC_KEY: "oauth-encryption-key" };
  const previous = Object.keys(values).map(key => [key, process.env[key]] as const), originalFetch = globalThis.fetch;
  Object.assign(process.env, values);
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const rows = new Map<string, any>(), routes = new Map<string, any>(), jobs: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/oauth/token")) {
      const code = new URLSearchParams(String(init?.body)).get("code");
      assert.equal((init?.headers as Record<string, string>)["enable-jwt"], "1");
      return Response.json({ access_token: `token-${code}`, refresh_token: `refresh-${code}`, expires_in: 21600 });
    }
    const token = (init?.headers as Record<string, string>).Authorization.replace("Bearer token-", "");
    return Response.json({ data: { id: token === "replacement" ? "another-company" : token } });
  };
  const prisma = { erpConnection: {
    findUnique: async ({ where }: any) => rows.get(where.merchantId_provider.merchantId) ?? null,
    upsert: async ({ where, create, update }: any) => { const id = where.merchantId_provider.merchantId, row = { id: `connection-${id}`, ...(rows.has(id) ? { ...rows.get(id), ...update } : create) }; rows.set(id, row); return row; },
  }, erpWebhookRoute: {
    findUnique: async ({ where }: any) => routes.get(where.provider_externalAccountId.externalAccountId) ?? null,
    deleteMany: async () => ({ count: 0 }),
    upsert: async ({ create }: any) => { routes.set(create.externalAccountId, create); return create; },
  } };
  const controller = new ErpOAuthController(prisma as never, {} as never, { execute: async (merchantId: string) => jobs.push(merchantId) } as never, new TikTokShopOAuthAdapter());
  for (const id of ["merchant-a", "merchant-b"]) {
    const { url } = await controller.authorize({ user: { merchantId: id } }, "bling"), response = responseCapture();
    await controller.callback(id, new URL(url).searchParams.get("state")!, response.response);
    assert.match(response.redirects[0][1], /erp_connected=bling/);
    assert.equal(decryptErpSecret(rows.get(id).accessTokenCipher), `token-${id}`);
    assert.equal(rows.get(id).merchantId, id);
    assert.equal(routes.get(id).merchantId, id);
  }
  const saved = rows.get("merchant-a");
  const { url } = await controller.authorize({ user: { merchantId: "merchant-a" } }, "bling"), response = responseCapture();
  await controller.callback("replacement", new URL(url).searchParams.get("state")!, response.response);
  assert.match(response.redirects[0][1], /bling_company_change_requires_disconnect/);
  assert.equal(rows.get("merchant-a"), saved);
  assert.deepEqual(jobs, ["merchant-a", "merchant-b"]);
});

function responseCapture() {
  const redirects: Array<[number, string]> = [];
  return {
    redirects,
    response: { redirect: (status: number, url: string) => redirects.push([status, url]) },
  };
}

test("ERP OAuth callback redirects errors to the Inventory deep link", async (t) => {
  const previousDashboardUrl = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = "https://app.example.com/settings?tab=integrations";
  t.after(() => {
    if (previousDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = previousDashboardUrl;
  });

  const controller = new ErpOAuthController({} as never, {} as never, {} as never, new TikTokShopOAuthAdapter());

  const denied = responseCapture();
  await controller.callback("", "", denied.response);
  assert.deepEqual(denied.redirects, [[302, "https://app.example.com/settings?tab=integrations&error=erp_denied#inventory"]]);

  const csrf = responseCapture();
  await controller.callback("code", "invalid-state", csrf.response);
  assert.deepEqual(csrf.redirects, [[302, "https://app.example.com/settings?tab=integrations&error=erp_csrf#inventory"]]);
});

function configureTikTok(t: TestContext) {
  const values = { TIKTOKSHOP_APP_KEY: "oauth-test-key", TIKTOKSHOP_APP_SECRET: "oauth-test-secret",
    TIKTOKSHOP_SERVICE_ID: "oauth-test-service", OAUTH_STATE_SECRET: "oauth-test-state-secret",
    AACP_ERP_ENC_KEY: "oauth-test-encryption-key", DASHBOARD_URL: "https://dashboard.example.com" };
  const previous = Object.keys(values).map(key => [key, process.env[key]] as const);
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, values);
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

test("TikTok OAuth callback stores encrypted tokens, absolute expiry and authorized shop identity", async t => {
  configureTikTok(t);
  const expires = Math.floor(Date.now() / 1000) + 604800;
  const refreshExpires = expires + 604800;
  let saved: any;
  let synchronized: any;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v2/token/get") return Response.json({ code: 0, data: {
      access_token: "oauth-seller-token", refresh_token: "oauth-refresh-token", user_type: 0,
      access_token_expire_in: expires, refresh_token_expire_in: refreshExpires,
    } });
    assert.equal(url.pathname, "/authorization/202309/shops");
    return Response.json({ code: 0, data: { shops: [{ id: "shop-1", name: "Shop", cipher: "cipher-1" }] } });
  };
  const controller = new ErpOAuthController({ erpConnection: { upsert: async (data: unknown) => {
    saved = data; return { id: "connection-1" };
  } } } as never, { execute: async (input: unknown) => { synchronized = input; return { productsImported: 2 }; } } as never, {} as never, new TikTokShopOAuthAdapter());
  const { url } = await controller.authorize({ user: { merchantId: "merchant-1" } }, "tiktokshop");
  assert.equal(new URL(url).searchParams.get("service_id"), "oauth-test-service");
  const response = responseCapture();
  await controller.callback("temporary-code", new URL(url).searchParams.get("state")!, response.response);
  assert.equal(saved.create.tokenExpiresAt.getTime(), expires * 1000);
  assert.equal(decryptErpSecret(saved.create.accessTokenCipher), "oauth-seller-token");
  assert.equal(decryptErpSecret(saved.create.refreshTokenCipher), "oauth-refresh-token");
  assert.deepEqual(saved.create.config, { tiktokShopId: "shop-1", tiktokShopCipher: "cipher-1", tiktokRefreshExpiresAt: new Date(refreshExpires * 1000).toISOString() });
  assert.equal(synchronized.connectionId, "connection-1");
  assert.deepEqual(response.redirects, [[302, "https://dashboard.example.com/?erp_connected=tiktokshop#inventory"]]);
});

test("TikTok OAuth provider errors cannot persist a connection or trigger synchronization", async t => {
  configureTikTok(t);
  globalThis.fetch = async () => Response.json({ code: 40101, message: "Invalid authorization code" });
  const controller = new ErpOAuthController({ erpConnection: { upsert: async () => assert.fail("must not persist") } } as never,
    { execute: async () => assert.fail("must not synchronize") } as never, {} as never, new TikTokShopOAuthAdapter());
  const { url } = await controller.authorize({ user: { merchantId: "merchant-1" } }, "tiktokshop");
  const response = responseCapture();
  await controller.callback("invalid-code", new URL(url).searchParams.get("state")!, response.response);
  assert.deepEqual(response.redirects, [[302, "https://dashboard.example.com/?error=erp_callback_error#inventory"]]);
});

test("TikTok's literal null denial code redirects without calling the token API", async t => {
  configureTikTok(t);
  globalThis.fetch = async () => assert.fail("must not call provider after denial");
  const controller = new ErpOAuthController({} as never, {} as never, {} as never, new TikTokShopOAuthAdapter());
  const response = responseCapture();
  await controller.callback("null", "state", response.response);
  assert.deepEqual(response.redirects, [[302, "https://dashboard.example.com/?error=erp_denied#inventory"]]);
});
