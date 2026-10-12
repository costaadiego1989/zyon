import "reflect-metadata";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { HubSpotOAuthService } from "../application/services/hubspot-oauth.service.js";
import { CrmAdapterFactory } from "../infrastructure/adapters/crm-adapter.factory.js";
import { encryptCrmSecret, decryptCrmSecret } from "../infrastructure/adapters/crm-secret-cipher.js";
import { ConnectCrmUseCase } from "../application/use-cases/connect-crm.use-case.js";

function fixture(t: TestContext) {
  const settings = { HUBSPOT_CLIENT_ID: "test-client", HUBSPOT_CLIENT_SECRET: "private-client-secret",
    HUBSPOT_REDIRECT_URI: "https://api.example.test/v1/inventory/crm/oauth/hubspot/callback", DASHBOARD_URL: "https://dashboard.example.test/", NODE_ENV: "test" };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const priorFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = priorFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const entries = new Map<string, { value: string; expires: number }>();
  const redis = {
    async set(key: string, value: string, _ex: string, ttl: number, nx?: string) {
      if (nx && entries.has(key) && entries.get(key)!.expires > Date.now()) return null;
      entries.set(key, { value, expires: Date.now() + ttl * 1000 }); return "OK";
    },
    async eval(script: string, count: number, key: string, ...args: string[]) {
      assert.equal(count, 1);
      const entry = entries.get(key); if (!entry || entry.expires <= Date.now()) return null;
      if (key.includes("oauth-state")) {
        assert.ok(script.includes("item.merchantId ~= ARGV[1] or item.userId ~= ARGV[2]"));
        const item = JSON.parse(entry.value);
        if (item.merchantId !== args[0] || item.userId !== args[1]) return null;
        entries.delete(key); return entry.value;
      }
      if (entry.value !== args[0]) return 0;
      entries.delete(key); return 1;
    },
  };
  let connection: any = null;
  const saves: any[] = [], updates: any[] = [], calls: Array<{ url: string; fields: URLSearchParams }> = [];
  const repo = {
    async upsert(merchantId: string, provider: string, input: any) {
      saves.push({ merchantId, provider, ...input });
      connection = { id: "connection-a", merchantId, provider, ...input, lastSyncAt: null, lastErrorCode: null, createdAt: new Date() };
      return connection;
    },
    async findByProvider(merchantId: string, provider: string) {
      assert.equal(merchantId, "merchant-a"); assert.equal(provider, "hubspot"); return connection;
    },
    async updateOAuthTokens(merchantId: string, id: string, expected: string, tokens: any) {
      updates.push({ merchantId, id, expected, tokens });
      if (!connection || connection.id !== id || connection.merchantId !== merchantId || connection.accessTokenCipher !== expected) return false;
      Object.assign(connection, tokens); return true;
    },
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), fields: new URLSearchParams(String(options?.body ?? "")) });
    return new Response(JSON.stringify({ access_token: "private-access", refresh_token: "private-refresh", expires_in: 1800 }));
  };
  const adapters = { create({ provider, accessToken }: any) {
    assert.equal(provider, "hubspot"); assert.equal(accessToken, "private-access");
    return { async validateCredentials() { return true; } };
  } };
  const service = new HubSpotOAuthService(repo as never, adapters as never, redis as never);
  return { service, repo, adapters, entries, calls, saves, updates, principal: { merchantId: "merchant-a", userId: "owner-a" },
    setConnection(row: any) { connection = row; }, getConnection() { return connection; } };
}

test("HubSpot OAuth binds one-time state to the authenticated merchant and user and never exposes credentials", async t => {
  const f = fixture(t);
  const { url } = await f.service.authorize(f.principal);
  const target = new URL(url), state = target.searchParams.get("state")!;
  assert.equal(target.origin, "https://app.hubspot.com");
  assert.equal(target.searchParams.get("client_id"), "test-client");
  assert.match(target.searchParams.get("scope")!, /crm.objects.deals.write/);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.includes("private-client-secret"), false);
  assert.equal(state.includes("merchant-a"), false);
  await assert.rejects(f.service.complete({ ...f.principal, merchantId: "merchant-b" }, state, "code"), /crm_oauth_state_invalid/);
  await assert.rejects(f.service.complete({ ...f.principal, userId: "owner-b" }, state, "code"), /crm_oauth_state_invalid/);
  assert.equal(f.calls.length, 0);
  const result = await f.service.complete(f.principal, state, "code");
  assert.equal(f.calls[0].url, "https://api.hubspot.com/oauth/2026-09/token");
  assert.equal(f.calls[0].fields.get("client_secret"), "private-client-secret");
  assert.equal(f.calls[0].fields.get("grant_type"), "authorization_code");
  assert.equal(f.saves[0].merchantId, "merchant-a");
  assert.equal(decryptCrmSecret(f.saves[0].accessTokenCipher), "private-access");
  assert.equal(decryptCrmSecret(f.saves[0].refreshTokenCipher), "private-refresh");
  assert.equal(JSON.stringify(result).includes("private"), false);
  await assert.rejects(f.service.complete(f.principal, state, "code"), /crm_oauth_state_invalid/);
  assert.equal(f.calls.length, 1);
});

