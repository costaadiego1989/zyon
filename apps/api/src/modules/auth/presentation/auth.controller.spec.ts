import test from "node:test";
import assert from "node:assert/strict";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { AuthController } from "./auth.controller.js";

test("AuthController.logout clears the auth cookie", () => {
  const controller = new AuthController(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    new AuthCookieService("aacp_access_token", false)
  );
  const headers = new Map<string, string>();

  controller.logout({
    setHeader(name: string, value: string) {
      headers.set(name, value);
    }
  });

  assert.equal(headers.get("Set-Cookie"), "aacp_access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
});
