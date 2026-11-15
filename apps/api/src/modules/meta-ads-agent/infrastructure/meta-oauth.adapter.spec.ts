import assert from "node:assert/strict";
import { test } from "node:test";
import { MetaOAuthAdapter } from "./meta-oauth.adapter.js";

const env = { META_ADS_OAUTH_APP_ID: "123456", META_ADS_OAUTH_APP_SECRET: "test-app-secret", META_ADS_GRAPH_API_VERSION: "v26.0", META_ADS_OAUTH_REDIRECT_URI: "https://dashboard.example.test/meta-ads/callback" };

test("MGA-16 the registered dashboard module callback preserves its exact tab query and rejects extra parameters", () => {
  const callback = "https://dashboard.example.test/?tab=meta-ads-agent";
  const adapter = new MetaOAuthAdapter({...env, META_ADS_OAUTH_REDIRECT_URI: callback});
  assert.equal(adapter.configured(), true);
  const url = new URL(adapter.authorizationUrl("a".repeat(48), callback));
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.get("scope")!.includes("ads_mcp_management"), true);
  assert.throws(() => adapter.authorizationUrl("a".repeat(48), callback + "&next=https://other.example.test"), {code: "meta_oauth_redirect_invalid"});
  for (const query of ["?tab=other", "?tab=meta-ads-agent&next=https://other.example.test", "?tab=meta-ads-agent#fragment"]) assert.equal(new MetaOAuthAdapter({...env, META_ADS_OAUTH_REDIRECT_URI: "https://dashboard.example.test/" + query}).configured(), false);
});
test("OAuth requests a server code with scoped permissions, state and an exact trusted redirect", () => {
  const adapter = new MetaOAuthAdapter(env); const state = "a".repeat(48);
  const url = new URL(adapter.authorizationUrl(state, env.META_ADS_OAUTH_REDIRECT_URI));
  assert.equal(url.origin, "https://www.facebook.com"); assert.equal(url.pathname, "/v26.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "123456"); assert.equal(url.searchParams.get("response_type"), "code"); assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("redirect_uri"), env.META_ADS_OAUTH_REDIRECT_URI); assert.equal(url.searchParams.get("scope")!.includes("ads_mcp_management"), true);
  assert.equal(url.href.includes("test-app-secret"), false);
  assert.throws(() => adapter.authorizationUrl(state, "https://attacker.example.test/callback"), { code: "meta_oauth_redirect_invalid" });
  assert.throws(() => adapter.authorizationUrl("short", env.META_ADS_OAUTH_REDIRECT_URI), { code: "meta_oauth_state_invalid" });
});
test("OAuth exchanges and extends the code only on the server, then verifies app and actual scopes", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const body = requests.length === 1 ? { access_token: "short-token", expires_in: 3600 }
      : requests.length === 2 ? { access_token: "long-token", expires_in: 5184000 }
      : { data: { is_valid: true, app_id: "123456", scopes: ["ads_mcp_management", "ads_read"], expires_at: 1800000000 } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await new MetaOAuthAdapter(env, request).exchange("one-time-code", env.META_ADS_OAUTH_REDIRECT_URI);
  assert.equal(result.accessToken, "long-token"); assert.deepEqual(result.scopes, ["ads_mcp_management", "ads_read"]); assert.equal(result.expiresAt, new Date(1800000000000).toISOString());
  assert.equal(requests[0].url, "https://graph.facebook.com/v26.0/oauth/access_token");
  assert.equal(requests[0].init!.method, "POST"); assert.equal(new URLSearchParams(String(requests[0].init!.body)).get("code"), "one-time-code");
  assert.equal(new URLSearchParams(String(requests[1].init!.body)).get("grant_type"), "fb_exchange_token");
  assert.equal(new URLSearchParams(String(requests[1].init!.body)).get("fb_exchange_token"), "short-token");
  assert.equal(new URL(requests[2].url).pathname, "/v26.0/debug_token");
  assert.equal(requests[0].url.includes("test-app-secret"), false);
});
test("OAuth rejects wrong app, invalid tokens and missing MCP permission without leaking the token", async () => {
  for (const data of [{ is_valid: false, app_id: "123456", scopes: [] }, { is_valid: true, app_id: "other", scopes: ["ads_mcp_management", "ads_read"] }, { is_valid: true, app_id: "123456", scopes: ["ads_read"] }]) {
    const request: typeof fetch = async url => new Response(JSON.stringify(String(url).includes("debug_token") ? { data } : { access_token: "never-expose-this", expires_in: 3600 }));
    await assert.rejects(new MetaOAuthAdapter(env, request).exchange("code", env.META_ADS_OAUTH_REDIRECT_URI), { code: "meta_oauth_permission_denied" });
  }
  await assert.rejects(new MetaOAuthAdapter(env, async () => new Response(JSON.stringify({ error: { message: "secret-token" } }), { status: 400 })).exchange("code", env.META_ADS_OAUTH_REDIRECT_URI), error => error instanceof Error && error.message === "meta_oauth_exchange_failed");
});
test("OAuth remains unavailable without complete valid server configuration", () => {
  for (const config of [{}, { ...env, META_ADS_GRAPH_API_VERSION: "latest" }, { ...env, META_ADS_OAUTH_REDIRECT_URI: "https://user:password@evil.example.test/cb" }]) {
    const adapter = new MetaOAuthAdapter(config); assert.equal(adapter.configured(), false);
    assert.throws(() => adapter.authorizationUrl("a".repeat(48), env.META_ADS_OAUTH_REDIRECT_URI), { code: "meta_oauth_not_configured" });
  }
});
