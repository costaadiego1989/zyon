import { Inject, Injectable } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, type ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ProcessRefundUseCase } from "./process-refund.use-case.js";

export type ReconcilePendingRefundsInput = {
  staleAfterMs: number;
  limit: number;
};

export type ReconcilePendingRefundsResult = {
  scanned: number;
  reconciled: Array<{ returnId: string; outcome: "completed" | "failed" | "still_pending" | "unknown" }>;
};

/**
 * Reconciles only attempts which already have a provider refund ID. It delegates
 * to ProcessRefund's PENDING branch, whose only provider action is a read.
 */
@Injectable()
export class ReconcilePendingRefundsUseCase {
  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    private readonly processRefund: ProcessRefundUseCase,
  ) {}

  async execute(input: ReconcilePendingRefundsInput): Promise<ReconcilePendingRefundsResult> {
    const returns = await this.returnRepo.listPendingRefunds({
      olderThan: new Date(Date.now() - input.staleAfterMs),
      limit: input.limit,
    });
    const reconciled: ReconcilePendingRefundsResult["reconciled"] = [];

    for (const ret of returns) {
      try {
        const result = await this.processRefund.execute(ret.merchantId, ret.id);
        const outcome = result.status === "REFUND_COMPLETED"
          ? "completed"
          : result.refund?.status === "FAILED"
            ? "failed"
            : "still_pending";
        reconciled.push({ returnId: ret.id, outcome });
      } catch {
        // A provider outage is not evidence to retry a financial operation.
        reconciled.push({ returnId: ret.id, outcome: "unknown" });
      }
    }
    return { scanned: returns.length, reconciled };
  }
}
