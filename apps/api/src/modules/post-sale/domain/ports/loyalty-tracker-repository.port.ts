export const LOYALTY_TRACKER_REPOSITORY = Symbol("LOYALTY_TRACKER_REPOSITORY");

export interface BuyerLoyaltyTracker {
  id: string;
  merchantId: string;
  buyerId: string;
  purchaseCount: number;
  totalSpentCents: number;
  lastPurchaseAt: Date | null;
  lastWinBackAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertLoyaltyTrackerInput {
  merchantId: string;
  buyerId: string;
  purchaseCount?: number;
  totalSpentCents?: number;
  lastPurchaseAt?: Date;
  lastWinBackAt?: Date;
}

export interface LoyaltyTrackerRepositoryPort {
  upsert(input: UpsertLoyaltyTrackerInput): Promise<BuyerLoyaltyTracker>;
  findByBuyer(merchantId: string, buyerId: string): Promise<BuyerLoyaltyTracker | null>;
  incrementPurchase(
    merchantId: string,
    buyerId: string,
    amountCents: number
  ): Promise<BuyerLoyaltyTracker>;
  updateLastWinBack(merchantId: string, buyerId: string): Promise<BuyerLoyaltyTracker>;
}
