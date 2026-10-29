import { EmailChangeRequestThrottledError } from "../errors.js";

/**
 * Rate-limits email change requests per user to prevent OTP spam.
 * In-memory. For multi-instance deployments, swap for a Redis-backed store.
 */
export class EmailChangeRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts = 3,
    private readonly windowMs = 15 * 60 * 1000, // 15 minutes
  ) {}

  assertAllowed(userId: string, now = Date.now()): void {
    const recent = this.recent(userId, now);
    if (recent.length >= this.maxAttempts) {
      const oldest = recent[0]!;
      const retryAfterMs = Math.max(this.windowMs - (now - oldest), 0);
      throw new EmailChangeRequestThrottledError(retryAfterMs);
    }
  }

  record(userId: string, now = Date.now()): void {
    const recent = this.recent(userId, now);
    recent.push(now);
    this.attempts.set(userId, recent);
  }

  clear(userId: string): void {
    this.attempts.delete(userId);
  }

  private recent(userId: string, now: number): number[] {
    const list = this.attempts.get(userId) ?? [];
    const cutoff = now - this.windowMs;
    const filtered = list.filter((t) => t > cutoff);
    if (filtered.length !== list.length) this.attempts.set(userId, filtered);
    return filtered;
  }
}
