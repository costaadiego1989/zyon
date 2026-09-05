import { BadRequestException, Body, Controller, Get, HttpCode, Ip, Post, Put, Req, Res, UnauthorizedException, UseGuards, ServiceUnavailableException, HttpException } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from "@nestjs/swagger";
import { LoginWithRateLimitUseCase } from "../application/login-with-rate-limit.use-case.js";
import { OAuthCallbackUseCase, type OAuthCallbackRequest } from "../application/oauth-callback.use-case.js";
import { RefreshTokenUseCase } from "../application/refresh-token.use-case.js";
import { RegisterMerchantUseCase, type RegisterMerchantRequest } from "../application/register-merchant.use-case.js";
import { RequestPasswordResetUseCase } from "../application/request-password-reset.use-case.js";
import { ResetPasswordUseCase } from "../application/reset-password.use-case.js";
import { VerifyCaptchaUseCase } from "../application/verify-captcha.use-case.js";
import { GetMeUseCase } from "../application/get-me.use-case.js";
import { UpdateMeUseCase } from "../application/update-me.use-case.js";
import { ChangePasswordUseCase } from "../application/change-password.use-case.js";
import { RequestEmailChangeUseCase } from "../application/request-email-change.use-case.js";
import { ConfirmEmailChangeUseCase } from "../application/confirm-email-change.use-case.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { AuthGuard } from "./auth.guard.js";
import { CurrentTenant } from "../../../shared/tenant/current-tenant.decorator.js";
import {
  EmailAlreadyRegisteredError,
  EmailChangeRequestThrottledError,
  InvalidCredentialsError,
  LoginRateLimitedError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  RefreshTokenExpiredError,
} from "../domain/errors.js";
import { normalizeEmail } from "../domain/validators.js";
import type { LoginAttemptScope } from "../domain/ports/rate-limiter.port.js";
import { isAuthorizedAutomationLogin } from "../domain/services/automation-login-captcha.js";

/**
 * H1: Controller is now a thin HTTP layer. Orchestration lives in use-cases.
 * L13: Maps domain errors to HTTP exceptions.
 * H8: Sets Retry-After header on 429.
 * L6: Register rate limiting via same limiter (separate scope).
 */
