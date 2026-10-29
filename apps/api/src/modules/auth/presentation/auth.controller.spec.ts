import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { InvalidCredentialsError } from "../domain/errors.js";
import { AuthController } from "./auth.controller.js";
import { VerifyCaptchaUseCase } from "../application/verify-captcha.use-case.js";

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

test("OAuth callback rejects a missing or mismatched server cookie before contacting the provider", async () => {
  const controller = makeController();
  let exchanges = 0;
  Object.assign(controller, { oauthCallback: { execute: async () => { exchanges++; throw Error("must not exchange"); } } });
  const headers = new Map<string, string | string[]>();
  const response = { setHeader(name: string, value: string | string[]) { headers.set(name, value); } };
  const attempt = controller.startOAuth({ provider: "microsoft" }, response);
  const cookie = String(headers.get("Set-Cookie")).split(";")[0]!;
  await assert.rejects(() => controller.oauthCallbackAction({ provider: "microsoft", code: "code", state: attempt.state }, response, { headers: {} }), UnauthorizedException);
  await assert.rejects(() => controller.oauthCallbackAction({ provider: "facebook", code: "code", state: attempt.state }, response, { headers: { cookie } }), UnauthorizedException);
  assert.equal(exchanges, 0);
  assert.ok(String(headers.get("Set-Cookie")).includes("Max-Age=0"));
});

test("OAuth callback accepts matching browser state and replaces it with the authenticated session", async () => {
  const controller = makeController();
  const auth = { access_token: "synthetic-session", expires_in: 3600, token_type: "Bearer", merchant_id: "merchant", user_id: "owner", email: "owner@example.test" };
  let received: unknown;
  Object.assign(controller, { oauthCallback: { execute: async (input: unknown) => { received = input; return auth; } } });
  const headers = new Map<string, string | string[]>();
  const response = { setHeader(name: string, value: string | string[]) { headers.set(name, value); } };
  const attempt = controller.startOAuth({ provider: "google" }, response);
  const cookie = String(headers.get("Set-Cookie")).split(";")[0]!;
  const request = { provider: "google" as const, code: "code", state: attempt.state, code_verifier: "a".repeat(43) };
  assert.equal(await controller.oauthCallbackAction(request, response, { headers: { cookie } }), auth);
  assert.equal(received, request);
  const setCookies = headers.get("Set-Cookie");
  assert.ok(Array.isArray(setCookies));
  assert.equal(setCookies.length, 2);
  assert.ok(setCookies[0]!.includes("Max-Age=0"));
  assert.ok(setCookies[1]!.includes("aacp_access_token=synthetic-session"));
});

test("forgot and reset password require fresh CAPTCHA before any reset work", async () => {
  const controller = makeController();
  const actions: string[] = [];
  let allowed = false;
  let recoveryCalls = 0;
  let resetCalls = 0;
  Object.assign(controller, {
    verifyCaptcha: new VerifyCaptchaUseCase({ verify: async input => { actions.push(input.action!); return { success: allowed, reason: "invalid-token" }; } }),
    requestPasswordReset: { execute: async () => { recoveryCalls++; return { message: "same-for-all-emails" }; } },
    resetPassword: { execute: async () => { resetCalls++; return { message: "updated" }; } },
  });
  await assert.rejects(() => controller.forgotPassword({ email: "buyer@example.test" }), BadRequestException);
  await assert.rejects(() => controller.resetPasswordAction({ token: "reset-token", password: "password" }), BadRequestException);
  assert.equal(recoveryCalls + resetCalls, 0);
  allowed = true;
  await controller.forgotPassword({ email: "buyer@example.test", turnstile_token: "fresh-a" });
  await controller.resetPasswordAction({ token: "reset-token", password: "password", turnstile_token: "fresh-b" });
  assert.equal(recoveryCalls, 1);
  assert.equal(resetCalls, 1);
  assert.deepEqual(actions, ["forgot_password", "reset_password", "forgot_password", "reset_password"]);
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
      verifyCaptcha: { assertAllowed: async () => { if (!allowed) throw new BadRequestException("captcha_invalid"); } },
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
