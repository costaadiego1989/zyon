import { Injectable, Logger } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
} from "../../domain/ports/marketplace-settlement-repository.port.js";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import type {
  MarketplaceSellerDebtRepository,
  MarketplaceSellerDebtSnapshot,
} from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface HandleMarketplaceChargebackInput {
  settlementId: string;
}

export interface HandleMarketplaceChargebackOutput {
  settlement: MarketplaceSettlementSnapshot;
  debtCreated: boolean;
  debt?: MarketplaceSellerDebtSnapshot;
}

@Injectable()
export class HandleMarketplaceChargebackUseCase {
  private readonly logger = new Logger(HandleMarketplaceChargebackUseCase.name);

  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly debtRepository: MarketplaceSellerDebtRepository,
    private readonly stateMachine: SettlementStateMachineService,
  ) {}

  async execute(
    input: HandleMarketplaceChargebackInput,
  ): Promise<HandleMarketplaceChargebackOutput> {
    const settlement = await this.settlementRepository.getById(
      input.settlementId,
    );
    if (!settlement) {
      throw new Error("Settlement not found");
    }

    const newStatus = this.stateMachine.transition(
      settlement.status,
      "chargeback_received",
    );

    const updated = await this.settlementRepository.updateStatus({
      settlementId: settlement.id,
      status: newStatus,
      chargebackAt: new Date(),
    });

    const debtCreated = newStatus === "chargeback_debt";
    let debt: MarketplaceSellerDebtSnapshot | undefined;

    if (debtCreated) {
      debt = await this.debtRepository.create({
        sellerMerchantId: settlement.sellerMerchantId,
        settlementId: settlement.id,
        amountCents: settlement.sellerNetCents,
      });

      this.logger.warn(
        `Chargeback debt created for settlement ${settlement.id}, seller ${settlement.sellerMerchantId}, amount=${settlement.sellerNetCents}, debtId=${debt.id}`,
      );
    } else {
      this.logger.log(
        `Chargeback cancelled settlement ${settlement.id}, status: ${settlement.status} → ${newStatus}`,
      );
    }

    return { settlement: updated, debtCreated, debt };
  }

  /**
   * Chargeback every cross-store settlement of an order. Called from the PSP
   * dispute webhook (charge.dispute.created), where we only know the buyer's
   * order — not the individual settlement ids. Each settlement runs through the
   * same state machine as the single-settlement path: still inside the window
   * (awaiting_return_window / awaiting_chargeback_window) → chargeback_cancelled;
   * already transferred → chargeback_debt (seller owes the money back).
   *
   * No-op (empty result) when the order has no cross-store settlements — i.e. a
   * pure own-store order. Safe to call for every disputed order.
   */
  async executeForOrder(orderId: string): Promise<HandleMarketplaceChargebackOutput[]> {
    const settlements = await this.settlementRepository.findByOrderId(orderId);
    const results: HandleMarketplaceChargebackOutput[] = [];
    for (const s of settlements) {
      // Skip settlements already in a terminal chargeback/return state so a
      // duplicate webhook delivery doesn't double-create debts.
      if (s.status.startsWith("chargeback_") || s.status === "return_cancelled") {
        continue;
      }
      try {
        results.push(await this.execute({ settlementId: s.id }));
      } catch (err) {
        this.logger.error(
          `Chargeback failed for settlement ${s.id} (order ${orderId}): ${(err as Error).message}`,
        );
      }
    }
    return results;
  }
}
