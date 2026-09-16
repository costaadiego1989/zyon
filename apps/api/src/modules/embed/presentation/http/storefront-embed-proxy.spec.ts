import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { storefrontRequestOrigin } from "../../../../../../storefront/src/lib/platform-hostname.js";

type ProxyRoute = (request: Request, context: { params: Promise<{ path: string[] }> }) => Promise<Response>;

function route(upstream: typeof fetch): ProxyRoute {
  const sourceUrl = new URL("../../../../../../storefront/src/app/api/embed/[...path]/route.ts", import.meta.url);
  const source = fs.readFileSync(sourceUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} as { POST: ProxyRoute } };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => name === "@/lib/platform-hostname" ? { storefrontRequestOrigin } : createRequire(sourceUrl)(name),
    process: { env: { INTERNAL_SERVICE_TOKEN: "unit-test-service-token", AACP_API_URL: "https://api.example" } },
    URL,
    Headers,
    AbortSignal,
    crypto: webcrypto,
    fetch: upstream,
  }, { filename: sourceUrl.pathname });
  return module.exports.POST;
}

function request(options: { origin?: string; authorization?: string } = {}): Request {
  return new Request("https://store.example/api/embed/start", {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://store.example",
      "Content-Type": "application/json",
      ...(options.authorization ? { authorization: options.authorization } : {}),
    },
    body: JSON.stringify({ merchant_id: "merchant" }),
  });
}

function startContext() {
  return { params: Promise.resolve({ path: ["start"] }) };
}

test("storefront embed proxy refuses browser requests before exposing its service credential", async () => {
  let delegated = 0;
  const post = route(async () => { delegated += 1; throw new Error("must_not_delegate"); });

  assert.equal((await post(request({ origin: "https://attacker.example", authorization: "Bearer token" }), startContext())).status, 403);
  assert.equal((await post(request(), startContext())).status, 401);
  assert.equal(delegated, 0);
});

test("storefront embed proxy forwards a verified origin only with the server credential", async () => {
  let delegated: { url: string; init?: RequestInit } | undefined;
  const post = route(async (url, init) => {
    delegated = { url: String(url), init };
    return Response.json({ session_id: "checkout_session" });
  });

  const response = await post(request({ authorization: "Bearer signed-embed-token" }), startContext());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(delegated?.url, "https://api.example/embed/start");
  const headers = delegated?.init?.headers as Headers;
  assert.equal(headers.get("authorization"), "Bearer signed-embed-token");
  assert.equal(headers.get("x-internal-service-token"), "unit-test-service-token");
  assert.equal(headers.get("x-trusted-storefront-origin"), "https://store.example");
});

test("standalone embed proxy authenticates the public HTTPS origin and rejects a foreign browser origin", async () => {
  let calls = 0;
  const post = route(async (_url, init) => {
    calls++;
    assert.equal((init!.headers as Headers).get("x-trusted-storefront-origin"), "https://store.example");
    return Response.json({ session_id: "checkout_session" });
  });
  const standalone = (origin: string) => new Request("http://0.0.0.0:8080/api/embed/start", {
    method: "POST", headers: { host: "store.example", "x-forwarded-proto": "https", origin, authorization: "Bearer token" }, body: "{}",
  });
  assert.equal((await post(standalone("https://store.example"), startContext())).status, 200);
  assert.equal((await post(standalone("https://attacker.example"), startContext())).status, 403);
  assert.equal(calls, 1);
});
