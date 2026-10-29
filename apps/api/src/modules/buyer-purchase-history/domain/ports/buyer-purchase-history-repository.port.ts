import type { BuyerPurchaseHistoryEntity } from "../entities/buyer-purchase-history.entity.js";
import type { BuyerPurchaseHistoryContext, PurchaseHistoryIdentity, PurchaseRecord } from "../buyer-purchase-history.types.js";

export const BUYER_PURCHASE_HISTORY_REPOSITORY = Symbol("BUYER_PURCHASE_HISTORY_REPOSITORY");

export interface BuyerPurchaseHistoryRepository {
  /**
   * Bounded compatibility read for callers that need individual purchase
   * records. Aggregate consumers must use getContext() instead.
   */
  getByBuyer(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryEntity | undefined>;
  getContext(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryContext | undefined>;
  recordPurchase(purchase: PurchaseRecord): Promise<{ ordersCount: number; idempotent: boolean }>;
}
