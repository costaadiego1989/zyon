import { Inject, Injectable } from "@nestjs/common";
import { normalizePlatformEmail } from "../domain/platform-operator.js";
import {
  PLATFORM_LOGIN_RATE_LIMITER,
  type PlatformLoginAttemptScope,
  type PlatformLoginRateLimiter,
} from "../domain/ports/platform-login-rate-limiter.port.js";
import { LoginPlatformOperatorUseCase } from "./login-platform-operator.use-case.js";

@Injectable()
export class LoginPlatformOperatorWithRateLimitUseCase {
  constructor(
    private readonly login: LoginPlatformOperatorUseCase,
    @Inject(PLATFORM_LOGIN_RATE_LIMITER) private readonly rateLimiter: PlatformLoginRateLimiter,
  ) {}

  async execute(input: { email: string; password: string }, ip: string) {
    const scope: PlatformLoginAttemptScope = {
      ip: ip || "unknown",
      email: normalizePlatformEmail(input.email),
    };
    this.rateLimiter.assertAllowed(scope);
    try {
      const response = await this.login.execute(input);
      this.rateLimiter.recordSuccess(scope);
      return response;
    } catch (error) {
      this.rateLimiter.recordFailure(scope);
      throw error;
    }
  }
}
