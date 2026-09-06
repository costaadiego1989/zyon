import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { MarketplaceSettlementRepository, MarketplaceSettlementSnapshot } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceSellerDebtRepository, MarketplaceSellerDebtSnapshot } from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface HandleMarketplaceChargebackInput {
  settlementId: string;
  merchantId: string;
  role: string;
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
      message: "Chargeback requires provider confirmation. The settlement was not changed.",
    });
  }

  /**
   * Called only after Stripe has verified a provider dispute webhook. It has no
   * merchant-controlled inputs, so it is safe to apply the settlement transition.
   */
  async executeForOrder(orderId: string): Promise<HandleMarketplaceChargebackOutput[]> {
    const settlements = await this.settlementRepository.findByOrderId(orderId);
    const results: HandleMarketplaceChargebackOutput[] = [];
    for (const settlement of settlements) {
      if (!["awaiting_return_window", "transfer_scheduled", "transferred"].includes(settlement.status)) {
        continue;
      }
      try {
        const status = this.stateMachine.transition(settlement.status, "chargeback_received");
        const updated = await this.settlementRepository.updateStatus({
          settlementId: settlement.id,
          expectedStatus: settlement.status,
          status,
          chargebackAt: new Date(),
        });
        const debtCreated = status === "chargeback_debt";
        const debt = debtCreated
          ? await this.debtRepository.create({
              sellerMerchantId: settlement.sellerMerchantId,
              settlementId: settlement.id,
              amountCents: settlement.sellerNetCents,
            })
          : undefined;
        results.push({ settlement: updated, debtCreated, debt });
      } catch (error) {
        this.logger.error(`Marketplace chargeback failed for settlement ${settlement.id} (order ${orderId}): ${(error as Error).message}`);
      }
    }
    return results;
  }
}