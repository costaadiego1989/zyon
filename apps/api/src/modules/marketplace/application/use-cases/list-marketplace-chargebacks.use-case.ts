import { Injectable } from "@nestjs/common";
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

export interface ListMarketplaceChargebacksInput {
  sellerMerchantId: string;
}

export interface ChargebackEntry {
  settlement: MarketplaceSettlementSnapshot;
  debt: MarketplaceSellerDebtSnapshot | null;
  type: "chargeback_cancelled" | "chargeback_debt";
}

export interface ListMarketplaceChargebacksOutput {
  chargebacks: ChargebackEntry[];
  totalDebtCents: number;
  totalCancelled: number;
  totalWithDebt: number;
}

@Injectable()
export class ListMarketplaceChargebacksUseCase {
  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly debtRepository: MarketplaceSellerDebtRepository,
  ) {}

  async execute(
    input: ListMarketplaceChargebacksInput,
  ): Promise<ListMarketplaceChargebacksOutput> {
    // Get all settlements with chargeback states
    const allSettlements = await this.settlementRepository.findBySellerMerchantId(
      input.sellerMerchantId,
    );

    const chargebackSettlements = allSettlements.filter(
      (s) => s.status === "chargeback_cancelled" || s.status === "chargeback_debt",
    );

    // Sort by chargebackAt desc (newest first)
    chargebackSettlements.sort((a, b) => {
      const aDate = a.chargebackAt?.getTime() ?? 0;
      const bDate = b.chargebackAt?.getTime() ?? 0;
      return bDate - aDate;
    });

    // Get debts for chargeback_debt settlements
    const debts = await this.debtRepository.findBySellerMerchantId(
      input.sellerMerchantId,
    );
    const debtBySettlementId = new Map(
      debts.map((d) => [d.settlementId, d]),
    );

    const chargebacks: ChargebackEntry[] = chargebackSettlements.map((s) => ({
      settlement: s,
      debt: debtBySettlementId.get(s.id) ?? null,
      type: s.status as "chargeback_cancelled" | "chargeback_debt",
    }));

    const totalCancelled = chargebacks.filter((c) => c.type === "chargeback_cancelled").length;
    const totalWithDebt = chargebacks.filter((c) => c.type === "chargeback_debt").length;
    const totalDebtCents = chargebacks
      .filter((c) => c.debt)
      .reduce((sum, c) => sum + (c.debt?.amountCents ?? 0), 0);

    return {
      chargebacks,
      totalDebtCents,
      totalCancelled,
      totalWithDebt,
    };
  }
}
