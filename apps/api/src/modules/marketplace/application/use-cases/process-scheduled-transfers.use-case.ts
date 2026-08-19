import { Injectable, Logger } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface ProcessScheduledTransfersInput {
  nowDate?: Date;
}

export interface ProcessScheduledTransfersOutput {
  returnWindowsExpired: number;
  transfersExecuted: number;
  processed: number;
}

@Injectable()
export class ProcessScheduledTransfersUseCase {
  private readonly logger = new Logger(ProcessScheduledTransfersUseCase.name);

  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly stateMachine: SettlementStateMachineService,
  ) {}

  async execute(
    input: ProcessScheduledTransfersInput,
  ): Promise<ProcessScheduledTransfersOutput> {
    const nowDate = input.nowDate ?? new Date();

    // Step 1: Process expired return windows (awaiting_return_window → transfer_scheduled)
    const expiredReturnWindows =
      await this.settlementRepository.findExpiredReturnWindows(nowDate);

    let returnWindowsExpired = 0;
    for (const settlement of expiredReturnWindows) {
      try {
        const newStatus = this.stateMachine.transition(
          settlement.status,
          "return_window_expired",
        );

        // Calculate transferScheduledAt based on the settlement config
        // transferScheduledAt = returnWindowUntil + payoutDelayDays
        // For now, we'll set it to now + a minimal delay
        // In a real system, this would be persisted in the settlement or fetched from config
        const transferScheduledAt = new Date(nowDate.getTime());
        transferScheduledAt.setDate(transferScheduledAt.getDate() + 1);

        await this.settlementRepository.updateStatus({
          settlementId: settlement.id,
          status: newStatus,
          transferScheduledAt,
        });

        returnWindowsExpired++;
        this.logger.log(
          `Processed return window expiration for settlement ${settlement.id}, seller=${settlement.sellerMerchantId}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to process return window for settlement ${settlement.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Step 2: Process due transfers (transfer_scheduled → transferred)
    const dueSettlements =
      await this.settlementRepository.findDueTransfers(nowDate);

    let transfersExecuted = 0;
    for (const settlement of dueSettlements) {
      try {
        const newStatus = this.stateMachine.transition(
          settlement.status,
          "transfer_executed",
        );

        await this.settlementRepository.updateStatus({
          settlementId: settlement.id,
          status: newStatus,
          transferredAt: nowDate,
        });

        transfersExecuted++;
        this.logger.log(
          `Processed transfer for settlement ${settlement.id}, seller=${settlement.sellerMerchantId}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to process transfer for settlement ${settlement.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      returnWindowsExpired,
      transfersExecuted,
      processed: returnWindowsExpired + transfersExecuted,
    };
  }
}
