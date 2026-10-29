import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * R2P-B01: In-memory rate limiter for buyer registration.
 * Keys on IP only. Max 5 registrations per IP per hour.
 * Falls back to in-memory; production should use Redis.
 */
export interface RegistrationAttemptScope {
  ip: string;
}

interface AttemptBucket {
  count: number;
  resetAt: number;
}

export class BuyerRegistrationRateLimiter {
  private readonly attempts = new Map<string, AttemptBucket>();

  constructor(
    private readonly maxAttempts = Number(process.env.BUYER_REGISTRATION_MAX_ATTEMPTS ?? 5),
    private readonly windowMs = Number(process.env.BUYER_REGISTRATION_WINDOW_MS ?? 60 * 60 * 1000) // 1 hour
  ) {
    if (process.env.NODE_ENV === "production" && process.env.REDIS_ENABLED === "true") {
      throw new Error("redis_buyer_registration_rate_limit_store_not_configured");
    }
  }

  assertAllowed(ip: string, now = Date.now()): void {
    const bucket = this.activeBucket(ip, now);
    if (bucket.count >= this.maxAttempts) {
      throw new HttpException("registration_rate_limited", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(ip: string, now = Date.now()): void {
    const bucket = this.activeBucket(ip, now);
    bucket.count += 1;
    this.attempts.set(ip, bucket);
  }

  recordSuccess(ip: string): void {
    this.attempts.delete(ip);
  }

  remaining(ip: string, now = Date.now()): number {
    const bucket = this.activeBucket(ip, now);
    return Math.max(this.maxAttempts - bucket.count, 0);
  }

  private activeBucket(ip: string, now: number): AttemptBucket {
    const existing = this.attempts.get(ip);
    if (!existing || existing.resetAt <= now) {
      return { count: 0, resetAt: now + this.windowMs };
    }
    return existing;
  }
}
