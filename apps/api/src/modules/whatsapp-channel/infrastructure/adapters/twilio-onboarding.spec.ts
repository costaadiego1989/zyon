import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { MetaSignupAuthorizationAdapter } from "./meta-signup-authorization.adapter.js";
import { encodeWhatsAppCredentials, decodeWhatsAppCredentials } from "../repositories/whatsapp-credential-codec.js";

const input = { code: "signup-code", wabaId: "123456789", phoneNumberId: "987654321" };

function environment(t: TestContext) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    META_EMBEDDED_SIGNUP_APP_ID: "123456",
    META_EMBEDDED_SIGNUP_CONFIGURATION_ID: "234567",
    META_APP_SECRET: "meta-test-secret",
    AACP_PII_ENC_KEY: "test-key",
  });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); });
}

test("Meta authorization exchanges the code and accepts only the granted WABA phone", async t => {
  environment(t);
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: "merchant-token", expires_in: 3600 });
    if (url.pathname.endsWith("/debug_token")) return Response.json({ data: { is_valid: true, app_id: "123456", granular_scopes: [
      { scope: "whatsapp_business_management", target_ids: [input.wabaId] },
    ] } });
    assert.equal(url.pathname, `/v23.0/${input.wabaId}/phone_numbers`);
    return Response.json({ data: [{ id: input.phoneNumberId, display_phone_number: "+55 11 99999-9999" }] });
  });
  const authorized = await new MetaSignupAuthorizationAdapter().authorize(input);
  assert.equal(authorized.accessToken, "merchant-token");
  assert.equal(authorized.whatsappNumber, "+5511999999999");
  assert.equal(authorized.wabaId, input.wabaId);
});

test("Meta authorization rejects a WABA missing from the code grant", async t => {
  environment(t);
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: "merchant-token" });
    return Response.json({ data: { is_valid: true, app_id: "123456", granular_scopes: [
      { scope: "whatsapp_business_management", target_ids: ["another-waba"] },
    ] } });
  });
  await assert.rejects(new MetaSignupAuthorizationAdapter().authorize(input), /META_ASSET_NOT_AUTHORIZED/);
});

test("subscription and readback use the merchant token against the exact WABA", async t => {
  environment(t);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === "POST") return Response.json({ success: true });
    return Response.json({ data: [{ id: "123456" }] });
  });
  const adapter = new MetaSignupAuthorizationAdapter();
  await adapter.subscribe({ accessToken: "merchant-token", wabaId: input.wabaId });
  assert.equal(await adapter.isSubscribed({ accessToken: "merchant-token", wabaId: input.wabaId }), true);
  assert.equal(calls[0]?.url, `https://graph.facebook.com/v23.0/${input.wabaId}/subscribed_apps`);
  assert.equal(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer merchant-token");
  assert.ok(calls[1]?.url.includes(`/v23.0/${input.wabaId}/subscribed_apps`));
});

test("subscription distinguishes a definite Meta refusal from an unknown transport outcome", async t => {
  environment(t);
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: {} }, { status: 400 }));
  const adapter = new MetaSignupAuthorizationAdapter();
  await assert.rejects(adapter.subscribe({ accessToken: "token", wabaId: input.wabaId }), /META_SUBSCRIPTION_FAILED/);
  mock.mock.mockImplementation(async () => { throw new Error("network unavailable"); });
  await assert.rejects(adapter.subscribe({ accessToken: "token", wabaId: input.wabaId }), (error: any) => error.code === "META_SUBSCRIPTION_UNKNOWN" && error.uncertain === true);
});

test("credential codec encrypts a direct Meta token while retaining searchable routing IDs", t => {
  environment(t);
  const credentials = { accessToken: "merchant-token", wabaId: input.wabaId, phoneNumberId: input.phoneNumberId };
  const encrypted = encodeWhatsAppCredentials(credentials);
  assert.notEqual(encrypted.accessToken, credentials.accessToken);
  assert.equal(encrypted.phoneNumberId, credentials.phoneNumberId);
  assert.deepEqual(decodeWhatsAppCredentials(encrypted), credentials);
});
