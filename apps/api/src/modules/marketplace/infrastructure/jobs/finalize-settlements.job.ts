import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from "@nestjs/common";
import {
  MARKETPLACE_SETTLEMENT_REPOSITORY,
  type MarketplaceSettlementRepository,
} from "../../domain/ports/marketplace-settlement-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

const FINALIZE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class FinalizeSettlementsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinalizeSettlementsJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(MARKETPLACE_SETTLEMENT_REPOSITORY)
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly stateMachine: SettlementStateMachineService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.finalizeExpiredWindows().catch((err) => {
        this.logger.error(
          `Finalize settlements job failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, FINALIZE_INTERVAL_MS);
    this.logger.log("Finalize settlements job started (daily)");
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async finalizeExpiredWindows(): Promise<void> {
    const now = new Date();
    const expired =
      await this.settlementRepository.findExpiredChargebackWindows(now);

    let finalized = 0;
    for (const settlement of expired) {
      try {
        const newStatus = this.stateMachine.transition(
          settlement.status,
          "chargeback_window_expired",
        );

        await this.settlementRepository.updateStatus({
          settlementId: settlement.id,
          status: newStatus,
          finalizedAt: now,
        });
        finalized++;
      } catch (err) {
        this.logger.error(
          `Failed to finalize settlement ${settlement.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (finalized > 0) {
      this.logger.log(`Finalized ${finalized} settlement(s)`);
    }
  }
}
