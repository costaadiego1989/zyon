import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { RecoveryAttempt, type RecoveryAttemptStatus } from "../../domain/entities/recovery-attempt.entity.js";

/**
 * In-memory test double — NEVER used in production module wiring.
 * Only constructed directly in specs (per CLAUDE.md invariant).
 */
export class InMemoryRecoveryAttemptRepository implements RecoveryAttemptRepositoryPort {
  private attempts: RecoveryAttempt[] = [];

  async save(attempt: RecoveryAttempt): Promise<void> {
    const idx = this.attempts.findIndex((a) => a.id === attempt.id);
    if (idx >= 0) {
      this.attempts[idx] = attempt;
    } else {
      this.attempts.push(attempt);
    }
  }

  async findById(id: string): Promise<RecoveryAttempt | null> {
    return this.attempts.find((a) => a.id === id) ?? null;
  }

  async findBySessionId(merchantId: string, sessionId: string): Promise<RecoveryAttempt[]> {
    return this.attempts.filter((a) => a.merchantId === merchantId && a.sessionId === sessionId);
  }

  async existsForSession(merchantId: string, sessionId: string): Promise<boolean> {
    return this.attempts.some((a) => a.merchantId === merchantId && a.sessionId === sessionId);
  }

  async findByMerchantAndStatus(merchantId: string, status: RecoveryAttemptStatus): Promise<RecoveryAttempt[]> {
    return this.attempts.filter((a) => a.merchantId === merchantId && a.status === status);
  }

  async getMetrics(merchantId: string, from: Date, to: Date) {
    const scoped = this.attempts.filter(
      (a) => a.merchantId === merchantId && a.createdAt >= from && a.createdAt <= to
    );
    const recovered = scoped.filter((a) => a.status === "recovered");
    const strategies = scoped.map((a) => a.strategy.type);
    const topStrategy = strategies.length > 0
      ? mostFrequent(strategies)
      : null;

    return {
      total_abandoned: null,
      recovery_attempts: scoped.length,
      recovered: recovered.length,
      recovery_rate: scoped.length > 0 ? recovered.length / scoped.length : null,
      revenue_recovered_cents: null,
      top_strategy: topStrategy,
    };
  }

  // Test helpers
  getAll(): RecoveryAttempt[] {
    return [...this.attempts];
  }

  count(): number {
    return this.attempts.length;
  }

  clear(): void {
    this.attempts = [];
  }
}

function mostFrequent(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const s of arr) freq[s] = (freq[s] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]![0];
}
