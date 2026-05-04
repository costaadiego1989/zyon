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
