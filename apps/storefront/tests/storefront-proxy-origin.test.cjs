const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Run with: node --test tests/storefront-proxy-origin.test.cjs
// Exercise the production route and its real NextResponse without a Next server,
// network access, environment secrets, or replacement origin-validation logic.
const routePath = path.resolve(__dirname, "../src/app/api/storefront-proxy/[...path]/route.ts");
const compiled = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const publicOrigin = "https://storefront-sandbox-3f42.up.railway.app";
const internalOrigin = "http://0.0.0.0:8080";
const authorization = "Bearer fixture-origin-bound-capability";
const edgeHeaders = {
  "x-railway-edge": "fixture-edge",
  "x-forwarded-host": new URL(publicOrigin).host,
  "x-forwarded-proto": "https",
  "sec-fetch-site": "same-origin",
  authorization,
};

function fixture(upstreamStatus = 200) {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (id) => { assert.equal(id, "next/server"); return require(id); },
    URL, Headers, AbortSignal,
    process: { env: { INTERNAL_SERVICE_TOKEN: "fixture-internal-only", AACP_API_URL: "https://api.fixture.invalid" } },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return Response.json({ status: "fixture" }, { status: upstreamStatus });
    },
  }, { filename: routePath });
  return {
    calls,
    invoke(method = "GET", overrides = {}, urlOrigin = internalOrigin) {
      const headers = new Headers(edgeHeaders);
      for (const [name, value] of Object.entries(overrides)) {
        if (value === null) headers.delete(name);
        else headers.set(name, value);
      }
      const request = new Request(`${urlOrigin}/api/storefront-proxy/conversations/session-1/one-buy-click?current=true`, {
        method, headers,
        ...(method === "POST" || method === "PATCH" ? { body: '{"enabled":true}' } : {}),
      });
      // Next implements HEAD through GET when there is no explicit HEAD handler.
      return module.exports[method === "HEAD" ? "GET" : method](request, {
        params: Promise.resolve({ path: ["conversations", "session-1", "one-buy-click"] }),
      });
    },
  };
}

async function expectDenied(method, headers, origin = internalOrigin) {
  const route = fixture();
  const response = await route.invoke(method, headers, origin);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
  assert.equal(route.calls.length, 0, "unverified requests must never reach the API");
}

for (const method of ["GET", "HEAD"]) {
  test(`Railway ${method} without Origin preserves the public capability origin`, async () => {
    const route = fixture();
    assert.equal((await route.invoke(method)).status, 200);
    assert.equal(route.calls.length, 1);
    const call = route.calls[0];
    assert.equal(call.url, "https://api.fixture.invalid/storefront/conversations/session-1/one-buy-click?current=true");
    assert.equal(call.method, method);
    assert.equal(call.body, undefined);
    assert.equal(call.headers.get("Origin"), publicOrigin);
    assert.equal(call.headers.get("X-Trusted-Storefront-Origin"), publicOrigin);
    assert.equal(call.headers.get("Authorization"), authorization);
    assert.equal(call.headers.get("X-Internal-Service-Token"), "fixture-internal-only");
  });
}

for (const method of ["POST", "PATCH"]) {
  test(`Railway ${method} still requires an exact browser Origin`, async () => {
    const route = fixture();
    assert.equal((await route.invoke(method, { origin: publicOrigin })).status, 200);
    assert.equal(route.calls[0].headers.get("Origin"), publicOrigin);
    assert.equal(route.calls[0].body, '{"enabled":true}');
    await expectDenied(method, {});
  });
}

test("GET accepts a matching Origin but rejects a contradictory or opaque Origin", async () => {
  const route = fixture();
  assert.equal((await route.invoke("GET", { origin: publicOrigin })).status, 200);
  for (const method of ["GET", "HEAD", "POST", "PATCH"]) {
    for (const origin of ["https://other-store.example", internalOrigin, "null", ""]) {
      await expectDenied(method, { origin });
    }
  }
});

test("cross-site requests are denied even with a matching claimed Origin", async () => {
  for (const method of ["GET", "HEAD", "POST", "PATCH"]) {
    await expectDenied(method, { origin: publicOrigin, "sec-fetch-site": "cross-site" });
  }
});

test("reads without same-origin Fetch Metadata cannot use forwarded origins", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const site of [null, "same-site", "none", "cross-site"]) {
      await expectDenied(method, { "sec-fetch-site": site });
    }
  }
});

test("invalid Railway host and protocol never fall back to a trusted internal origin", async () => {
  for (const host of [null, "", "store.example/path", "store.example@attacker.example", "store.example:99999", "store.example?attacker=1"]) {
    for (const method of ["GET", "POST"]) {
      await expectDenied(method, { "x-forwarded-host": host, ...(method === "POST" ? { origin: internalOrigin } : {}) });
    }
  }
  for (const proto of [null, "http", "javascript"]) {
    await expectDenied("GET", { "x-forwarded-proto": proto });
  }
});

test("forwarded headers without Railway metadata cannot replace the direct request origin", async () => {
  for (const method of ["GET", "POST"]) {
    await expectDenied(method, { "x-railway-edge": null, origin: publicOrigin });
  }
  const route = fixture();
  assert.equal((await route.invoke("GET", { "x-railway-edge": null })).status, 200);
  assert.equal(route.calls[0].headers.get("Origin"), internalOrigin);
});

test("direct same-origin development reads and writes retain their origin", async () => {
  const directOrigin = "http://localhost:3001";
  for (const method of ["GET", "POST"]) {
    const route = fixture();
    assert.equal((await route.invoke(method, {
      "x-railway-edge": null, "x-forwarded-host": null, "x-forwarded-proto": null,
      ...(method === "POST" ? { origin: directOrigin } : {}),
    }, directOrigin)).status, 200);
    assert.equal(route.calls[0].headers.get("Origin"), directOrigin);
  }
});

test("trusted origin does not bypass missing authorization or upstream capability rejection", async () => {
  const missing = fixture();
  assert.equal((await missing.invoke("GET", { authorization: null })).status, 401);
  assert.equal(missing.calls.length, 0);
  const rejected = fixture(401);
  assert.equal((await rejected.invoke()).status, 401);
  assert.equal(rejected.calls[0].headers.get("Authorization"), authorization);
});
