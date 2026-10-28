import assert from "node:assert/strict";
import test from "node:test";
import { PlatformApi, PlatformApiError } from "../src/lib/api.js";

const operator = { operator_id: "test_operator", email: "operator@example.invalid", role: "platform_admin" as const };
const token = (expiresIn: number, id = "first") => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresIn, jti: id })).toString("base64url")}.signature`;
const response = (access_token: string) => ({ ...operator, access_token, token_type: "Bearer" as const, expires_in: 900 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("concurrent requests share one rotation and use the replacement token, including CSV and support", async t => {
  const old = token(-1), next = token(900, "next");
  let rotations = 0, saved = "";
  const headers: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/auth/refresh")) {
      rotations++;
      await new Promise(resolve => setTimeout(resolve, 15));
      return json(response(next));
    }
    headers.push((init.headers as Record<string, string>).Authorization);
    return url.includes("export") ? new Response("day,calls\n") : json(operator);
  });
  const api = new PlatformApi("https://example.invalid", { token: old, onRefreshed: r => { saved = r.access_token; } });
  await Promise.all([api.me(old), api.getOverview(old), api.exportAiCosts(old, {}), api.supportClient(old).capabilities()]);
  assert.equal(rotations, 1);
  assert.equal(saved, next);
  assert.deepEqual(headers, Array(4).fill("Bearer " + next));
  await api.me(old); // Existing UI closures may still carry the old token.
  assert.equal(rotations, 1);
  assert.equal(headers.at(-1), "Bearer " + next);
});

test("simultaneous 401 responses rotate only once and retry each request once", async t => {
  const old = token(900), next = token(900, "next");
  let rotations = 0, attempts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/auth/refresh")) { rotations++; return json(response(next)); }
    attempts++;
    if ((init.headers as Record<string, string>).Authorization === "Bearer " + old) {
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ message: "unauthorized" }, 401);
    }
    return json(operator);
  });
  const api = new PlatformApi("https://example.invalid", { token: old });
  await Promise.all([api.me(old), api.getOverview(old)]);
  assert.equal(rotations, 1);
  assert.equal(attempts, 4);
});

test("transient refresh errors preserve the session and can recover", async t => {
  const old = token(-20), next = token(900, "next");
  let attempts = 0, expired = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/auth/refresh")) {
      attempts++;
      if (attempts === 1) throw new TypeError("offline");
      if (attempts === 2) return json({ message: "unavailable" }, 503);
      return json(response(next));
    }
    return json(operator);
  });
  const api = new PlatformApi("https://example.invalid", { token: old, onExpired: () => { expired++; } });
  await assert.rejects(api.me(old), /offline/);
  await assert.rejects(api.me(old), (e: unknown) => e instanceof PlatformApiError && e.status === 503);
  assert.equal(expired, 0);
  assert.deepEqual(await api.me(old), operator);
});

test("revoked refresh credentials end the session without loops, while permission denials preserve it", async t => {
  const old = token(-1);
  let requests = 0, expired = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return json({ message: "revoked" }, 401); });
  const api = new PlatformApi("https://example.invalid", { token: old, onExpired: () => { expired++; } });
  await assert.rejects(api.me(old), (e: unknown) => e instanceof PlatformApiError && e.status === 401);
  await assert.rejects(api.me(old));
  assert.equal(expired, 1);
  assert.equal(requests, 1);
  const current = token(900);
  t.mock.method(globalThis, "fetch", async () => json({ message: "forbidden" }, 403));
  const limited = new PlatformApi("https://example.invalid", { token: current, onExpired: () => { expired++; } });
  await assert.rejects(limited.me(current), (e: unknown) => e instanceof PlatformApiError && e.status === 403);
  assert.equal(expired, 1);
});

test("logout waits for rotation then revokes its replacement and prevents renewed requests", async t => {
  const old = token(-1), next = token(900, "next");
  let revoked = "";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/auth/refresh")) {
      await new Promise(resolve => setTimeout(resolve, 10));
      return json(response(next));
    }
    if (url.endsWith("/auth/logout")) { revoked = (init.headers as Record<string, string>).Authorization; return new Response(null, { status: 204 }); }
    return json(operator);
  });
  const api = new PlatformApi("https://example.invalid", { token: old });
  const rotating = api.renewSession();
  await api.logout(old);
  await rotating;
  assert.equal(revoked, "Bearer " + next);
  await assert.rejects(api.me(old));
});

test("a browser clock ahead of the API does not repeatedly rotate freshly issued tokens", async t => {
  const old = token(-1), next = token(900, "next");
  const actual = Date.now();
  t.mock.method(Date, "now", () => actual + 16 * 60 * 1000);
  let rotations = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/auth/refresh")) { rotations++; return json(response(next)); }
    return json(operator);
  });
  const api = new PlatformApi("https://example.invalid", { token: old });
  await api.me(old);
  await api.me(old);
  await api.renewSession();
  assert.equal(rotations, 1);
});
