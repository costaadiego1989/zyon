import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * B2 (P1): The scope key is built from trusted identifiers only.
 * `email` is the normalized credential being tested (attacker-known, not
 * attacker-controlled as a header). `ip` is the resolved client address.
 * `deviceId` is NOT included — it was a client-controlled header that made
 * the limit trivially bypassable by rotating the header value.
 */
export interface LoginAttemptScope {
  ip: string;
  /** Normalized (lower-cased, trimmed) email being attempted. */
  email: string;
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
    // Key on IP + normalized email. Both are trusted — IP from server-resolved
    // request address, email from request body (same value being checked).
    return `${scope.ip}:${scope.email.toLowerCase().trim()}`;
  }
}
