export const MARKETPLACE_SETTLEMENT_REPOSITORY = Symbol(
  "MARKETPLACE_SETTLEMENT_REPOSITORY",
);

export type SettlementStatus =
  | "awaiting_return_window"
  | "transfer_scheduled"
  | "transferred"
  | "finalized"
  | "return_cancelled"
  | "chargeback_cancelled"
  | "chargeback_debt";

export interface MarketplaceSettlementSnapshot {
  id: string;
  hostMerchantId: string;
  sellerMerchantId: string;
  orderId: string;
  lineItemId: string;
  totalAmountCents: number;
  commissionCents: number;
  sellerNetCents: number;
  status: SettlementStatus;
  returnWindowUntil: Date;
  transferScheduledAt: Date | null;
  chargebackWindowUntil: Date;
  transferredAt: Date | null;
  finalizedAt: Date | null;
  chargebackAt: Date | null;
  returnAt: Date | null;
  providerTransferId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMarketplaceSettlementInput {
  hostMerchantId: string;
  sellerMerchantId: string;
  orderId: string;
  lineItemId: string;
  totalAmountCents: number;
  commissionCents: number;
  sellerNetCents: number;
  returnWindowUntil: Date;
  chargebackWindowUntil: Date;
}

export interface UpdateSettlementStatusInput {
  settlementId: string;
  status: SettlementStatus;
  transferScheduledAt?: Date;
  transferredAt?: Date;
  finalizedAt?: Date;
  chargebackAt?: Date;
  returnAt?: Date;
  providerTransferId?: string;
}

export interface MarketplaceSettlementRepository {
  create(
    input: CreateMarketplaceSettlementInput,
  ): Promise<MarketplaceSettlementSnapshot>;
  getById(settlementId: string): Promise<MarketplaceSettlementSnapshot | undefined>;
  findByLineItemId(lineItemId: string): Promise<MarketplaceSettlementSnapshot | undefined>;
  findByOrderId(orderId: string): Promise<MarketplaceSettlementSnapshot[]>;
  findBySellerMerchantId(
    sellerMerchantId: string,
    status?: SettlementStatus,
  ): Promise<MarketplaceSettlementSnapshot[]>;
  findExpiredReturnWindows(nowDate: Date): Promise<MarketplaceSettlementSnapshot[]>;
  findDueTransfers(nowDate: Date): Promise<MarketplaceSettlementSnapshot[]>;
  findExpiredChargebackWindows(nowDate: Date): Promise<MarketplaceSettlementSnapshot[]>;
  updateStatus(input: UpdateSettlementStatusInput): Promise<MarketplaceSettlementSnapshot>;
}
