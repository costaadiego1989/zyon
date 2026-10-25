/**
 * R2P-B01: Rate limiter for buyer registration.
 * Prevents email enumeration and brute-force registration attacks.
 * Max 5 registrations per IP per hour.
 */
export interface BuyerRegistrationRateLimiterPort {
  /**
   * Assert that a registration attempt from this IP is allowed.
   * Throws HttpException(429) if rate limit is exceeded.
   */
  assertAllowed(ip: string): void;

  /**
   * Record a failed registration attempt (e.g., email already exists).
   */
  recordFailure(ip: string): void;

  /**
   * Record a successful registration.
   */
  recordSuccess(ip: string): void;

  /**
   * Get remaining attempts for this IP.
   */
  remaining(ip: string): number;
}

export const BUYER_REGISTRATION_RATE_LIMITER = "BUYER_REGISTRATION_RATE_LIMITER";
