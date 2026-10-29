import type { MarketplaceSettlementSnapshot } from "./marketplace-settlement-repository.port.js";
import type { MarketplaceSellerDebtSnapshot } from "./marketplace-seller-debt-repository.port.js";

export const MARKETPLACE_FINANCIAL_REPOSITORY = Symbol("MARKETPLACE_FINANCIAL_REPOSITORY");
export interface PlaceMarketplaceOrder {
  hostMerchantId: string;
  checkoutSessionId: string;
  orderId: string;
  purchasedAt?: Date;
}
export interface MarketplaceChargebackResult {
  settlement: MarketplaceSettlementSnapshot;
  debtCreated: boolean;
  debt?: MarketplaceSellerDebtSnapshot;
}
export interface MarketplaceReturnInput {
  merchantId: string;
  orderId?: string;
  settlementId?: string;
  variantIds?: string[];
  items?: Array<{ variantId: string; quantity: number }>;
  requestedAt?: Date;
}
export interface MarketplaceReturnResult {
  updated: MarketplaceSettlementSnapshot[];
  skipped: Array<{ settlementId: string; reason: string }>;
}
export interface MarketplaceFinancialRepository {
  placeOrder(input: PlaceMarketplaceOrder): Promise<MarketplaceSettlementSnapshot[]>;
  chargebackOrder(hostMerchantId: string, orderId: string): Promise<MarketplaceChargebackResult[]>;
  registerReturn(input: MarketplaceReturnInput): Promise<MarketplaceReturnResult>;
}
