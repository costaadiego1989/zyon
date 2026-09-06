import { Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

export interface QuotaOptions {
  redisUrl?: string;
  production: boolean;
  ipMax: number;
  windowMs: number;
  tenantMax: number;
}
export interface QuotaDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

// Count and expiry are one server operation, including repair of an old key
// without TTL. Every replica awaits and enforces the same authoritative count.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export class DistributedRateLimitStore implements OnModuleDestroy {
  private readonly redis: Redis | undefined;
  private readonly local = new Map<string, { count: number; resetAt: number }>();
  private connecting: Promise<unknown> | undefined;

  constructor(readonly options: QuotaOptions = resolveQuotaOptions()) {
    for (const value of [options.ipMax, options.windowMs, options.tenantMax]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("invalid_rate_limit_configuration");
    }
    if (!options.redisUrl) {
      if (options.production) throw new Error("rate_limit_requires_redis_in_production");
      new Logger(DistributedRateLimitStore.name).warn("Rate limiting uses process-local counters outside production because REDIS_URL is absent.");
    } else {
      this.redis = new Redis(options.redisUrl, {
        lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500,
        commandTimeout: 2000, enableOfflineQueue: false,
      });
      // Keep the client for reconnection without logging URLs or credentials.
      this.redis.on("error", () => {});
    }
  }

  async hit(key: string, limit: number, windowMs: number): Promise<QuotaDecision> {
    const now = Date.now();
    let count: number;
    let ttl: number;
    if (this.redis) {
      if (this.redis.status === "wait") this.connecting = this.redis.connect();
      if (this.connecting) {
        try { await this.connecting; } finally { this.connecting = undefined; }
      }
      const result = await this.redis.eval(HIT_SCRIPT, 1, `aacp:quota:v2:${key}`, windowMs) as [number, number];
      [count, ttl] = result;
    } else {
      for (const [localKey, bucket] of this.local) if (bucket.resetAt <= now) this.local.delete(localKey);
      let bucket = this.local.get(key);
      if (!bucket) {
        if (this.local.size >= 10_000) throw new Error("local_rate_limit_capacity_reached");
        bucket = { count: 0, resetAt: now + windowMs };
        this.local.set(key, bucket);
      }
      count = ++bucket.count;
      ttl = Math.max(0, bucket.resetAt - now);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: now + ttl, retryAfterMs: ttl };
  }

  onModuleDestroy(): void { this.redis?.disconnect(); this.local.clear(); }
}

export function resolveQuotaOptions(env: NodeJS.ProcessEnv = process.env): QuotaOptions {
  function positive(name: string, fallback: number): number {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid_rate_limit_configuration:${name}`);
    return value;
  }
  return {
    redisUrl: env.REDIS_URL?.trim() || undefined, production: env.NODE_ENV === "production",
    ipMax: positive("RATE_LIMIT_MAX", 600), windowMs: positive("RATE_LIMIT_WINDOW_MS", 60_000),
    tenantMax: positive("RATE_LIMIT_TENANT_MAX", 60),
  };
}
