import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RateLimitGuard, RATE_LIMIT_OPTIONS } from "./rate-limit.guard.js";
import { RateLimitStore } from "./rate-limit.store.js";
import { resolveRateLimitOptions } from "./rate-limit.options.js";

/**
 * Wires the in-memory rate-limit store and registers the guard globally.
 *
 * Per-route override:
 *   @RateLimit(10, 60_000)        // tighten budget
 *   @SkipRateLimit()              // bypass entirely (e.g., health)
 *
 * Env:
 *   RATE_LIMIT_MAX        (default 100)
 *   RATE_LIMIT_WINDOW_MS  (default 900_000 = 15 min)
 *   RATE_LIMIT_COUNT_FAILED (default true) — reserved for future use
 *
 * Excludes /health, /ready, /readyz, /livez, /metrics by default.
 * A Redis-backed store can replace RateLimitStore without changing the guard.
 */
@Global()
@Module({
  providers: [
    RateLimitStore,
    {
      provide: RATE_LIMIT_OPTIONS,
      useFactory: () => resolveRateLimitOptions(),
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [RateLimitStore, RATE_LIMIT_OPTIONS],
})
export class RateLimitModule {}
