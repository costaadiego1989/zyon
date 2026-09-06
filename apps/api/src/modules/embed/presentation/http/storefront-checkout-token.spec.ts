import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import ts from "typescript";

// Execute the actual Next route with a mocked upstream, without a Next dev server
// or a service credential from the environment. NextResponse remains the real class.
function route(upstream: typeof fetch) {
  const sourceUrl = new URL("../../../../../../storefront/src/app/api/checkout-token/route.ts", import.meta.url);
  const source = fs.readFileSync(sourceUrl, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, require: createRequire(sourceUrl),
    process: { env: { INTERNAL_SERVICE_TOKEN: "unit-test-service-token", AACP_API_URL: "https://api.example" } },
    URL, AbortSignal, crypto: webcrypto, fetch: upstream,
  }, { filename: sourceUrl.pathname });
  return module.exports.POST;
}

function request(body: unknown, origin = "https://a.example") {
  return new Request("https://a.example/api/checkout-token", {
    method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("storefront token proxy rejects arbitrary origin and borrowed cart before delegating its service credential", async () => {
  let delegated = 0;
  const post = route(async () => { delegated += 1; throw new Error("must_not_delegate"); });
  assert.equal((await post(request({ merchant_id: "a" }, "https://attacker.example"))).status, 403);
  assert.equal((await post(request({ merchant_id: "a", allowed_origin: "https://b.example" }))).status, 403);
  assert.equal((await post(request({ merchant_id: "a", cart_ref: "victim-cart" }))).status, 403);
  assert.equal(delegated, 0);
});

test("storefront token proxy binds observed origin, fixed scopes and short TTL, and keeps tokens uncached", async () => {
  let delegated: { url: string; init?: RequestInit } | undefined;
  const post = route(async (url, init) => {
    delegated = { url: String(url), init };
    return Response.json({ embed_session_token: "signed-unit-test-token", expires_at_unix: 2000 });
  });
  const response = await post(request({ merchant_id: "a", allowed_origin: "https://a.example", ttl_seconds: 86400, scopes: ["admin"] }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(delegated?.url, "https://api.example/embed-sessions");
  const issued = JSON.parse(delegated!.init!.body as string);
  assert.equal(issued.allowed_origin, "https://a.example");
  assert.equal(issued.ttl_seconds, 900);
  assert.equal(issued.cart_ref, undefined);
  assert.ok(!issued.scopes.includes("admin"));
  assert.deepEqual(await response.json(), { embed_session_token: "signed-unit-test-token", expires_at_unix: 2000 });
});
