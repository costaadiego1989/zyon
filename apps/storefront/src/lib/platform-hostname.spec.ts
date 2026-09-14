import test from "node:test";
import assert from "node:assert/strict";
import { isPlatformHostname } from "./platform-hostname.js";

test("custom domains cannot masquerade as platform hosts using substrings", () => {
  for (const host of ["zyon-payments.com.br", "storefront.zyon-payments.com.br", "project.vercel.app", "localhost", "127.0.0.1", "[::1]", "STOREFRONT.ZYON.COM."]) {
    assert.equal(isPlatformHostname(host), true, host);
  }
  for (const host of ["zyon-payments.com.br.attacker.com", "fakezyon.com", "localhost.attacker.com", "store.example.com", "notvercel.app"]) {
    assert.equal(isPlatformHostname(host), false, host);
  }
});
