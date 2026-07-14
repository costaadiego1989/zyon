/**
 * In-memory rate limiter with per-IP + per-email tracking and eviction.
 * Closes C4, H8, M8, M10, L3, L4.
 * TODO: Replace with Redis-backed implementation behind RateLimiterPort as follow-up.
 */

import { Injectable } from "@nestjs/common";
import type { LoginAttemptScope, RateLimiterPort } from "../ports/rate-limiter.port.js";
import { LoginRateLimitedError } from "../errors.js";

interface AttemptBucket {
  count: number;
  resetAt: number;
}

interface PerIpBucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limiter.
 * Scope key: `ip:email`
 * Also tracks per-IP throttle to prevent per-email rotation.
 */
@Injectable()
export class LoginRateLimiter implements RateLimiterPort {
  private readonly attempts = new Map<string, AttemptBucket>();
  private readonly perIpAttempts = new Map<string, PerIpBucket>();

  constructor(
    private readonly maxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5),
    private readonly windowMs = Number(process.env.AUTH_LOGIN_WINDOW_MS ?? 15 * 60 * 1000),
    private readonly maxAttemptsPerIp = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS_PER_IP ?? 10)
  ) {
    // L3: Validate env var parsing
    if (!Number.isFinite(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error("AUTH_LOGIN_MAX_ATTEMPTS must be a positive integer");
    }
    if (!Number.isFinite(this.windowMs) || this.windowMs < 1000) {
      throw new Error("AUTH_LOGIN_WINDOW_MS must be at least 1000");
    }
  }

  assertAllowed(scope: LoginAttemptScope, now = Date.now()): void {
    // M8: Per-IP throttle — attacker cannot bypass by rotating email
    const ipKey = scope.ip;
    const ipBucket = this.activePerIpBucket(ipKey, now);
    if (ipBucket.count >= this.maxAttemptsPerIp) {
      throw new LoginRateLimitedError(ipBucket.resetAt - now);
    }

    // Per-email throttle (within the IP)
    const key = this.key(scope);
    const bucket = this.activeBucket(key, now);
    if (bucket.count >= this.maxAttempts) {
      throw new LoginRateLimitedError(bucket.resetAt - now);
    }
  }

  recordFailure(scope: LoginAttemptScope, now = Date.now()): void {
    const key = this.key(scope);
    const bucket = this.activeBucket(key, now);
    bucket.count += 1;
    this.attempts.set(key, bucket);

    // Also increment per-IP counter
    const ipKey = scope.ip;
    const ipBucket = this.activePerIpBucket(ipKey, now);
    ipBucket.count += 1;
    this.perIpAttempts.set(ipKey, ipBucket);
  }

  recordSuccess(scope: LoginAttemptScope): void {
    this.attempts.delete(this.key(scope));
    // Note: per-IP counter is NOT deleted, as it's a broader limit.
    // The IP-level bucket will reset after windowMs.
  }

  remaining(scope: LoginAttemptScope, now = Date.now()): number {
    const bucket = this.activeBucket(this.key(scope), now);
    return Math.max(this.maxAttempts - bucket.count, 0);
  }

  retryAfterMs(scope: LoginAttemptScope, now = Date.now()): number | undefined {
    const key = this.key(scope);
    const bucket = this.attempts.get(key);
    if (!bucket || bucket.resetAt <= now) {
      return undefined;
    }
    return bucket.resetAt - now;
  }

  /**
   * Evict expired buckets to prevent unbounded memory growth (C4).
   * Call periodically (e.g., from a scheduled job) or opportunistically.
   */
  evictExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.attempts.entries()) {
      if (bucket.resetAt <= now) {
        this.attempts.delete(key);
        removed++;
      }
    }
    for (const [key, bucket] of this.perIpAttempts.entries()) {
      if (bucket.resetAt <= now) {
        this.perIpAttempts.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private activeBucket(key: string, now: number): AttemptBucket {
    const existing = this.attempts.get(key);
    if (!existing || existing.resetAt <= now) {
      return { count: 0, resetAt: now + this.windowMs };
    }
    return existing;
  }

  private activePerIpBucket(ip: string, now: number): PerIpBucket {
    const existing = this.perIpAttempts.get(ip);
    if (!existing || existing.resetAt <= now) {
      return { count: 0, resetAt: now + this.windowMs };
    }
    return existing;
  }

  private key(scope: LoginAttemptScope): string {
    // L4: Normalize email once (upstream does normalizeEmail on controller, but normalize here too for safety)
    return `${scope.ip}:${scope.email.toLowerCase().trim()}`;
  }
}
