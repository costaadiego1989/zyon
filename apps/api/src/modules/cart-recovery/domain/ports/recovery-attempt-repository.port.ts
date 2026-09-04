import type { RecoveryAttempt, RecoveryAttemptStatus } from "../entities/recovery-attempt.entity.js";

export const RECOVERY_ATTEMPT_REPOSITORY = Symbol("RECOVERY_ATTEMPT_REPOSITORY");

export interface RecoveryAttemptRepositoryPort {
  save(attempt: RecoveryAttempt): Promise<void>;
  findById(id: string): Promise<RecoveryAttempt | null>;
  findBySessionId(merchantId: string, sessionId: string): Promise<RecoveryAttempt[]>;
  existsForSession(merchantId: string, sessionId: string): Promise<boolean>;
  findByMerchantAndStatus(merchantId: string, status: RecoveryAttemptStatus): Promise<RecoveryAttempt[]>;
  getMetrics(merchantId: string, from: Date, to: Date): Promise<{
    total_abandoned: number;
    recovery_attempts: number;
    recovered: number;
    recovery_rate: number;
    revenue_recovered_cents: number;
    top_strategy: string | null;
  }>;
}
