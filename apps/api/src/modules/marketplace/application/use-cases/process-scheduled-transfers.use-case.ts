import { Injectable, Logger } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface ProcessScheduledTransfersInput {
  nowDate?: Date;
}

export interface ProcessScheduledTransfersOutput {
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

    const dueSettlements =
      await this.settlementRepository.findDueTransfers(nowDate);

    let processed = 0;
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

        processed++;
        this.logger.log(
          `Processed transfer for settlement ${settlement.id}, seller=${settlement.sellerMerchantId}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to process transfer for settlement ${settlement.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { processed };
  }
}
