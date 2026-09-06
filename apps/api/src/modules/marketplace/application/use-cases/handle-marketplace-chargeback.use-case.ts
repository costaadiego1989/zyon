import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";

export interface HandleMarketplaceChargebackInput {
  settlementId: string;
  merchantId: string;
  role: string;
}

@Injectable()
export class HandleMarketplaceChargebackUseCase {
  constructor(private readonly settlementRepository: MarketplaceSettlementRepository) {}

  async execute(input: HandleMarketplaceChargebackInput): Promise<never> {
    if (!input.merchantId || !["owner", "admin"].includes(input.role)) {
      throw new ForbiddenException("chargeback_not_authorized");
    }
    const settlement = await this.settlementRepository.getByIdForMerchant(input.settlementId, input.merchantId);
    if (!settlement || (settlement.hostMerchantId !== input.merchantId && settlement.sellerMerchantId !== input.merchantId)) {
      throw new NotFoundException("settlement_not_found");
    }

    // A dashboard action is not evidence of a chargeback from the payment provider.
    // Keep financial state intact until a verified event can atomically record debt.
    throw new ServiceUnavailableException({
      code: "chargeback_provider_confirmation_required",
      message: "O chargeback depende de confirmação do provedor. A liquidação não foi alterada.",
    });
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
