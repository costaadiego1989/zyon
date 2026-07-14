import test from "node:test";
import assert from "node:assert/strict";
import { AuthCookieService } from "./auth-cookie.service.js";

test("AuthCookieService creates HttpOnly SameSite=Lax cookies and reads them", () => {
  const service = new AuthCookieService("aacp_access_token", false);
  const cookie = service.create({
    merchant_id: "mrc_1",
    user_id: "usr_1",
    email: "owner@example.com",
    access_token: "jwt-token",
    token_type: "Bearer",
    expires_in: 3600
  });

  assert.equal(cookie, "aacp_access_token=jwt-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600");
  assert.equal(service.read(`other=1; ${cookie}`), "jwt-token");
  assert.equal(service.clear(), "aacp_access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
});

// H7: CookieConfig support
test("AuthCookieService accepts CookieConfig object", () => {
  const service = new AuthCookieService({
    cookieName: "my_token",
    secure: true,
    sameSite: "Strict",
    domain: ".example.com",
    partitioned: true
  });
  const cookie = service.create({
    merchant_id: "mrc_1",
    user_id: "usr_1",
    email: "owner@example.com",
    access_token: "jwt-token",
    token_type: "Bearer",
    expires_in: 1800
  });

  assert.ok(cookie.includes("my_token=jwt-token"));
  assert.ok(cookie.includes("SameSite=Strict"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("Domain=.example.com"));
  assert.ok(cookie.includes("Partitioned"));
  assert.ok(cookie.includes("Max-Age=1800"));
});

test("AuthCookieService.clear with config includes all configured options", () => {
  const service = new AuthCookieService({
    cookieName: "my_token",
    secure: true,
    sameSite: "Strict",
    domain: ".example.com",
    partitioned: true
  });
  const cleared = service.clear();
  assert.ok(cleared.includes("my_token="));
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(cleared.includes("Domain=.example.com"));
});
