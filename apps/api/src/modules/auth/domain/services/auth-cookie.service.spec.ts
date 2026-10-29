import test from "node:test";
import assert from "node:assert/strict";
import { AuthCookieService } from "./auth-cookie.service.js";

test("configured cross-site cookies bind OAuth state and survive the callback policy", () => {
  const previous = process.env.AUTH_COOKIE_SAME_SITE;
  try {
    process.env.AUTH_COOKIE_SAME_SITE = "None";
    const service = new AuthCookieService("session", true);
    const attempt = service.createOAuthState("facebook");
    assert.match(attempt.cookie, /SameSite=None/);
    assert.match(attempt.cookie, /; Secure/);
    assert.equal(service.matchesOAuthState("facebook", attempt.state, attempt.cookie.split(";")[0]), true);
    assert.match(service.clearOAuthState(), /SameSite=None/);
    assert.match(service.clear(), /SameSite=None/);
    assert.doesNotMatch(new AuthCookieService("session", false).createOAuthState("facebook").cookie, /SameSite=None/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_COOKIE_SAME_SITE;
    else process.env.AUTH_COOKIE_SAME_SITE = previous;
  }
});

test("OAuth state is bound to its provider and a host-only HttpOnly cookie", () => {
  const service = new AuthCookieService({ cookieName: "session", secure: true, sameSite: "Lax", domain: ".example.test" });
  const attempt = service.createOAuthState("microsoft");
  assert.match(attempt.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(attempt.cookie, /^__Host-zyon_oauth_state=/);
  assert.ok(attempt.cookie.includes("HttpOnly") && attempt.cookie.includes("Secure") && attempt.cookie.includes("Max-Age=600"));
  assert.ok(!attempt.cookie.includes("Domain="));
  const header = attempt.cookie.split(";")[0]!;
  assert.equal(service.matchesOAuthState("microsoft", attempt.state, header), true);
  assert.equal(service.matchesOAuthState("facebook", attempt.state, header), false);
  assert.equal(service.matchesOAuthState("microsoft", "b".repeat(43), header), false);
  assert.equal(service.matchesOAuthState("microsoft", attempt.state, `${header}; ${header}`), false);
  assert.equal(service.matchesOAuthState("microsoft", attempt.state), false);
  assert.ok(service.clearOAuthState().includes("Max-Age=0"));
});

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

  assert.equal(cookie, "aacp_access_token=jwt-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000");
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
