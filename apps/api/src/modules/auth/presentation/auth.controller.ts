import { Body, Controller, HttpCode, Ip, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { LoginWithRateLimitUseCase } from "../application/login-with-rate-limit.use-case.js";
import { RefreshTokenUseCase } from "../application/refresh-token.use-case.js";
import { RegisterMerchantUseCase, type RegisterMerchantRequest } from "../application/register-merchant.use-case.js";
import { RequestPasswordResetUseCase } from "../application/request-password-reset.use-case.js";
import { ResetPasswordUseCase } from "../application/reset-password.use-case.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { InvalidCredentialsError, LoginRateLimitedError, RefreshTokenExpiredError } from "../domain/errors.js";
import { normalizeEmail } from "../domain/validators.js";
import type { LoginAttemptScope } from "../domain/ports/rate-limiter.port.js";

/**
 * H1: Controller is now a thin HTTP layer. Orchestration lives in use-cases.
 * L13: Maps domain errors to HTTP exceptions.
 * H8: Sets Retry-After header on 429.
 * L6: Register rate limiting via same limiter (separate scope).
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly registerMerchant: RegisterMerchantUseCase,
    private readonly loginWithRateLimit: LoginWithRateLimitUseCase,
    private readonly refreshToken: RefreshTokenUseCase,
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
    private readonly cookies: AuthCookieService
  ) {}

  @Post("register")
  async register(@Body() body: RegisterMerchantRequest, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    const auth = await this.registerMerchant.execute(body);
    response.setHeader("Set-Cookie", this.cookies.create(auth));
    return auth;
  }

  @Post("login")
  async loginWithPassword(
    @Body() body: { email: string; password: string },
    @Ip() ip: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
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
  logout(@Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    response.setHeader("Set-Cookie", this.cookies.clear());
  }

  @Post("forgot-password")
  @HttpCode(200)
  async forgotPassword(@Body() body: { email: string }) {
    return this.requestPasswordReset.execute(body.email ?? "");
  }

  @Post("reset-password")
  @HttpCode(200)
  async resetPasswordAction(@Body() body: { token: string; password: string }) {
    return this.resetPassword.execute(body.token ?? "", body.password ?? "");
  }
}
