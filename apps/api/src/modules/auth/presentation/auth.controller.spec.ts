import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { InvalidCredentialsError } from "../domain/errors.js";
import { AuthController } from "./auth.controller.js";

function makeController(): AuthController {
  return new AuthController(
    null as never, null as never, null as never, null as never,
    null as never, null as never, null as never,
    new AuthCookieService("aacp_access_token", false),
    null as never, null as never, null as never, null as never, null as never,
  );
}

test("AuthController.logout clears the auth cookie", () => {
  const controller = makeController();
  const headers = new Map<string, string>();
  void controller.logout({ setHeader(name: string, value: string) { headers.set(name, value); } }, {});
  assert.equal(headers.get("Set-Cookie"), "aacp_access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
});

test("production login and registration require CAPTCHA before normal credential validation", async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const controller = makeController();
    let allowed = false;
    let logins = 0;
    let registrations = 0;
    Object.assign(controller, {
      verifyCaptcha: { execute: async () => ({ allowed, reason: "invalid-token" }) },
      loginWithRateLimit: { execute: async (_body: unknown, scope: { email: string; ip: string }) => {
        logins++;
        assert.equal(scope.email, "audit@example.test");
        assert.equal(scope.ip, "127.0.0.1");
        throw new InvalidCredentialsError();
      } },
      registerMerchant: { execute: async () => { registrations++; throw new BadRequestException("weak_password"); } },
    });
    const body = { email: "audit@example.test", password: "short", merchant_name: "Test", turnstile_token: "test-token" };
    const response = { setHeader() { assert.fail("Invalid credentials must not create a session"); } };
    await assert.rejects(() => controller.loginWithPassword(body, "127.0.0.1", response), BadRequestException);
    await assert.rejects(() => controller.register(body, "127.0.0.1", response), BadRequestException);
    assert.equal(logins, 0);
    assert.equal(registrations, 0);
    allowed = true;
    await assert.rejects(() => controller.loginWithPassword(body, "127.0.0.1", response), UnauthorizedException);
    await assert.rejects(() => controller.register(body, "127.0.0.1", response), /weak_password/);
    assert.equal(logins, 1);
    assert.equal(registrations, 1);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
