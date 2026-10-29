/**
 * Nuvemshop (Tiendanube) rate limiter.
 *
 * Nuvemshop publish a leaky-bucket limit: 40 burst / 2 req/sec sustained, per
 * (store, app) pair. We approximate with a token bucket that refills at
 * 2 tokens/sec and caps burst at 40. Calls are serialised per bucket so the
 * adapter never observes a 429 in normal operation.
 *
 * Note: the bucket is process-local. For multi-instance deployments, the
 * `minIntervalMs` floor is still respected per-instance; cross-instance
 * coordination would require a shared store (Redis token bucket) and is
 * intentionally out of scope here.
 */
export interface NuvemshopRateLimiterOptions {
  /** Sustained refill rate (tokens / second). Default 2 (Nuvemshop spec). */
  refillPerSecond?: number;
  /** Maximum burst capacity. Default 40 (Nuvemshop spec). */
  burst?: number;
  /** Floor between calls, regardless of tokens (ms). Default 0. */
  minIntervalMs?: number;
}

export class NuvemshopRateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #minIntervalMs: number;
  #tokens: number;
  #lastRefillMs: number;
  #lastAcquireMs: number;
  #queue: Array<() => void> = [];
  #draining = false;

  constructor(options: NuvemshopRateLimiterOptions = {}) {
    this.#capacity = Math.max(1, options.burst ?? 40);
    this.#refillPerMs = (options.refillPerSecond ?? 2) / 1000;
    this.#minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    this.#tokens = this.#capacity;
    this.#lastRefillMs = Date.now();
    this.#lastAcquireMs = 0;
  }

  /**
   * Wait until a request slot is available, then return. The promise resolves
   * strictly after any prior queued acquire, preserving FIFO ordering so
   * batched catalog sync cannot reorder.
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
          // Release the drain lock so other acquire() calls can re-enter after the wait.
          this.#draining = false;
          setTimeout(() => {
            // Preserve queue head ordering: re-attach the same resolver.
            if (next && this.#queue[0] !== next) {
              this.#queue.unshift(next);
            }
            void this.#drain();
          }, waitMs);
          return;
        }
        // Tokens exhausted but waitMs == 0 (e.g., refillPerSecond == 0); schedule a 1ms wait.
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
