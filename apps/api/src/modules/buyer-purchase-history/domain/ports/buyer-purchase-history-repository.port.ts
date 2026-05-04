import type { BuyerPurchaseHistoryEntity } from "../entities/buyer-purchase-history.entity.js";
import type { PurchaseHistoryIdentity, PurchaseRecord } from "../buyer-purchase-history.types.js";

export const BUYER_PURCHASE_HISTORY_REPOSITORY = Symbol("BUYER_PURCHASE_HISTORY_REPOSITORY");

export interface BuyerPurchaseHistoryRepository {
  getByBuyer(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryEntity | undefined>;
  save(history: BuyerPurchaseHistoryEntity): Promise<BuyerPurchaseHistoryEntity>;
  recordPurchase(purchase: PurchaseRecord): Promise<{ history: BuyerPurchaseHistoryEntity; idempotent: boolean }>;
}
