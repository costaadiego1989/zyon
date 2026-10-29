import { Inject, Injectable, Logger } from "@nestjs/common";
import { RegisterBuyerUseCase, type RegisterBuyerRequest, type BuyerAuthResponse } from "./register-buyer.use-case.js";
import { BUYER_REGISTRATION_RATE_LIMITER, type BuyerRegistrationRateLimiterPort } from "../../domain/ports/buyer-registration-rate-limiter.port.js";

/**
 * R2P-B01: Wraps buyer registration with rate limiting.
 * Enforces max 5 registrations per IP per hour.
 * Prevents email enumeration and brute-force attacks.
 */
@Injectable()
export class RegisterBuyerWithRateLimitUseCase {
  private readonly logger = new Logger(RegisterBuyerWithRateLimitUseCase.name);

  constructor(
    private readonly register: RegisterBuyerUseCase,
    @Inject(BUYER_REGISTRATION_RATE_LIMITER) private readonly rateLimiter: BuyerRegistrationRateLimiterPort
  ) {}

  async execute(input: RegisterBuyerRequest, ip: string): Promise<BuyerAuthResponse> {
    this.rateLimiter.assertAllowed(ip);
    try {
      const result = await this.register.execute(input);
      this.rateLimiter.recordSuccess(ip);
      return result;
    } catch (error) {
      this.rateLimiter.recordFailure(ip);
      throw error;
    }
  }
}
