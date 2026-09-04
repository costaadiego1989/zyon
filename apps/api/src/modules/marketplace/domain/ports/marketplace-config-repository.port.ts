export const MARKETPLACE_CONFIG_REPOSITORY = Symbol(
  "MARKETPLACE_CONFIG_REPOSITORY",
);

export interface MarketplaceConfigSnapshot {
  id: string;
  merchantId: string;
  enabled: boolean;
  commissionRateBps: number;
  returnWindowDays: number;
  payoutDelayDays: number;
  chargebackWindowDays: number;
  allowedCategories: string[];
  blockedMerchants: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertMarketplaceConfigInput {
  merchantId: string;
  enabled?: boolean;
  commissionRateBps?: number;
  returnWindowDays?: number;
  payoutDelayDays?: number;
  chargebackWindowDays?: number;
  allowedCategories?: string[];
  blockedMerchants?: string[];
}

export interface MarketplaceConfigRepository {
  get(merchantId: string): Promise<MarketplaceConfigSnapshot | undefined>;
  upsert(input: UpsertMarketplaceConfigInput): Promise<MarketplaceConfigSnapshot>;
}
