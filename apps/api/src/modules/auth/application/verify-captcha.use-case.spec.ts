import test from "node:test";
import assert from "node:assert/strict";
import { VerifyCaptchaUseCase } from "./verify-captcha.use-case.js";
import { CloudflareTurnstileAdapter } from "../infrastructure/cloudflare-turnstile.adapter.js";

test("production cannot skip CAPTCHA when the verifier or secret is missing", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(() => new VerifyCaptchaUseCase().assertAllowed({}), (error: any) => error.getStatus() === 503);
    const missingSecret = new VerifyCaptchaUseCase({ verify: async () => ({ success: false, reason: "not-configured" }) });
    await assert.rejects(() => missingSecret.assertAllowed({}), (error: any) => error.getResponse().code === "captcha_unavailable");
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("configured development requires valid tokens and forwards the expected form action", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  let seen: unknown;
  try {
    const useCase = new VerifyCaptchaUseCase({ verify: async input => { seen = input; return { success: Boolean(input.token), reason: "missing-token" }; } });
    await assert.rejects(() => useCase.assertAllowed({ action: "forgot_password" }), (error: any) => error.getStatus() === 400);
    await useCase.assertAllowed({ token: "valid", remoteIp: "127.0.0.1", action: "forgot_password" });
    assert.deepEqual(seen, { token: "valid", remoteIp: "127.0.0.1", action: "forgot_password" });
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("provider failure does not admit authentication", async () => {
  await assert.rejects(() => new VerifyCaptchaUseCase({ verify: async () => ({ success: false, reason: "verification-http-error" }) }).assertAllowed({ token: "valid" }), (error: any) => error.getStatus() === 503);
});

test("Turnstile validates action, hostname and single use; missing/oversized tokens never reach the provider", async () => {
  const prior = { secret: process.env.TURNSTILE_SECRET_KEY, hosts: process.env.TURNSTILE_ALLOWED_HOSTNAMES };
  const originalFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
  process.env.TURNSTILE_ALLOWED_HOSTNAMES = "store.example";
  let calls = 0;
  const used = new Set<string>();
  globalThis.fetch = (async (_url, init) => {
    calls++;
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("secret"), "test-turnstile-secret");
    const token = body.get("response")!;
    if (used.has(token)) return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
    used.add(token);
    return Response.json({ success: true, action: token === "wrong-action" ? "signup" : "login", hostname: token === "wrong-host" ? "attacker.example" : "store.example" });
  }) as typeof fetch;
  try {
    const adapter = new CloudflareTurnstileAdapter();
    assert.equal((await adapter.verify({ token: "" })).success, false);
    assert.equal((await adapter.verify({ token: "a".repeat(2049) })).success, false);
    assert.equal(calls, 0);
    assert.equal((await adapter.verify({ token: "good", action: "login" })).success, true);
    assert.equal((await adapter.verify({ token: "good", action: "login" })).success, false);
    assert.equal((await adapter.verify({ token: "wrong-action", action: "login" })).reason, "action-mismatch");
    assert.equal((await adapter.verify({ token: "wrong-host", action: "login" })).reason, "hostname-mismatch");
  } finally {
    globalThis.fetch = originalFetch;
    if (prior.secret === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = prior.secret;
    if (prior.hosts === undefined) delete process.env.TURNSTILE_ALLOWED_HOSTNAMES; else process.env.TURNSTILE_ALLOWED_HOSTNAMES = prior.hosts;
  }
});
