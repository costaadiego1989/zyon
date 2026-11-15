import assert from "node:assert/strict";
import { test } from "node:test";
import { POST, GET } from "../app/api/storefront-proxy/[...path]/route";
test("storefront proxy permits only exact attribution POST actions and forwards the real browser user agent", async () => {
  const originalFetch = globalThis.fetch; const oldToken = process.env.INTERNAL_SERVICE_TOKEN; const oldBase = process.env.AACP_API_URL;
  process.env.INTERNAL_SERVICE_TOKEN = "internal-test-secret"; process.env.AACP_API_URL = "https://api.example.test";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } }); };
  const request = (method: string, origin = "https://store.example.test") => new Request("https://store.example.test/api/storefront-proxy/conversations/conversation-a/meta-ads/attribution", { method, headers: { Authorization: "Bearer conversation-proof", Origin: origin, "Content-Type": "application/json", "User-Agent": "Real-Browser-Test" }, ...(method === "POST" ? { body: "{}" } : {}) });
  try {
    for (const action of ["attribution", "bind", "revoke", "purchase"]) assert.equal((await POST(request("POST"), { params: Promise.resolve({ path: ["conversations", "conversation-a", "meta-ads", action] }) })).status, 200);
    assert.equal(calls.length, 4); assert.equal(calls[0].url, "https://api.example.test/storefront/conversations/conversation-a/meta-ads/attribution"); const headers = new Headers(calls[0].init?.headers); assert.equal(headers.get("User-Agent"), "Real-Browser-Test"); assert.equal(headers.get("Origin"), "https://store.example.test"); assert.equal(headers.get("Authorization"), "Bearer conversation-proof"); assert.equal(headers.get("X-Internal-Service-Token"), "internal-test-secret");
    assert.equal((await GET(request("GET"), { params: Promise.resolve({ path: ["conversations", "conversation-a", "meta-ads", "purchase"] }) })).status, 404);
    assert.equal((await POST(request("POST"), { params: Promise.resolve({ path: ["conversations", "conversation-a", "meta-ads", "arbitrary-tool"] }) })).status, 404);
    assert.equal((await POST(request("POST", "https://evil.example.test"), { params: Promise.resolve({ path: ["conversations", "conversation-a", "meta-ads", "purchase"] }) })).status, 403); assert.equal(calls.length, 4);
  } finally { globalThis.fetch = originalFetch; if (oldToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN; else process.env.INTERNAL_SERVICE_TOKEN = oldToken; if (oldBase === undefined) delete process.env.AACP_API_URL; else process.env.AACP_API_URL = oldBase; }
});
