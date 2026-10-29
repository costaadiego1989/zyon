import test from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { OAuthProviderAdapter } from "./oauth-provider.adapter.js";

const proof = { codeVerifier: "a".repeat(43) };
function discovery(url: string) {
  if (url === "https://accounts.google.com/.well-known/openid-configuration") return new Response(JSON.stringify({
    token_endpoint: "https://oauth2.googleapis.com/token", userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  }), { headers: { "Cache-Control": "public, max-age=3600" } });
  if (url === "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration") return new Response(JSON.stringify({
    token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token", userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
  }), { headers: { "Cache-Control": "public, max-age=3600" } });
  return undefined;
}

for (const provider of ["google", "github", "microsoft", "facebook"] as const) {
  test(`${provider}: expired code returns a restartable authentication error`, async t => {
    t.mock.method(globalThis, "fetch", async (url: string) => discovery(url) ?? new Response(JSON.stringify({ error: provider === "facebook" ? { code: 100 } : provider === "github" ? "bad_verification_code" : "invalid_grant" }), { status: 400 }));
    const prefix = provider.toUpperCase();
    const before = { ...process.env };
    process.env[`${prefix}_CLIENT_ID`] = "test-client";
    process.env[`${prefix}_CLIENT_SECRET`] = "test-secret";
    process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
    try {
      await assert.rejects(() => new OAuthProviderAdapter().exchangeCodeForProfile(provider, "expired-code", proof), (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 401);
        assert.equal((error.getResponse() as { code: string }).code, "oauth_code_expired");
        return true;
      });
    } finally { process.env = before; }
  });
}

for (const provider of ["google", "github"] as const) {
  test(`${provider}: returns verified profile and sends configured callback`, async t => {
    const before = { ...process.env };
    process.env[`${provider.toUpperCase()}_CLIENT_ID`] = "test-client";
    process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] = "test-secret";
    process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
    const requests: { url: string; init?: RequestInit }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      const metadata = discovery(url); if (metadata) return metadata;
      requests.push({ url, init });
      const body = requests.length === 1 ? { access_token: "fake-access-token" }
        : url.endsWith("/emails") ? [{ email: "verified@example.test", primary: true, verified: true }]
        : { id: "123", sub: "123", name: "Ana", login: "ana", email: provider === "github" ? "unverified@example.test" : "verified@example.test", email_verified: true, hd: "example.test" };
      return new Response(JSON.stringify(body));
    });
    try {
      const profile = await new OAuthProviderAdapter().exchangeCodeForProfile(provider, "new-code");
      assert.equal(profile.email, "verified@example.test");
      assert.equal(profile.name, "Ana");
      assert.ok(String(requests[0]?.init?.body).includes(provider === "google" ? encodeURIComponent(process.env.OAUTH_REDIRECT_URI) : process.env.OAUTH_REDIRECT_URI));
      assert.ok(requests.every(request => request.init?.signal));
    } finally { process.env = before; }
  });
}

test("Microsoft exchanges a code server-side and uses the provider subject, never the display email as an identity", async t => {
  const before = { ...process.env };
  process.env.MICROSOFT_CLIENT_ID = "synthetic-client";
  process.env.MICROSOFT_CLIENT_SECRET = "synthetic-private-secret";
  process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const metadata = discovery(url); if (metadata) return metadata;
    requests.push({ url, init });
    return new Response(JSON.stringify(requests.length === 1 ? { access_token: "opaque-provider-token" }
      : { sub: "immutable-subject", email: "ana@example.test", name: "Ana", preferred_username: "other@example.test" }));
  });
  try {
    const profile = await new OAuthProviderAdapter().exchangeCodeForProfile("microsoft", "code", proof);
    assert.equal(profile.providerId, "immutable-subject");
    assert.equal(profile.email, "ana@example.test");
    assert.equal(profile.emailVerified, false);
    const form = new URLSearchParams(String(requests[0]!.init!.body));
    assert.equal(form.get("redirect_uri"), process.env.OAUTH_REDIRECT_URI);
    assert.equal(form.get("client_secret"), process.env.MICROSOFT_CLIENT_SECRET);
    assert.equal(form.get("code_verifier"), proof.codeVerifier);
    assert.equal(requests[1]!.url, "https://graph.microsoft.com/oidc/userinfo");
    assert.ok(requests.every(request => request.init?.signal));
  } finally { process.env = before; }
});

