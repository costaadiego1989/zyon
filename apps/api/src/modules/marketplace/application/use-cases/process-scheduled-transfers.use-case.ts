import { Injectable, Logger } from "@nestjs/common";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface ProcessScheduledTransfersInput { nowDate?: Date; }
export interface ProcessScheduledTransfersOutput {
  returnWindowsExpired: number;
  transfersExecuted: number;
  transfersBlocked: number;
  schedulesBlocked: number;
  processed: number;
}

@Injectable()
export class ProcessScheduledTransfersUseCase {
  private readonly logger = new Logger(ProcessScheduledTransfersUseCase.name);

  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly stateMachine: SettlementStateMachineService,
    private readonly configRepository: MarketplaceConfigRepository,
  ) {}

  async execute(input: ProcessScheduledTransfersInput): Promise<ProcessScheduledTransfersOutput> {
    const nowDate = input.nowDate ?? new Date();
    const expiredReturnWindows = await this.settlementRepository.findExpiredReturnWindows(nowDate);
    let returnWindowsExpired = 0;
    let schedulesBlocked = 0;
    for (const settlement of expiredReturnWindows) {
      try {
        let transferScheduledAt = settlement.transferScheduledAt;
        if (!transferScheduledAt) {
          // Legacy settlements did not persist the calculated payout date.
          const config = await this.configRepository.get(settlement.hostMerchantId);
          if (!config) throw new Error("marketplace_payout_config_missing");
          this.stateMachine.validateConfig(config);
          transferScheduledAt = new Date(settlement.returnWindowUntil);
          transferScheduledAt.setUTCDate(transferScheduledAt.getUTCDate() + config.payoutDelayDays);
        }
        if (!Number.isFinite(transferScheduledAt.getTime())) throw new Error("invalid_payout_date");
        await this.settlementRepository.updateStatus({
          settlementId: settlement.id,
          expectedStatus: "awaiting_return_window",
          status: this.stateMachine.transition(settlement.status, "return_window_expired"),
          transferScheduledAt,
        });
        returnWindowsExpired++;
      } catch (error) {
        schedulesBlocked++;
        this.logger.error("Settlement scheduling failed", error instanceof Error ? error.message : "unknown_error");
      }
    }

    // MarketplaceModule has no payout adapter or provider reconciliation. A due date
    // alone cannot prove money moved, even if a legacy row contains a transfer ID.
    const dueSettlements = await this.settlementRepository.findDueTransfers(nowDate);
    if (dueSettlements.length) {
      this.logger.warn({ event: "marketplace_payout_blocked", reason: "provider_unavailable", count: dueSettlements.length });
    }
    return {
      returnWindowsExpired,
      transfersExecuted: 0,
      transfersBlocked: dueSettlements.length,
      schedulesBlocked,
      processed: returnWindowsExpired,
    };
  }
}
