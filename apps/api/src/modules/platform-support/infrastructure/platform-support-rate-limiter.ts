import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT_TOKEN } from "../../../shared/cache/redis.module.js";
import { SupportError } from "../domain/platform-support.js";

@Injectable()
export class PlatformSupportRateLimiter {
  private readonly counters = new Map<string, { count: number; until: number }>();
  private readonly logger = new Logger(PlatformSupportRateLimiter.name);
  constructor(@Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null) {}

  async check(key: string, limit: number, windowMs: number) {
    let count: number;
    if (this.redis) {
      try {
        count = Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `platform-support:rate:${key}`, windowMs));
      } catch {
        this.logger.warn("support_rate_store_unavailable");
        throw new SupportError("support_temporarily_unavailable", 503);
      }
    } else {
      const now = Date.now();
      for (const [entry, value] of this.counters) if (value.until <= now) this.counters.delete(entry);
      if (this.counters.size >= 10_000 && !this.counters.has(key)) throw new SupportError("support_rate_limited", 429);
      const counter = this.counters.get(key) ?? { count: 0, until: now + windowMs };
      count = ++counter.count;
      this.counters.set(key, counter);
    }
    if (count > limit) throw new SupportError("support_rate_limited", 429);
  }
}
