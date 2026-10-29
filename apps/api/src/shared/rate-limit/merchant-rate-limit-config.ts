/**
 * Merchant-Scoped Rate Limiting Integration Guide
 *
 * The existing rate-limit.guard.ts uses IP-based keying. To add merchant-scoped limits:
 *
 * 1. Update rate-limit.guard.ts buildKey() to extract merchantId from request context:
 *    - Check `(req as any).merchantId` (set by TenantGuard)
 *    - Fallback to IP if merchantId missing
 *
 * 2. Suggested key format:
 *    const merchantId = (req as any).merchantId;
 *    const basePath = this.normalizedPath(request);
 *    return merchantId ? `merchant:${merchantId}:${basePath}` : this.extractIp(request);
 *
 * 3. Per-endpoint limits example in controller:
 *    @Post('conversations/:storeId/messages')
 *    @RateLimit(100, 60_000)  // 100 msgs/min per merchant
 *    async sendMessage(...) { ... }
 *
 * 4. Redis-backed store (redis-rate-limit.store.ts) automatically scales to multi-instance:
 *    - Constructor already injects Redis client if RateLimitStore is bound to it
 *    - No code changes needed if Redis is wired in app.module.ts
 *
 * Current Limits (from spec, deployable via @RateLimit decorators):
 * - Conversations: 100/min per merchant
 * - API calls: 1000/min per merchant
 * - Store Builder product creates: 50/min
 *
 * Apply with:
 * @RateLimit(100, 60_000)  // conversations endpoint
 * @RateLimit(1000, 60_000) // general API
 * @RateLimit(50, 60_000)   // product create
 */

export const MERCHANT_RATE_LIMIT_CONFIG = {
  CONVERSATIONS: { limit: 100, windowMs: 60_000 },
  API_CALLS: { limit: 1000, windowMs: 60_000 },
  STORE_BUILDER_PRODUCTS: { limit: 50, windowMs: 60_000 },
} as const;
