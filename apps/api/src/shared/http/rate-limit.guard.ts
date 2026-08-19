import { Injectable, type CanActivate, type ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

// eslint-disable-next-line @typescript-eslint/no-require-imports
let IoRedis: any;
try { IoRedis = require("ioredis"); } catch { IoRedis = null; }

const RATE_LIMIT_KEY = "rate-limit";

export const TIER_LIMITS: Record<string, number> = {
  free: 60,
  starter: 60,
  growth: 600,
  pro: 600,
  scale: 6000,
  enterprise: 6000,
};

export function RateLimit(requestsPerMinute: number) {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(RATE_LIMIT_KEY, requestsPerMinute, descriptor?.value ?? target);
  };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private redis: any = null;

  constructor(private readonly reflector: Reflector) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && IoRedis) {
      this.redis = new IoRedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      this.redis.connect().catch(() => { this.redis = null; });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip if no Redis (dev mode — no rate limiting)
    if (!this.redis) return true;

    const request = context.switchToHttp().getRequest();
    const principal = request.tenantPrincipal;
    if (!principal) return true; // unauthenticated — let auth guard handle

    const merchantId = principal.tenantId;
    const tier = request.billingTier ?? "free";

    // Check per-endpoint override
    const handlerLimit = this.reflector.get<number>(RATE_LIMIT_KEY, context.getHandler());
    const limit = handlerLimit ?? TIER_LIMITS[tier] ?? 60;

    const now = Math.floor(Date.now() / 60000); // minute bucket
    const key = `rl:${merchantId}:${now}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, 120); // expire after 2 minutes
    }

    const remaining = Math.max(0, limit - current);
    const reset = (now + 1) * 60;

    // Set headers
    const response = context.switchToHttp().getResponse();
    response.setHeader("X-RateLimit-Limit", String(limit));
    response.setHeader("X-RateLimit-Remaining", String(remaining));
    response.setHeader("X-RateLimit-Reset", String(reset));

    if (current > limit) {
      response.setHeader("Retry-After", "60");
      throw new HttpException(
        {
          type: "https://docs.aacp.dev/errors/rate_limited",
          title: "Too Many Requests",
          status: 429,
          code: "rate_limited",
          detail: `Rate limit exceeded (${limit} req/min for ${tier} tier). Retry after 60 seconds.`,
          correlation_id: request.correlationId,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
