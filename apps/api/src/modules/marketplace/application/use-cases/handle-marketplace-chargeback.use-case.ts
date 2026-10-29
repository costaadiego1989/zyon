import type { MarketplaceFinancialRepository } from "../../domain/ports/marketplace-financial-repository.port.js";
﻿import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
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
    private readonly financialRepository?: MarketplaceFinancialRepository,
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

  /** Only called by an authenticated provider event or its durable outbox. */
  async executeForOrder(orderId: string, hostMerchantId: string): Promise<HandleMarketplaceChargebackOutput[]> {
    if (!this.financialRepository) throw new Error("marketplace_financial_repository_required");
    return this.financialRepository.chargebackOrder(hostMerchantId, orderId);
  }
}
