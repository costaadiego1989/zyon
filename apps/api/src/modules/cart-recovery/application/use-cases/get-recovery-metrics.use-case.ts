import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";

export interface GetRecoveryMetricsInput {
  merchantId: string;
  from: Date;
  to: Date;
}

export class GetRecoveryMetricsUseCase {
  constructor(private readonly repository: RecoveryAttemptRepositoryPort) {}

  async execute(input: GetRecoveryMetricsInput) {
    return this.repository.getMetrics(input.merchantId, input.from, input.to);
  }
}
