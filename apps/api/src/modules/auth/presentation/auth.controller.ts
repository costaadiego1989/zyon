import { Body, Controller, HttpCode, Ip, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { LoginUseCase } from "../application/login.use-case.js";
import { RegisterMerchantUseCase, type RegisterMerchantRequest } from "../application/register-merchant.use-case.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { LoginRateLimiter } from "../domain/services/login-rate-limiter.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly registerMerchant: RegisterMerchantUseCase,
    private readonly login: LoginUseCase,
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService,
    private readonly rateLimiter: LoginRateLimiter
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
    // B2 (P1): Key by IP + normalized email. x-device-id header is NOT used
    // because it is client-controlled and was trivially rotatable to bypass limits.
    const scope = { ip: ip || "unknown", email: body.email ?? "" };
    this.rateLimiter.assertAllowed(scope);
    try {
      const auth = await this.login.execute(body);
      this.rateLimiter.recordSuccess(scope);
      response.setHeader("Set-Cookie", this.cookies.create(auth));
      return auth;
    } catch (error) {
      this.rateLimiter.recordFailure(scope);
      throw error;
    }
  }

  @Post("refresh")
  refresh(
    @Req() request: { headers?: { cookie?: string; authorization?: string } },
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    // Lê token do cookie ou header
    const header = request.headers?.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : this.cookies.read(request.headers?.cookie);

    if (!token) {
      throw new UnauthorizedException("missing_bearer_token");
    }

    try {
      // Verifica assinatura, aceita expirado dentro da janela de graça (7 dias)
      const principal = this.jwt.verifyForRefresh(token);
      // Emite novo token
      const newToken = this.jwt.sign(principal);
      const expiresIn = this.jwt.expiresIn();
      const auth = {
        merchant_id: principal.merchantId,
        user_id: principal.userId,
        email: principal.email,
        access_token: newToken,
        token_type: "Bearer" as const,
        expires_in: expiresIn
      };
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
}
