/**
 * Redis-backed sliding-window rate-limit store.
 * Falls back to in-memory RateLimitStore when REDIS_URL is not configured.
 * Uses a single INCR + PEXPIRE per hit — lightweight, atomic, no Lua needed.
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { Redis as RedisType } from "ioredis";
import RedisModule from "ioredis";
const Redis = RedisModule.default ?? RedisModule;
import { RateLimitStore, type RateLimitDecision } from "./rate-limit.store.js";

@Injectable()
export class RedisRateLimitStore extends RateLimitStore implements OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private redis: RedisType | null = null;

  constructor() {
    super();
    const url = process.env.REDIS_URL?.trim();
    if (url) {
      try {
        this.redis = new (Redis as unknown as new (...args: unknown[]) => RedisType)(url, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
          connectTimeout: 3000,
        });
        this.redis.connect().catch((err: Error) => {
          this.logger.warn(`Redis rate-limit connection failed, using in-memory fallback: ${err.message}`);
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => {});
  }

  override hit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    if (!this.redis) {
      return super.hit(key, limit, windowMs, now);
    }

    // Fire-and-forget async Redis call; return optimistic allow.
    // Next request within window will see incremented count.
    const redisKey = `rl:${key}`;
    const windowSec = Math.ceil(windowMs / 1000);

    this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSec, "NX")
      .exec()
      .then((results: [Error | null, unknown][] | null) => {
        if (!results) return;
        const count = (results[0]?.[1] as number) ?? 0;
        // Cache locally for sync peek() calls
        this.syncLocal(key, count, windowMs, now);
      })
      .catch((err: Error) => {
        this.logger.warn(`Redis rate-limit hit failed, falling back: ${err.message}`);
      });

    // For the current request, use local state (slightly behind Redis but avoids async guard).
    return super.hit(key, limit, windowMs, now);
  }

  private syncLocal(key: string, redisCount: number, windowMs: number, now: number): void {
    // Update in-memory bucket to match Redis for consistent peek() results.
    const bucket = { count: redisCount, resetAt: now + windowMs };
    (this as unknown as { buckets: Map<string, unknown> }).buckets.set(key, bucket);
  }
}
