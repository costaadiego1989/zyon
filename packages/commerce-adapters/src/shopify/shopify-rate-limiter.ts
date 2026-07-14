/**
 * Shopify GraphQL Admin API rate-limit helpers.
 *
 * Shopify returns the current bucket state in `extensions.cost.throttleStatus`:
 *   { "throttleStatus": { "currentlyAvailable": 850, "restoreRate": 50 } }
 *
 * On 429 the response also carries `Retry-After` (seconds). Throttled errors
 * inside `errors[]` use `extensions.code === "THROTTLED"` (Shopify 2024-10+).
 *
 * Refs:
 * - https://shopify.dev/docs/api/admin-graphql#rate_limits
 * - https://shopify.dev/docs/api/admin-graphql#throttling
 */

export type ShopifyThrottleStatus = {
  /** Approximate points available in the leaky bucket right now. */
  currentlyAvailable?: number;
  /** Points restored per second. */
  restoreRate?: number;
  /** Optional maximum bucket size; older API versions may not include it. */
  maximumAvailable?: number;
};

export type ShopifyGraphqlCost = {
  throttleStatus?: ShopifyThrottleStatus | null;
  /** What this single request cost. */
  actualQueryCost?: number | null;
  /** Sum of nested fields / theoretical max. */
  maxCost?: number | null;
};

export type ShopifyGraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  extensions?: { cost?: ShopifyGraphqlCost | null } | null;
};

/**
 * Parses a numeric `Retry-After` header value.
 * Returns `undefined` if missing or malformed.
 */
export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

/**
 * Mutable leaky-bucket snapshot for a single shop's GraphQL cost budget.
 * One instance per adapter (one shop per adapter). We do NOT throttle locally
 * — Shopify is the source of truth — we only expose `suggestedBackoffMs` so
 * callers can wait proactively under sustained load.
 */
export class ShopifyRateLimiter {
  #available: number;
  #restoreRate: number;
  #maximum: number;
  #hasSnapshot: boolean;

  constructor(initial?: ShopifyThrottleStatus) {
    if (initial) {
      this.#available = Math.max(0, initial.currentlyAvailable ?? 0);
      this.#restoreRate = Math.max(0, initial.restoreRate ?? 50);
      this.#maximum = Math.max(
        this.#available,
        initial.maximumAvailable ?? initial.currentlyAvailable ?? 1000,
      );
      this.#hasSnapshot = true;
    } else {
      this.#available = 0;
      this.#restoreRate = 50;
      this.#maximum = 1000;
      this.#hasSnapshot = false;
    }
  }

  /** Update the bucket snapshot from a GraphQL response. */
  updateFromResponse(cost?: ShopifyGraphqlCost | null): void {
    const status = cost?.throttleStatus;
    if (!status) return;
    this.#available = Math.max(0, status.currentlyAvailable ?? this.#available);
    this.#restoreRate = Math.max(0, status.restoreRate ?? this.#restoreRate);
    this.#maximum = Math.max(
      this.#available,
      status.maximumAvailable ?? this.#maximum,
    );
    this.#hasSnapshot = true;
  }

  /**
   * Suggested delay (ms) before retrying, derived from the current bucket
   * snapshot. `cost` is the actual cost of the most recent request.
   * Returns 0 if the bucket is comfortably above the cost.
   */
  suggestedBackoffMs(cost: number): number {
    if (!this.#hasSnapshot) return 0;
    if (this.#available >= cost) return 0;
    const deficit = cost - this.#available;
    const seconds = deficit / Math.max(1, this.#restoreRate);
    return Math.ceil(seconds * 1000);
  }

  get available(): number {
    return this.#available;
  }

  get hasSnapshot(): boolean {
    return this.#hasSnapshot;
  }
}

/**
 * Returns `max(defaultDelayMs, retryAfterSeconds * 1000)` so that the larger
 * of the two wins when the server explicitly tells us to wait.
 */
export function retryDelayFromHeaders(
  retryAfterSeconds: number | undefined,
  defaultDelayMs: number,
): number {
  if (retryAfterSeconds === undefined) return defaultDelayMs;
  return Math.max(defaultDelayMs, Math.ceil(retryAfterSeconds * 1000));
}
