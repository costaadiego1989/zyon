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
}
