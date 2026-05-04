import { Body, Controller, Headers, Ip, Post, Res } from "@nestjs/common";
import { LoginUseCase } from "../application/login.use-case.js";
import { RegisterMerchantUseCase, type RegisterMerchantRequest } from "../application/register-merchant.use-case.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { LoginRateLimiter } from "../domain/services/login-rate-limiter.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly registerMerchant: RegisterMerchantUseCase,
    private readonly login: LoginUseCase,
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
    @Headers("x-device-id") deviceId: string | undefined,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    const scope = { ip: ip || "unknown", deviceId: deviceId || "unknown-device" };
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
}
