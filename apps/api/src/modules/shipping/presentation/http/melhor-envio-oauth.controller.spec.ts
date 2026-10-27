import "reflect-metadata";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MelhorEnvioOAuthController } from "./melhor-envio-oauth.controller.js";
import { decryptCommerceSecret } from "../../../commerce/infrastructure/commerce-secret-cipher.js";

const keys = ["NODE_ENV", "MELHOR_ENVIO_BASE_URL", "DASHBOARD_URL", "MELHOR_ENVIO_CLIENT_ID", "MELHOR_ENVIO_REDIRECT_URI", "OAUTH_STATE_SECRET", "AACP_COMMERCE_ENC_KEY"];
const original = new Map(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.MELHOR_ENVIO_BASE_URL = "https://api.melhorenvio.com.br/";
  process.env.DASHBOARD_URL = "https://app.example.test";
  process.env.MELHOR_ENVIO_CLIENT_ID = "test-client";
  process.env.MELHOR_ENVIO_REDIRECT_URI = "https://api.example.test/shipping/melhor-envio/callback";
  process.env.OAUTH_STATE_SECRET = "shipping-oauth-test-secret";
  process.env.AACP_COMMERCE_ENC_KEY = "shipping-token-encryption-test-key";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function setup(returnTo = "onboarding") {
  const writes: any[] = [];
  const controller = new MelhorEnvioOAuthController({ merchant: { update: async (input: any) => { writes.push(input); return {}; } } } as any);
  let redirect = "";
  const res = { redirect: (status: number, url: string) => { assert.equal(status, 302); redirect = url; } };
  controller.authorize({ user: { merchantId: "merchant-a" } }, res, returnTo);
  const authorize = new URL(redirect);
  return { controller, writes, res, authorize, state: authorize.searchParams.get("state")!, redirect: () => new URL(redirect) };
}

test("authorizes at the official production origin with the registered callback", () => {
  const { authorize } = setup();
  assert.equal(authorize.origin, "https://melhorenvio.com.br");
  assert.equal(authorize.searchParams.get("redirect_uri"), process.env.MELHOR_ENVIO_REDIRECT_URI);
  assert.equal(authorize.searchParams.get("client_id"), "test-client");
  assert.ok(!authorize.searchParams.get("scope")!.includes("webhooks-"));
});

test("stores encrypted tokens for the signed merchant and returns to onboarding", async () => {
  const run = setup();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://melhorenvio.com.br/oauth/token");
    assert.ok(new Headers(init?.headers).get("User-Agent"));
    assert.ok(init?.signal);
    return new Response(JSON.stringify({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 }));
  };
  await run.controller.callback("test-code", run.state, run.res);
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].where.id, "merchant-a");
  assert.equal(decryptCommerceSecret(run.writes[0].data.melhorEnvioAccessToken), "test-access");
  assert.equal(decryptCommerceSecret(run.writes[0].data.melhorEnvioRefreshToken), "test-refresh");
  assert.equal(run.redirect().origin, "https://app.example.test");
  assert.equal(run.redirect().hash, "#onboarding");
  assert.equal(run.redirect().searchParams.get("shipping_connected"), "melhor_envio");
});

test("cancellation returns to the originating page without a token exchange", async () => {
  const run = setup("delivery");
  globalThis.fetch = async () => { throw new Error("must not fetch"); };
  await run.controller.callback("", run.state, run.res);
  assert.equal(run.redirect().origin, "https://app.example.test");
  assert.equal(run.redirect().hash, "#delivery");
  assert.equal(run.redirect().searchParams.get("shipping_error"), "denied");
  assert.equal(run.writes.length, 0);
});

test("a changed merchant or return destination cannot reuse a signed state", async () => {
  const run = setup();
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("must not fetch"); };
  for (const state of [run.state.replace("merchant-a", "merchant-b"), run.state.replace("onboarding", "delivery")]) {
    await run.controller.callback("test-code", state, run.res);
    assert.equal(run.redirect().searchParams.get("shipping_error"), "invalid_state");
  }
  assert.equal(fetched, false);
  assert.equal(run.writes.length, 0);
});

test("network, token rejection and malformed token responses return recoverable dashboard errors", async () => {
  const run = setup();
  for (const fetcher of [
    async () => { throw new Error("network unavailable"); },
    async () => new Response("{}", { status: 400 }),
    async () => new Response(JSON.stringify({ access_token: "test-access" })),
  ]) {
    globalThis.fetch = fetcher;
    await run.controller.callback("test-code", run.state, run.res);
    assert.equal(run.redirect().origin, "https://app.example.test");
    assert.equal(run.redirect().hash, "#onboarding");
    assert.ok(run.redirect().searchParams.has("shipping_error"));
  }
  assert.equal(run.writes.length, 0);
});