test("expired and denied OAuth states cannot save or replace a customer's connection", async t => {
  const f = fixture(t);
  const expired = new URL((await f.service.authorize(f.principal)).url).searchParams.get("state")!;
  for (const entry of f.entries.values()) entry.expires = 0;
  await assert.rejects(f.service.complete(f.principal, expired, "code"), /crm_oauth_state_invalid/);
  const denied = new URL((await f.service.authorize(f.principal)).url).searchParams.get("state")!;
  assert.equal(await f.service.complete(f.principal, denied, undefined, true), null);
  await assert.rejects(f.service.complete(f.principal, denied, "code"), /crm_oauth_state_invalid/);
  assert.equal(f.calls.length, 0); assert.equal(f.saves.length, 0);
});

test("provider errors and incomplete token replies produce only a fixed error and no connection", async t => {
  const f = fixture(t);
  for (const response of [new Response('{"error_description":"private-client-secret"}', { status: 400 }),
    new Response('{"access_token":"private-access","expires_in":1800}')]) {
    globalThis.fetch = async () => response;
    const state = new URL((await f.service.authorize(f.principal)).url).searchParams.get("state")!;
    await assert.rejects(f.service.complete(f.principal, state, "code"), { message: "crm_oauth_token_failed" });
  }
  assert.equal(f.saves.length, 0);
});

test("OAuth authorization fails closed until the SaaS app and shared state storage are configured", async t => {
  const f = fixture(t);
  delete process.env.HUBSPOT_CLIENT_SECRET;
  await assert.rejects(f.service.authorize(f.principal), /crm_oauth_unavailable/);
  process.env.HUBSPOT_CLIENT_SECRET = "private-client-secret";
  const noRedis = new HubSpotOAuthService(f.repo as never, f.adapters as never, null);
  await assert.rejects(noRedis.authorize(f.principal), /crm_oauth_unavailable/);
  assert.equal(f.entries.size, 0);
});

test("expired HubSpot tokens refresh once under a shared lease and remain scoped to their merchant", async t => {
  const f = fixture(t);
  const current = { id: "connection-a", merchantId: "merchant-a", provider: "hubspot", status: "connected",
    config: { authType: "oauth" }, accessTokenCipher: encryptCrmSecret("old-access"), refreshTokenCipher: encryptCrmSecret("old-refresh"), tokenExpiresAt: new Date(0) };
  f.setConnection(current);
  const results = await Promise.allSettled([f.service.accessToken(current as never), f.service.accessToken(current as never)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.updates.length, 1);
  assert.equal(f.calls[0].fields.get("grant_type"), "refresh_token");
  assert.equal(f.calls[0].fields.get("refresh_token"), "old-refresh");
  assert.equal(f.updates[0].merchantId, "merchant-a");
  assert.equal(f.updates[0].id, "connection-a");
  assert.equal(await f.service.accessToken(f.getConnection()), "private-access");
  assert.equal(f.calls.length, 1);
});

test("a connection removed during refresh cannot be recreated or sent to the provider", async t => {
  const f = fixture(t);
  const current = { id: "connection-a", merchantId: "merchant-a", provider: "hubspot", config: { authType: "oauth" },
    accessTokenCipher: encryptCrmSecret("old-access"), tokenExpiresAt: new Date(0) };
  await assert.rejects(f.service.accessToken(current as never), /crm_oauth_connection_invalid/);
  assert.equal(f.calls.length, 0); assert.equal(f.updates.length, 0);
});

test("new HubSpot customers cannot bypass the public OAuth flow using a private-app token", async () => {
  const service = new ConnectCrmUseCase({} as never, new CrmAdapterFactory());
  await assert.rejects(service.execute({ merchantId: "merchant-a", provider: "hubspot", accessToken: "private-token" }), /crm_oauth_required/);
});
