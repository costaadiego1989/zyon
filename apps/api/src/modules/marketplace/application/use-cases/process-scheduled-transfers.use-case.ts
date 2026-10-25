import { Injectable, Logger } from "@nestjs/common";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";
import type { ExecuteMarketplacePayoutUseCase } from "./execute-marketplace-payout.use-case.js";
import type { MarketplacePayoutRepository } from "../../domain/ports/marketplace-payout-repository.port.js";
import type { ExecuteMarketplaceResidualUseCase } from "./execute-marketplace-residual.use-case.js";
import type { MarketplaceResidualRepository } from "../../domain/ports/marketplace-residual-repository.port.js";

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
    private readonly payouts?: ExecuteMarketplacePayoutUseCase,
    private readonly payoutRepository?: MarketplacePayoutRepository,
    private readonly residuals?: ExecuteMarketplaceResidualUseCase,
    private readonly residualRepository?: MarketplaceResidualRepository,
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

    const dueSettlements = await this.settlementRepository.findDueTransfers(nowDate);
    const unresolved = await this.payoutRepository?.listUnresolved(100) ?? [];
    const hostReceivables = await this.payoutRepository?.listDueHost?.(nowDate, 100) ?? [];
    const candidates = [...new Set([...unresolved, ...dueSettlements.map(s => s.id), ...hostReceivables])];
    let transfersExecuted = 0;
    let transfersBlocked = 0;
    for (const id of candidates) {
      try {
        const outcome = this.payouts ? await this.payouts.execute(id, nowDate) : "blocked";
        if (outcome === "confirmed") transfersExecuted++;
        else transfersBlocked++;
      } catch {
        transfersBlocked++;
        this.logger.error({ event: "marketplace_payout_processing_failed" });
      }
    }
    const residualCandidates = await this.residualRepository?.listDue(nowDate, 20) ?? [];
    const uniqueResiduals = [...new Map(residualCandidates.map(row => [JSON.stringify([row.hostMerchantId, row.operationId]), row])).values()].slice(0, 20);
    // Only already prepared, due obligations may start a POST. Recovery workers
    // remain GET-only; per-row failure never stops the other beneficiaries.
    for (const row of uniqueResiduals) {
      try {
        const outcome = this.residuals ? await this.residuals.execute(row.hostMerchantId, row.operationId, nowDate) : "blocked";
        if (outcome === "confirmed") transfersExecuted++;
        else transfersBlocked++;
      } catch {
        transfersBlocked++;
        this.logger.error({ event: "marketplace_residual_processing_failed" });
      } finally {
        try { await this.residualRepository!.deferPlanned(row.hostMerchantId, row.operationId); }
        catch { this.logger.error({ event: "marketplace_residual_deferral_failed" }); }
      }
    }
    if (transfersBlocked) {
      this.logger.warn({ event: "marketplace_payout_blocked", reason: "awaiting_verified_provider_receipt", count: transfersBlocked });
    }
    return {
      returnWindowsExpired,
      transfersExecuted,
      transfersBlocked,
      schedulesBlocked,
      processed: returnWindowsExpired + transfersExecuted,
    };
  }
}
