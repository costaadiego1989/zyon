import test from "node:test";
import assert from "node:assert/strict";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { AuthController } from "./auth.controller.js";
import type { RequestPasswordResetUseCase } from "../application/request-password-reset.use-case.js";
import type { ResetPasswordUseCase } from "../application/reset-password.use-case.js";
import type { VerifyCaptchaUseCase } from "../application/verify-captcha.use-case.js";
import type { RegisterMerchantUseCase } from "../application/register-merchant.use-case.js";
import type { LoginWithRateLimitUseCase } from "../application/login-with-rate-limit.use-case.js";
import type { RefreshTokenUseCase } from "../application/refresh-token.use-case.js";
import type { OAuthCallbackUseCase } from "../application/oauth-callback.use-case.js";
import type { GetMeUseCase } from "../application/get-me.use-case.js";
import type { UpdateMeUseCase } from "../application/update-me.use-case.js";
import type { ChangePasswordUseCase } from "../application/change-password.use-case.js";
import type { RequestEmailChangeUseCase } from "../application/request-email-change.use-case.js";
import type { ConfirmEmailChangeUseCase } from "../application/confirm-email-change.use-case.js";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { InvalidCredentialsError } from "../domain/errors.js";

function makeController(): AuthController {
  return new AuthController(
    null as never, // registerMerchant
    null as never, // loginWithRateLimit
    null as never, // refreshToken
    null as never, // requestPasswordReset
    null as never, // resetPassword
    null as never, // oauthCallback
    null as never, // verifyCaptcha
    new AuthCookieService("aacp_access_token", false),
    null as never, // getMe
    null as never, // updateMe
    null as never, // changePassword
    null as never, // requestEmailChange
    null as never, // confirmEmailChange
  );
}

test("AuthController.logout clears the auth cookie", () => {
  const controller = makeController();
  const headers = new Map<string, string>();

  controller.logout({
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  });

  assert.equal(headers.get("Set-Cookie"), "aacp_access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
});

test("authorized registration still executes account and password validation", async () => {
  const keys = ["NODE_ENV", "AUTH_AUTOMATION_REGISTER_EMAIL", "AUTH_AUTOMATION_REGISTER_TOKEN", "AUTH_AUTOMATION_REGISTER_EXPIRES_AT"];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.NODE_ENV = "production";
    process.env.AUTH_AUTOMATION_REGISTER_EMAIL = "audit@example.test";
    process.env.AUTH_AUTOMATION_REGISTER_TOKEN = "r".repeat(64);
    process.env.AUTH_AUTOMATION_REGISTER_EXPIRES_AT = new Date(Date.now() + 3600000).toISOString();
    const controller = makeController();
    let registrations = 0;
    let captchaCalls = 0;
    Object.assign(controller, {
      verifyCaptcha: { execute: async () => { captchaCalls++; return { allowed: false }; } },
      registerMerchant: { execute: async (body: { email: string; password: string }) => {
        registrations++;
        assert.equal(body.email, "audit@example.test");
        assert.equal(body.password, "short");
        throw new BadRequestException("weak_password");
      } },
    });
    const body = { merchant_name: "Audit", email: "audit@example.test", password: "short", turnstile_token: "r".repeat(64) };
    const response = { setHeader() { assert.fail("Invalid account must not receive a session"); } };
    await assert.rejects(() => controller.register(body, "127.0.0.1", response), /weak_password/);
    assert.equal(registrations, 1);
    assert.equal(captchaCalls, 0);
    await assert.rejects(() => controller.register({ ...body, email: "other@example.test" }, "127.0.0.1", response), BadRequestException);
    assert.equal(captchaCalls, 1);
    assert.equal(registrations, 1);
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test("authorized automation skips only login CAPTCHA, retaining password validation and rate limiting", async () => {
  const keys = ["NODE_ENV", "AUTH_AUTOMATION_LOGIN_EMAIL", "AUTH_AUTOMATION_LOGIN_TOKEN", "AUTH_AUTOMATION_LOGIN_EXPIRES_AT"];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.NODE_ENV = "production";
    process.env.AUTH_AUTOMATION_LOGIN_EMAIL = "audit@example.test";
    process.env.AUTH_AUTOMATION_LOGIN_TOKEN = "a".repeat(64);
    process.env.AUTH_AUTOMATION_LOGIN_EXPIRES_AT = new Date(Date.now() + 3600000).toISOString();
    const controller = makeController();
    let captchaCalls = 0;
    let loginCalls = 0;
    Object.assign(controller, {
      verifyCaptcha: { execute: async () => { captchaCalls++; return { allowed: false, reason: "missing-token" }; } },
      loginWithRateLimit: { execute: async (_body: unknown, scope: { email: string; ip: string }) => {
        loginCalls++;
        assert.equal(scope.email, "audit@example.test");
        assert.equal(scope.ip, "127.0.0.1");
        throw new InvalidCredentialsError();
      } },
    });
    const body = { email: "audit@example.test", password: "wrong-password", turnstile_token: "a".repeat(64) };
    const response = { setHeader() {} };
    await assert.rejects(() => controller.loginWithPassword(body, "127.0.0.1", response), UnauthorizedException);
    assert.equal(loginCalls, 1);
    assert.equal(captchaCalls, 0);
    await assert.rejects(() => controller.loginWithPassword({ ...body, email: "other@example.test" }, "127.0.0.1", response), BadRequestException);
    await assert.rejects(() => controller.register({ ...body, merchant_name: "Test" }, "127.0.0.1", response), BadRequestException);
    assert.equal(captchaCalls, 2);
    assert.equal(loginCalls, 1);
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
