import { Inject, Injectable , Logger} from "@nestjs/common";
import type { LoginAttemptScope, RateLimiterPort } from "../domain/ports/rate-limiter.port.js";
import { RATE_LIMITER } from "../domain/ports/rate-limiter.port.js";
import { LoginUseCase } from "./login.use-case.js";
import type { AuthResponse } from "../domain/auth.types.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

/**
 * H1, H4: Application layer wraps LoginUseCase + RateLimiter.
 * The controller no longer owns rate-limit orchestration.
 */
@Injectable()
export class LoginWithRateLimitUseCase {
  private readonly logger = new Logger(LoginWithRateLimitUseCase.name);

  constructor(
    private readonly login: LoginUseCase,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiterPort
  ) {}

  async execute(input: { email: string; password: string }, scope: LoginAttemptScope): Promise<AuthResponse> {
    this.rateLimiter.assertAllowed(scope);
    try {
      const result = await this.login.execute(input);
      this.rateLimiter.recordSuccess(scope);
      return result;
    } catch (error) {
      this.rateLimiter.recordFailure(scope);
      throw error;
    }
  }
}
