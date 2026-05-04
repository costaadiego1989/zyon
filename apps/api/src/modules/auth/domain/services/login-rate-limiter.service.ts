import { HttpException, HttpStatus } from "@nestjs/common";

export interface LoginAttemptScope {
  ip: string;
  deviceId: string;
}

interface AttemptBucket {
  count: number;
  resetAt: number;
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptBucket>();

  constructor(
    private readonly maxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5),
    private readonly windowMs = Number(process.env.AUTH_LOGIN_WINDOW_MS ?? 15 * 60 * 1000)
  ) {}

  assertAllowed(scope: LoginAttemptScope, now = Date.now()): void {
    const key = this.key(scope);
    const bucket = this.activeBucket(key, now);
    if (bucket.count >= this.maxAttempts) {
      throw new HttpException("login_rate_limited", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(scope: LoginAttemptScope, now = Date.now()): void {
    const key = this.key(scope);
    const bucket = this.activeBucket(key, now);
    bucket.count += 1;
    this.attempts.set(key, bucket);
  }

  recordSuccess(scope: LoginAttemptScope): void {
    this.attempts.delete(this.key(scope));
  }

  remaining(scope: LoginAttemptScope, now = Date.now()): number {
    const bucket = this.activeBucket(this.key(scope), now);
    return Math.max(this.maxAttempts - bucket.count, 0);
  }

  private activeBucket(key: string, now: number): AttemptBucket {
    const existing = this.attempts.get(key);
    if (!existing || existing.resetAt <= now) {
      return { count: 0, resetAt: now + this.windowMs };
    }
    return existing;
  }

  private key(scope: LoginAttemptScope): string {
    return `${scope.ip}:${scope.deviceId}`;
  }
}
