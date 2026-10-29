/**
 * VTEX rate limiter.
 *
 * VTEX enforces 800 requests per minute per merchant (approx. 13.33 req/sec).
 * We implement a token bucket that refills at ~13.3 tokens/sec and caps burst
 * at 100. Calls are serialized per bucket so the adapter never observes a 429
 * in normal operation.
 *
 * Note: the bucket is process-local. For multi-instance deployments, the
 * `minIntervalMs` floor is still respected per-instance; cross-instance
 * coordination would require a shared store (Redis token bucket) and is
 * intentionally out of scope here.
 */
export interface VtexRateLimiterOptions {
  /** Sustained refill rate (tokens / second). Default ~13.33 (800 req/min). */
  refillPerSecond?: number;
  /** Maximum burst capacity. Default 100. */
  burst?: number;
  /** Floor between calls, regardless of tokens (ms). Default 0. */
  minIntervalMs?: number;
}

export class VtexRateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #minIntervalMs: number;
  #tokens: number;
  #lastRefillMs: number;
  #lastAcquireMs: number;
  #queue: Array<() => void> = [];
  #draining = false;

  constructor(options: VtexRateLimiterOptions = {}) {
    // 800 req/min = 13.333... req/sec
    this.#capacity = Math.max(1, options.burst ?? 100);
    this.#refillPerMs = (options.refillPerSecond ?? (800 / 60)) / 1000;
    this.#minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    this.#tokens = this.#capacity;
    this.#lastRefillMs = Date.now();
    this.#lastAcquireMs = 0;
  }

  /**
   * Wait until a request slot is available, then return. The promise resolves
   * strictly after any prior queued acquire, preserving FIFO ordering.
   */
  acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#queue.push(resolve);
      void this.#drain();
    });
  }

  /** @visibleForTesting — synchronously read available tokens, capped to capacity. */
  availableTokens(): number {
    this.#refill();
    return this.#tokens;
  }

  #drain(): Promise<void> {
    if (this.#draining) return Promise.resolve();
    this.#draining = true;
    const loop = (): void => {
      while (this.#queue.length > 0) {
        this.#refill();
        const now = Date.now();
        const waitMs = this.#computeWaitMs(now);
        if (waitMs <= 0 && this.#tokens >= 1) {
          this.#tokens -= 1;
          this.#lastAcquireMs = now;
          const next = this.#queue.shift();
          next?.();
          continue;
        }
        if (waitMs > 0) {
          const next = this.#queue[0];
          this.#draining = false;
          setTimeout(() => {
            if (next && this.#queue[0] !== next) {
              this.#queue.unshift(next);
            }
            void this.#drain();
          }, waitMs);
          return;
        }
        const next2 = this.#queue[0];
        this.#draining = false;
        setTimeout(() => {
          if (next2 && this.#queue[0] !== next2) {
            this.#queue.unshift(next2);
          }
          void this.#drain();
        }, 1);
        return;
      }
      this.#draining = false;
    };
    loop();
    return Promise.resolve();
  }

  #refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.#lastRefillMs;
    if (elapsedMs <= 0) return;
    const refilled = elapsedMs * this.#refillPerMs;
    if (refilled <= 0) {
      this.#lastRefillMs = now;
      return;
    }
    this.#tokens = Math.min(this.#capacity, this.#tokens + refilled);
    this.#lastRefillMs = now;
  }

  #computeWaitMs(now: number): number {
    if (this.#tokens < 1) {
      const tokensNeeded = 1 - this.#tokens;
      const msUntilNextToken = tokensNeeded / this.#refillPerMs;
      return Math.max(0, Math.ceil(msUntilNextToken));
    }
    const sinceLast = now - this.#lastAcquireMs;
    if (this.#minIntervalMs > sinceLast) {
      return this.#minIntervalMs - sinceLast;
    }
    return 0;
  }
}