for (const scenario of ["valid", "wrong-app", "invalid-token", "wrong-subject", "missing-email"] as const) {
  test(`Facebook token ownership: ${scenario}`, async t => {
    const before = { ...process.env };
    process.env.FACEBOOK_CLIENT_ID = "synthetic-app";
    process.env.FACEBOOK_CLIENT_SECRET = "synthetic-private-secret";
    process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
    const requests: { url: string; init?: RequestInit }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const body = url.includes("/oauth/access_token") ? { access_token: "opaque-provider-token" }
        : url.includes("/debug_token") ? { data: { is_valid: scenario !== "invalid-token", app_id: scenario === "wrong-app" ? "another-app" : "synthetic-app", user_id: "facebook-subject" } }
        : { id: scenario === "wrong-subject" ? "another-subject" : "facebook-subject", email: scenario === "missing-email" ? undefined : "ana@example.test", name: "Ana" };
      return new Response(JSON.stringify(body));
    });
    try {
      const action = () => new OAuthProviderAdapter().exchangeCodeForProfile("facebook", "code");
      if (scenario !== "valid") {
        await assert.rejects(action, (error: unknown) => error instanceof HttpException && error.getStatus() >= 400);
        if (scenario === "wrong-app" || scenario === "invalid-token") assert.equal(requests.length, 2);
      } else {
        const profile = await action();
        assert.equal(profile.providerId, "facebook-subject");
        assert.equal(profile.emailVerified, false);
        assert.equal(new URLSearchParams(String(requests[0]!.init!.body)).get("redirect_uri"), process.env.OAUTH_REDIRECT_URI);
        assert.match(new URL(requests[2]!.url).searchParams.get("appsecret_proof")!, /^[a-f0-9]{64}$/);
        const profileUrl = new URL(requests[2]!.url);
        const timestamp = profileUrl.searchParams.get("appsecret_time")!;
        assert.ok(Math.abs(Number(timestamp) - Date.now() / 1000) < 5);
        assert.equal(profileUrl.searchParams.get("appsecret_proof"), createHmac("sha256", process.env.FACEBOOK_CLIENT_SECRET!).update(`opaque-provider-token|${timestamp}`).digest("hex"));
        assert.ok(requests.every(request => request.init?.signal));
        assert.ok(requests.every(request => !request.url.includes("synthetic-private-secret")));
      }
    } finally { process.env = before; }
  });
}

test("Microsoft never substitutes preferred_username when email is missing", async t => {
  const before = { ...process.env };
  process.env.MICROSOFT_CLIENT_ID = "synthetic-client";
  process.env.MICROSOFT_CLIENT_SECRET = "synthetic-secret";
  process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => discovery(url) ?? new Response(JSON.stringify(++calls === 1
    ? { access_token: "opaque-token" } : { sub: "subject", preferred_username: "untrusted@example.test" })));
  try {
    await assert.rejects(() => new OAuthProviderAdapter().exchangeCodeForProfile("microsoft", "code", proof), (error: unknown) =>
      error instanceof HttpException && (error.getResponse() as { code: string }).code === "oauth_email_required");
  } finally { process.env = before; }
});

test("OAuth network failures return 503 without leaking credentials", async t => {
  const before = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "private-value";
  process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private-value"); });
  try {
    await assert.rejects(() => new OAuthProviderAdapter().exchangeCodeForProfile("google", "code"), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 503);
      assert.ok(!JSON.stringify(error.getResponse()).includes("private-value"));
      return true;
    });
  } finally { process.env = before; }
});

for (const scenario of ["gmail", "workspace", "external"] as const) {
  test(`Google email ownership policy: ${scenario}`, async t => {
    const before = { ...process.env };
    process.env.GOOGLE_CLIENT_ID = "synthetic-client";
    process.env.GOOGLE_CLIENT_SECRET = "synthetic-secret";
    process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
    t.mock.method(globalThis, "fetch", async (url: string) => discovery(url) ?? new Response(JSON.stringify(
      url.includes("/token") ? { access_token: "opaque-token" }
        : { sub: "google-subject", email: scenario === "gmail" ? "ana@gmail.com" : "ana@example.test", email_verified: true, ...(scenario === "workspace" ? { hd: "example.test" } : {}) },
    )));
    try {
      const profile = await new OAuthProviderAdapter().exchangeCodeForProfile("google", "code", proof);
      assert.equal(profile.providerId, "google-subject");
      assert.equal(profile.emailVerified, scenario !== "external");
    } finally { process.env = before; }
  });
}

test("OIDC discovery is cached and never sends secrets to an untrusted endpoint", async t => {
  const before = { ...process.env };
  process.env.MICROSOFT_CLIENT_ID = "synthetic-client";
  process.env.MICROSOFT_CLIENT_SECRET = "synthetic-private-secret";
  process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
  let metadataCalls = 0;
  let hostile = false;
  const visited: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    visited.push(url);
    if (url.includes(".well-known")) {
      metadataCalls++;
      return hostile ? new Response(JSON.stringify({ token_endpoint: "https://attacker.example.test/token", userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo" })) : discovery(url)!;
    }
    return new Response(JSON.stringify(url.includes("/token") ? { access_token: "opaque-token" } : { sub: "subject", email: "ana@example.test" }));
  });
  try {
    const adapter = new OAuthProviderAdapter();
    await adapter.exchangeCodeForProfile("microsoft", "code-one", proof);
    await adapter.exchangeCodeForProfile("microsoft", "code-two", proof);
    assert.equal(metadataCalls, 1);
    hostile = true;
    await assert.rejects(() => new OAuthProviderAdapter().exchangeCodeForProfile("microsoft", "code-three", proof));
    assert.ok(visited.every(url => !url.includes("attacker.example.test")));
  } finally { process.env = before; }
});

test("Microsoft rejects a missing proof before exchanging a code", async t => {
  const before = { ...process.env };
  process.env.MICROSOFT_CLIENT_ID = "synthetic-client";
  process.env.MICROSOFT_CLIENT_SECRET = "synthetic-secret";
  process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("must not reach provider"); });
  try {
    await assert.rejects(() => new OAuthProviderAdapter().exchangeCodeForProfile("microsoft", "code"), (error: unknown) =>
      error instanceof HttpException && (error.getResponse() as { code: string }).code === "oauth_proof_key_required");
    assert.equal(fetch.mock.callCount(), 0);
  } finally { process.env = before; }
});
