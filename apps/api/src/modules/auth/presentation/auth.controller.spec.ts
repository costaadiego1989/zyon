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
