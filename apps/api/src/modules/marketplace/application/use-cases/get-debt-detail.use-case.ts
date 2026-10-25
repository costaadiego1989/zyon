import { Injectable, NotFoundException } from "@nestjs/common";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import type {
  MarketplaceSellerDebtRepository,
  MarketplaceSellerDebtSnapshot,
} from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";

export interface GetDebtDetailInput {
  debtId: string;
  sellerMerchantId: string;
}

export interface DeductionRecord {
  deductedFromSettlementId: string;
  deductedAt: Date | null;
}

export interface GetDebtDetailOutput {
  debt: MarketplaceSellerDebtSnapshot;
  originSettlement: { id: string; orderId: string } | null;
  deductionHistory: DeductionRecord[];
}

@Injectable()
export class GetDebtDetailUseCase {
  constructor(
    private readonly debtRepository: MarketplaceSellerDebtRepository,
    private readonly settlementRepository: MarketplaceSettlementRepository,
  ) {}

  async execute(
    input: GetDebtDetailInput,
  ): Promise<GetDebtDetailOutput> {
    const debt = await this.debtRepository.getById(input.debtId);

    if (!debt) {
      throw new NotFoundException("Debt not found");
    }

    if (debt.sellerMerchantId !== input.sellerMerchantId) {
      throw new NotFoundException("Debt not found");
    }

    // Get origin settlement (the one that triggered debt creation)
    const originSettlement = await this.settlementRepository.getById(
      debt.settlementId,
    );
    if (!originSettlement) {
      throw new NotFoundException("Origin settlement not found");
    }

    // If debt was deducted, get that settlement too
    const deductionHistory: DeductionRecord[] = [];
    if (debt.deductedFromSettlementId) {
      const deductedSettlement = await this.settlementRepository.getById(
        debt.deductedFromSettlementId,
      );
      if (deductedSettlement) {
        deductionHistory.push({
          deductedFromSettlementId: deductedSettlement.id,
          deductedAt: deductedSettlement.transferredAt || new Date(),
        });
      }
    }

    return {
      debt,
      originSettlement: {
        id: originSettlement.id,
        orderId: originSettlement.orderId,
      },
      deductionHistory,
    };
  }
}
