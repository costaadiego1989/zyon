/**
 * Rate limiter port — abstracts the rate-limiting mechanism.
 * Closes H4, H8, M10, C4 (partial — in-memory with eviction; Redis as follow-up).
 */

export const RATE_LIMITER = Symbol("RATE_LIMITER");

export interface LoginAttemptScope {
  ip: string;
  /** Normalized (lower-cased, trimmed) email being attempted. */
  email: string;
}

export interface RateLimiterPort {
  /**
   * Assert login attempt is allowed. Throws LoginRateLimitedError if blocked.
   */
  assertAllowed(scope: LoginAttemptScope, now?: number): void;
  recordFailure(scope: LoginAttemptScope, now?: number): void;
  recordSuccess(scope: LoginAttemptScope): void;
  remaining(scope: LoginAttemptScope, now?: number): number;
  /** Returns the ms until the limit resets for the given scope, or undefined if not limited. */
  retryAfterMs(scope: LoginAttemptScope, now?: number): number | undefined;
}
