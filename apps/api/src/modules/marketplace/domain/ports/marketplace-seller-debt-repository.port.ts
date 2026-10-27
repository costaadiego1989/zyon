export const MARKETPLACE_SELLER_DEBT_REPOSITORY = Symbol(
  "MARKETPLACE_SELLER_DEBT_REPOSITORY",
);

export type SellerDebtStatus = "outstanding" | "deducted" | "resolved" | "extinguished";

export interface MarketplaceSellerDebtSnapshot {
  id: string;
  sellerMerchantId: string;
  settlementId: string;
  amountCents: number;
  /** Derived from immutable receipts; original principal and lifecycle remain unchanged. */
  recoveredAmountCents?: number;
  /** Native reinstatement extinguishes a principal liability without collecting
   * funds from a seller. This amount is never reported as a recovery. */
  extinguishedAmountCents?: number;
  outstandingAmountCents?: number;
  status: SellerDebtStatus;
  deductedFromSettlementId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface CreateSellerDebtInput {
  sellerMerchantId: string;
  settlementId: string;
  amountCents: number;
}

export interface DeductDebtInput {
  debtId: string;
  deductedFromSettlementId: string;
}

export interface MarketplaceSellerDebtRepository {
  create(input: CreateSellerDebtInput): Promise<MarketplaceSellerDebtSnapshot>;
  getById(debtId: string): Promise<MarketplaceSellerDebtSnapshot | undefined>;
  findBySellerMerchantId(
    sellerMerchantId: string,
    status?: SellerDebtStatus,
  ): Promise<MarketplaceSellerDebtSnapshot[]>;
  findOutstandingBySellerMerchantId(
    sellerMerchantId: string,
  ): Promise<MarketplaceSellerDebtSnapshot[]>;
  deductDebt(input: DeductDebtInput): Promise<MarketplaceSellerDebtSnapshot>;
  resolveDebt(debtId: string): Promise<MarketplaceSellerDebtSnapshot>;
}
