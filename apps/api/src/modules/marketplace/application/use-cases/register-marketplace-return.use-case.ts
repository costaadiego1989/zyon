import { Injectable, Logger } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
} from "../../domain/ports/marketplace-settlement-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface RegisterMarketplaceReturnInput {
  /** Register the return for every cross-store settlement of this order. */
  orderId?: string;
  /** Or target a single settlement directly. */
  settlementId?: string;
}

export interface RegisterMarketplaceReturnOutput {
  updated: MarketplaceSettlementSnapshot[];
  skipped: Array<{ settlementId: string; reason: string }>;
}

/**
 * Registers a buyer return on the marketplace settlement(s) of a cross-store
 * order. This is the missing link between the support flow (host handles the
 * complaint and routes it to the product owner/seller) and the financial
 * ledger: approving the return moves the settlement `awaiting_return_window`
 * → `return_cancelled` via the state machine, which cancels the seller repasse
 * and makes the return surface in the dashboard Devoluções tab.
 *
 * Only settlements still inside the return window (`awaiting_return_window`)
 * can be returned; once a transfer is scheduled/executed the proper channel is
 * a chargeback (HandleMarketplaceChargebackUseCase), so those are skipped with
 * a reason instead of throwing.
 */
@Injectable()
export class RegisterMarketplaceReturnUseCase {
  private readonly logger = new Logger(RegisterMarketplaceReturnUseCase.name);

  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly stateMachine: SettlementStateMachineService,
  ) {}

  async execute(
    input: RegisterMarketplaceReturnInput,
  ): Promise<RegisterMarketplaceReturnOutput> {
    if (!input.orderId && !input.settlementId) {
      throw new Error("register_return_requires_order_or_settlement");
    }

    const settlements = input.settlementId
      ? await this.oneById(input.settlementId)
      : await this.settlementRepository.findByOrderId(input.orderId!);

    if (settlements.length === 0) {
      throw new Error("no_marketplace_settlement_for_return");
    }

    const updated: MarketplaceSettlementSnapshot[] = [];
    const skipped: Array<{ settlementId: string; reason: string }> = [];

    for (const settlement of settlements) {
      if (settlement.status !== "awaiting_return_window") {
        skipped.push({
          settlementId: settlement.id,
          reason: `not_in_return_window (status=${settlement.status})`,
        });
        continue;
      }
      const newStatus = this.stateMachine.transition(
        settlement.status,
        "buyer_returned",
      );
      const result = await this.settlementRepository.updateStatus({
        settlementId: settlement.id,
        status: newStatus,
        returnAt: new Date(),
      });
      this.logger.log(
        `Return registered: settlement ${settlement.id} ${settlement.status} → ${newStatus} (seller ${settlement.sellerMerchantId}, repasse ${settlement.sellerNetCents} cancelled)`,
      );
      updated.push(result);
    }

    return { updated, skipped };
  }

  private async oneById(
    settlementId: string,
  ): Promise<MarketplaceSettlementSnapshot[]> {
    const s = await this.settlementRepository.getById(settlementId);
    return s ? [s] : [];
  }
}
