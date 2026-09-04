/**
 * In-memory sliding-window rate-limit store.
 * Swap implementation behind this port to add Redis later (REDIS_URL is documented
 * in .env.example; this class stays the default).
 */

import { Injectable } from "@nestjs/common";

export interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  resetAt: number;
}

@Injectable()
export class RateLimitStore {
  private readonly buckets = new Map<string, RateLimitBucket>();

  /**
   * Atomically evaluate + increment for a key.
   * Returns the post-increment decision so callers can build response headers.
   */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    const bucket = this.activeBucket(key, now, windowMs);
    bucket.count += 1;
    this.buckets.set(key, bucket);

    const remaining = Math.max(limit - bucket.count, 0);
    return {
      allowed: bucket.count <= limit,
      remaining,
      retryAfterMs: Math.max(bucket.resetAt - now, 0),
      limit,
      resetAt: bucket.resetAt,
    };
  }

  /**
   * Evaluate without incrementing — useful for headers on requests that skip the guard.
   */
  peek(key: string, limit: number, now = Date.now()): RateLimitDecision {
    const bucket = this.activeBucket(key, now, 0);
    const remaining = Math.max(limit - bucket.count, 0);
    return {
      allowed: bucket.count <= limit,
      remaining,
      retryAfterMs: bucket.count > limit ? Math.max(bucket.resetAt - now, 0) : 0,
      limit,
      resetAt: bucket.resetAt,
    };
  }

  /** Evict expired buckets to bound memory growth. */
  evictExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Test-only — wipe all state. */
  reset(): void {
    this.buckets.clear();
  }

  private activeBucket(key: string, now: number, windowMs: number): RateLimitBucket {
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) return existing;
    return { count: 0, resetAt: windowMs > 0 ? now + windowMs : now };
  }
}