@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly registerMerchant: RegisterMerchantUseCase,
    private readonly loginWithRateLimit: LoginWithRateLimitUseCase,
    private readonly refreshToken: RefreshTokenUseCase,
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
    private readonly oauthCallback: OAuthCallbackUseCase,
    private readonly verifyCaptcha: VerifyCaptchaUseCase,
    private readonly cookies: AuthCookieService,
    private readonly getMe: GetMeUseCase,
    private readonly updateMe: UpdateMeUseCase,
    private readonly changePassword: ChangePasswordUseCase,
    private readonly requestEmailChange: RequestEmailChangeUseCase,
    private readonly confirmEmailChange: ConfirmEmailChangeUseCase,
  ) {}

  @Post("register")
  @ApiOperation({
    summary: "Register a new merchant",
    description: "Create a new merchant account with email and password. Returns authentication token and sets auth cookie.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email", example: "merchant@example.com" },
        password: { type: "string", minLength: 8, example: "secure_password_123" },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Merchant registered successfully. Auth cookie set in response.",
    schema: {
      type: "object",
      properties: {
        merchant_id: { type: "string", example: "cm123merchant" },
        email: { type: "string", format: "email" },
        token: { type: "string", description: "JWT access token" },
        expires_at: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Validation error: invalid email format or password too weak",
  })
  @ApiResponse({
    status: 409,
    description: "Email already registered",
  })
  async register(
    @Body() body: RegisterMerchantRequest,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    if (process.env.NODE_ENV === "production") {
      const captcha = await this.verifyCaptcha.execute({
        token: body.turnstile_token,
        remoteIp: ip || undefined,
      });
      if (!captcha.allowed) {
        throw new BadRequestException({
          statusCode: 400,
          code: "captcha_invalid",
          message: "captcha_invalid",
          reason: captcha.reason,
        });
      }
    }
    const auth = await this.registerMerchant.execute(body);
    response.setHeader("Set-Cookie", this.cookies.create(auth));
    return auth;
  }

  @Post("login")
  @ApiOperation({
    summary: "Login with email and password",
    description: "Authenticate a merchant using email and password. Rate limited by IP and email. Returns authentication token and sets auth cookie.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email", example: "merchant@example.com" },
        password: { type: "string", example: "secure_password_123" },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Login successful. Auth cookie set in response.",
    schema: {
      type: "object",
      properties: {
        merchant_id: { type: "string", example: "cm123merchant" },
        email: { type: "string", format: "email" },
        token: { type: "string", description: "JWT access token" },
        expires_at: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Invalid credentials (email or password incorrect)",
  })
  @ApiResponse({
    status: 429,
    description: "Rate limited. Too many failed login attempts. Retry-After header indicates seconds to wait.",
    headers: {
      "Retry-After": {
        schema: { type: "integer", example: 60 },
        description: "Seconds to wait before retrying",
      },
    },
  })
  async loginWithPassword(
    @Body() body: { email: string; password: string; turnstile_token?: string },
    @Ip() ip: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    // Captcha first — block bot traffic before we hit the rate limiter / DB.
    // DEV: captcha bypassed entirely to keep local testing unblocked.
    // Production CAPTCHA remains required except for a scoped, expiring audit key.
    if (process.env.NODE_ENV === "production" && !isAuthorizedAutomationLogin(body)) {
      const captcha = await this.verifyCaptcha.execute({
        token: body.turnstile_token,
        remoteIp: ip || undefined,
      });
      if (!captcha.allowed) {
        throw new BadRequestException({
          statusCode: 400,
          code: "captcha_invalid",
          message: "captcha_invalid",
          reason: captcha.reason,
        });
      }
    }

    // Build scope from trusted identifiers
    const scope: LoginAttemptScope = { ip: ip || "unknown", email: normalizeEmail(body.email ?? "") };
    try {
      const auth = await this.loginWithRateLimit.execute(body, scope);
      response.setHeader("Set-Cookie", this.cookies.create(auth));
      return auth;
    } catch (error) {
      // H8, L13: Map domain errors to appropriate HTTP responses
      if (error instanceof LoginRateLimitedError) {
        const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
        response.setHeader("Retry-After", String(retryAfterSec));
        throw new UnauthorizedException({
          statusCode: 429,
          message: "login_rate_limited",
          retryAfter: retryAfterSec
        });
      }
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("invalid_credentials");
      }
      throw error;
    }
  }

  @Post("refresh")
  @ApiOperation({
    summary: "Refresh access token",
    description: "Issue a new access token using an existing valid token from Bearer header or auth cookie. Returns new token with updated expiration.",
  })
  @ApiResponse({
    status: 201,
    description: "Token refreshed successfully. New auth cookie set in response.",
    schema: {
      type: "object",
      properties: {
        merchant_id: { type: "string", example: "cm123merchant" },
        token: { type: "string", description: "New JWT access token" },
        expires_at: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Token missing, invalid, or expired. No valid refresh possible.",
  })
  refresh(
    @Req() request: { headers?: { cookie?: string; authorization?: string } },
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    // Extract token from header or cookie
    const header = request.headers?.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : this.cookies.read(request.headers?.cookie);

    if (!token) {
      throw new UnauthorizedException("missing_bearer_token");
    }

    try {
      const auth = this.refreshToken.execute(token);
      response.setHeader("Set-Cookie", this.cookies.create(auth));
      return auth;
    } catch {
      throw new UnauthorizedException("refresh_failed");
    }
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({
    summary: "Logout and clear session",
    description: "Invalidate the current session and clear auth cookie. Returns 204 No Content.",
  })
  @ApiResponse({
    status: 204,
    description: "Logged out successfully. Auth cookie cleared.",
  })
  logout(@Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    response.setHeader("Set-Cookie", this.cookies.clear());
  }

  @Post("forgot-password")
  @HttpCode(200)
  @ApiOperation({
    summary: "Request password reset token",
    description: "Send a password reset token to the registered email. Always returns 200 for security (no email enumeration). Token expires after 1 hour.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", format: "email", example: "merchant@example.com" },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Password reset email sent (or no account found - same response for security)",
    schema: {
      type: "object",
      properties: {
        message: { type: "string", example: "If an account exists, a reset link has been sent to the email." },
      },
    },
  })
  async forgotPassword(@Body() body: { email: string }) {
    return this.requestPasswordReset.execute(body.email ?? "");
  }

  @Post("reset-password")
  @HttpCode(200)
  @ApiOperation({
    summary: "Reset password with token",
    description: "Complete password reset using the token sent to email. Token must be valid and not expired.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["token", "password"],
      properties: {
        token: { type: "string", description: "Reset token from email", example: "eyJhbGc..." },
        password: { type: "string", minLength: 8, example: "new_secure_password_456" },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Password reset successfully. New auth cookie set in response.",
    schema: {
      type: "object",
      properties: {
        merchant_id: { type: "string", example: "cm123merchant" },
        message: { type: "string", example: "Password reset successful" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid or expired reset token, or password validation failed",
  })
  async resetPasswordAction(@Body() body: { token: string; password: string }) {
    return this.resetPassword.execute(body.token ?? "", body.password ?? "");
  }

  @Post("oauth/callback")
  @ApiOperation({
    summary: "OAuth callback",
    description: "Exchange OAuth authorization code for JWT. Creates merchant if new user.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["provider", "code", "state"],
      properties: {
        provider: { type: "string", enum: ["github", "google"] },
        code: { type: "string" },
        state: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "OAuth login/signup successful. Auth cookie set." })
  @ApiResponse({ status: 400, description: "Invalid provider or code" })
  async oauthCallbackAction(
    @Body() body: OAuthCallbackRequest,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    const auth = await this.oauthCallback.execute(body);
    response.setHeader("Set-Cookie", this.cookies.create(auth));
    return auth;
  }

  // ───────── Account settings (requires auth) ─────────

  @UseGuards(AuthGuard)
  @Get("me")
  @ApiOperation({
    summary: "Get current merchant owner profile",
    description: "Returns name, email and phone from the authenticated merchant's owner profile.",
  })
  @ApiResponse({ status: 200, description: "Owner profile" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  getMeRoute(@CurrentTenant() merchantId: string) {
    return this.getMe.execute(merchantId);
  }

  @UseGuards(AuthGuard)
  @Put("me")
  @HttpCode(200)
  @ApiOperation({
    summary: "Update owner profile (name, phone)",
    description: "Email is NOT updated here — use the email-change OTP flow instead.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 2, maxLength: 80 },
        phone: { type: "string", maxLength: 20 },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Profile updated" })
  @ApiResponse({ status: 400, description: "Validation error" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  async updateMeRoute(
    @CurrentTenant() merchantId: string,
    @Body() body: { name?: string; phone?: string },
  ) {
    return this.updateMe.execute({
      merchantId,
      name: body.name ?? "",
      phone: body.phone,
    });
  }

  @UseGuards(AuthGuard)
  @Put("me/password")
  @HttpCode(200)
  @ApiOperation({
    summary: "Change password",
    description: "Requires current password. Strong password validation (min 8 chars).",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["current_password", "new_password"],
      properties: {
        current_password: { type: "string", minLength: 8 },
        new_password: { type: "string", minLength: 8 },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Password changed" })
  @ApiResponse({ status: 400, description: "Validation error" })
  @ApiResponse({ status: 401, description: "Current password is invalid" })
  async changePasswordRoute(
    @CurrentTenant() merchantId: string,
    @Body() body: { current_password?: string; new_password?: string },
  ) {
    try {
      return await this.changePassword.execute({
        merchantId,
        currentPassword: body.current_password ?? "",
        newPassword: body.new_password ?? "",
      });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("invalid_credentials");
      }
      throw err;
    }
  }

  @UseGuards(AuthGuard)
  @Post("me/email-change/request")
  @HttpCode(200)
  @ApiOperation({
    summary: "Request email change (step 1 of 2)",
    description: "Sends a 6-digit OTP code to the new email. TTL: 10 minutes. Max 5 attempts. Rate limited per user.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["new_email"],
      properties: {
        new_email: { type: "string", format: "email" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "OTP sent" })
  @ApiResponse({ status: 400, description: "Invalid email or already taken" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({ status: 429, description: "Too many requests" })
  async requestEmailChangeRoute(
    @CurrentTenant() merchantId: string,
    @Body() body: { new_email?: string },
  ) {
    try {
      return await this.requestEmailChange.execute({
        merchantId,
        newEmail: body.new_email ?? "",
      });
    } catch (err) {
      if (err instanceof EmailChangeRequestThrottledError) {
        throw new HttpException(
          {
            statusCode: 429,
            code: "email_change_throttled",
            retryAfter: Math.ceil(err.retryAfterMs / 1000),
          },
          429,
        );
      }
      throw err;
    }
  }

  @UseGuards(AuthGuard)
  @Post("me/email-change/confirm")
  @HttpCode(200)
  @ApiOperation({
    summary: "Confirm email change (step 2 of 2)",
    description: "Validates the OTP and applies the email change. Notifies the previous email.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["new_email", "code"],
      properties: {
        new_email: { type: "string", format: "email" },
        code: { type: "string", minLength: 6, maxLength: 6, example: "123456" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Email updated" })
  @ApiResponse({ status: 400, description: "Email mismatch or already taken" })
  @ApiResponse({ status: 401, description: "OTP invalid, expired, or locked" })
  async confirmEmailChangeRoute(
    @CurrentTenant() merchantId: string,
    @Body() body: { new_email?: string; code?: string },
  ) {
    try {
      return await this.confirmEmailChange.execute({
        merchantId,
        newEmail: body.new_email ?? "",
        code: body.code ?? "",
      });
    } catch (err) {
      if (err instanceof OtpInvalidError) {
        throw new UnauthorizedException("otp_invalid");
      }
      if (err instanceof OtpLockedError) {
        throw new UnauthorizedException("otp_locked");
      }
      if (err instanceof OtpExpiredError) {
        throw new UnauthorizedException("otp_expired");
      }
      if (err instanceof EmailAlreadyRegisteredError) {
        throw new BadRequestException("email_taken");
      }
      if (err instanceof Error && err.message === "otp_store_unavailable") {
        throw new ServiceUnavailableException("otp_unavailable");
      }
      throw err;
    }
  }
}
