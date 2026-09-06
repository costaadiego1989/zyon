import type { RecoveryAttempt, RecoveryAttemptStatus } from "../entities/recovery-attempt.entity.js";

export const RECOVERY_ATTEMPT_REPOSITORY = Symbol("RECOVERY_ATTEMPT_REPOSITORY");

export interface ListRecoveryAttemptsOptions {
  status?: RecoveryAttemptStatus;
  limit: number;
  offset: number;
}

export interface RecoveryAttemptRepositoryPort {
  save(attempt: RecoveryAttempt): Promise<void>;
  findById(id: string): Promise<RecoveryAttempt | null>;
  findBySessionId(merchantId: string, sessionId: string): Promise<RecoveryAttempt[]>;
  existsForSession(merchantId: string, sessionId: string): Promise<boolean>;
  findByMerchantAndStatus(merchantId: string, status: RecoveryAttemptStatus): Promise<RecoveryAttempt[]>;
  findByMerchant(merchantId: string, options: ListRecoveryAttemptsOptions): Promise<RecoveryAttempt[]>;
  getMetrics(merchantId: string, from: Date, to: Date): Promise<{
    // Null means unmeasured; a triggered session is not confirmed abandonment.
    total_abandoned: number | null;
    recovery_attempts: number;
    recovered: number;
    recovery_rate: number | null;
    // Requires reconciled orders and currency units; never estimate from count.
    revenue_recovered_cents: number | null;
    top_strategy: string | null;
  }>;
}
