import { BadRequestException, Injectable } from "@nestjs/common";
import type { MarketplaceFinancialRepository, MarketplaceReturnInput, MarketplaceReturnResult } from "../../domain/ports/marketplace-financial-repository.port.js";

export type RegisterMarketplaceReturnInput = MarketplaceReturnInput;
export type RegisterMarketplaceReturnOutput = MarketplaceReturnResult;

/** Cancellation and payout admission share one transaction and order lock. */
@Injectable()
export class RegisterMarketplaceReturnUseCase {
  constructor(private readonly financial: MarketplaceFinancialRepository) {}

  async execute(input: RegisterMarketplaceReturnInput): Promise<RegisterMarketplaceReturnOutput> {
    if (!input.merchantId?.trim() || (!input.orderId && !input.settlementId)) {
      throw new BadRequestException("register_return_requires_merchant_and_order_or_settlement");
    }
    if ((input.orderId !== undefined && (typeof input.orderId !== "string" || !input.orderId.trim())) ||
        (input.settlementId !== undefined && (typeof input.settlementId !== "string" || !input.settlementId.trim())) ||
        (input.variantIds !== undefined && (!Array.isArray(input.variantIds) || !input.variantIds.length ||
          input.variantIds.length > 100 || input.variantIds.some(id => typeof id !== "string" || !id.trim()))) ||
        (input.items !== undefined && (!Array.isArray(input.items) || !input.items.length || input.items.length > 100 ||
          input.items.some(item => !item || typeof item.variantId !== "string" || !item.variantId.trim() ||
            !Number.isSafeInteger(item.quantity) || item.quantity < 1))) ||
        (input.requestedAt !== undefined && (!(input.requestedAt instanceof Date) || !Number.isFinite(input.requestedAt.getTime()) || input.requestedAt > new Date()))) {
      throw new BadRequestException("invalid_marketplace_return_scope");
    }
    return this.financial.registerReturn(input);
  }
}
