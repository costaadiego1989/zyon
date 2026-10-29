export const PLATFORM_LOGIN_RATE_LIMITER = Symbol("PLATFORM_LOGIN_RATE_LIMITER");

export type PlatformLoginAttemptScope = {
  ip: string;
  email: string;
};

export interface PlatformLoginRateLimiter {
  assertAllowed(scope: PlatformLoginAttemptScope): void;
  recordFailure(scope: PlatformLoginAttemptScope): void;
  recordSuccess(scope: PlatformLoginAttemptScope): void;
}
