import test from "node:test";
import assert from "node:assert/strict";
import { POST as startConversation } from "../app/api/storefront-conversations/route.js";
import { POST as proxyPost, GET as proxyGet } from "../app/api/storefront-proxy/[...path]/route.js";

type OriginCase = { name: string; url?: string; host?: string; origin?: string; extra?: Record<string, string>; allowed: boolean };
const cases: OriginCase[] = [
  { name: "exact raw127 survives Next normalization", host: "127.0.0.1:5188", origin: "http://127.0.0.1:5188", allowed: true },
  { name: "localhost Origin cannot borrow raw127 Host", host: "127.0.0.1:5188", origin: "http://localhost:5188", allowed: false },
  { name: "rawlocalhost does not authorize127 Origin", host: "localhost:5188", origin: "http://127.0.0.1:5188", allowed: false },
  { name: "raw Host port mismatch", host: "127.0.0.1:5189", origin: "http://127.0.0.1:5188", allowed: false },
  { name: "Origin port mismatch", host: "127.0.0.1:5188", origin: "http://127.0.0.1:5189", allowed: false },
  { name: "Origin scheme mismatch", host: "127.0.0.1:5188", origin: "https://127.0.0.1:5188", allowed: false },
  { name: "foreign Origin", host: "127.0.0.1:5188", origin: "https://foreign.example.test", allowed: false },
  { name: "null Origin", host: "127.0.0.1:5188", origin: "null", allowed: false },
  { name: "missing Origin", host: "127.0.0.1:5188", allowed: false },
  { name: "missing Host does not project127", origin: "http://127.0.0.1:5188", allowed: false },
  { name: "other127 addresses are not added", host: "127.0.0.2:5188", origin: "http://127.0.0.2:5188", allowed: false },
  { name: "malformed raw Host", host: "127.0.0.1:5188@foreign.example.test", origin: "http://127.0.0.1:5188", allowed: false },
  { name: "forwarded protocol cannot change local scheme", host: "127.0.0.1:5188", origin: "https://127.0.0.1:5188", extra: { "x-forwarded-proto": "https" }, allowed: false },
  { name: "forwarded Host without Railway cannot expand trust", host: "127.0.0.1:5188", origin: "https://foreign.example.test", extra: { "x-forwarded-host": "foreign.example.test", "x-forwarded-proto": "https" }, allowed: false },
  { name: "URL HTTPS protocol is preserved", url: "https://localhost:5188", host: "127.0.0.1:5188", origin: "https://127.0.0.1:5188", allowed: true },
  { name: "public domain matching behavior remains", url: "https://store.example.test", host: "store.example.test", origin: "https://store.example.test", allowed: true },
  { name: "public URL cannot be reinterpreted as127", url: "https://store.example.test", host: "127.0.0.1:5188", origin: "http://127.0.0.1:5188", allowed: false },
  { name: "Railway verified public Origin remains", url: "http://internal.example:3000", host: "internal.example:3000", origin: "https://store.example.test", extra: { "x-railway-edge": "synthetic", "x-forwarded-host": "store.example.test", "x-forwarded-proto": "https" }, allowed: true },
  { name: "Railway foreign Origin remains rejected", url: "http://internal.example:3000", host: "internal.example:3000", origin: "https://foreign.example.test", extra: { "x-railway-edge": "synthetic", "x-forwarded-host": "store.example.test", "x-forwarded-proto": "https" }, allowed: false },
];
function headers(value: OriginCase): Record<string, string> {
  return { "content-type": "application/json", ...(value.host === undefined ? {} : { host: value.host }),
    ...(value.origin === undefined ? {} : { origin: value.origin }), ...value.extra };
}

test("real POST handlers preserve exact Origin boundaries before backend access", async t => {
  const originalFetch = globalThis.fetch;
  let backendCalls = 0;
  globalThis.fetch = async () => { backendCalls++; throw Error("unexpected_backend_call"); };
  try {
    for (const value of cases) await t.test(value.name, async () => {
      const request = () => new Request((value.url ?? "http://localhost:5188") + "/api/storefront-conversations", {
        method: "POST", headers: headers(value), body: "{}",
      });
      const start = await startConversation(request());
      assert.equal(start.status, value.allowed ? 400 : 403);
      assert.deepEqual(await start.json(), { error: value.allowed ? "merchant_id_required" : "origin_not_allowed" });
      const proxy = await proxyPost(request(), { params: Promise.resolve({ path: ["conversations", "synthetic-conversation", "messages"] }) });
      assert.equal(proxy.status, value.allowed ? 401 : 403);
      assert.deepEqual(await proxy.json(), { error: value.allowed ? "conversation_access_required" : "origin_not_allowed" });
      assert.equal(backendCalls, 0);
    });
    await t.test("Railway same-origin GET retains its Fetch Metadata fence", async () => {
      const base = { host: "internal.example:3000", "x-railway-edge": "synthetic", "x-forwarded-host": "store.example.test", "x-forwarded-proto": "https" };
      for (const site of ["same-origin", "cross-site"]) {
        const response = await proxyGet(new Request("http://internal.example:3000/api/storefront-proxy/conversations/synthetic-conversation/history", {
          headers: { ...base, "sec-fetch-site": site },
        }), { params: Promise.resolve({ path: ["conversations", "synthetic-conversation", "history"] }) });
        assert.equal(response.status, site === "same-origin" ? 401 : 403);
      }
      assert.equal(backendCalls, 0);
    });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(globalThis.fetch, originalFetch);
});
