import type { RecoveryAttempt, RecoveryAttemptStatus } from "../../domain/entities/recovery-attempt.entity.js";
import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";

const STATUSES = new Set<RecoveryAttemptStatus>(["pending", "sent", "recovered", "failed", "expired", "unknown"]);

export interface ListRecoveryAttemptsInput {
  merchantId: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/** Tenant-scoped, bounded projection source for the dashboard attempt table. */
export class ListRecoveryAttemptsUseCase {
  constructor(private readonly repository: RecoveryAttemptRepositoryPort) {}

  async execute(input: ListRecoveryAttemptsInput): Promise<RecoveryAttempt[]> {
    const status = input.status && input.status !== "all" && STATUSES.has(input.status as RecoveryAttemptStatus)
      ? input.status as RecoveryAttemptStatus
      : undefined;
    const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Math.floor(input.limit!), 1), 100) : 50;
    const offset = Number.isFinite(input.offset) ? Math.max(Math.floor(input.offset!), 0) : 0;
    return this.repository.findByMerchant(input.merchantId, { status, limit, offset });
  }
}
