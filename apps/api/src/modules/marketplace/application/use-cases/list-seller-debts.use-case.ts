import { Injectable } from "@nestjs/common";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import type {
  MarketplaceSellerDebtRepository,
  MarketplaceSellerDebtSnapshot,
  SellerDebtStatus,
} from "../../domain/ports/marketplace-seller-debt-repository.port.js";

export interface ListSellerDebtsInput {
  sellerMerchantId: string;
  status?: SellerDebtStatus;
}

export interface ListSellerDebtsOutput {
  debts: MarketplaceSellerDebtSnapshot[];
  totalOutstandingCents: number;
  totalDeductedCents: number;
  totalResolvedCents: number;
}

@Injectable()
export class ListSellerDebtsUseCase {
  constructor(
    private readonly debtRepository: MarketplaceSellerDebtRepository,
  ) {}

  async execute(input: ListSellerDebtsInput): Promise<ListSellerDebtsOutput> {
    const debts = await this.debtRepository.findBySellerMerchantId(
      input.sellerMerchantId,
      input.status,
    );

    const totalOutstandingCents = debts
      .filter((d) => d.status === "outstanding")
      .reduce((sum, d) => sum + d.amountCents, 0);

    const totalDeductedCents = debts
      .filter((d) => d.status === "deducted")
      .reduce((sum, d) => sum + d.amountCents, 0);

    const totalResolvedCents = debts
      .filter((d) => d.status === "resolved")
      .reduce((sum, d) => sum + d.amountCents, 0);

    return {
      debts,
      totalOutstandingCents,
      totalDeductedCents,
      totalResolvedCents,
    };
  }
}
