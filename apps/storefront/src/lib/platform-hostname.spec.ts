import test from "node:test";
import assert from "node:assert/strict";
import { isPlatformHostname, storefrontRequestHostname } from "./platform-hostname.js";

test("custom domains cannot masquerade as platform hosts using substrings", () => {
  for (const host of ["zyon-payments.com.br", "storefront.zyon-payments.com.br", "project.vercel.app", "localhost", "127.0.0.1", "[::1]", "STOREFRONT.ZYON.COM."]) {
    assert.equal(isPlatformHostname(host), true, host);
  }
  for (const host of ["zyon-payments.com.br.attacker.com", "fakezyon.com", "localhost.attacker.com", "store.example.com", "notvercel.app"]) {
    assert.equal(isPlatformHostname(host), false, host);
  }
});

 test("accepts only the configured Railway deployment hostname", () => {
  assert.equal(isPlatformHostname("store-sandbox.up.railway.app", "store-sandbox.up.railway.app"), true);
  assert.equal(isPlatformHostname("another.up.railway.app", "store-sandbox.up.railway.app"), false);
  assert.equal(isPlatformHostname("store-sandbox.up.railway.app.evil.test", "store-sandbox.up.railway.app"), false);
});

test("standalone routing uses the request Host instead of the internal bind address", () => {
  assert.equal(storefrontRequestHostname("store-sandbox.up.railway.app:443", "0.0.0.0"), "store-sandbox.up.railway.app");
  assert.equal(storefrontRequestHostname("LOJA.EXAMPLE.COM.", "0.0.0.0"), "loja.example.com");
  assert.equal(storefrontRequestHostname("[::1]:3001", "0.0.0.0"), "[::1]");
  assert.equal(storefrontRequestHostname("loja.example.com@attacker.test", "fallback"), "fallback");
});

test("standalone checkout origin preserves public host, HTTPS and local ports", async () => {
  const { storefrontRequestOrigin } = await import("./platform-hostname.js");
  const request = (host: string, proto: string) => new Request("http://0.0.0.0:8080/api/embed/start", { headers: { host, "x-forwarded-proto": proto } });
  assert.equal(storefrontRequestOrigin(request("store-sandbox.up.railway.app", "https")), "https://store-sandbox.up.railway.app");
  assert.equal(storefrontRequestOrigin(request("loja.example.com", "https")), "https://loja.example.com");
  assert.equal(storefrontRequestOrigin(request("localhost:4318", "http")), "http://localhost:4318");
  assert.equal(storefrontRequestOrigin(request("store.example@attacker.test", "https")), "http://0.0.0.0:8080");
  assert.equal(storefrontRequestOrigin(request("store.example", "javascript")), "http://store.example");
});
