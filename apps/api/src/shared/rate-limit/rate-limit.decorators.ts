import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_OPTIONS_KEY = "rate-limit:options";
export const SKIP_RATE_LIMIT_KEY = "rate-limit:skip";

export interface RateLimitOverride {
  limit: number;
  windowMs: number;
}

/**
 * Override the global rate-limit budget for a specific handler or controller.
 * Example: @RateLimit(10, 60_000) → 10 req / 60s.
 */
export const RateLimit = (limit: number, windowMs: number): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_OPTIONS_KEY, { limit, windowMs } satisfies RateLimitOverride);

/**
 * Bypass the rate-limit guard entirely for the decorated handler/controller.
 * Use for health checks, readiness probes, and internal callbacks.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT_KEY, true);
