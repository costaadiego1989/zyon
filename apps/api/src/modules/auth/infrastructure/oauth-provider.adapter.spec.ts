import test from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { OAuthProviderAdapter } from "./oauth-provider.adapter.js";

for (const provider of ["google", "github"] as const) {
  test(`${provider}: expired code returns a restartable authentication error`, async t => {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: provider === "google" ? "invalid_grant" : "bad_verification_code" }), { status: 400 }));
    const prefix = provider.toUpperCase();
    const before = { ...process.env };
    process.env[`${prefix}_CLIENT_ID`] = "test-client";
    process.env[`${prefix}_CLIENT_SECRET`] = "test-secret";
    try {
      await assert.rejects(() => new OAuthProviderAdapter().exchangeCodeForProfile(provider, "expired-code"), (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 401);
        assert.equal((error.getResponse() as { code: string }).code, "oauth_code_expired");
        return true;
      });
    } finally { process.env = before; }
  });
  test(`${provider}: returns verified profile and sends configured callback`, async t => {
    const before = { ...process.env };
    process.env[`${provider.toUpperCase()}_CLIENT_ID`] = "test-client";
    process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] = "test-secret";
    process.env.OAUTH_REDIRECT_URI = "https://app.example.test/auth/oauth/callback";
    const requests: { url: string; init?: RequestInit }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const body = requests.length === 1 ? { access_token: "fake-access-token" }
        : url.endsWith("/emails") ? [{ email: "verified@example.test", primary: true, verified: true }]
        : { id: "123", name: "Ana", login: "ana", email: provider === "github" ? "unverified@example.test" : "verified@example.test", verified_email: true };
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

test("OAuth network failures return 503 without leaking credentials", async t => {
  const before = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "private-value";
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
