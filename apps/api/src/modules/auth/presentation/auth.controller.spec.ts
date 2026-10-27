import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, HttpException, UnauthorizedException } from "@nestjs/common";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { InvalidCredentialsError } from "../domain/errors.js";
import { VerifyCaptchaUseCase } from "../application/verify-captcha.use-case.js";
import type { CaptchaVerifier } from "../domain/ports/captcha-verifier.port.js";
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
    const challenges: Array<Parameters<CaptchaVerifier["verify"]>[0]> = [];
    Object.assign(controller, {
      verifyCaptcha: new VerifyCaptchaUseCase({ verify: async (input) => {
        challenges.push(input);
        return { success: allowed, reason: allowed ? undefined : "invalid-token" };
      } }),
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
    assert.deepEqual(challenges, ["login", "signup", "login", "signup"].map((action) => ({
      token: "test-token", remoteIp: "127.0.0.1", action,
    })));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

const deniedChallenges = [
  { name: "missing token", reason: "missing-token", token: undefined, status: 400, code: "captcha_invalid" },
  { name: "invalid token", reason: "invalid-token", token: "invalid-synthetic", status: 400, code: "captcha_invalid" },
  { name: "expired token", reason: "expired-token", token: "expired-synthetic", status: 400, code: "captcha_invalid" },
  { name: "reused token", reason: "reused-token", token: "reused-synthetic", status: 400, code: "captcha_invalid" },
  { name: "no verifier", reason: "no-verifier", token: "synthetic", status: 503, code: "captcha_unavailable" },
  { name: "unconfigured verifier", reason: "not-configured", token: "synthetic", status: 503, code: "captcha_unavailable" },
  { name: "verification error", reason: "verification-error", token: "synthetic", status: 503, code: "captcha_unavailable" },
  { name: "provider HTTP error", reason: "verification-http-error", token: "synthetic", status: 503, code: "captcha_unavailable" },
] as const;

for (const challenge of deniedChallenges) {
  test(`production auth fails closed for ${challenge.name} before credentials or cookie writes`, async (t) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    t.after(() => {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    });
    let verifications = 0;
    const captcha = new VerifyCaptchaUseCase(challenge.reason === "no-verifier" ? undefined : {
      verify: async (input) => {
        verifications++;
        assert.equal(input.token, challenge.token ?? "");
        assert.equal(input.remoteIp, "127.0.0.1");
        assert.equal(input.action, verifications === 1 ? "login" : "signup");
        return { success: false, reason: challenge.reason };
      },
    });
    const controller = makeController();
    let credentialCalls = 0;
    let cookieWrites = 0;
    const rejectCredentials = async () => { credentialCalls++; assert.fail("CAPTCHA rejection must precede credentials"); };
    Object.assign(controller, { verifyCaptcha: captcha,
      loginWithRateLimit: { execute: rejectCredentials }, registerMerchant: { execute: rejectCredentials } });
    const body = { email: "audit@example.test", password: "synthetic-password", merchant_name: "Synthetic", turnstile_token: challenge.token };
    const response = { setHeader() { cookieWrites++; assert.fail("Rejected CAPTCHA must not create a cookie"); } };
    const expected = (error: unknown) => error instanceof HttpException && error.getStatus() === challenge.status &&
      (error.getResponse() as { code?: string }).code === challenge.code;
    await assert.rejects(() => controller.loginWithPassword(body, "127.0.0.1", response), expected);
    await assert.rejects(() => controller.register(body, "127.0.0.1", response), expected);
    assert.equal(credentialCalls, 0);
    assert.equal(cookieWrites, 0);
    assert.equal(verifications, challenge.reason === "no-verifier" ? 0 : 2);
  });
}
